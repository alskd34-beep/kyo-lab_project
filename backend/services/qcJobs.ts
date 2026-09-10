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
import { kstToday } from '@backend/lib/kstDate'
import { describeSchemaError } from '@backend/lib/schemaError'
import { getTesterId } from '@backend/lib/testerLink'
import { createNotification } from '@backend/services/notifications'
import { checkEquipmentReadiness, type ReadinessResult } from '@backend/services/equipmentMaster'
import { listByProduct, type PretestNoteRow } from '@backend/services/productPretestNotes'
import {
  METHOD_PARTIAL, listByOrder as listOrderTestItems, activeItemsForSlot, countActiveBySlot,
} from '@backend/services/pctOrderTestItems'
import { logJobStatusChange } from '@backend/services/qcJobStatusHistory'
import { notifyStageChangeToSlack } from '@backend/services/slackNotify'
import {
  ACTIVE_JOB_STATUSES,
  APPROVAL_READY_STATUS,
  CLOSED_STAGE,
  DELAYED_STATUS,
  DELETED_STATUS,
  IN_PROGRESS_STATUS,
  ITEM_CLEARED,
  ITEM_IN_PROGRESS,
  ITEM_PENDING,
  JOB_STAGES,
  JOB_STATUSES,
  NEXT_STAGE,
  PENDING_STATUS,
  REVIEWING_STATUS,
  REVIEW_READY_STATUS,
  SELF_EDITABLE_JOB_STATUSES,
  STAGE_ACTION_LABEL,
  canAdvanceByAdmin,
  isJobStage,
  type JobStage,
} from '@shared/qc-status'

export interface JobItemRow {
  id: string
  testItemName: string
  sequenceOrder: number
  /** 'pending' | 'in_progress' | 'cleared' */
  status: string
  /** 시험자가 이 항목을 시작한 시각. null = 미시작(또는 0040 이전에 완료된 옛 항목) */
  startedAt: string | null
  clearedAt: string | null
  /** 이 항목의 실소요 분(시작→완료). 옛 항목은 직전 항목 완료 이후 구간 — 통계·평가 기준 */
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
  /**
   * 이 오더가 속한 동시분석 그룹. 화면이 같은 그룹의 작업을 카드 하나로 묶는다.
   * ⚠️ 묶이는 것은 **조작**뿐이다 — 시험 기록(qc_job_items)은 배치별로 그대로 남는다.
   */
  groupId: string | null
  groupLabel: string | null
  /** 그 그룹의 전체 오더 수(내 것이 아닌 것 포함). "3건 중 2건이 내 몫" 을 알리기 위해 */
  groupSize: number
}
export interface PendingOrderRow {
  id: string
  productCode: string
  productName: string
  batchNo: string
  dueDate: string | null
  isUrgent: boolean
  method: string
  groupId: string | null
  groupLabel: string | null
  groupSize: number
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
  const date = kstToday()
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
  const { data: jobRows, error: jobsErr } = await supabaseAdmin
    .from('qc_jobs')
    .select('id, order_id, qc_no, work_start_date, work_end_date, status')
    .eq('assignee_user_id', userSub)
    .order('created_at', { ascending: false })
  if (jobsErr) throw describeSchemaError(jobsErr, '2인 배정')

  const jobOrderIds = (jobRows ?? []).map(j => j.order_id as string)

  // 오더 정보 (작업/대기 공통)
  // 2인 배정 오더는 담당자2(assignee_tester_id_2)로 배정된 경우도 "내 오더"다 —
  // eq() 하나만 쓰면 담당자2에게는 오더 자체가 보이지 않는다.
  //
  // 0037(2인 배정) 미적용 DB 에서는 is_dual_assignment 참조가 42703 을 낸다. 예전에는
  // error 를 버려 data===null 이 되고, 대기 목록·작업 화면이 아무 안내 없이 텅 비었다.
  // describeSchemaError 로 감싸 원인을 알 수 있는 메시지로 던진다.
  const { data: orderRows, error: ordersErr } = await supabaseAdmin
    .from('pct_orders')
    .select('id, product_code, product_name, batch_no, due_date, is_urgent, method, status, assignee_tester_id, is_dual_assignment')
    .or(`assignee_tester_id.eq.${testerId},and(is_dual_assignment.eq.true,assignee_tester_id_2.eq.${testerId})`)
    .neq('status', DELETED_STATUS)
  if (ordersErr) throw describeSchemaError(ordersErr, '2인 배정')
  const orderById = new Map<string, Record<string, unknown>>()
  for (const o of orderRows ?? []) orderById.set(o.id as string, o)

  // 작업 항목
  const jobIds = (jobRows ?? []).map(j => j.id as string)
  const itemsByJob = new Map<string, JobItemRow[]>()
  if (jobIds.length > 0) {
    const { data: items } = await supabaseAdmin
      .from('qc_job_items')
      .select('id, qc_job_id, test_item_name, sequence_order, status, started_at, cleared_at, elapsed_minutes, elapsed_total_minutes')
      .in('qc_job_id', jobIds)
      .order('sequence_order', { ascending: true })
    for (const it of items ?? []) {
      const arr = itemsByJob.get(it.qc_job_id as string) ?? []
      arr.push({
        id: it.id as string,
        testItemName: it.test_item_name as string,
        sequenceOrder: it.sequence_order as number,
        status: it.status as string,
        startedAt: (it.started_at as string) ?? null,
        clearedAt: (it.cleared_at as string) ?? null,
        elapsedMinutes: (it.elapsed_minutes as number) ?? null,
        elapsedTotalMinutes: (it.elapsed_total_minutes as number) ?? null,
      })
      itemsByJob.set(it.qc_job_id as string, arr)
    }
  }

  // 동시분석 그룹 — 화면이 같은 그룹의 작업을 카드 하나로 묶는다.
  // 0044 미적용이나 테이블 부재에도 화면이 죽지 않게 실패를 삼킨다(묶기는 편의 기능이다).
  const groupByOrder = new Map<string, { id: string; label: string | null; size: number }>()
  try {
    const { data: gItems } = await supabaseAdmin
      .from('concurrent_analysis_group_items').select('group_id, order_id')
    const { data: gRows } = await supabaseAdmin
      .from('concurrent_analysis_groups').select('id, label')
    const labelOf = new Map((gRows ?? []).map(g => [g.id as string, (g.label as string) ?? null]))
    const sizeOf = new Map<string, number>()
    for (const it of gItems ?? []) {
      const gid = it.group_id as string
      sizeOf.set(gid, (sizeOf.get(gid) ?? 0) + 1)
    }
    for (const it of gItems ?? []) {
      const gid = it.group_id as string
      // 혼자 남은 그룹은 묶을 것이 없다 — 화면이 1건짜리 그룹 카드를 그리지 않게 여기서 거른다.
      if ((sizeOf.get(gid) ?? 0) < 2) continue
      groupByOrder.set(it.order_id as string, {
        id: gid, label: labelOf.get(gid) ?? null, size: sizeOf.get(gid) ?? 0,
      })
    }
  } catch { /* 그룹 정보가 없으면 예전처럼 낱개로 보인다 */ }

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
      groupId:    groupByOrder.get(j.order_id as string)?.id ?? null,
      groupLabel: groupByOrder.get(j.order_id as string)?.label ?? null,
      groupSize:  groupByOrder.get(j.order_id as string)?.size ?? 0,
    }
  })

  // 2인 배정 오더는 "내 슬롯에 진행할 항목이 있는가"까지 봐야 한다. 항목이 0개면 시작해도
  // startJob 이 '배정된 시험항목이 없습니다' 로 거절하는데, 그 오더가 대기 목록에 계속 남아
  // 누를 때마다 에러만 나는 상태가 된다. 후보를 한 번에 세어 N+1 을 피한다.
  const dualCandidateIds = (orderRows ?? [])
    .filter(o => o.is_dual_assignment && !jobOrderIds.includes(o.id as string))
    .map(o => o.id as string)
  const slotCounts = await countActiveBySlot(dualCandidateIds)

  const pendingOrders: PendingOrderRow[] = (orderRows ?? [])
    .filter(o => {
      // 내가 이미 시작한 오더는 '작업'쪽에 있으므로 대기 목록에서 뺀다.
      if (jobOrderIds.includes(o.id as string)) return false
      // 1인 배정: 예전 그대로 오더 상태가 '대기'일 때만 시작 대기로 본다.
      if (!o.is_dual_assignment) return o.status === PENDING_STATUS
      // 2인 배정: 상대 담당자가 먼저 시작하면 오더 상태가 '진행중'으로 넘어간다.
      // 오더 상태만 보면 아직 시작도 못 한 내 몫이 목록에서 사라져 영영 시작할 수 없다.
      // "내 작업이 아직 없다"가 곧 내 시작 대기이므로, 종결·삭제만 제외한다.
      if (o.status === CLOSED_STAGE || o.status === DELETED_STATUS) return false
      // 내 슬롯에 할 일이 없으면 대기로 잡지 않는다.
      // 스냅샷이 아직 없어 카운트를 모르는 오더(맵에 없음)는 예전처럼 남긴다 — 읽기 경로에서
      // 스냅샷을 만들지 않기로 했으므로, 모를 때는 감추기보다 보여주는 쪽이 안전하다.
      const counts = slotCounts.get(o.id as string)
      if (!counts) return true
      const mySlot = (o.assignee_tester_id as string) === testerId ? 1 : 2
      return (mySlot === 1 ? counts.slot1 : counts.slot2) > 0
    })
    .map(o => ({
      id: o.id as string,
      productCode: o.product_code as string,
      productName: o.product_name as string,
      batchNo: o.batch_no as string,
      dueDate: (o.due_date as string) ?? null,
      isUrgent: !!o.is_urgent,
      method: o.method as string,
      groupId:    groupByOrder.get(o.id as string)?.id ?? null,
      groupLabel: groupByOrder.get(o.id as string)?.label ?? null,
      groupSize:  groupByOrder.get(o.id as string)?.size ?? 0,
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
  workEndDate: string | null
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
  /** 시험자 본인 화면에서 "나"인 행. 관리자 화면에서는 항상 false */
  isSelf: boolean
  /**
   * 2인 배정으로 함께 맡은 상대. 이 행의 숫자·목록은 **나와 함께 배정된 오더로 한정**된다.
   * 상대의 다른 업무까지 보여주는 것은 요청 범위 밖이고, 시험자에게 동료의 전체 업무를
   * 열어 주는 것은 별개의 결정이다.
   */
  isPartner: boolean
  pendingCount: number
  inProgress: number
  reviewing: number
  delayed: number
  completedTotal: number
  activeJobs: OverviewJobRow[]
  /** 승인완료된 작업 (최근 완료일 순, 시험자당 COMPLETED_JOBS_LIMIT 건까지) */
  completedJobs: OverviewJobRow[]
  pendingOrders: OverviewPendingRow[]
}
export interface WorkerOverview {
  totals: {
    workingTesters: number   // 진행중/대기 업무가 있는 시험자 수
    activeJobs: number       // 진행중·검토중·지연 작업 총수
    pending: number          // 시작 대기 오더 총수
    delayed: number          // 지연 작업 총수
    completedToday: number   // 오늘 완료한 작업 수
    completedTotal: number   // 승인완료 작업 총수(기간 제한 없음)
  }
  workers: WorkerOverviewRow[]
  /** 'admin' = 전체 시험자, 'tester' = 본인 + 2인 배정 상대(공유 오더 한정) */
  scope: 'admin' | 'tester'
}

// 진행 중으로 간주하는 작업 상태는 @shared/qc-status 의 ACTIVE_JOB_STATUSES 를 쓴다.

/** 시험자 1명당 응답에 싣는 완료 작업 상한 — 화면은 기간 필터로 더 좁혀 본다. */
const COMPLETED_JOBS_LIMIT = 50

/** qc_jobs 행 + 오더 메타 → 화면용 작업 요약 (진행 중/완료 공통) */
function toOverviewJob(
  j: Record<string, unknown>,
  o: Record<string, unknown> | undefined,
  itemAgg: Map<string, { total: number; cleared: number }>,
): OverviewJobRow {
  const agg = itemAgg.get(j.id as string) ?? { total: 0, cleared: 0 }
  return {
    jobId: j.id as string,
    qcNo: j.qc_no as string,
    productName: (o?.product_name as string) ?? '',
    batchNo: (o?.batch_no as string) ?? '',
    status: j.status as string,
    dueDate: (o?.due_date as string) ?? null,
    isUrgent: !!o?.is_urgent,
    itemsTotal: agg.total,
    itemsCleared: agg.cleared,
    workStartDate: (j.work_start_date as string) ?? null,
    workEndDate: (j.work_end_date as string) ?? null,
  }
}

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
  /** 시험자가 [시작]을 눌러 진행 중인 항목 id 목록 (병행 시험이므로 여럿일 수 있다) */
  currentItemIds: string[]
  /** 위 목록의 첫 항목 — "지금 무엇을 하는가"를 한 줄로 보여주는 요약용. 없으면 null */
  currentItemId: string | null
  /** currentItemId 항목의 시작 시각 */
  currentItemStartedAt: string | null
  /** 관리자가 버튼으로 넘길 수 있는 다음 단계. 없으면 null */
  nextStage: string | null
  /** 그 버튼에 표시할 라벨 (예: '검토 시작'). 없으면 null */
  nextStageLabel: string | null
  /** 소유자(로그인 사용자) id — 라우트의 소유권 검사에 쓴다 */
  assigneeUserId: string | null
}

/**
 * 작업 상세 조회 — 어떤 시험항목을 수행 중인지 확인용 (관리자 작업현황 화면).
 *
 * 예전에는 "미완료 항목 중 sequence_order 가 가장 작은 것"을 진행 중으로 추론했다.
 * 그래서 1번을 완료하면 2번이 저절로 진행 중이 되었는데, 시험자는 순번대로 시험하지
 * 않는다. 0040 부터 항목이 'in_progress' 상태와 started_at 을 직접 갖는다 — 추론하지
 * 않고 시험자가 [시작]으로 정한 것만 진행 중으로 본다(병행이라 여럿일 수 있다).
 */
export async function getJobDetail(jobId: string): Promise<JobDetail | null> {
  const { data: job } = await supabaseAdmin
    .from('qc_jobs')
    .select('id, order_id, qc_no, status, work_start_date, work_end_date, work_started_at, created_at, assignee_tester_id, assignee_user_id')
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
      .select('id, test_item_name, sequence_order, status, started_at, cleared_at, elapsed_minutes, elapsed_total_minutes')
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
    startedAt: (it.started_at as string) ?? null,
    clearedAt: (it.cleared_at as string) ?? null,
    elapsedMinutes: (it.elapsed_minutes as number) ?? null,
    elapsedTotalMinutes: (it.elapsed_total_minutes as number) ?? null,
  }))

  const status = job.status as string
  // "현재 수행 중인 항목"은 아직 시험을 하고 있는 단계에서만 의미가 있다.
  // 검토전 이후 단계는 시험이 끝난 상태라 현재 항목을 표시하지 않는다.
  const testing = status === IN_PROGRESS_STATUS || status === DELAYED_STATUS
  const running = testing ? items.filter(i => i.status === ITEM_IN_PROGRESS) : []
  // 요약 줄에는 가장 먼저 시작한 항목을 세운다 — 여러 개를 걸어둔 시험자의 화면에서
  // 순번이 아니라 "가장 오래 돌고 있는 것"이 먼저 눈에 들어와야 한다.
  const current = [...running].sort((a, b) => (a.startedAt ?? '').localeCompare(b.startedAt ?? ''))[0] ?? null

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
    currentItemIds: running.map(i => i.id),
    currentItemId: current?.id ?? null,
    currentItemStartedAt: current?.startedAt ?? null,
    nextStage: canAdvanceByAdmin(status) ? NEXT_STAGE[status] : null,
    nextStageLabel: canAdvanceByAdmin(status) ? STAGE_ACTION_LABEL[status] : null,
    assigneeUserId: (job.assignee_user_id as string) ?? null,
  }
}

/**
 * 이 사용자가 그 작업의 상세를 열람할 수 있는가.
 *
 * 원칙은 "본인 작업만"이다(관리자는 전체). 여기에 2인 배정 상대를 더한다 — 같은 오더를
 * 둘이 나눠 맡으면 상대가 어디까지 했는지 보여야 남은 몫을 판단할 수 있고, 작업 현황
 * 화면이 그 상대 행을 이미 보여주므로 눌러도 열리지 않으면 화면이 거짓말을 하는 셈이다.
 *
 * 넓히는 것은 **같은 오더에 함께 배정된 경우로 한정**한다. 상대의 다른 작업은 여전히
 * 남의 작업이다. 쓰기(clearItem·changeJobStatus 등)는 그대로 assertOwner 가 막는다 —
 * 여기는 읽기 전용 판정이다.
 */
export async function canViewJob(jobId: string, userSub: string): Promise<boolean> {
  const { data: job } = await supabaseAdmin
    .from('qc_jobs').select('order_id, assignee_user_id').eq('id', jobId).maybeSingle()
  if (!job) return false
  if ((job.assignee_user_id as string | null) === userSub) return true

  const testerId = await getTesterId(userSub)
  if (!testerId) return false

  const { data: order } = await supabaseAdmin
    .from('pct_orders')
    .select('is_dual_assignment, assignee_tester_id, assignee_tester_id_2')
    .eq('id', job.order_id as string)
    .maybeSingle()
  if (!order?.is_dual_assignment) return false
  return order.assignee_tester_id === testerId || order.assignee_tester_id_2 === testerId
}

/**
 * 시험자 본인용 작업 현황 — 로그인 계정에 연결된 시험자를 뷰어로 잡는다.
 * 관리자는 인자 없는 listWorkerOverview() 로 전체를 본다.
 */
export async function listWorkerOverviewForTester(userSub: string): Promise<WorkerOverview> {
  const testerId = await getTesterId(userSub)
  if (!testerId) {
    throw new Error('로그인 계정에 연결된 시험자가 없습니다. 관리자에게 시험자 연결을 요청하세요.')
  }
  return listWorkerOverview(testerId)
}

/**
 * 작업자(시험자)별 작업 현황 집계. 기존 테이블만 읽어 JS에서 집계한다.
 *  - testers       : 활성 시험자 목록
 *  - qc_jobs       : 시험자별 작업(진행중/검토중/지연/완료)
 *  - qc_job_items  : 작업별 항목 진행률(완료/전체)
 *  - pct_orders    : 작업 메타(품목·제조번호·완료예정·긴급) + 시작 대기 오더
 *
 * viewerTesterId 를 주면 시험자 시점으로 좁힌다.
 *   - 본인 행    : 전체 현황
 *   - 상대 행    : **나와 함께 배정된 2인 오더에 한정된** 현황
 *   - 그 외 시험자는 목록에서 빠지고, 상단 지표도 남은 행들로만 계산된다.
 * 좁히기는 집계 루프 안에서 하고 나중에 걸러내지 않는다 — 나중에 거르면 지표가 이미
 * 전체를 세어 버려서, 화면에는 안 보이는 남의 작업이 숫자에만 남는다.
 */
export async function listWorkerOverview(viewerTesterId: string | null = null): Promise<WorkerOverview> {
  const today = kstToday()

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
      .select('id, product_name, batch_no, due_date, is_urgent, status, assignee_tester_id, is_dual_assignment, assignee_tester_id_2')
      .neq('status', DELETED_STATUS),
  ])
  // 0037(2인 배정) 미적용 DB 에서는 is_dual_assignment 참조가 42703 을 낸다. 예전에는
  // error 를 버려 관리자 「작업자 현황」이 안내 없이 통째로 비어 보였다(listWorkspace 와 같은 문제).
  if (jobsRes.error) throw describeSchemaError(jobsRes.error, '2인 배정')
  if (ordersRes.error) throw describeSchemaError(ordersRes.error, '2인 배정')
  const jobRows = (jobsRes.data ?? []) as Record<string, unknown>[]
  const orderRows = (ordersRes.data ?? []) as Record<string, unknown>[]
  const orderById = new Map<string, Record<string, unknown>>()
  for (const o of orderRows) orderById.set(o.id as string, o)

  // 3-1) 시험자 시점이면 "내가 낀 2인 오더"와 그 상대를 먼저 추린다.
  //      상대 행은 이 오더들에 한정해서만 채운다.
  const sharedOrderIds = new Set<string>()
  const partnerTesterIds = new Set<string>()
  if (viewerTesterId) {
    for (const o of orderRows) {
      if (!o.is_dual_assignment) continue
      const slot1 = o.assignee_tester_id as string | null
      const slot2 = o.assignee_tester_id_2 as string | null
      if (slot1 !== viewerTesterId && slot2 !== viewerTesterId) continue
      sharedOrderIds.add(o.id as string)
      const partner: string | null = slot1 === viewerTesterId ? slot2 : slot1
      // 같은 사람이 두 슬롯에 들어간 오더는 상대가 없는 것과 같다
      if (partner && partner !== viewerTesterId) partnerTesterIds.add(partner)
    }
  }

  /** 이 (시험자, 오더) 조합을 지금 보는 사람에게 보여도 되는가 */
  const visible = (testerId: string, orderId: string): boolean => {
    if (!viewerTesterId) return true                 // 관리자 — 전체
    if (testerId === viewerTesterId) return true     // 본인 — 전부
    return partnerTesterIds.has(testerId) && sharedOrderIds.has(orderId)
  }

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
      if (it.status === ITEM_CLEARED) agg.cleared += 1
      itemAgg.set(jid, agg)
    }
  }

  // 시험자별 빈 행 초기화
  const rowByTester = new Map<string, WorkerOverviewRow>()
  for (const t of testers) {
    const tid = t.id as string
    // 시험자 시점에서는 본인과 2인 배정 상대만 행을 만든다.
    if (viewerTesterId && tid !== viewerTesterId && !partnerTesterIds.has(tid)) continue
    rowByTester.set(tid, {
      testerId: tid,
      name: t.name as string,
      employeeNo: t.employee_no as string,
      isActive: !!t.is_active,
      isSelf: viewerTesterId ? tid === viewerTesterId : false,
      isPartner: viewerTesterId ? partnerTesterIds.has(tid) : false,
      pendingCount: 0,
      inProgress: 0,
      reviewing: 0,
      delayed: 0,
      completedTotal: 0,
      activeJobs: [],
      completedJobs: [],
      pendingOrders: [],
    })
  }

  let completedToday = 0
  // 오더별로 "이 담당자가 이미 자기 몫을 시작했는가"를 슬롯(담당자) 단위로 기억한다.
  // 예전에는 오더 단위(startedOrderIds)라서, 2인 배정에서 한쪽만 시작해도 아직
  // 시작하지 않은 다른 담당자 몫까지 "대기" 집계에서 함께 사라졌다.
  const startedByTesterOrder = new Set<string>()   // `${orderId}::${testerId}`

  // 작업 집계
  for (const j of jobRows) {
    const testerId = j.assignee_tester_id as string | null
    if (testerId) startedByTesterOrder.add(`${j.order_id as string}::${testerId}`)
    if (!testerId) continue
    // startedByTesterOrder 는 가드보다 먼저 채운다 — 시험자 시점에서 상대가 이미 시작한
    // 작업을 놓치면 그 몫이 아래 '시작 대기'로 다시 잡혀 한 건이 두 번 보인다.
    if (!visible(testerId, j.order_id as string)) continue
    const row = rowByTester.get(testerId)
    if (!row) continue

    const status = j.status as string
    const o = orderById.get(j.order_id as string)
    if (status === CLOSED_STAGE) {
      row.completedTotal += 1
      if ((j.work_end_date as string) === today) completedToday += 1
      // 예전에는 여기서 건너뛰어 화면에서 완료 작업을 아예 볼 수 없었다.
      // 집계만 하지 말고 목록도 함께 내려준다(화면에서 기간으로 좁혀 본다).
      row.completedJobs.push(toOverviewJob(j, o, itemAgg))
      continue
    }
    if (!ACTIVE_JOB_STATUSES.has(status)) continue

    if (status === IN_PROGRESS_STATUS) row.inProgress += 1
    // 검토전·검토중·승인전은 모두 "시험은 끝나고 후속 절차 대기" — 검토 카운터로 함께 센다
    else if (status === REVIEW_READY_STATUS || status === REVIEWING_STATUS || status === APPROVAL_READY_STATUS) row.reviewing += 1
    else if (status === DELAYED_STATUS) row.delayed += 1

    row.activeJobs.push(toOverviewJob(j, o, itemAgg))
  }

  // 시작 대기 오더 집계 (배정됐고 status '대기' & 아직 미시작)
  // 2인 배정 오더는 담당자1·담당자2 각각 아직 자기 몫을 시작하지 않았으면
  // 각자의 목록에 따로 잡힌다(한 오더가 두 사람에게 각각 잡히는 것이 정상이다).
  // 슬롯에 할 일이 0개인 담당자는 시작해도 startJob 이 거절하므로 대기로 세지 않는다
  // (listWorkspace 와 같은 규칙). 후보를 한 번에 세어 N+1 을 피한다.
  const dualOverviewIds = orderRows
    .filter(o => o.is_dual_assignment && o.status !== CLOSED_STAGE && o.status !== DELETED_STATUS)
    .map(o => o.id as string)
  const overviewSlotCounts = await countActiveBySlot(dualOverviewIds)

  for (const o of orderRows) {
    // 1인 배정은 예전 그대로 오더 상태가 '대기'일 때만 센다.
    // 2인 배정은 상대가 먼저 시작하면 오더가 '진행중'이 되므로 오더 상태로 거르면
    // 아직 시작 안 한 담당자의 대기 건이 집계에서 통째로 사라진다(listWorkspace 와 같은 이유).
    if (o.is_dual_assignment
      ? (o.status === CLOSED_STAGE || o.status === DELETED_STATUS)
      : o.status !== PENDING_STATUS) continue
    const orderId = o.id as string
    const slotTesterIds: (string | null)[] = [o.assignee_tester_id as string | null]
    if (o.is_dual_assignment) slotTesterIds.push(o.assignee_tester_id_2 as string | null)
    for (const [idx, testerId] of slotTesterIds.entries()) {
      if (!testerId) continue
      if (!visible(testerId, orderId)) continue
      if (startedByTesterOrder.has(`${orderId}::${testerId}`)) continue
      if (o.is_dual_assignment) {
        // 스냅샷이 아직 없어 카운트를 모르면(맵에 없음) 예전처럼 센다 — 안전한 쪽.
        const counts = overviewSlotCounts.get(orderId)
        if (counts && (idx === 0 ? counts.slot1 : counts.slot2) === 0) continue
      }
      const row = rowByTester.get(testerId)
      if (!row) continue
      row.pendingCount += 1
      row.pendingOrders.push({
        orderId,
        productName: o.product_name as string,
        batchNo: o.batch_no as string,
        dueDate: (o.due_date as string) ?? null,
        isUrgent: !!o.is_urgent,
      })
    }
  }

  // 완료예정 임박 순으로 활성 작업 정렬 (null은 뒤로)
  const dueRank = (d: string | null) => (d ? new Date(d).getTime() : Number.MAX_SAFE_INTEGER)
  for (const row of rowByTester.values()) {
    row.activeJobs.sort((a, b) => dueRank(a.dueDate) - dueRank(b.dueDate))
    row.pendingOrders.sort((a, b) => dueRank(a.dueDate) - dueRank(b.dueDate))
    // 완료 작업은 최근 완료일 순. 오래된 이력까지 전부 실어 보내면 응답이 커지므로 상한을 둔다.
    row.completedJobs.sort((a, b) => (b.workEndDate ?? '').localeCompare(a.workEndDate ?? ''))
    row.completedJobs = row.completedJobs.slice(0, COMPLETED_JOBS_LIMIT)
  }

  // 작업량 많은 순(진행중→대기) 정렬, 활성 시험자 우선
  const workers = [...rowByTester.values()].sort((a, b) => {
    // 본인 화면은 "내 현황"이 먼저다. 작업량 순으로 두면 상대가 더 바쁠 때 내가 밀린다.
    if (a.isSelf !== b.isSelf) return a.isSelf ? -1 : 1
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
    completedTotal: workers.reduce((s, w) => s + w.completedTotal, 0),
  }

  return { totals, workers, scope: viewerTesterId ? 'tester' : 'admin' }
}

/** 작업 시작 — 장비 준비상태 검증 + QC번호 채번 + 항목 체크리스트 생성 + 오더 상태 진행중 + 알림 */
export async function startJob(orderId: string, userSub: string): Promise<{ jobId: string; qcNo: string; warnings?: string[] }> {
  const testerId = await getTesterId(userSub)

  const { data: order, error: oErr } = await supabaseAdmin
    .from('pct_orders')
    .select('id, product_code, product_name, batch_no, assignee_tester_id, method, is_dual_assignment, assignee_tester_id_2')
    .eq('id', orderId)
    .single()
  if (oErr) throw oErr

  // 본인 배정 검증.
  //
  // 2026-08-23 보안 수정: 예전에는 `if (testerId && order.assignee_tester_id && ...)` 라서
  // ① 시험자 미연결 계정(testerId=null)이거나 ② 미배정 오더면 검증이 통째로 건너뛰어졌다.
  // 그 경로로 타인 배정 오더를 가로채면 assignee_user_id 가 가로챈 쪽으로 기록돼
  // (assertOwner 기준) 원래 담당자가 자기 작업을 만질 수 없게 됐다.
  if (!testerId) {
    throw new Error('로그인 계정에 연결된 시험자가 없습니다. 관리자에게 시험자 연결을 요청하세요.')
  }
  if (!order.assignee_tester_id) {
    throw new Error('아직 담당자가 배정되지 않은 오더입니다. 관리자 배정 후 시작할 수 있습니다.')
  }
  // 2인 배정이면 담당자1·담당자2 둘 중 하나만 맞아도 본인 오더다.
  const isDual = !!order.is_dual_assignment
  if (order.assignee_tester_id !== testerId && !(isDual && order.assignee_tester_id_2 === testerId)) {
    throw new Error('본인에게 배정된 오더만 시작할 수 있습니다.')
  }
  const mySlot: 1 | 2 = order.assignee_tester_id === testerId ? 1 : 2

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
  //  - 2인 배정: method 와 무관하게 항상 내 슬롯(mySlot) 몫만 (pct_order_test_items.assignee_slot)
  //  - 개별항목: 오더 생성 시 고른 항목만 (pct_order_test_items)
  //  - 전항목  : 품목에 등록된 시험항목 전체 (product_test_items)
  // 작업을 만든 뒤에 실패하면 QC번호만 소모된 빈 작업이 남으므로 순서가 중요하다.
  const plannedItems: Array<{ test_item_name: string; sequence_order: number }> = []
  if (isDual) {
    // 2인 배정은 슬롯이 유일한 기준이다 — method(전항목/개별항목) 값은 보지 않는다.
    const selected = await activeItemsForSlot(orderId, order.product_code, mySlot)
    if (selected.length === 0) {
      throw new Error('배정된 시험항목이 없습니다. 관리자에게 항목 배분을 요청하세요.')
    }
    selected.forEach((it, idx) => plannedItems.push({
      test_item_name: it.testItemName,
      sequence_order: it.sequenceOrder ?? idx,
    }))
  } else if (order.method === METHOD_PARTIAL) {
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

  // 이미 작업이 있는 오더인지 먼저 본다.
  // 2인 배정에서는 오더당 작업이 최대 2건(담당자별)이라 order_id 만으로는 "이미
  // 시작됨"을 판단할 수 없다 — 담당자(테스터) 기준으로 좁혀서 봐야 담당자2가
  // 담당자1의 작업 때문에 시작을 거부당하지 않는다.
  const { data: dup } = await supabaseAdmin
    .from('qc_jobs').select('qc_no').eq('order_id', orderId).eq('assignee_tester_id', testerId).maybeSingle()
  if (dup) {
    throw new Error(`이미 시작된 오더입니다 (QC ${dup.qc_no}). 작업 화면에서 이어서 진행하세요.`)
  }

  // 채번 (QC번호 충돌 시 1회 재시도)
  let qcNo = await generateQcNo()
  let jobId = ''
  const startedAt = new Date()
  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabaseAdmin
      .from('qc_jobs')
      // work_start_date(날짜)는 화면·집계용이라 KST 기준, work_started_at(시각)은 항목 소요시간 기준점
      .insert({ order_id: orderId, qc_no: qcNo, assignee_tester_id: testerId, assignee_user_id: userSub, status: IN_PROGRESS_STATUS, work_start_date: kstToday(), work_started_at: startedAt.toISOString() })
      .select('id')
      .single()
    if (!error) { jobId = data.id as string; break }
    // (order_id, assignee_tester_id) 유니크 위반은 재시도해도 소용없다(위에서 걸렀지만
    // 경쟁 상황 대비). 0037 이전 제약명(order_id 단일 컬럼)과 이후 인덱스명
    // (uq_qc_jobs_order_assignee / uq_qc_jobs_order_unassigned) 을 모두 잡는다.
    if (error.code === '23505' && /order_id|uq_qc_jobs_order/.test(error.message ?? '')) {
      throw new Error('이미 시작된 오더입니다. 새로고침 후 확인하세요.')
    }
    if (error.code === '23505') { qcNo = await generateQcNo(); continue }  // QC번호 충돌
    throw error
  }
  if (!jobId) throw new Error('QC번호 채번에 실패했습니다. 잠시 후 다시 시도해 주세요.')

  if (plannedItems.length > 0) {
    // 실패를 삼키면 체크리스트가 빈 작업이 남고, 담당자는 클리어할 항목이 없어
    // 작업을 끝낼 수 없게 된다. 실패 시 방금 만든 작업을 되돌린다.
    const { error: itemErr } = await supabaseAdmin.from('qc_job_items').insert(
      plannedItems.map(it => ({ qc_job_id: jobId, ...it })),
    )
    if (itemErr) {
      await supabaseAdmin.from('qc_jobs').delete().eq('id', jobId)
      throw new Error(`시험항목 체크리스트 생성 실패: ${itemErr.message}`)
    }
  }

  // 오더 상태 진행중
  const { error: ordErr } = await supabaseAdmin
    .from('pct_orders').update({ status: IN_PROGRESS_STATUS }).eq('id', orderId)
  if (ordErr) {
    console.error('[qcJobs.startJob] 오더 상태 동기화 실패 — 작업은 생성됨:', orderId, ordErr)
  }

  // 상태 이력 — 작업 생성이 첫 전이(null → 진행중)다.
  await logJobStatusChange({
    jobId, orderId, fromStatus: null, toStatus: IN_PROGRESS_STATUS,
    changedBy: userSub, source: 'manual', note: `QC ${qcNo} 작업 시작`,
  })

  // 슬랙 알림은 부가 기능이다 — 응답을 붙잡지 않도록 await 하지 않는다.
  // 이 뒤의 return 값이 곧 HTTP 응답이라, await 하면 전이 API 가 슬랙 왕복만큼 느려진다.
  void notifyStageChangeToSlack({
    jobId, orderId, fromStatus: null, toStatus: IN_PROGRESS_STATUS, source: 'manual',
  }).catch(() => {})

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

  // [원칙2] 검토·승인 단계에 들어간 작업의 수행일자는 담당자가 바꿀 수 없다.
  const { data: job } = await supabaseAdmin
    .from('qc_jobs').select('status, work_start_date, work_end_date').eq('id', jobId).maybeSingle()
  if (!job) throw new Error('작업을 찾을 수 없습니다.')
  if (!SELF_SERVICE_STATUSES.has(job.status as string)) {
    throw new Error(`"${job.status}" 단계의 작업은 수행일자를 변경할 수 없습니다.`)
  }

  const patch: Record<string, unknown> = {}
  if ('workStartDate' in dates) patch.work_start_date = dates.workStartDate || null
  if ('workEndDate' in dates) patch.work_end_date = dates.workEndDate || null
  if (Object.keys(patch).length === 0) return

  // 기간 정합성 — 종료일이 시작일보다 앞서면 공수 집계(testerEvaluation)가 음수가 된다.
  const start = (patch.work_start_date as string | null | undefined) ?? (job.work_start_date as string | null)
  const end   = (patch.work_end_date   as string | null | undefined) ?? (job.work_end_date   as string | null)
  if (start && end && end < start) {
    throw new Error('종료일은 시작일 이후여야 합니다.')
  }

  const { error } = await supabaseAdmin.from('qc_jobs').update(patch).eq('id', jobId)
  if (error) throw error
}

/**
 * 오더 상태를 그 오더에 속한 qc_jobs 상태들과 동기화한다.
 *
 * 2인 배정 이전에는 오더당 작업이 항상 1건이라 "작업 상태를 오더 상태에 그대로
 * 덮어쓴다"가 곧 정답이었다. 2인 배정에서는 오더당 작업이 최대 2건(담당자별)이라
 * 한쪽 상태만 보고 덮어쓰면, 담당자1이 먼저 끝내 '검토전'으로 넘어가도 담당자2는
 * 아직 '진행중'인데 오더가 검토 단계로 넘어가 버린다.
 *
 * 그래서 오더 상태는 **그 오더의 모든 작업 중 가장 뒤처진(진척도가 가장 낮은) 단계**로
 * 정한다 — JOB_STAGES 의 배열 순서를 진척도 기준으로 삼는다. '지연'은 단계가 아니라
 * 납기 경과 표시이므로, 하나라도 '지연'이면 오더도 '지연'로 본다(진척도 비교 대상에서 뺀다).
 *
 * 2인 배정이 아닌 오더(작업 1건)에서는 그 작업의 상태가 곧 "가장 뒤처진 단계"이므로
 * 결과가 예전(작업 상태를 그대로 덮어쓰던 방식)과 완전히 동일하다 — 하위호환.
 *
 * 작업이 하나도 없으면 아무것도 하지 않는다(오더 상태를 건드릴 근거가 없다).
 */
export async function syncOrderStatusFromJobs(orderId: string): Promise<void> {
  const { data: jobs, error } = await supabaseAdmin
    .from('qc_jobs')
    .select('status, assignee_tester_id')
    .eq('order_id', orderId)
  if (error) throw error
  if (!jobs || jobs.length === 0) return

  const statuses = jobs.map(j => j.status as string)

  // '지연'은 단계가 아니다 — 하나라도 지연이면 오더도 지연로 본다.
  if (statuses.some(s => s === DELAYED_STATUS)) {
    await supabaseAdmin.from('pct_orders').update({ status: DELAYED_STATUS }).eq('id', orderId)
    return
  }

  // JOB_STAGES 순서를 진척도로 삼아 index 가 가장 작은(가장 덜 진행된) 단계를 찾는다.
  let leastIdx: number = JOB_STAGES.length
  for (const s of statuses) {
    const idx = JOB_STAGES.indexOf(s as JobStage)
    if (idx >= 0 && idx < leastIdx) leastIdx = idx
  }
  if (leastIdx >= JOB_STAGES.length) return   // 유효한 단계를 하나도 못 찾으면 손대지 않는다(방어적)

  // 아직 '작업을 시작조차 하지 않은' 담당자는 qc_jobs 행이 없어서 위 비교에 잡히지 않는다.
  // 그대로 두면 담당자1이 자기 몫을 끝낸 순간 오더가 '검토전'으로 넘어가는데, 담당자2는
  // 아직 시작도 못 했다(그리고 오더가 '대기'가 아니게 되어 시작 목록에서도 사라진다).
  // 그래서 시작하지 않은 담당자가 남아 있으면 오더는 '진행중'을 넘어설 수 없게 묶는다.
  const stillUnstarted = await hasUnstartedAssignee(orderId, jobs.map(j => j.assignee_tester_id as string | null))
  if (stillUnstarted) leastIdx = Math.min(leastIdx, JOB_STAGES.indexOf(IN_PROGRESS_STATUS))

  await supabaseAdmin.from('pct_orders').update({ status: JOB_STAGES[leastIdx] }).eq('id', orderId)
}

/**
 * 2인 배정 오더에서 "배정은 됐는데 아직 작업을 시작하지 않은 담당자"가 남아 있는가.
 *
 * 슬롯에 진행할 항목이 하나도 없는 담당자(관리자가 항목을 전부 한쪽에 몰아둔 경우)는
 * 시작할 것이 없으므로 세지 않는다 — 그러지 않으면 오더가 '진행중'에서 영원히 못 벗어난다.
 */
async function hasUnstartedAssignee(orderId: string, startedTesterIds: (string | null)[]): Promise<boolean> {
  const { data: order } = await supabaseAdmin
    .from('pct_orders')
    .select('product_code, is_dual_assignment, assignee_tester_id, assignee_tester_id_2')
    .eq('id', orderId)
    .maybeSingle()
  if (!order?.is_dual_assignment) return false

  const started = new Set(startedTesterIds.filter((t): t is string => !!t))
  const slots: Array<{ slot: 1 | 2; testerId: string | null }> = [
    { slot: 1, testerId: (order.assignee_tester_id as string) ?? null },
    { slot: 2, testerId: (order.assignee_tester_id_2 as string) ?? null },
  ]

  for (const { slot, testerId } of slots) {
    if (!testerId || started.has(testerId)) continue
    const mine = await activeItemsForSlot(orderId, order.product_code as string, slot)
    if (mine.length > 0) return true      // 할 일이 남았는데 아직 시작 안 함
  }
  return false
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
    .neq('status', ITEM_CLEARED)
  if (cntErr || remaining === null || remaining > 0) return { allCleared: false, statusChangedTo: null }

  const target = NEXT_STAGE[IN_PROGRESS_STATUS] ?? REVIEW_READY_STATUS   // '검토전'

  // '진행중' 인 경우에만 전환 (동시 호출 시 한 번만 성공)
  const { data: updated } = await supabaseAdmin
    .from('qc_jobs')
    .update({ status: target })
    .eq('id', jobId)
    .eq('status', IN_PROGRESS_STATUS)
    .select('order_id')
    .maybeSingle()
  if (!updated) return { allCleared: true, statusChangedTo: null }

  // 오더 상태 동기화(2인 배정에서는 다른 담당자의 작업이 아직 뒤처져 있을 수 있다) + 이력 + 감독관 알림
  await syncOrderStatusFromJobs(updated.order_id as string)
  await logJobStatusChange({
    jobId, orderId: updated.order_id as string,
    fromStatus: IN_PROGRESS_STATUS, toStatus: target,
    source: 'auto', note: '전 시험항목 완료로 서버가 자동 전환했습니다.',
  })

  // 슬랙 알림은 부가 기능이다 — 응답을 붙잡지 않도록 await 하지 않는다.
  // 이 뒤의 return 값이 곧 HTTP 응답이라, await 하면 전이 API 가 슬랙 왕복만큼 느려진다.
  void notifyStageChangeToSlack({
    jobId, orderId: updated.order_id as string,
    fromStatus: IN_PROGRESS_STATUS, toStatus: target, source: 'auto',
  }).catch(() => {})

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
 * - 오더 상태를 함께 동기화하고, 상태 이력·알림을 남긴다.
 */
export async function advanceJobStage(
  jobId: string,
  expected?: string,
  /** 전이를 실행한 관리자(로그인 사용자) id — 상태 이력에 남긴다 */
  changedBy?: string,
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
    patch.work_end_date = kstToday()
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

  await syncOrderStatusFromJobs(updated.order_id as string)
  await logJobStatusChange({
    jobId, orderId: updated.order_id as string,
    fromStatus: current, toStatus: target,
    changedBy: changedBy ?? null, source: 'manual',
    note: STAGE_ACTION_LABEL[current] ?? '단계 전이',
  })

  // 슬랙 알림은 부가 기능이다 — 응답을 붙잡지 않도록 await 하지 않는다.
  // 이 뒤의 return 값이 곧 HTTP 응답이라, await 하면 전이 API 가 슬랙 왕복만큼 느려진다.
  void notifyStageChangeToSlack({
    jobId, orderId: updated.order_id as string,
    fromStatus: current, toStatus: target, source: 'manual',
  }).catch(() => {})

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

/** 항목을 만지기 전 공통 확인 — 소유권 + 시험 단계 여부 + 항목 존재.
 *
 *  [원칙2] 검토·승인 단계로 넘어간 작업의 항목은 더 이상 손댈 수 없다.
 *  예전에는 상태를 보지 않아 '승인완료' 작업에도 cleared_at 을 쓰고 알림까지 보냈다.
 */
async function loadItemForEdit(jobId: string, itemId: string, userSub: string) {
  await assertOwner(jobId, userSub)

  const { data: job } = await supabaseAdmin
    .from('qc_jobs').select('work_started_at, created_at, order_id, status').eq('id', jobId).single()
  if (job && !SELF_SERVICE_STATUSES.has(job.status as string)) {
    throw new Error(`"${job.status}" 단계의 작업은 시험항목을 변경할 수 없습니다.`)
  }

  const { data: item } = await supabaseAdmin
    .from('qc_job_items').select('id, test_item_name, status, started_at')
    .eq('id', itemId).eq('qc_job_id', jobId).maybeSingle()
  if (!item) throw new Error('시험항목을 찾을 수 없습니다.')

  return { job, item }
}

/** 시험자가 그 항목의 시작을 누른다 — 'pending' → 'in_progress' + started_at 적재.
 *
 *  순번을 강제하지 않는다. 시험자는 장비·시약·시료 상황에 따라 아무 항목이나 먼저
 *  시작할 수 있고, 오래 걸리는 시험을 걸어둔 채 다른 항목을 함께 시작해도 된다.
 */
export async function startItem(
  jobId: string, itemId: string, userSub: string,
): Promise<{ startedAt: string }> {
  const { item } = await loadItemForEdit(jobId, itemId, userSub)
  if (item.status === ITEM_CLEARED) throw new Error('이미 완료된 시험항목입니다.')
  // 이미 진행 중이면 시작 시각을 다시 쓰지 않는다 — 두 번 눌러 소요시간이 깎이면 안 된다.
  if (item.status === ITEM_IN_PROGRESS && item.started_at) {
    return { startedAt: item.started_at as string }
  }

  const now = new Date().toISOString()
  const { error } = await supabaseAdmin
    .from('qc_job_items')
    .update({ status: ITEM_IN_PROGRESS, started_at: now })
    .eq('id', itemId).eq('qc_job_id', jobId)
  if (error) throw error
  return { startedAt: now }
}

/** 시작 취소 — 잘못 누른 항목을 대기로 되돌린다. 시작 시각도 함께 지운다. */
export async function cancelItemStart(
  jobId: string, itemId: string, userSub: string,
): Promise<void> {
  const { item } = await loadItemForEdit(jobId, itemId, userSub)
  if (item.status === ITEM_CLEARED) {
    throw new Error('이미 완료된 시험항목은 시작을 취소할 수 없습니다.')
  }
  const { error } = await supabaseAdmin
    .from('qc_job_items')
    .update({ status: ITEM_PENDING, started_at: null })
    .eq('id', itemId).eq('qc_job_id', jobId)
  if (error) throw error
}

/** 항목 클리어 — 시간 적재 + 감독관 알림 + 전체 완료 시 '검토전' 자동 전환
 *
 *  소요시간은 두 기준을 함께 적재한다.
 *   - elapsed_total_minutes : 작업 시작 → 이 항목 완료 (작업 화면에 보여주는 값)
 *   - elapsed_minutes       : 이 항목 시작 → 완료 (항목 실소요, 통계·평가 기준)
 *  완료 버튼을 눌러도 작업 시작 시각은 움직이지 않으므로 누적값은 항목이 진행될수록 커진다.
 *
 *  started_at 이 없는 경우(시작을 누르지 않고 바로 완료했거나 0040 이전 항목)에는
 *  예전 기준인 '직전 항목 완료 이후 구간' 으로 계산한다 — 병행 시험에서는 부정확하지만
 *  값이 아예 비는 것보다 낫고, 통계의 과거 데이터와 의미가 이어진다.
 */
export async function clearItem(
  jobId: string, itemId: string, userSub: string,
): Promise<{ allCleared: boolean; statusChangedTo: string | null }> {
  const { job, item } = await loadItemForEdit(jobId, itemId, userSub)
  if (item.status === ITEM_CLEARED) throw new Error('이미 완료된 시험항목입니다.')
  const now = new Date()

  // 작업 시작 시각 — 0030 이전에 만들어진 작업은 work_started_at 이 비어 있어 created_at 으로 대체
  const jobStartedAt = new Date(
    (job?.work_started_at as string) ?? (job?.created_at as string) ?? now.toISOString(),
  )

  let itemStartedAt: Date
  if (item.started_at) {
    itemStartedAt = new Date(item.started_at as string)
  } else {
    const { data: lastCleared } = await supabaseAdmin
      .from('qc_job_items').select('cleared_at')
      .eq('qc_job_id', jobId).eq('status', ITEM_CLEARED)
      .order('cleared_at', { ascending: false }).limit(1).maybeSingle()
    itemStartedAt = lastCleared?.cleared_at ? new Date(lastCleared.cleared_at as string) : jobStartedAt
  }

  const minutesSince = (base: Date) => Math.max(0, Math.round((now.getTime() - base.getTime()) / 60000))
  const elapsedTotal = minutesSince(jobStartedAt)
  const elapsed = minutesSince(itemStartedAt)

  const { error } = await supabaseAdmin
    .from('qc_job_items')
    .update({
      status: ITEM_CLEARED,
      // 시작을 누르지 않고 바로 완료한 항목도 시작 시각을 남겨 둔다 — 이후 조회가
      // started_at 하나만 보면 되도록 기준을 한 곳으로 모은다.
      started_at: itemStartedAt.toISOString(),
      cleared_at: now.toISOString(),
      elapsed_minutes: elapsed,
      elapsed_total_minutes: elapsedTotal,
    })
    .eq('id', itemId).eq('qc_job_id', jobId)
  if (error) throw error

  await createNotification({
    type: 'item_cleared',
    title: '시험항목 완료',
    body: `시험항목 "${item.test_item_name}" 완료 (작업 시작 후 ${elapsedTotal}분, 항목 소요 ${elapsed}분)`,
    relatedOrderId: (job?.order_id as string) ?? null,
    relatedQcJobId: jobId, severity: 'info',
  })

  // 마지막 항목이었다면 '검토전' 으로 자동 전환
  return autoAdvanceToReview(jobId)
}

/**
 * 담당 시험자가 직접 바꿀 수 있는 상태.
 * 검토·승인 단계는 관리자만 advanceJobStage 로 넘길 수 있어야 워크플로가 의미를 갖는다.
 *
 * 목록은 @shared/qc-status 가 단일 기준이다 — 화면(동시분석 그룹 카드)도 같은 목록을
 * 봐야 "눌러도 아무 일이 없는 버튼" 이 생기지 않는다.
 */
const SELF_SERVICE_STATUSES = SELF_EDITABLE_JOB_STATUSES

/** 작업 상태 변경(담당자) — 오더 상태 동기화 + 감독관 알림.
 *  최종 단계(승인완료)면 work_end_date를 오늘로 설정(이미 설정된 경우 유지).
 */
export async function changeJobStatus(jobId: string, userSub: string, status: string): Promise<void> {
  await assertOwner(jobId, userSub)
  if (!SELF_SERVICE_STATUSES.has(status)) {
    throw new Error(`"${status}" 는 담당자가 직접 지정할 수 없습니다. 검토·승인은 관리자가 작업 현황에서 진행합니다.`)
  }

  // 2026-08-23 수정: 예전에는 **목표 상태만** 검사하고 현재 상태를 보지 않았다.
  // 그래서 '승인완료' 작업에 status='진행중' 을 보내면 그대로 통과해
  // 승인이 끝난 시험 기록이 되돌아가고 pct_orders.status 까지 함께 되돌아갔다.
  // 담당자가 스스로 바꿀 수 있는 출발 상태를 명시적으로 제한한다.
  const { data: before } = await supabaseAdmin
    .from('qc_jobs').select('status, work_end_date').eq('id', jobId).maybeSingle()
  if (!before) throw new Error('작업을 찾을 수 없습니다.')
  const current = before.status as string
  if (!SELF_SERVICE_STATUSES.has(current)) {
    throw new Error(
      `"${current}" 단계의 작업은 담당자가 상태를 바꿀 수 없습니다. 관리자에게 문의하세요.`,
    )
  }
  if (current === status) return   // 변경 없음

  const patch: Record<string, unknown> = { status }
  const { data: job, error } = await supabaseAdmin
    .from('qc_jobs').update(patch).eq('id', jobId)
    .eq('status', current)          // 낙관적 잠금 — 그 사이 바뀌었으면 실패
    .select('order_id').maybeSingle()
  if (error) throw error
  if (!job) throw new Error('다른 사용자가 먼저 상태를 변경했습니다. 새로고침 후 다시 시도하세요.')
  await syncOrderStatusFromJobs(job.order_id as string)
  await logJobStatusChange({
    jobId, orderId: job.order_id as string,
    fromStatus: current, toStatus: status,
    changedBy: userSub, source: 'manual', note: '담당자 상태 변경',
  })

  // 슬랙 알림은 부가 기능이다 — 응답을 붙잡지 않도록 await 하지 않는다.
  // 이 뒤의 return 값이 곧 HTTP 응답이라, await 하면 전이 API 가 슬랙 왕복만큼 느려진다.
  void notifyStageChangeToSlack({
    jobId, orderId: job.order_id as string,
    fromStatus: current, toStatus: status, source: 'manual',
  }).catch(() => {})

  await createNotification({
    type: 'status_changed',
    title: '상태 변경',
    body: `작업 상태가 "${status}" 로 변경되었습니다.`,
    relatedOrderId: job.order_id as string, relatedQcJobId: jobId, severity: 'info',
  })
}

/**
 * 관리자 상태 직접 변경 — 정해진 순서(advanceJobStage) 밖으로 상태를 옮긴다.
 *
 * 되돌리기(승인완료 → 검토중), 지연 지정/해제처럼 순차 전이로는 표현할 수 없는 정정이
 * 실제로 필요하다. 다만 임의 변경은 시험 기록의 신뢰도를 떨어뜨리므로
 *  ① 관리자만(라우트에서 requireAdmin), ② **사유 필수**, ③ 상태 이력에 사유까지 남긴다.
 *
 * work_end_date 는 종결 여부를 따라간다 — 승인완료로 가면 오늘로 기록하고,
 * 승인완료에서 되돌리면 지운다(완료일이 남아 있으면 완료 집계·공수 통계가 어긋난다).
 */
export async function setJobStatusByAdmin(
  jobId: string, adminUserSub: string, status: string, reason: string,
): Promise<{ from: string; to: string }> {
  if (!JOB_STATUSES.includes(status)) {
    throw new Error(`"${status}" 는 작업에 지정할 수 없는 상태입니다.`)
  }
  const note = reason.trim()
  if (note.length < 2) {
    throw new Error('상태를 직접 변경하려면 사유를 입력해야 합니다.')
  }

  const { data: before } = await supabaseAdmin
    .from('qc_jobs').select('status, order_id, qc_no, work_end_date').eq('id', jobId).maybeSingle()
  if (!before) throw new Error('작업을 찾을 수 없습니다.')
  const current = before.status as string
  if (current === status) return { from: current, to: status }

  const patch: Record<string, unknown> = { status }
  if (status === CLOSED_STAGE) {
    if (!before.work_end_date) patch.work_end_date = kstToday()
  } else if (current === CLOSED_STAGE) {
    patch.work_end_date = null
  }

  const { data: updated, error } = await supabaseAdmin
    .from('qc_jobs').update(patch).eq('id', jobId)
    .eq('status', current)          // 낙관적 잠금 — 그 사이 바뀌었으면 실패
    .select('order_id').maybeSingle()
  if (error) throw error
  if (!updated) throw new Error('다른 사용자가 먼저 상태를 변경했습니다. 새로고침 후 다시 시도하세요.')

  await syncOrderStatusFromJobs(updated.order_id as string)
  await logJobStatusChange({
    jobId, orderId: updated.order_id as string,
    fromStatus: current, toStatus: status,
    changedBy: adminUserSub, source: 'manual', note: `관리자 직접 변경 — ${note}`,
  })

  // 슬랙 알림은 부가 기능이다 — 응답을 붙잡지 않도록 await 하지 않는다.
  // 이 뒤의 return 값이 곧 HTTP 응답이라, await 하면 전이 API 가 슬랙 왕복만큼 느려진다.
  void notifyStageChangeToSlack({
    jobId, orderId: updated.order_id as string,
    fromStatus: current, toStatus: status, source: 'manual', note,
  }).catch(() => {})

  await createNotification({
    type: 'status_changed',
    title: '관리자 상태 변경',
    body: `QC ${before.qc_no} 작업 상태가 "${current}" → "${status}" 로 변경되었습니다. (사유: ${note})`,
    relatedOrderId: updated.order_id as string,
    relatedQcJobId: jobId,
    severity: 'warning',
  })

  return { from: current, to: status }
}

/** 작업 소유자(로그인 사용자) id — 라우트의 소유권 검사용. 없는 작업이면 undefined */
export async function getJobAssigneeUserId(jobId: string): Promise<string | null | undefined> {
  const { data } = await supabaseAdmin
    .from('qc_jobs').select('assignee_user_id').eq('id', jobId).maybeSingle()
  if (!data) return undefined
  return (data.assignee_user_id as string) ?? null
}

async function assertOwner(jobId: string, userSub: string): Promise<void> {
  const { data } = await supabaseAdmin.from('qc_jobs').select('assignee_user_id').eq('id', jobId).maybeSingle()
  if (!data) throw new Error('작업을 찾을 수 없습니다.')
  if (data.assignee_user_id !== userSub) throw new Error('본인 작업만 수정할 수 있습니다.')
}

// ─── 동시분석 그룹 단위 처리 ──────────────────────────────────────────────────
/**
 * 같은 동시분석 그룹의 배치들을 **한 번의 조작**으로 처리한다.
 *
 * 시험자는 3개 배치를 한 시퀀스로 돌리면서 「성상 완료」를 세 번 누르고 있었다. 배치가
 * 늘수록 클릭만 늘고, 그러다 한 배치를 빠뜨리면 기록이 어긋난다.
 *
 * ⚠️ 묶이는 것은 **조작뿐**이다. qc_job_items 는 배치별로 그대로 남는다 — 제조번호마다
 *    시험 기록과 성적서가 분리돼야 한다는 것(GMP 추적성)은 협상 대상이 아니다.
 *    항목 매칭은 test_item_name 으로 한다. 배치마다 항목 구성이 조금 다를 수 있으므로
 *    "그 이름을 가진 항목이 있는 작업" 에만 적용하고, 없는 배치는 조용히 건너뛴다.
 *
 * 남의 작업은 절대 건드리지 않는다 — 대상 작업을 assignee_user_id 로 먼저 좁힌다.
 * 관리자라도 여기서는 넓히지 않는다. 이 함수는 "내 손으로 하는 시험" 의 조작이다.
 */
export interface GroupItemResult {
  /** 실제로 처리된 (작업, 항목) 수 */
  affected: number
  /** 건드린 작업 수 */
  jobs: number
  /** 전 항목 완료로 '검토전' 이 된 작업의 QC번호 */
  advanced: string[]
}

/** 그룹에 속한 내 작업들을 찾는다. 그룹이 없거나 내 몫이 없으면 빈 배열. */
async function myJobsInGroup(groupId: string, userSub: string): Promise<Array<{ id: string; qcNo: string }>> {
  const { data: items, error: iErr } = await supabaseAdmin
    .from('concurrent_analysis_group_items').select('order_id').eq('group_id', groupId)
  if (iErr) throw iErr
  const orderIds = (items ?? []).map(i => i.order_id as string)
  if (orderIds.length === 0) return []

  const { data: jobs, error: jErr } = await supabaseAdmin
    .from('qc_jobs').select('id, qc_no, status')
    .in('order_id', orderIds)
    .eq('assignee_user_id', userSub)
  if (jErr) throw jErr
  // 검토·승인 단계로 넘어간 작업은 항목을 더 이상 건드리지 않는다(clearItem 과 같은 규칙).
  return (jobs ?? [])
    .filter(j => SELF_SERVICE_STATUSES.has(j.status as string))
    .map(j => ({ id: j.id as string, qcNo: j.qc_no as string }))
}

/**
 * 그룹 내 내 작업들에서 같은 이름의 시험항목을 한꺼번에 시작/완료한다.
 * 이미 그 상태인 항목은 건너뛴다 — 다시 눌러도 시간이 덮어써지지 않는다.
 */
export async function applyGroupItemAction(
  groupId: string, testItemName: string, action: 'start' | 'clear' | 'cancel', userSub: string,
): Promise<GroupItemResult> {
  const jobs = await myJobsInGroup(groupId, userSub)
  if (jobs.length === 0) throw new Error('이 그룹에 진행 중인 내 작업이 없습니다.')

  const { data: rows, error } = await supabaseAdmin
    .from('qc_job_items')
    .select('id, qc_job_id, status')
    .in('qc_job_id', jobs.map(j => j.id))
    .eq('test_item_name', testItemName)
  if (error) throw error

  // 이미 목표 상태인 것은 제외한다. 두 번 눌러 started_at 이 덮어써지거나
  // 완료 시각이 다시 찍히는 일을 막는다(개별 경로와 같은 규칙).
  const targets = (rows ?? []).filter(r => {
    const st = r.status as string
    if (action === 'start')  return st === ITEM_PENDING
    if (action === 'cancel') return st === ITEM_IN_PROGRESS
    return st !== ITEM_CLEARED
  })

  const advanced: string[] = []
  let affected = 0
  const touchedJobs = new Set<string>()
  for (const r of targets) {
    const jobId = r.qc_job_id as string
    // 개별 경로(startItem/clearItem/cancelItemStart)를 그대로 재사용한다.
    // 소요시간 적재·알림·전체완료 전환 규칙을 여기서 다시 쓰면 언젠가 갈라진다.
    if (action === 'start') await startItem(jobId, r.id as string, userSub)
    else if (action === 'cancel') await cancelItemStart(jobId, r.id as string, userSub)
    else {
      const res = await clearItem(jobId, r.id as string, userSub)
      if (res.statusChangedTo) advanced.push(jobs.find(j => j.id === jobId)?.qcNo ?? '')
    }
    affected++
    touchedJobs.add(jobId)
  }
  return { affected, jobs: touchedJobs.size, advanced: advanced.filter(Boolean) }
}

/**
 * 그룹 안에서 아직 시작하지 않은 내 오더를 한꺼번에 시작한다.
 * 장비 검증(startJob)은 오더마다 그대로 돈다 — 한 건이 막히면 그 건만 실패로 돌려준다.
 */
export async function startGroupJobs(
  groupId: string, userSub: string,
): Promise<{ started: Array<{ orderId: string; qcNo: string }>; failed: Array<{ orderId: string; message: string }> }> {
  const { data: items, error } = await supabaseAdmin
    .from('concurrent_analysis_group_items').select('order_id').eq('group_id', groupId)
  if (error) throw error
  const orderIds = (items ?? []).map(i => i.order_id as string)

  // 이미 내 작업이 있는 오더는 건너뛴다.
  const { data: mine } = await supabaseAdmin
    .from('qc_jobs').select('order_id').in('order_id', orderIds).eq('assignee_user_id', userSub)
  const already = new Set((mine ?? []).map(j => j.order_id as string))

  const started: Array<{ orderId: string; qcNo: string }> = []
  const failed: Array<{ orderId: string; message: string }> = []
  for (const orderId of orderIds) {
    if (already.has(orderId)) continue
    try {
      const r = await startJob(orderId, userSub)
      started.push({ orderId, qcNo: r.qcNo })
    } catch (e) {
      // 내 배정이 아닌 오더는 그룹에 있어도 시작 대상이 아니다 — 실패로 보고하지 않는다.
      const msg = e instanceof Error ? e.message : '시작 실패'
      if (!msg.includes('본인에게 배정된')) failed.push({ orderId, message: msg })
    }
  }
  return { started, failed }
}
