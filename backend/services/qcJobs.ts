/**
 * [BACKEND] QC 작업 (담당자 실행)
 *
 * 담당자(user)는 본인 tester(users.tester_id)에 배정된 오더를 시작한다.
 * 시작 시 QC번호 채번 + 시험항목(product_test_items) 기준 체크리스트 생성.
 * 항목 클리어 시 시간 적재 + 감독관(admin) 알림. 상태 변경 시에도 알림.
 * 시작 전 장비 준비상태(검교정+가용성) 자동 검증 연동.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { generateQcNo } from '@backend/lib/qcNumber'
import { createNotification } from '@backend/services/notifications'
import { checkEquipmentReadiness, type ReadinessResult } from '@backend/services/equipmentMaster'
import { listByProduct, type PretestNoteRow } from '@backend/services/productPretestNotes'

export interface JobItemRow {
  id: string
  testItemName: string
  sequenceOrder: number
  status: string
  clearedAt: string | null
  elapsedMinutes: number | null
}
export interface QcJobRow {
  id: string
  orderId: string
  qcNo: string
  productName: string
  batchNo: string
  workStartDate: string | null
  workEndDate: string | null
  status: string
  isUrgent: boolean
  dueDate: string | null
  items: JobItemRow[]
}
export interface PendingOrderRow {
  id: string
  productCode: string
  productName: string
  batchNo: string
  dueDate: string | null
  isUrgent: boolean
  method: string
}

/**
 * 로그인 사용자의 tester_id 조회.
 * 사용자·시험자 통합 모델에서 로그인 ID(username) = 시험자 사번(employee_no) 이므로,
 * users.tester_id 가 비어 있어도 사번이 같은 시험자를 찾아 즉시 연결(자가복구)한다.
 * (재시드·수동 편집 등으로 1:1 링크가 끊긴 계정도 다음 접근 시 자동 복구)
 */
async function getTesterId(userSub: string): Promise<string | null> {
  const { data: user } = await supabaseAdmin
    .from('users').select('tester_id, username').eq('id', userSub).maybeSingle()
  if (!user) return null
  if (user.tester_id) return user.tester_id as string

  // 링크 누락 — 사번(=username)이 동일한 시험자로 자가복구
  const username = user.username as string | undefined
  if (!username) return null
  const { data: tester } = await supabaseAdmin
    .from('testers').select('id').eq('employee_no', username).maybeSingle()
  if (!tester?.id) return null

  const testerId = tester.id as string
  // 다른 사용자가 이 시험자를 점유 중이면 먼저 해제(1:1 unique 유지) 후 연결
  await supabaseAdmin.from('users').update({ tester_id: null }).eq('tester_id', testerId).neq('id', userSub)
  await supabaseAdmin.from('users').update({ tester_id: testerId }).eq('id', userSub)
  return testerId
}

/**
 * 오더의 품목코드로부터 필요 장비코드 목록을 수집한다.
 * products → product_test_items → test_items(name) → test_item_equipment(required_equipment)
 * required_equipment 문자열을 다중구분자 /[,/+]/ 로 토큰화, 중복 제거하여 반환.
 * ('_'는 복합 장비코드(UV_VIS, SHIMADZU_HPLC, LCMS_TQ 등)의 일부라 분할하지 않음 — 장비 마스터 코드와 정합)
 * 오류 발생 시 빈 배열로 폴백 (throw 금지).
 */
export async function resolveOrderEquipmentCodes(productCode: string): Promise<string[]> {
  try {
    const { data: prod } = await supabaseAdmin
      .from('products').select('id').eq('product_code', productCode).maybeSingle()
    if (!prod?.id) return []

    const { data: pti } = await supabaseAdmin
      .from('product_test_items')
      .select('test_items!inner(name)')
      .eq('product_id', prod.id)
    const testItemNames = (pti ?? []).map(r => (r as unknown as { test_items: { name: string } }).test_items.name)
    if (testItemNames.length === 0) return []

    const { data: eqRows } = await supabaseAdmin
      .from('test_item_equipment')
      .select('required_equipment')
      .in('test_item', testItemNames)
    const codes = new Set<string>()
    for (const row of eqRows ?? []) {
      const raw = (row.required_equipment as string | null) ?? ''
      for (const token of raw.split(/[,/+]/)) {
        const t = token.trim()
        if (t) codes.add(t)
      }
    }
    return Array.from(codes)
  } catch {
    return []
  }
}

/**
 * 오더 시작 전 준비상태 조회.
 * - 장비: 오더의 product_code → 장비코드 목록 → checkEquipmentReadiness(오늘 기준).
 * - 시험 전 확인사항: product_code → products.id → product_pretest_notes.
 * 두 정보를 함께 반환해 시작 모달에서 한 번에 확인할 수 있게 한다.
 */
export async function getStartReadiness(
  orderId: string,
): Promise<ReadinessResult & { equipmentCodes: string[]; pretestNotes: PretestNoteRow[] }> {
  const { data: order } = await supabaseAdmin
    .from('pct_orders').select('product_code').eq('id', orderId).maybeSingle()
  const productCode = (order?.product_code as string) ?? ''

  // 시험 전 확인사항 (product_code → products.id → product_pretest_notes)
  let pretestNotes: PretestNoteRow[] = []
  if (productCode) {
    const { data: prod } = await supabaseAdmin
      .from('products').select('id').eq('product_code', productCode).maybeSingle()
    if (prod?.id) pretestNotes = await listByProduct(prod.id as string)
  }

  const equipmentCodes = productCode ? await resolveOrderEquipmentCodes(productCode) : []
  const date = new Date().toISOString().slice(0, 10)
  if (equipmentCodes.length === 0) {
    // 장비 없으면 장비 검증은 OK (확인사항은 별도 반환)
    return { ok: true, checks: [], equipmentCodes, pretestNotes }
  }
  const readiness = await checkEquipmentReadiness({ equipmentCodes, date })
  return { ...readiness, equipmentCodes, pretestNotes }
}

/**
 * 담당자 작업 화면 데이터.
 * - pendingOrders: 내 tester 배정 + 아직 작업 미시작
 * - jobs: 내가 시작한 작업(+항목)
 */
export async function listWorkspace(userSub: string): Promise<{ testerLinked: boolean; pendingOrders: PendingOrderRow[]; jobs: QcJobRow[] }> {
  const testerId = await getTesterId(userSub)
  if (!testerId) return { testerLinked: false, pendingOrders: [], jobs: [] }

  // 내 작업
  const { data: jobRows } = await supabaseAdmin
    .from('qc_jobs')
    .select('id, order_id, qc_no, work_start_date, work_end_date, status')
    .eq('assignee_user_id', userSub)
    .order('created_at', { ascending: false })

  const jobOrderIds = (jobRows ?? []).map(j => j.order_id as string)

  // 오더 정보 (작업/대기 공통)
  const { data: orderRows } = await supabaseAdmin
    .from('pct_orders')
    .select('id, product_code, product_name, batch_no, due_date, is_urgent, method, status, assignee_tester_id')
    .eq('assignee_tester_id', testerId)
    .neq('status', '삭제')
  const orderById = new Map<string, Record<string, unknown>>()
  for (const o of orderRows ?? []) orderById.set(o.id as string, o)

  // 작업 항목
  const jobIds = (jobRows ?? []).map(j => j.id as string)
  const itemsByJob = new Map<string, JobItemRow[]>()
  if (jobIds.length > 0) {
    const { data: items } = await supabaseAdmin
      .from('qc_job_items')
      .select('id, qc_job_id, test_item_name, sequence_order, status, cleared_at, elapsed_minutes')
      .in('qc_job_id', jobIds)
      .order('sequence_order', { ascending: true })
    for (const it of items ?? []) {
      const arr = itemsByJob.get(it.qc_job_id as string) ?? []
      arr.push({
        id: it.id as string,
        testItemName: it.test_item_name as string,
        sequenceOrder: it.sequence_order as number,
        status: it.status as string,
        clearedAt: (it.cleared_at as string) ?? null,
        elapsedMinutes: (it.elapsed_minutes as number) ?? null,
      })
      itemsByJob.set(it.qc_job_id as string, arr)
    }
  }

  const jobs: QcJobRow[] = (jobRows ?? []).map(j => {
    const o = orderById.get(j.order_id as string)
    return {
      id: j.id as string,
      orderId: j.order_id as string,
      qcNo: j.qc_no as string,
      productName: (o?.product_name as string) ?? '',
      batchNo: (o?.batch_no as string) ?? '',
      workStartDate: (j.work_start_date as string) ?? null,
      workEndDate: (j.work_end_date as string) ?? null,
      status: j.status as string,
      isUrgent: !!o?.is_urgent,
      dueDate: (o?.due_date as string) ?? null,
      items: itemsByJob.get(j.id as string) ?? [],
    }
  })

  const pendingOrders: PendingOrderRow[] = (orderRows ?? [])
    .filter(o => !jobOrderIds.includes(o.id as string) && o.status === '대기')
    .map(o => ({
      id: o.id as string,
      productCode: o.product_code as string,
      productName: o.product_name as string,
      batchNo: o.batch_no as string,
      dueDate: (o.due_date as string) ?? null,
      isUrgent: !!o.is_urgent,
      method: o.method as string,
    }))

  return { testerLinked: true, pendingOrders, jobs }
}

/** 작업 시작 — 장비 준비상태 검증 + QC번호 채번 + 항목 체크리스트 생성 + 오더 상태 진행중 + 알림 */
export async function startJob(orderId: string, userSub: string): Promise<{ jobId: string; qcNo: string; warnings?: string[] }> {
  const testerId = await getTesterId(userSub)

  const { data: order, error: oErr } = await supabaseAdmin
    .from('pct_orders')
    .select('id, product_code, product_name, batch_no, assignee_tester_id')
    .eq('id', orderId)
    .single()
  if (oErr) throw oErr

  // 본인 배정 검증
  if (testerId && order.assignee_tester_id && order.assignee_tester_id !== testerId) {
    throw new Error('본인에게 배정된 오더만 시작할 수 있습니다.')
  }

  // 장비 준비상태 검증
  const readiness = await getStartReadiness(orderId)
  const blockedChecks = readiness.checks.filter(c => c.blocked)
  if (!readiness.ok && blockedChecks.length > 0) {
    const reasons = blockedChecks.map(c => c.reason ?? c.name).join(', ')
    throw new Error(`장비 검증 실패: ${reasons}`)
  }
  const warningChecks = readiness.checks.filter(c => c.warning && !c.blocked)
  const warnings = warningChecks.length > 0
    ? warningChecks.map(c => c.warning ?? c.reason ?? c.name ?? c.code)
    : undefined

  // 채번 (충돌 시 1회 재시도)
  let qcNo = await generateQcNo()
  let jobId = ''
  const today = new Date().toISOString().slice(0, 10)
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabaseAdmin
      .from('qc_jobs')
      .insert({ order_id: orderId, qc_no: qcNo, assignee_tester_id: testerId, assignee_user_id: userSub, status: '진행중', work_start_date: today })
      .select('id')
      .single()
    if (!error) { jobId = data.id as string; break }
    if (error.code === '23505') { qcNo = await generateQcNo(); continue }  // unique 충돌
    throw error
  }
  if (!jobId) throw new Error('작업 생성에 실패했습니다.')

  // 시험항목 → 체크리스트
  const { data: prod } = await supabaseAdmin.from('products').select('id').eq('product_code', order.product_code).maybeSingle()
  if (prod?.id) {
    const { data: pti } = await supabaseAdmin
      .from('product_test_items')
      .select('sequence_order, test_items!inner(name)')
      .eq('product_id', prod.id)
      .order('sequence_order', { ascending: true })
    const items = (pti ?? []).map((r, idx) => ({
      qc_job_id: jobId,
      test_item_name: (r as unknown as { test_items: { name: string } }).test_items.name,
      sequence_order: (r.sequence_order as number) ?? idx,
    }))
    if (items.length > 0) await supabaseAdmin.from('qc_job_items').insert(items)
  }

  // 오더 상태 진행중
  await supabaseAdmin.from('pct_orders').update({ status: '진행중' }).eq('id', orderId)

  // 감독관 알림 (경고 있으면 본문에 덧붙임)
  const warnSuffix = warnings ? ` ⚠ 경고: ${warnings.join(', ')}` : ''
  await createNotification({
    type: 'status_changed',
    title: '작업 시작',
    body: `${order.product_name} / ${order.batch_no} — QC ${qcNo} 작업이 시작되었습니다.${warnSuffix}`,
    relatedOrderId: orderId, relatedQcJobId: jobId, severity: 'info',
  })

  return { jobId, qcNo, ...(warnings ? { warnings } : {}) }
}

/** 시작/종료일 수정 */
export async function updateJobDates(jobId: string, userSub: string, dates: { workStartDate?: string | null; workEndDate?: string | null }): Promise<void> {
  await assertOwner(jobId, userSub)
  const patch: Record<string, unknown> = {}
  if ('workStartDate' in dates) patch.work_start_date = dates.workStartDate || null
  if ('workEndDate' in dates) patch.work_end_date = dates.workEndDate || null
  if (Object.keys(patch).length === 0) return
  const { error } = await supabaseAdmin.from('qc_jobs').update(patch).eq('id', jobId)
  if (error) throw error
}

/** 항목 클리어 — 시간 적재 + 감독관 알림 */
export async function clearItem(jobId: string, itemId: string, userSub: string): Promise<void> {
  await assertOwner(jobId, userSub)
  const now = new Date()

  // 직전 클리어(또는 작업 시작) 이후 경과시간 산정
  const { data: job } = await supabaseAdmin.from('qc_jobs').select('created_at, order_id').eq('id', jobId).single()
  const { data: lastCleared } = await supabaseAdmin
    .from('qc_job_items').select('cleared_at')
    .eq('qc_job_id', jobId).eq('status', 'cleared')
    .order('cleared_at', { ascending: false }).limit(1).maybeSingle()
  const baseTime = new Date((lastCleared?.cleared_at as string) ?? (job?.created_at as string) ?? now.toISOString())
  const elapsed = Math.max(0, Math.round((now.getTime() - baseTime.getTime()) / 60000))

  const { data: item, error } = await supabaseAdmin
    .from('qc_job_items')
    .update({ status: 'cleared', cleared_at: now.toISOString(), elapsed_minutes: elapsed })
    .eq('id', itemId).eq('qc_job_id', jobId)
    .select('test_item_name')
    .single()
  if (error) throw error

  await createNotification({
    type: 'item_cleared',
    title: '시험항목 완료',
    body: `시험항목 "${item.test_item_name}" 완료 (소요 ${elapsed}분)`,
    relatedOrderId: (job?.order_id as string) ?? null,
    relatedQcJobId: jobId, severity: 'info',
  })
}

/** 작업 상태 변경 — 오더 상태 동기화 + 감독관 알림.
 *  status === '완료' 이면 work_end_date를 오늘로 설정(이미 설정된 경우 유지).
 */
export async function changeJobStatus(jobId: string, userSub: string, status: string): Promise<void> {
  await assertOwner(jobId, userSub)
  const patch: Record<string, unknown> = { status }
  if (status === '완료') {
    // 기존 work_end_date가 없을 때만 오늘로 설정
    const { data: existing } = await supabaseAdmin
      .from('qc_jobs').select('work_end_date').eq('id', jobId).maybeSingle()
    if (!existing?.work_end_date) {
      patch.work_end_date = new Date().toISOString().slice(0, 10)
    }
  }
  const { data: job, error } = await supabaseAdmin
    .from('qc_jobs').update(patch).eq('id', jobId)
    .select('order_id').single()
  if (error) throw error
  await supabaseAdmin.from('pct_orders').update({ status }).eq('id', job.order_id)
  await createNotification({
    type: 'status_changed',
    title: '상태 변경',
    body: `작업 상태가 "${status}" 로 변경되었습니다.`,
    relatedOrderId: job.order_id as string, relatedQcJobId: jobId, severity: 'info',
  })
}

async function assertOwner(jobId: string, userSub: string): Promise<void> {
  const { data } = await supabaseAdmin.from('qc_jobs').select('assignee_user_id').eq('id', jobId).maybeSingle()
  if (!data) throw new Error('작업을 찾을 수 없습니다.')
  if (data.assignee_user_id !== userSub) throw new Error('본인 작업만 수정할 수 있습니다.')
}
