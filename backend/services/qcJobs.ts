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
import { METHOD_PARTIAL, listByOrder as listOrderTestItems } from '@backend/services/pctOrderTestItems'
import {
  ACTIVE_JOB_STATUSES,
  APPROVAL_READY_STATUS,
  CLOSED_STAGE,
  DELAYED_STATUS,
  DELETED_STATUS,
  IN_PROGRESS_STATUS,
  NEXT_STAGE,
  PENDING_STATUS,
  REVIEWING_STATUS,
  REVIEW_READY_STATUS,
  STAGE_ACTION_LABEL,
  canAdvanceByAdmin,
  isJobStage,
  type JobStage,
} from '@shared/qc-status'

export interface JobItemRow {
  id: string
  testItemName: string
  sequenceOrder: number
  status: string
  clearedAt: string | null
  /** 직전 항목 완료(첫 항목은 작업 시작) 이후 구간 소요 분 — 통계·평가 기준 */
  elapsedMinutes: number | null
  /** 작업 시작부터 이 항목 완료까지 누적 소요 분 — 작업 화면 표시 기준 */
  elapsedTotalMinutes: number | null
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
    .neq('status', DELETED_STATUS)
  const orderById = new Map<string, Record<string, unknown>>()
  for (const o of orderRows ?? []) orderById.set(o.id as string, o)

  // 작업 항목
  const jobIds = (jobRows ?? []).map(j => j.id as string)
  const itemsByJob = new Map<string, JobItemRow[]>()
  if (jobIds.length > 0) {
    const { data: items } = await supabaseAdmin
      .from('qc_job_items')
      .select('id, qc_job_id, test_item_name, sequence_order, status, cleared_at, elapsed_minutes, elapsed_total_minutes')
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
        elapsedTotalMinutes: (it.elapsed_total_minutes as number) ?? null,
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
    .filter(o => !jobOrderIds.includes(o.id as string) && o.status === PENDING_STATUS)
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

// ─── 작업자 현황 (관리자 한눈에 보기) ──────────────────────────────────────────
export interface OverviewJobRow {
  jobId: string
  qcNo: string
  productName: string
  batchNo: string
  status: string
  dueDate: string | null
  isUrgent: boolean
  itemsTotal: number
  itemsCleared: number
  workStartDate: string | null
}
export interface OverviewPendingRow {
  orderId: string
  productName: string
  batchNo: string
  dueDate: string | null
  isUrgent: boolean
}
export interface WorkerOverviewRow {
  testerId: string
  name: string
  employeeNo: string
  isActive: boolean
  pendingCount: number
  inProgress: number
  reviewing: number
  delayed: number
  completedTotal: number
  activeJobs: OverviewJobRow[]
  pendingOrders: OverviewPendingRow[]
}
export interface WorkerOverview {
  totals: {
    workingTesters: number   // 진행중/대기 업무가 있는 시험자 수
    activeJobs: number       // 진행중·검토중·지연 작업 총수
    pending: number          // 시작 대기 오더 총수
    delayed: number          // 지연 작업 총수
    completedToday: number   // 오늘 완료한 작업 수
  }
  workers: WorkerOverviewRow[]
}

// 진행 중으로 간주하는 작업 상태는 @shared/qc-status 의 ACTIVE_JOB_STATUSES 를 쓴다.

// ─── 작업 상세 (시험항목 진행 내역) ──────────────────────────────────────────
export interface JobDetail {
  jobId: string
  qcNo: string
  status: string
  workStartDate: string | null
  workEndDate: string | null
  /** 작업 시작 버튼을 누른 시각 — 항목 누적 소요시간의 기준점 */
  workStartedAt: string | null
  createdAt: string | null
  orderId: string
  productCode: string | null
  productName: string
  batchNo: string
  dueDate: string | null
  isUrgent: boolean
  method: string | null
  testerName: string | null
  testerEmployeeNo: string | null
  items: JobItemRow[]
  /** 현재 수행 중으로 간주되는 항목 id (미완료 중 sequence_order 최소). 작업이 활성 상태가 아니면 null */
  currentItemId: string | null
  /** 현재 항목을 시작한 시각 = 직전 클리어 시각 ?? 작업 시작 시각 (clearItem 의 구간 소요시간 기준과 동일) */
  currentItemStartedAt: string | null
  /** 관리자가 버튼으로 넘길 수 있는 다음 단계. 없으면 null */
  nextStage: string | null
  /** 그 버튼에 표시할 라벨 (예: '검토 시작'). 없으면 null */
  nextStageLabel: string | null
}

/**
 * 작업 상세 조회 — 어떤 시험항목을 수행 중인지 확인용 (관리자 작업현황 화면).
 *
 * qc_job_items 에는 'pending' | 'cleared' 두 상태만 있고 항목별 "진행중" 플래그가 없다.
 * clearItem 이 직전 cleared_at 을 기준으로 경과시간을 적재하는 순차 처리 모델이므로,
 * 미완료 항목 중 sequence_order 가 가장 작은 항목을 현재 수행 항목으로 간주한다.
 */
export async function getJobDetail(jobId: string): Promise<JobDetail | null> {
  const { data: job } = await supabaseAdmin
    .from('qc_jobs')
    .select('id, order_id, qc_no, status, work_start_date, work_end_date, work_started_at, created_at, assignee_tester_id')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return null

  const [orderRes, testerRes, itemsRes] = await Promise.all([
    supabaseAdmin
      .from('pct_orders')
      .select('id, product_code, product_name, batch_no, due_date, is_urgent, method')
      .eq('id', job.order_id as string)
      .maybeSingle(),
    job.assignee_tester_id
      ? supabaseAdmin.from('testers').select('name, employee_no').eq('id', job.assignee_tester_id as string).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin
      .from('qc_job_items')
      .select('id, test_item_name, sequence_order, status, cleared_at, elapsed_minutes, elapsed_total_minutes')
      .eq('qc_job_id', jobId)
      .order('sequence_order', { ascending: true }),
  ])

  const order = orderRes.data as Record<string, unknown> | null
  const tester = testerRes.data as Record<string, unknown> | null

  const items: JobItemRow[] = (itemsRes.data ?? []).map(it => ({
    id: it.id as string,
    testItemName: it.test_item_name as string,
    sequenceOrder: it.sequence_order as number,
    status: it.status as string,
    clearedAt: (it.cleared_at as string) ?? null,
    elapsedMinutes: (it.elapsed_minutes as number) ?? null,
    elapsedTotalMinutes: (it.elapsed_total_minutes as number) ?? null,
  }))

  const status = job.status as string
  // "현재 수행 중인 항목"은 아직 시험을 하고 있는 단계에서만 의미가 있다.
  // 검토전 이후 단계는 시험이 끝난 상태라 현재 항목을 표시하지 않는다.
  const testing = status === IN_PROGRESS_STATUS || status === DELAYED_STATUS
  const current = testing
    ? items.find(i => i.status !== 'cleared') ?? null
    : null

  // 직전 클리어 시각(가장 늦은 cleared_at) — 없으면 작업 시작 시각
  const lastClearedAt = items
    .filter(i => i.clearedAt)
    .map(i => i.clearedAt as string)
    .sort()
    .at(-1) ?? null

  // 0030 이전 작업은 work_started_at 이 비어 있어 created_at 으로 대체
  const workStartedAt = (job.work_started_at as string) ?? (job.created_at as string) ?? null

  return {
    jobId: job.id as string,
    qcNo: job.qc_no as string,
    status,
    workStartDate: (job.work_start_date as string) ?? null,
    workEndDate: (job.work_end_date as string) ?? null,
    workStartedAt: workStartedAt,
    createdAt: (job.created_at as string) ?? null,
    orderId: job.order_id as string,
    productCode: (order?.product_code as string) ?? null,
    productName: (order?.product_name as string) ?? '',
    batchNo: (order?.batch_no as string) ?? '',
    dueDate: (order?.due_date as string) ?? null,
    isUrgent: !!order?.is_urgent,
    method: (order?.method as string) ?? null,
    testerName: (tester?.name as string) ?? null,
    testerEmployeeNo: (tester?.employee_no as string) ?? null,
    items,
    currentItemId: current?.id ?? null,
    currentItemStartedAt: current ? (lastClearedAt ?? workStartedAt) : null,
    nextStage: canAdvanceByAdmin(status) ? NEXT_STAGE[status] : null,
    nextStageLabel: canAdvanceByAdmin(status) ? STAGE_ACTION_LABEL[status] : null,
  }
}

/**
 * 작업자(시험자)별 작업 현황 집계 — 관리자가 "내 작업"을 수행 중인 작업자들의
 * 진행 상황을 한눈에 보기 위한 뷰. 기존 테이블만 읽어 JS에서 집계한다.
 *  - testers       : 활성 시험자 목록
 *  - qc_jobs       : 시험자별 작업(진행중/검토중/지연/완료)
 *  - qc_job_items  : 작업별 항목 진행률(완료/전체)
 *  - pct_orders    : 작업 메타(품목·제조번호·완료예정·긴급) + 시작 대기 오더
 */
export async function listWorkerOverview(): Promise<WorkerOverview> {
  const today = new Date().toISOString().slice(0, 10)

  // 1) 시험자
  const { data: testerData } = await supabaseAdmin
    .from('testers')
    .select('id, employee_no, name, is_active')
    .order('employee_no', { ascending: true })
  const testers = (testerData ?? []) as Record<string, unknown>[]

  // 2) 작업 + 3) 오더 (삭제 제외) 병렬
  const [jobsRes, ordersRes] = await Promise.all([
    supabaseAdmin
      .from('qc_jobs')
      .select('id, order_id, qc_no, assignee_tester_id, status, work_start_date, work_end_date')
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('pct_orders')
      .select('id, product_name, batch_no, due_date, is_urgent, status, assignee_tester_id')
      .neq('status', DELETED_STATUS),
  ])
  const jobRows = (jobsRes.data ?? []) as Record<string, unknown>[]
  const orderRows = (ordersRes.data ?? []) as Record<string, unknown>[]
  const orderById = new Map<string, Record<string, unknown>>()
  for (const o of orderRows) orderById.set(o.id as string, o)

  // 4) 작업 항목 진행률 (완료/전체)
  const jobIds = jobRows.map(j => j.id as string)
  const itemAgg = new Map<string, { total: number; cleared: number }>()
  if (jobIds.length > 0) {
    const { data: items } = await supabaseAdmin
      .from('qc_job_items')
      .select('qc_job_id, status')
      .in('qc_job_id', jobIds)
    for (const it of items ?? []) {
      const jid = it.qc_job_id as string
      const agg = itemAgg.get(jid) ?? { total: 0, cleared: 0 }
      agg.total += 1
      if (it.status === 'cleared') agg.cleared += 1
      itemAgg.set(jid, agg)
    }
  }

  // 시험자별 빈 행 초기화
  const rowByTester = new Map<string, WorkerOverviewRow>()
  for (const t of testers) {
    rowByTester.set(t.id as string, {
      testerId: t.id as string,
      name: t.name as string,
      employeeNo: t.employee_no as string,
      isActive: !!t.is_active,
      pendingCount: 0,
      inProgress: 0,
      reviewing: 0,
      delayed: 0,
      completedTotal: 0,
      activeJobs: [],
      pendingOrders: [],
    })
  }

  let completedToday = 0
  const startedOrderIds = new Set<string>()

  // 작업 집계
  for (const j of jobRows) {
    const testerId = j.assignee_tester_id as string | null
    startedOrderIds.add(j.order_id as string)
    if (!testerId) continue
    const row = rowByTester.get(testerId)
    if (!row) continue

    const status = j.status as string
    const o = orderById.get(j.order_id as string)
    if (status === CLOSED_STAGE) {
      row.completedTotal += 1
      if ((j.work_end_date as string) === today) completedToday += 1
      continue
    }
    if (!ACTIVE_JOB_STATUSES.has(status)) continue

    if (status === IN_PROGRESS_STATUS) row.inProgress += 1
    // 검토전·검토중·승인전은 모두 "시험은 끝나고 후속 절차 대기" — 검토 카운터로 함께 센다
    else if (status === REVIEW_READY_STATUS || status === REVIEWING_STATUS || status === APPROVAL_READY_STATUS) row.reviewing += 1
    else if (status === DELAYED_STATUS) row.delayed += 1

    const agg = itemAgg.get(j.id as string) ?? { total: 0, cleared: 0 }
    row.activeJobs.push({
      jobId: j.id as string,
      qcNo: j.qc_no as string,
      productName: (o?.product_name as string) ?? '',
      batchNo: (o?.batch_no as string) ?? '',
      status,
      dueDate: (o?.due_date as string) ?? null,
      isUrgent: !!o?.is_urgent,
      itemsTotal: agg.total,
      itemsCleared: agg.cleared,
      workStartDate: (j.work_start_date as string) ?? null,
    })
  }

  // 시작 대기 오더 집계 (배정됐고 status '대기' & 아직 미시작)
  for (const o of orderRows) {
    if (o.status !== PENDING_STATUS) continue
    const testerId = o.assignee_tester_id as string | null
    if (!testerId) continue
    if (startedOrderIds.has(o.id as string)) continue
    const row = rowByTester.get(testerId)
    if (!row) continue
    row.pendingCount += 1
    row.pendingOrders.push({
      orderId: o.id as string,
      productName: o.product_name as string,
      batchNo: o.batch_no as string,
      dueDate: (o.due_date as string) ?? null,
      isUrgent: !!o.is_urgent,
    })
  }

  // 완료예정 임박 순으로 활성 작업 정렬 (null은 뒤로)
  const dueRank = (d: string | null) => (d ? new Date(d).getTime() : Number.MAX_SAFE_INTEGER)
  for (const row of rowByTester.values()) {
    row.activeJobs.sort((a, b) => dueRank(a.dueDate) - dueRank(b.dueDate))
    row.pendingOrders.sort((a, b) => dueRank(a.dueDate) - dueRank(b.dueDate))
  }

  // 작업량 많은 순(진행중→대기) 정렬, 활성 시험자 우선
  const workers = [...rowByTester.values()].sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
    const aLoad = a.activeJobs.length + a.pendingCount
    const bLoad = b.activeJobs.length + b.pendingCount
    if (aLoad !== bLoad) return bLoad - aLoad
    return a.employeeNo.localeCompare(b.employeeNo)
  })

  const totals = {
    workingTesters: workers.filter(w => w.activeJobs.length > 0 || w.pendingCount > 0).length,
    activeJobs: workers.reduce((s, w) => s + w.activeJobs.length, 0),
    pending: workers.reduce((s, w) => s + w.pendingCount, 0),
    delayed: workers.reduce((s, w) => s + w.delayed, 0),
    completedToday,
  }

  return { totals, workers }
}

/** 작업 시작 — 장비 준비상태 검증 + QC번호 채번 + 항목 체크리스트 생성 + 오더 상태 진행중 + 알림 */
export async function startJob(orderId: string, userSub: string): Promise<{ jobId: string; qcNo: string; warnings?: string[] }> {
  const testerId = await getTesterId(userSub)

  const { data: order, error: oErr } = await supabaseAdmin
    .from('pct_orders')
    .select('id, product_code, product_name, batch_no, assignee_tester_id, method')
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

  // 체크리스트에 넣을 항목을 작업 생성 '전에' 확정한다.
  //  - 개별항목: 오더 생성 시 고른 항목만 (pct_order_test_items)
  //  - 전항목  : 품목에 등록된 시험항목 전체 (product_test_items)
  // 작업을 만든 뒤에 실패하면 QC번호만 소모된 빈 작업이 남으므로 순서가 중요하다.
  const plannedItems: Array<{ test_item_name: string; sequence_order: number }> = []
  if (order.method === METHOD_PARTIAL) {
    const selected = await listOrderTestItems(orderId)
    if (selected.length === 0) {
      // 오더 수정으로 진행방법만 개별항목으로 바뀌면 선택 목록이 비어 있을 수 있다.
      // 품목 전체로 대체하면 '개별항목' 지시와 어긋난 체크리스트가 되므로 시작을 막는다.
      throw new Error('진행방법이 「개별항목」인데 배정된 시험항목이 없습니다. 관리자에게 오더의 시험항목 지정을 요청하세요.')
    }
    selected.forEach((it, idx) => plannedItems.push({
      test_item_name: it.testItemName,
      sequence_order: it.sequenceOrder ?? idx,
    }))
  } else {
    const { data: prod } = await supabaseAdmin.from('products').select('id').eq('product_code', order.product_code).maybeSingle()
    if (prod?.id) {
      const { data: pti } = await supabaseAdmin
        .from('product_test_items')
        .select('sequence_order, test_items!inner(name)')
        .eq('product_id', prod.id)
        .order('sequence_order', { ascending: true })
      ;(pti ?? []).forEach((r, idx) => plannedItems.push({
        test_item_name: (r as unknown as { test_items: { name: string } }).test_items.name,
        sequence_order: (r.sequence_order as number) ?? idx,
      }))
    }
  }

  // 채번 (충돌 시 1회 재시도)
  let qcNo = await generateQcNo()
  let jobId = ''
  const startedAt = new Date()
  const today = startedAt.toISOString().slice(0, 10)
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabaseAdmin
      .from('qc_jobs')
      // work_start_date(날짜)는 화면·집계용, work_started_at(시각)은 항목 소요시간 기준점
      .insert({ order_id: orderId, qc_no: qcNo, assignee_tester_id: testerId, assignee_user_id: userSub, status: IN_PROGRESS_STATUS, work_start_date: today, work_started_at: startedAt.toISOString() })
      .select('id')
      .single()
    if (!error) { jobId = data.id as string; break }
    if (error.code === '23505') { qcNo = await generateQcNo(); continue }  // unique 충돌
    throw error
  }
  if (!jobId) throw new Error('작업 생성에 실패했습니다.')

  if (plannedItems.length > 0) {
    await supabaseAdmin.from('qc_job_items').insert(
      plannedItems.map(it => ({ qc_job_id: jobId, ...it })),
    )
  }

  // 오더 상태 진행중
  await supabaseAdmin.from('pct_orders').update({ status: IN_PROGRESS_STATUS }).eq('id', orderId)

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

/**
 * 모든 시험항목이 완료되면 작업 상태를 '진행중' → '검토전' 으로 자동 전환한다.
 * 이후 검토·승인 단계는 관리자가 작업 현황 화면에서 버튼으로 넘긴다(advanceJobStage).
 *
 * - 대상은 '진행중' 인 작업만. 이후 단계는 그대로 두고,
 *   '지연' 은 지연 표시를 잃지 않도록 자동 전환하지 않는다(담당자가 직접 변경).
 * - 조건부 update(.eq('status','진행중'))로 항목 동시 클리어 시 중복 전환·중복 알림을 막는다.
 * - work_end_date 는 건드리지 않는다(승인완료 시점에만 기록).
 *
 * @returns allCleared(전 항목 완료 여부)와 statusChangedTo(전환된 경우 '검토전')
 */
async function autoAdvanceToReview(jobId: string): Promise<{ allCleared: boolean; statusChangedTo: string | null }> {
  // 미완료 항목이 남아있으면 전환하지 않음
  const { count: remaining, error: cntErr } = await supabaseAdmin
    .from('qc_job_items')
    .select('id', { count: 'exact', head: true })
    .eq('qc_job_id', jobId)
    .neq('status', 'cleared')
  if (cntErr || remaining === null || remaining > 0) return { allCleared: false, statusChangedTo: null }

  const target = NEXT_STAGE[IN_PROGRESS_STATUS]   // '검토전'

  // '진행중' 인 경우에만 전환 (동시 호출 시 한 번만 성공)
  const { data: updated } = await supabaseAdmin
    .from('qc_jobs')
    .update({ status: target })
    .eq('id', jobId)
    .eq('status', IN_PROGRESS_STATUS)
    .select('order_id')
    .maybeSingle()
  if (!updated) return { allCleared: true, statusChangedTo: null }

  // 오더 상태 동기화 + 감독관 알림
  await supabaseAdmin.from('pct_orders').update({ status: target }).eq('id', updated.order_id as string)
  await createNotification({
    type: 'status_changed',
    title: '검토 대기',
    body: `모든 시험항목이 완료되어 작업 상태가 "${target}" 으로 자동 변경되었습니다.`,
    relatedOrderId: updated.order_id as string,
    relatedQcJobId: jobId,
    severity: 'info',
  })
  return { allCleared: true, statusChangedTo: target }
}

/**
 * 검토·승인 단계를 한 칸 앞으로 넘긴다 (관리자 전용).
 *   검토전 ─[검토 시작]─▶ 검토중 ─[검토 완료]─▶ 승인전 ─[승인]─▶ 승인완료
 *
 * - `expected` 를 주면 화면이 보고 있던 단계와 실제 단계가 같을 때만 전환한다(동시 클릭 방지).
 * - 조건부 update 로 한 번만 성공하게 한다.
 * - 마지막 단계(승인완료) 도달 시 work_end_date 를 오늘로 기록한다(이미 있으면 유지).
 * - 오더 상태를 함께 동기화하고 알림을 남긴다.
 */
export async function advanceJobStage(
  jobId: string,
  expected?: string,
): Promise<{ from: JobStage; to: JobStage }> {
  const { data: job } = await supabaseAdmin
    .from('qc_jobs')
    .select('status, order_id, work_end_date, qc_no')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) throw new Error('작업을 찾을 수 없습니다.')

  const current = job.status as string
  if (expected && expected !== current) {
    throw new Error(`이미 "${current}" 단계로 변경되었습니다. 새로고침 후 다시 시도하세요.`)
  }
  if (!isJobStage(current)) {
    throw new Error(`"${current}" 상태에서는 단계를 넘길 수 없습니다.`)
  }
  if (!canAdvanceByAdmin(current)) {
    throw new Error(`"${current}" 단계에서는 넘길 다음 단계가 없습니다.`)
  }
  const target = NEXT_STAGE[current]
  if (!target) throw new Error(`"${current}" 단계에서는 넘길 다음 단계가 없습니다.`)

  const patch: Record<string, unknown> = { status: target }
  if (target === CLOSED_STAGE && !job.work_end_date) {
    patch.work_end_date = new Date().toISOString().slice(0, 10)
  }

  const { data: updated } = await supabaseAdmin
    .from('qc_jobs')
    .update(patch)
    .eq('id', jobId)
    .eq('status', current)          // 낙관적 잠금 — 그 사이 바뀌었으면 실패
    .select('order_id')
    .maybeSingle()
  if (!updated) {
    throw new Error('다른 사용자가 먼저 단계를 변경했습니다. 새로고침 후 다시 시도하세요.')
  }

  await supabaseAdmin.from('pct_orders').update({ status: target }).eq('id', updated.order_id as string)
  await createNotification({
    type: 'status_changed',
    title: `${STAGE_ACTION_LABEL[current] ?? '단계 변경'} 처리`,
    body: `QC ${job.qc_no} 작업이 "${current}" → "${target}" 단계로 변경되었습니다.`,
    relatedOrderId: updated.order_id as string,
    relatedQcJobId: jobId,
    severity: 'info',
  })

  return { from: current, to: target }
}

/** 항목 클리어 — 시간 적재 + 감독관 알림 + 전체 완료 시 '검토전' 자동 전환
 *
 *  소요시간은 두 기준을 함께 적재한다.
 *   - elapsed_total_minutes : 작업 시작 → 이 항목 완료 (작업 화면에 보여주는 값)
 *   - elapsed_minutes       : 직전 항목 완료 → 이 항목 완료 (구간, 통계·평가 기준)
 *  완료 버튼을 눌러도 작업 시작 시각은 움직이지 않으므로 누적값은 항목이 진행될수록 커진다.
 */
export async function clearItem(
  jobId: string, itemId: string, userSub: string,
): Promise<{ allCleared: boolean; statusChangedTo: string | null }> {
  await assertOwner(jobId, userSub)
  const now = new Date()

  const { data: job } = await supabaseAdmin
    .from('qc_jobs').select('work_started_at, created_at, order_id').eq('id', jobId).single()
  const { data: lastCleared } = await supabaseAdmin
    .from('qc_job_items').select('cleared_at')
    .eq('qc_job_id', jobId).eq('status', 'cleared')
    .order('cleared_at', { ascending: false }).limit(1).maybeSingle()

  // 작업 시작 시각 — 0030 이전에 만들어진 작업은 work_started_at 이 비어 있어 created_at 으로 대체
  const startedAt = new Date(
    (job?.work_started_at as string) ?? (job?.created_at as string) ?? now.toISOString(),
  )
  const prevClearedAt = lastCleared?.cleared_at ? new Date(lastCleared.cleared_at as string) : startedAt
  const minutesSince = (base: Date) => Math.max(0, Math.round((now.getTime() - base.getTime()) / 60000))
  const elapsedTotal = minutesSince(startedAt)
  const elapsed = minutesSince(prevClearedAt)

  const { data: item, error } = await supabaseAdmin
    .from('qc_job_items')
    .update({
      status: 'cleared',
      cleared_at: now.toISOString(),
      elapsed_minutes: elapsed,
      elapsed_total_minutes: elapsedTotal,
    })
    .eq('id', itemId).eq('qc_job_id', jobId)
    .select('test_item_name')
    .single()
  if (error) throw error

  await createNotification({
    type: 'item_cleared',
    title: '시험항목 완료',
    body: `시험항목 "${item.test_item_name}" 완료 (작업 시작 후 ${elapsedTotal}분, 구간 ${elapsed}분)`,
    relatedOrderId: (job?.order_id as string) ?? null,
    relatedQcJobId: jobId, severity: 'info',
  })

  // 마지막 항목이었다면 '검토전' 으로 자동 전환
  return autoAdvanceToReview(jobId)
}

/**
 * 담당 시험자가 직접 바꿀 수 있는 상태.
 * 검토·승인 단계는 관리자만 advanceJobStage 로 넘길 수 있어야 워크플로가 의미를 갖는다.
 */
const SELF_SERVICE_STATUSES = new Set<string>([IN_PROGRESS_STATUS, DELAYED_STATUS])

/** 작업 상태 변경(담당자) — 오더 상태 동기화 + 감독관 알림.
 *  최종 단계(승인완료)면 work_end_date를 오늘로 설정(이미 설정된 경우 유지).
 */
export async function changeJobStatus(jobId: string, userSub: string, status: string): Promise<void> {
  await assertOwner(jobId, userSub)
  if (!SELF_SERVICE_STATUSES.has(status)) {
    throw new Error(`"${status}" 는 담당자가 직접 지정할 수 없습니다. 검토·승인은 관리자가 작업 현황에서 진행합니다.`)
  }
  const patch: Record<string, unknown> = { status }
  if (status === CLOSED_STAGE) {
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
