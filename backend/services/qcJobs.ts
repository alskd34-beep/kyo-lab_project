/**
 * [BACKEND] QC 작업 (담당자 실행)
 *
 * 담당자(user)는 본인 tester(users.tester_id)에 배정된 오더를 시작한다.
 * 시작 시 QC번호 채번 + 시험항목(product_test_items) 기준 체크리스트 생성.
 * 항목 클리어 시 시간 적재 + 감독관(admin) 알림. 상태 변경 시에도 알림.
 * 시작 전 장비 준비상태(검교정+가용성) 자동 검증 연동.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { rpcWithDeadlockRetry } from '@backend/lib/rpcRetry'
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
import {
  PARALLEL_ASSIGN_FEATURE, PARALLEL_ASSIGN_MIGRATION,
  assigneesOfOrderForWrite, isOrderCoAssignee, loadAssigneesByOrder,
} from '@backend/services/orderAssignees'
import { ASSIGNED_TESTER_FILTER_COLUMN, withAssignedTesterEmbed } from '@backend/lib/assigneeFilter'
import { PRIMARY_ASSIGNEE_SLOT, isParallelAssignment } from '@shared/assignment'
import { notifyStageChangeToSlack } from '@backend/services/slackNotify'
import type { GroupMember, JobGroupSummary } from '@shared/qc-group-stage'
import {
  ACTIVE_JOB_STATUSES,
  APPROVAL_READY_STATUS,
  CLOSED_STAGE,
  DELAYED_STATUS,
  DELETED_STATUS,
  DERIVED_JOB_STAGES,
  IN_PROGRESS_STATUS,
  ITEM_CLEARED,
  ITEM_EDITABLE_JOB_STATUSES,
  ITEM_IN_PROGRESS,
  ITEM_PENDING,
  ITEM_REVIEW_NONE,
  JOB_STAGES,
  JOB_STATUSES,
  NEXT_STAGE,
  PENDING_STATUS,
  REVIEWING_STATUS,
  REVIEW_READY_STATUS,
  STAGE_ACTION_LABEL,
  TESTER_STATUS_CHANGE_STATUSES,
  canAdvanceByAdmin,
  hasReviewTrace,
  isJobStage,
  type JobStage,
} from '@shared/qc-status'

/** 0048 미적용 안내에 쓰는 기능 이름·마이그레이션 파일 */
export const ITEM_REVIEW_FEATURE = '시험항목 검토'
export const ITEM_REVIEW_MIGRATION = '0048_item_review.sql'
/** 0048 의 DB 함수를 부를 수 없을 때(미적용) 쓰기 동작을 거절하는 문구 — spec §3.2 */
export const ITEM_REVIEW_INSTALL_MESSAGE =
  '시험항목 검토 기능의 DB 설치(0048 마이그레이션)가 아직 적용되지 않았습니다. 관리자에게 문의하세요.'

/**
 * 항목 시작·시작 취소·완료의 조건부 update 가 0행일 때(F2-6) — 확인한 뒤 쓰기 전에 그 항목이 다른 담당자에게
 * 넘어갔거나(F2 reassign_job_item) 상태가 바뀐 경우. 예전에는 0행인데도 성공으로 응답했다.
 */
export const ITEM_STATE_CHANGED_MESSAGE = '작업 상태가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.'

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
  /** 검토 축(0048): 'none' | 'reviewing' | 'reviewed'. 0048 미적용이면 'none' */
  reviewStatus: string
  reviewStartedAt: string | null
  reviewStartedByName: string | null
  reviewedAt: string | null
  reviewedByName: string | null
}

// ─── 시험항목 조회 (0048 검토 컬럼 포함) ──────────────────────────────────────
const ITEM_BASE_COLUMNS =
  'id, qc_job_id, test_item_name, sequence_order, status, started_at, cleared_at, elapsed_minutes, elapsed_total_minutes'
const ITEM_REVIEW_COLUMNS =
  'review_status, review_started_at, review_started_by_name, reviewed_at, reviewed_by_name'

/** 테이블·컬럼·함수가 아직 없는(마이그레이션 미적용) 오류인가 */
export function isSchemaMissingError(err: { code?: string } | null | undefined): boolean {
  const c = err?.code
  return c === '42703' || c === '42P01' || c === '42883'
    || c === 'PGRST202' || c === 'PGRST204' || c === 'PGRST205'
}

/**
 * 작업들의 시험항목을 읽는다(순번 순).
 *
 * 0048 미적용 DB 에서는 검토 컬럼 참조가 42703 을 내고, PostgREST 는 select 전체를 실패시킨다.
 * 예전 코드는 이 오류를 버려 항목 목록이 **아무 안내 없이 텅 비었다**. 여기서는 검토 컬럼 없이
 * 한 번 더 읽어 화면이 죽지 않게 하고, 무엇을 적용해야 하는지 `reviewSetupError` 로 알린다.
 * (읽기 경로의 대체일 뿐이다 — 검토 쓰기 동작과 시험자 항목 조작은 미적용이면 거절한다)
 */
export async function loadJobItems(
  jobIds: string[],
): Promise<{ byJob: Map<string, JobItemRow[]>; reviewSetupError: string | null }> {
  const byJob = new Map<string, JobItemRow[]>()
  if (jobIds.length === 0) return { byJob, reviewSetupError: null }

  let reviewSetupError: string | null = null
  let rows: Record<string, unknown>[] = []
  const full = await supabaseAdmin
    .from('qc_job_items')
    .select(`${ITEM_BASE_COLUMNS}, ${ITEM_REVIEW_COLUMNS}`)
    .in('qc_job_id', jobIds)
    .order('sequence_order', { ascending: true })
  if (full.error && isSchemaMissingError(full.error)) {
    reviewSetupError = describeSchemaError(full.error, ITEM_REVIEW_FEATURE, ITEM_REVIEW_MIGRATION).message
    const base = await supabaseAdmin
      .from('qc_job_items')
      .select(ITEM_BASE_COLUMNS)
      .in('qc_job_id', jobIds)
      .order('sequence_order', { ascending: true })
    if (base.error) throw base.error
    rows = (base.data ?? []) as unknown as Record<string, unknown>[]
  } else {
    if (full.error) throw full.error
    rows = (full.data ?? []) as unknown as Record<string, unknown>[]
  }

  for (const it of rows) {
    const jid = it.qc_job_id as string
    const arr = byJob.get(jid) ?? []
    arr.push({
      id: it.id as string,
      testItemName: it.test_item_name as string,
      sequenceOrder: it.sequence_order as number,
      status: it.status as string,
      startedAt: (it.started_at as string) ?? null,
      clearedAt: (it.cleared_at as string) ?? null,
      elapsedMinutes: (it.elapsed_minutes as number) ?? null,
      elapsedTotalMinutes: (it.elapsed_total_minutes as number) ?? null,
      reviewStatus: (it.review_status as string) ?? ITEM_REVIEW_NONE,
      reviewStartedAt: (it.review_started_at as string) ?? null,
      reviewStartedByName: (it.review_started_by_name as string) ?? null,
      reviewedAt: (it.reviewed_at as string) ?? null,
      reviewedByName: (it.reviewed_by_name as string) ?? null,
    })
    byJob.set(jid, arr)
  }
  return { byJob, reviewSetupError }
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
  /** 병렬 배정 오더(담당자 2명 이상)인가 — 할 일 화면의 [넘기기](F2) 노출 판정 */
  isParallel: boolean
  /** 이 오더에서 내 담당자 번호(1~5). 담당자 구성에서 빠졌으면 null */
  mySlot: number | null
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
export async function listWorkspace(userSub: string): Promise<{
  testerLinked: boolean; pendingOrders: PendingOrderRow[]; jobs: QcJobRow[]
  /** 0048 미적용 안내(검토 상태를 읽지 못함). 적용됐으면 null */
  reviewSetupError: string | null
}> {
  const testerId = await getTesterId(userSub)
  if (!testerId) return { testerLinked: false, pendingOrders: [], jobs: [], reviewSetupError: null }

  // 내 작업
  const { data: jobRows, error: jobsErr } = await supabaseAdmin
    .from('qc_jobs')
    .select('id, order_id, qc_no, work_start_date, work_end_date, status')
    .eq('assignee_user_id', userSub)
    .order('created_at', { ascending: false })
  if (jobsErr) throw describeSchemaError(jobsErr, PARALLEL_ASSIGN_FEATURE, PARALLEL_ASSIGN_MIGRATION)

  const jobOrderIds = (jobRows ?? []).map(j => j.order_id as string)

  // 오더 정보 (작업/대기 공통)
  // 병렬 배정 오더는 담당자 2~5 로 배정된 경우도 "내 오더"다 — 대표(assignee_tester_id) eq() 하나만
  // 쓰면 병렬 담당자에게는 오더 자체가 보이지 않는다. 담당자 슬롯 테이블(0049)을 inner 임베드로 건다.
  //
  // 0049 미적용 DB 에서는 임베드 관계가 없어 오류가 난다. 예전(0037)처럼 error 를 버리면
  // 대기 목록·작업 화면이 아무 안내 없이 텅 비므로 describeSchemaError 로 감싸 원인을 알린다.
  const { data: orderData, error: ordersErr } = await supabaseAdmin
    .from('pct_orders')
    .select(withAssignedTesterEmbed('id, product_code, product_name, batch_no, due_date, is_urgent, method, status', testerId))
    .eq(ASSIGNED_TESTER_FILTER_COLUMN, testerId)
    .neq('status', DELETED_STATUS)
  if (ordersErr) throw describeSchemaError(ordersErr, PARALLEL_ASSIGN_FEATURE, PARALLEL_ASSIGN_MIGRATION)
  const orderRows = (orderData ?? []) as unknown as Record<string, unknown>[]
  const orderById = new Map<string, Record<string, unknown>>()
  for (const o of orderRows) orderById.set(o.id as string, o)
  // 내 오더들의 담당자 구성 — 병렬 여부·내 슬롯 번호
  const assigneeMap = await loadAssigneesByOrder(orderRows.map(o => o.id as string))
  const isParallelOrder = (orderId: string) => isParallelAssignment(assigneeMap.get(orderId))
  const mySlotOf = (orderId: string) => assigneeMap.get(orderId)?.find(a => a.testerId === testerId)?.slot ?? null

  // 작업 항목
  const jobIds = (jobRows ?? []).map(j => j.id as string)
  const { byJob: itemsByJob, reviewSetupError } = await loadJobItems(jobIds)

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
      isParallel: isParallelOrder(j.order_id as string),
      mySlot:     mySlotOf(j.order_id as string),
    }
  })

  // 병렬 배정 오더는 "내 슬롯에 진행할 항목이 있는가"까지 봐야 한다. 항목이 0개면 시작해도
  // startJob 이 '배정된 시험항목이 없습니다' 로 거절하는데, 그 오더가 대기 목록에 계속 남아
  // 누를 때마다 에러만 나는 상태가 된다. 후보를 한 번에 세어 N+1 을 피한다.
  const parallelCandidateIds = orderRows
    .filter(o => isParallelOrder(o.id as string) && !jobOrderIds.includes(o.id as string))
    .map(o => o.id as string)
  const slotCounts = await countActiveBySlot(parallelCandidateIds)

  const pendingOrders: PendingOrderRow[] = orderRows
    .filter(o => {
      const orderId = o.id as string
      // 내가 이미 시작한 오더는 '작업'쪽에 있으므로 대기 목록에서 뺀다.
      if (jobOrderIds.includes(orderId)) return false
      // 1인 배정: 예전 그대로 오더 상태가 '대기'일 때만 시작 대기로 본다.
      if (!isParallelOrder(orderId)) return o.status === PENDING_STATUS
      // 병렬 배정: 다른 담당자가 먼저 시작하면 오더 상태가 '진행중'으로 넘어간다.
      // 오더 상태만 보면 아직 시작도 못 한 내 몫이 목록에서 사라져 영영 시작할 수 없다.
      // "내 작업이 아직 없다"가 곧 내 시작 대기이므로, 종결·삭제만 제외한다.
      if (o.status === CLOSED_STAGE || o.status === DELETED_STATUS) return false
      // 내 슬롯에 할 일이 없으면 대기로 잡지 않는다(작업 시작 뒤 추가된 담당자는 항목을 넘겨받기 전까지 0개).
      // 스냅샷이 아직 없어 카운트를 모르는 오더(맵에 없음)는 전 항목이 대표(담당자 1) 몫으로 깔린다
      // (ensureSnapshot 이 slot 1 로 깐다) — 대표에게만 대기로 보인다. 오더 상태 동기화(hasUnstartedAssignee)와 같은 판정.
      const counts = slotCounts.get(orderId)
      const mySlot = mySlotOf(orderId)
      if (!counts) return mySlot === PRIMARY_ASSIGNEE_SLOT
      return mySlot !== null && (counts.get(mySlot) ?? 0) > 0
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

  return { testerLinked: true, pendingOrders, jobs, reviewSetupError }
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
  /** 이 오더가 속한 동시분석 그룹의 오더 수 — 2 이상이면 카드에 "동시 N" 배지. 그룹이 없거나 1건이면 0 */
  groupSize: number
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
   * 병렬 배정으로 같은 오더를 함께 맡은 동료. 이 행의 숫자·목록은 **나와 함께 배정된 오더로 한정**된다.
   * 동료의 다른 업무까지 보여주는 것은 요청 범위 밖이고, 시험자에게 동료의 전체 업무를
   * 열어 주는 것은 별개의 결정이다.
   */
  isCoAssignee: boolean
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
  /** 'admin' = 전체 시험자, 'tester' = 본인 + 병렬 배정 동료(공유 오더 한정) */
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
  groupSizeByOrder: Map<string, number>,
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
    groupSize: groupSizeByOrder.get(j.order_id as string) ?? 0,
  }
}

/**
 * 오더 → 그 오더가 속한 동시분석 그룹의 오더 수(2 이상만). 목록의 "동시 N" 배지용.
 * 그룹 테이블이 없거나 읽기에 실패해도 목록은 죽지 않게 빈 맵을 돌려준다(표시 편의 기능이다).
 */
export async function loadGroupSizeByOrder(): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  try {
    const { data, error } = await supabaseAdmin
      .from('concurrent_analysis_group_items').select('group_id, order_id')
    if (error) return out
    const sizeOf = new Map<string, number>()
    for (const it of data ?? []) sizeOf.set(it.group_id as string, (sizeOf.get(it.group_id as string) ?? 0) + 1)
    for (const it of data ?? []) {
      const size = sizeOf.get(it.group_id as string) ?? 0
      if (size >= 2) out.set(it.order_id as string, size)
    }
  } catch { /* 그룹 정보가 없으면 배지 없이 보인다 */ }
  return out
}

/**
 * 작업이 속한 동시분석 그룹 요약(관리자 작업 상세의 "동시분석 N건").
 * 오더 2건 미만 그룹이거나 그룹이 없으면 null. 그룹 테이블을 읽지 못해도 상세 조회를 막지 않는다.
 * 멤버마다 항목 검토 요약을 싣는다 — 화면이 확인 모달의 대상 배치를 계산한다(최종 판정은 서버).
 */
async function loadJobGroupSummary(orderId: string): Promise<JobGroupSummary | null> {
  try {
    const { data: mine, error: mineErr } = await supabaseAdmin
      .from('concurrent_analysis_group_items').select('group_id').eq('order_id', orderId).maybeSingle()
    if (mineErr || !mine) return null
    const groupId = mine.group_id as string

    const [groupRes, membersRes] = await Promise.all([
      supabaseAdmin.from('concurrent_analysis_groups').select('id, label').eq('id', groupId).maybeSingle(),
      supabaseAdmin.from('concurrent_analysis_group_items').select('order_id').eq('group_id', groupId),
    ])
    if (membersRes.error) return null
    const orderIds = (membersRes.data ?? []).map(m => m.order_id as string)
    if (orderIds.length < 2) return null

    const [ordersRes, jobsRes] = await Promise.all([
      supabaseAdmin.from('pct_orders').select('id, product_name, batch_no, status').in('id', orderIds),
      supabaseAdmin.from('qc_jobs').select('id, order_id, qc_no, status, assignee_tester_id').in('order_id', orderIds),
    ])
    if (ordersRes.error || jobsRes.error) return null
    const orderById = new Map((ordersRes.data ?? []).map(o => [o.id as string, o as Record<string, unknown>]))
    const jobRows = (jobsRes.data ?? []) as Record<string, unknown>[]

    const testerIds = [...new Set(jobRows.map(j => j.assignee_tester_id as string | null).filter((t): t is string => !!t))]
    const [testersRes, itemsRes] = await Promise.all([
      testerIds.length > 0
        ? supabaseAdmin.from('testers').select('id, name').in('id', testerIds)
        : Promise.resolve({ data: [] as Record<string, unknown>[] }),
      loadJobItems(jobRows.map(j => j.id as string)),
    ])
    const testerName = new Map((testersRes.data ?? []).map(t => [t.id as string, t.name as string]))

    const members: GroupMember[] = []
    for (const oid of orderIds) {
      const o = orderById.get(oid)
      const base = {
        orderId: oid,
        productName: (o?.product_name as string) ?? '',
        batchNo: (o?.batch_no as string) ?? '',
      }
      const jobs = jobRows.filter(j => j.order_id === oid)
      if (jobs.length === 0) {
        members.push({ ...base, jobId: null, qcNo: null, status: (o?.status as string) ?? '', testerName: null, items: [] })
        continue
      }
      for (const j of jobs) {
        members.push({
          ...base,
          jobId: j.id as string,
          qcNo: j.qc_no as string,
          status: j.status as string,
          testerName: testerName.get(j.assignee_tester_id as string) ?? null,
          items: (itemsRes.byJob.get(j.id as string) ?? []).map(it => ({
            testItemName: it.testItemName, status: it.status, reviewStatus: it.reviewStatus,
          })),
        })
      }
    }
    // QC번호 순(미시작 오더는 뒤) — 조회마다 순서가 흔들리지 않게
    members.sort((a, b) => {
      if ((a.qcNo === null) !== (b.qcNo === null)) return a.qcNo === null ? 1 : -1
      return (a.qcNo ?? '').localeCompare(b.qcNo ?? '') || a.batchNo.localeCompare(b.batchNo)
    })

    return {
      groupId,
      groupLabel: (groupRes.data?.label as string | null) ?? null,
      orderCount: orderIds.length,
      members,
    }
  } catch (err) {
    console.error('[qcJobs.loadJobGroupSummary] 동시분석 그룹 요약을 읽지 못함 — 상세는 그룹 없이 보인다:', orderId, err)
    return null
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
  /** 그 버튼에 표시할 라벨 (이제 '승인' 뿐). 없으면 null */
  nextStageLabel: string | null
  /** 소유자(로그인 사용자) id — 라우트의 소유권 검사에 쓴다 */
  assigneeUserId: string | null
  /** 0048 미적용 안내(검토 상태를 읽지 못함). 적용됐으면 null */
  reviewSetupError: string | null
  /**
   * 동시분석 그룹 요약(오더 2건 이상 그룹만). 관리자 응답에만 싣는다 — 시험자 열람 경로로
   * 남의 배치 QC번호·담당자를 넓혀 보이지 않게(spec §8). 없거나 시험자면 null.
   */
  group: JobGroupSummary | null
}

/**
 * 작업 상세 조회 — 어떤 시험항목을 수행 중인지 확인용 (관리자 작업현황 화면).
 *
 * 예전에는 "미완료 항목 중 sequence_order 가 가장 작은 것"을 진행 중으로 추론했다.
 * 그래서 1번을 완료하면 2번이 저절로 진행 중이 되었는데, 시험자는 순번대로 시험하지
 * 않는다. 0040 부터 항목이 'in_progress' 상태와 started_at 을 직접 갖는다 — 추론하지
 * 않고 시험자가 [시작]으로 정한 것만 진행 중으로 본다(병행이라 여럿일 수 있다).
 */
export async function getJobDetail(
  jobId: string,
  /** includeGroup: 동시분석 그룹 요약을 싣는가(관리자만) */
  opts: { includeGroup?: boolean } = {},
): Promise<JobDetail | null> {
  const { data: job } = await supabaseAdmin
    .from('qc_jobs')
    .select('id, order_id, qc_no, status, work_start_date, work_end_date, work_started_at, created_at, assignee_tester_id, assignee_user_id')
    .eq('id', jobId)
    .maybeSingle()
  if (!job) return null

  const [orderRes, testerRes, itemsRes, group] = await Promise.all([
    supabaseAdmin
      .from('pct_orders')
      .select('id, product_code, product_name, batch_no, due_date, is_urgent, method')
      .eq('id', job.order_id as string)
      .maybeSingle(),
    job.assignee_tester_id
      ? supabaseAdmin.from('testers').select('name, employee_no').eq('id', job.assignee_tester_id as string).maybeSingle()
      : Promise.resolve({ data: null }),
    loadJobItems([jobId]),
    opts.includeGroup ? loadJobGroupSummary(job.order_id as string) : Promise.resolve(null),
  ])

  const order = orderRes.data as Record<string, unknown> | null
  const tester = testerRes.data as Record<string, unknown> | null

  const items: JobItemRow[] = itemsRes.byJob.get(jobId) ?? []

  const status = job.status as string
  // "현재 수행 중인 항목"은 아직 시험을 하고 있는 단계에서만 의미가 있다.
  // 항목 단위 검토(0048) 뒤로는 검토전·검토중 작업에도 시험 중인 항목이 있을 수 있다 —
  // 시험자가 항목을 조작할 수 있는 단계(ITEM_EDITABLE_JOB_STATUSES)와 같은 기준을 쓴다.
  const testing = ITEM_EDITABLE_JOB_STATUSES.has(status)
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
    reviewSetupError: itemsRes.reviewSetupError,
    group,
  }
}

/**
 * 이 사용자가 그 작업의 상세를 열람할 수 있는가.
 *
 * 원칙은 "본인 작업만"이다(관리자는 전체). 여기에 병렬 배정 동료를 더한다 — 같은 오더를
 * 여럿이 나눠 맡으면 동료가 어디까지 했는지 보여야 남은 몫을 판단할 수 있고, 작업 현황
 * 화면이 그 동료 행을 이미 보여주므로 눌러도 열리지 않으면 화면이 거짓말을 하는 셈이다.
 *
 * 넓히는 것은 **같은 오더에 병렬 배정된 담당자 전원(담당자 1~5)으로 한정**한다. 동료의 다른 작업은
 * 여전히 남의 작업이다. 쓰기(clearItem·changeJobStatus 등)는 그대로 assertOwner 가 막는다 —
 * 여기는 읽기 전용 판정이다.
 */
export async function canViewJob(jobId: string, userSub: string): Promise<boolean> {
  const { data: job } = await supabaseAdmin
    .from('qc_jobs').select('order_id, assignee_user_id').eq('id', jobId).maybeSingle()
  if (!job) return false
  if ((job.assignee_user_id as string | null) === userSub) return true

  const testerId = await getTesterId(userSub)
  if (!testerId) return false

  // 판정 함수는 하나로 모은다(F2 "같은 그룹" 과 같은 기준) — 그 오더가 병렬 배정이고 내가 그 담당자 중 한 명
  return isOrderCoAssignee(job.order_id as string, testerId)
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
 *   - 동료 행    : **나와 함께 병렬 배정된 오더에 한정된** 현황
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

  // 2) 작업 + 3) 오더 (삭제 제외) + 동시분석 그룹 크기("동시 N" 배지) 병렬
  const [jobsRes, ordersRes, groupSizeByOrder] = await Promise.all([
    supabaseAdmin
      .from('qc_jobs')
      .select('id, order_id, qc_no, assignee_tester_id, status, work_start_date, work_end_date')
      .order('created_at', { ascending: false }),
    supabaseAdmin
      .from('pct_orders')
      .select('id, product_name, batch_no, due_date, is_urgent, status')
      .neq('status', DELETED_STATUS),
    loadGroupSizeByOrder(),
  ])
  // 예전(0037)에는 error 를 버려 관리자 「작업자 현황」이 안내 없이 통째로 비어 보였다(listWorkspace 와 같은 문제).
  if (jobsRes.error) throw describeSchemaError(jobsRes.error, PARALLEL_ASSIGN_FEATURE, PARALLEL_ASSIGN_MIGRATION)
  if (ordersRes.error) throw describeSchemaError(ordersRes.error, PARALLEL_ASSIGN_FEATURE, PARALLEL_ASSIGN_MIGRATION)
  const jobRows = (jobsRes.data ?? []) as Record<string, unknown>[]
  const orderRows = (ordersRes.data ?? []) as Record<string, unknown>[]
  const orderById = new Map<string, Record<string, unknown>>()
  for (const o of orderRows) orderById.set(o.id as string, o)
  // 담당자 구성(0049) — 오더가 많아 담당자 테이블 전체를 한 번 읽는다. 미적용이면 설치 안내 오류.
  const assigneeMap = await loadAssigneesByOrder()
  const slotsOf = (orderId: string) => assigneeMap.get(orderId) ?? []

  // 3-1) 시험자 시점이면 "내가 낀 병렬 배정 오더"와 그 오더의 동료를 먼저 추린다.
  //      동료 행은 그 동료와 함께 맡은 오더에 한정해서만 채운다.
  const sharedMembersByOrder = new Map<string, Set<string>>()   // orderId → 그 오더의 담당자 전원
  const coAssigneeTesterIds = new Set<string>()
  if (viewerTesterId) {
    for (const o of orderRows) {
      const slots = slotsOf(o.id as string)
      if (!isParallelAssignment(slots)) continue
      const members = new Set(slots.map(a => a.testerId))
      if (!members.has(viewerTesterId)) continue
      sharedMembersByOrder.set(o.id as string, members)
      for (const m of members) if (m !== viewerTesterId) coAssigneeTesterIds.add(m)
    }
  }

  /** 이 (시험자, 오더) 조합을 지금 보는 사람에게 보여도 되는가 */
  const visible = (testerId: string, orderId: string): boolean => {
    if (!viewerTesterId) return true                 // 관리자 — 전체
    if (testerId === viewerTesterId) return true     // 본인 — 전부
    return sharedMembersByOrder.get(orderId)?.has(testerId) ?? false
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
    // 시험자 시점에서는 본인과 병렬 배정 동료만 행을 만든다.
    if (viewerTesterId && tid !== viewerTesterId && !coAssigneeTesterIds.has(tid)) continue
    rowByTester.set(tid, {
      testerId: tid,
      name: t.name as string,
      employeeNo: t.employee_no as string,
      isActive: !!t.is_active,
      isSelf: viewerTesterId ? tid === viewerTesterId : false,
      isCoAssignee: viewerTesterId ? coAssigneeTesterIds.has(tid) : false,
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
  // 예전에는 오더 단위(startedOrderIds)라서, 병렬 배정에서 한 명만 시작해도 아직
  // 시작하지 않은 다른 담당자 몫까지 "대기" 집계에서 함께 사라졌다.
  const startedByTesterOrder = new Set<string>()   // `${orderId}::${testerId}`

  // 작업 집계
  for (const j of jobRows) {
    const testerId = j.assignee_tester_id as string | null
    if (testerId) startedByTesterOrder.add(`${j.order_id as string}::${testerId}`)
    if (!testerId) continue
    // startedByTesterOrder 는 가드보다 먼저 채운다 — 시험자 시점에서 동료가 이미 시작한
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
      row.completedJobs.push(toOverviewJob(j, o, itemAgg, groupSizeByOrder))
      continue
    }
    if (!ACTIVE_JOB_STATUSES.has(status)) continue

    if (status === IN_PROGRESS_STATUS) row.inProgress += 1
    // 검토전·검토중·승인전은 검토·승인 절차에 들어간 작업이라 검토 카운터로 함께 센다.
    // (항목 단위 검토 뒤로 검토중 작업에는 시험 중인 항목이 남아 있을 수 있다 — 화면 미표시 필드)
    else if (status === REVIEW_READY_STATUS || status === REVIEWING_STATUS || status === APPROVAL_READY_STATUS) row.reviewing += 1
    else if (status === DELAYED_STATUS) row.delayed += 1

    row.activeJobs.push(toOverviewJob(j, o, itemAgg, groupSizeByOrder))
  }

  // 시작 대기 오더 집계 (배정됐고 status '대기' & 아직 미시작)
  // 병렬 배정 오더는 담당자 1~5 각각 아직 자기 몫을 시작하지 않았으면
  // 각자의 목록에 따로 잡힌다(한 오더가 여러 사람에게 각각 잡히는 것이 정상이다).
  // 슬롯에 할 일이 0개인 담당자는 시작해도 startJob 이 거절하므로 대기로 세지 않는다
  // (listWorkspace 와 같은 규칙). 후보를 한 번에 세어 N+1 을 피한다.
  const parallelOverviewIds = orderRows
    .filter(o => isParallelAssignment(slotsOf(o.id as string)) && o.status !== CLOSED_STAGE && o.status !== DELETED_STATUS)
    .map(o => o.id as string)
  const overviewSlotCounts = await countActiveBySlot(parallelOverviewIds)

  for (const o of orderRows) {
    const orderId = o.id as string
    const slots = slotsOf(orderId)
    const parallel = isParallelAssignment(slots)
    // 1인 배정은 예전 그대로 오더 상태가 '대기'일 때만 센다.
    // 병렬 배정은 다른 담당자가 먼저 시작하면 오더가 '진행중'이 되므로 오더 상태로 거르면
    // 아직 시작 안 한 담당자의 대기 건이 집계에서 통째로 사라진다(listWorkspace 와 같은 이유).
    if (parallel
      ? (o.status === CLOSED_STAGE || o.status === DELETED_STATUS)
      : o.status !== PENDING_STATUS) continue
    for (const { slot, testerId } of slots) {
      if (!visible(testerId, orderId)) continue
      if (startedByTesterOrder.has(`${orderId}::${testerId}`)) continue
      if (parallel) {
        // 스냅샷이 아직 없어 카운트를 모르면(맵에 없음) 전 항목이 대표 몫이다 — 대표만 센다(할 일과 같은 판정).
        const counts = overviewSlotCounts.get(orderId)
        if (counts ? (counts.get(slot) ?? 0) === 0 : slot !== PRIMARY_ASSIGNEE_SLOT) continue
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
    // 본인 화면은 "내 현황"이 먼저다. 작업량 순으로 두면 동료가 더 바쁠 때 내가 밀린다.
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
    .select('id, product_code, product_name, batch_no, method')
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
  // 담당자 구성(0049)에서 내 슬롯을 찾는다 — 담당자 1~5 중 누구든 본인 오더다.
  // 0049 미적용이면 설치 안내로 거절한다(작업 생성은 쓰기 경로).
  const slots = await assigneesOfOrderForWrite(orderId)
  if (slots.length === 0) {
    throw new Error('아직 담당자가 배정되지 않은 오더입니다. 관리자 배정 후 시작할 수 있습니다.')
  }
  const mine = slots.find(a => a.testerId === testerId)
  if (!mine) {
    throw new Error('본인에게 배정된 오더만 시작할 수 있습니다.')
  }
  const isParallel = isParallelAssignment(slots)
  const mySlot = mine.slot

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
  //  - 병렬 배정: method 와 무관하게 항상 내 슬롯(mySlot) 몫만 (pct_order_test_items.assignee_slot)
  //  - 개별항목: 오더 생성 시 고른 항목만 (pct_order_test_items)
  //  - 전항목  : 품목에 등록된 시험항목 전체 (product_test_items)
  // 작업을 만든 뒤에 실패하면 QC번호만 소모된 빈 작업이 남으므로 순서가 중요하다.
  // test_item_id 를 함께 적는다. 예전에는 이름만 넣어서 이 컬럼이 **한 건도** 채워지지
  // 않았고(51/51 null), 시험항목 실적 통계는 이름 문자열로만 마스터와 이어야 했다.
  // 마스터에서 항목 이름을 한 번 고치면 그 지점에서 실적이 조용히 끊긴다.
  const plannedItems: Array<{
    test_item_name: string; sequence_order: number; test_item_id?: string | null
  }> = []
  if (isParallel) {
    // 병렬 배정은 슬롯이 유일한 기준이다 — method(전항목/개별항목) 값은 보지 않는다.
    const selected = await activeItemsForSlot(orderId, order.product_code, mySlot)
    if (selected.length === 0) {
      throw new Error('배정된 시험항목이 없습니다. 관리자에게 항목 배분을 요청하세요.')
    }
    selected.forEach((it, idx) => plannedItems.push({
      test_item_name: it.testItemName,
      sequence_order: it.sequenceOrder ?? idx,
      test_item_id: it.testItemId ?? null,
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
      test_item_id: it.testItemId ?? null,
    }))
  }
  // '전항목' 인데 품목 마스터에 없는 오더(수동 오더의 품목코드 N/A 등)인지 — 안내 문구를 가르는 데 쓴다
  let productInMaster = true
  if (!isParallel && order.method !== METHOD_PARTIAL) {
    const { data: prod } = await supabaseAdmin.from('products').select('id').eq('product_code', order.product_code).maybeSingle()
    productInMaster = !!prod?.id
    if (prod?.id) {
      const { data: pti } = await supabaseAdmin
        .from('product_test_items')
        .select('test_item_id, sequence_order, test_items!inner(name)')
        .eq('product_id', prod.id)
        .order('sequence_order', { ascending: true })
      ;(pti ?? []).forEach((r, idx) => plannedItems.push({
        test_item_name: (r as unknown as { test_items: { name: string } }).test_items.name,
        sequence_order: (r.sequence_order as number) ?? idx,
        test_item_id: (r.test_item_id as string | null) ?? null,
      }))
    }
    // 품목 기준 항목이 없으면(마스터에 없는 품목 · 마스터에 항목 0개) 관리자가 오더 수정 서랍에서
    // **이 오더에 직접 지정한 시험항목**(pct_order_test_items, 제외 안 된 것)으로 시작한다.
    // 품목 기준이 있는 오더는 예전과 똑같이 품목 기준을 쓴다 — 기존 오더의 동작은 바꾸지 않는다.
    if (plannedItems.length === 0) {
      const selected = await activeItemsForSlot(orderId, order.product_code, mySlot)
      selected.forEach((it, idx) => plannedItems.push({
        test_item_name: it.testItemName,
        sequence_order: it.sequenceOrder ?? idx,
        test_item_id: it.testItemId ?? null,
      }))
    }
  }

  // 항목이 하나도 없으면 **작업을 만들기 전에** 멈춘다.
  //
  // 예전에는 '전항목' 경로만 이 검사가 없어, 품목-시험항목 매핑이 비어 있으면 체크리스트가
  // 0개인 작업이 조용히 만들어졌다. 그 작업은 '진행중' 인데 클리어할 항목이 없어 시험자가
  // 영원히 끝낼 수 없고, 오더는 그 상태로 묶인다(실제로 2건 발생).
  // 병렬 배정·개별항목 경로는 이미 같은 이유로 막고 있었다 — 셋의 기준을 맞춘다.
  if (plannedItems.length === 0) {
    throw new Error(
      productInMaster
        ? `"${order.product_name}" 에 등록된 시험항목이 없습니다. ` +
          `품목 관리에서 시험항목을 지정하거나, 관리자가 오더 수정에서 이 오더의 시험항목을 지정한 뒤 시작해 주세요.`
        : `"${order.product_name}" 은(는) 품목 마스터에 없는 오더입니다. ` +
          `관리자가 오더 수정에서 시험항목을 지정한 뒤 시작해 주세요.`,
    )
  }

  // 이미 작업이 있는 오더인지 먼저 본다.
  // 병렬 배정에서는 오더당 작업이 최대 5건(담당자별)이라 order_id 만으로는 "이미
  // 시작됨"을 판단할 수 없다 — 담당자(테스터) 기준으로 좁혀서 봐야 다른 담당자의
  // 작업 때문에 시작을 거부당하지 않는다.
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

  // 병렬 배정: 체크리스트를 만든 **뒤** 스냅샷을 다시 읽어 맞춘다(리뷰 F2 M2 — 항목 담당자 변경과의 경합).
  // 계획을 읽은 뒤 작업 행을 넣기 전 사이에 reassign_job_item 이 커밋되면(그 함수의 오더 잠금이 이 insert 를
  // 커밋 뒤까지 붙잡아 두므로 겹치면 반드시) 낡은 계획이 적용돼 항목이 누락되거나 두 체크리스트에 중복된다.
  // 실패해도 작업 시작은 되돌리지 않는다(서버 로그만) — 다음 시작·관리자 점검에서 확인한다.
  if (isParallel) {
    try {
      await reconcileParallelChecklist(jobId, orderId, mySlot)
    } catch (err) {
      console.error('[qcJobs.startJob] 체크리스트 사후 조정 실패 — 작업은 시작됨:', jobId, err)
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

/**
 * 병렬 배정 작업의 체크리스트를 스냅샷(pct_order_test_items)에 맞춘다 — startJob 직후 사후 조정(리뷰 F2 M2).
 *
 *  · 스냅샷상 내 슬롯의 활성 항목인데 내 작업에 없다 → pending 행 추가.
 *    단, 같은 오더의 **다른 작업**에 그 이름이 있으면 추가하지 않고 경고만 남긴다(중복 시험 방지).
 *  · 내 작업에 있는데 스냅샷상 내 슬롯의 활성 항목이 아니다 → **실행 흔적 0·검토 흔적 0** 일 때만 조건부 삭제.
 *    흔적이 있으면 절대 지우지 않고 서버 로그로 경고한다(GMP — 실측 기록 보존).
 *
 * 멱등: 몇 번 불러도 같은 결과로 수렴한다. 트랜잭션이 아니므로 조정 도중 커밋되는 다른 담당자 변경까지는 잡지 못한다
 * (spec F2-5 의 남는 창). 삭제는 조건부라 그 사이 시작된 항목을 지우지 않는다.
 */
async function reconcileParallelChecklist(jobId: string, orderId: string, mySlot: number): Promise<void> {
  const [{ data: snap, error: sErr }, { data: jobs, error: jErr }] = await Promise.all([
    supabaseAdmin.from('pct_order_test_items')
      .select('test_item_id, test_item_name, sequence_order, is_excluded, assignee_slot')
      .eq('order_id', orderId),
    supabaseAdmin.from('qc_jobs').select('id').eq('order_id', orderId),
  ])
  if (sErr) throw sErr
  if (jErr) throw jErr
  const jobIds = (jobs ?? []).map(j => j.id as string)

  const { data: rows, error: iErr } = await supabaseAdmin
    .from('qc_job_items')
    .select('id, qc_job_id, test_item_name, status, started_at, cleared_at, elapsed_minutes, elapsed_total_minutes, review_status')
    .in('qc_job_id', jobIds.length ? jobIds : [jobId])
  if (iErr) throw iErr

  const mine = new Map<string, Record<string, unknown>>()
  for (const s of snap ?? []) {
    if (s.is_excluded === true || Number(s.assignee_slot) !== mySlot) continue
    mine.set(s.test_item_name as string, s)
  }
  const myRows = (rows ?? []).filter(r => r.qc_job_id === jobId)
  const otherNames = new Set((rows ?? []).filter(r => r.qc_job_id !== jobId).map(r => r.test_item_name as string))
  const myNames = new Set(myRows.map(r => r.test_item_name as string))

  // ① 빠진 항목 추가
  const toAdd: Record<string, unknown>[] = []
  for (const [name, s] of mine) {
    if (myNames.has(name)) continue
    if (otherNames.has(name)) {
      console.warn('[qcJobs.reconcile] 내 슬롯 항목이 다른 담당자 작업에 있어 추가하지 않았습니다(관리자 확인 필요):', { orderId, jobId, name })
      continue
    }
    toAdd.push({
      qc_job_id: jobId,
      test_item_id: (s.test_item_id as string | null) ?? null,
      test_item_name: name,
      sequence_order: (s.sequence_order as number) ?? 0,
    })
  }
  if (toAdd.length > 0) {
    const { error } = await supabaseAdmin.from('qc_job_items').insert(toAdd)
    if (error) throw error
    console.warn('[qcJobs.reconcile] 시작 중 넘겨받은 항목을 체크리스트에 추가했습니다:', { orderId, jobId, names: toAdd.map(r => r.test_item_name) })
  }

  // ② 내 슬롯이 아닌 항목 제거 — 흔적 0·검토 흔적 0 만, 조건부 delete
  for (const r of myRows) {
    const name = r.test_item_name as string
    if (mine.has(name)) continue
    const untouched = r.status === ITEM_PENDING
      && r.started_at == null && r.cleared_at == null
      && r.elapsed_minutes == null && r.elapsed_total_minutes == null
      && (r.review_status ?? ITEM_REVIEW_NONE) === ITEM_REVIEW_NONE
    if (!untouched) {
      console.warn('[qcJobs.reconcile] 스냅샷상 내 몫이 아닌데 기록이 있는 항목 — 지우지 않습니다(관리자 확인 필요):', { orderId, jobId, name })
      continue
    }
    const { error } = await supabaseAdmin
      .from('qc_job_items').delete()
      .eq('id', r.id as string).eq('qc_job_id', jobId)
      .eq('status', ITEM_PENDING).is('started_at', null).is('cleared_at', null)
      .is('elapsed_minutes', null).is('elapsed_total_minutes', null)
      .eq('review_status', ITEM_REVIEW_NONE)
    if (error) throw error
    console.warn('[qcJobs.reconcile] 시작 중 다른 담당자에게 넘어간 항목을 체크리스트에서 뺐습니다:', { orderId, jobId, name })
  }
}

/** cancelJobStart 결과 — orderStatusAfter 가 PENDING_STATUS 가 아니면 병렬 배정 동료의 작업이 남아 오더가 유지된 것이다 */
export type CancelJobStartResult = {
  qcNo: string
  orderId: string
  orderStatusBefore: string
  orderStatusAfter: string
  warning?: string
}

/**
 * 작업 시작 취소 — 잘못 누른 [작업 시작] 을 되돌린다.
 *
 * 되돌리기는 **qc_jobs 행 삭제(원복)** 다. 새 상태값을 두지 않는다 — 취소 대상은 "지금 실행 흔적이
 * 없는 작업" 뿐이라 보존할 실적이 없다. 상세 규칙: intent/2026-09-13-tester-cancel-job-start-spec.md
 *
 * 검사·감사 기록·삭제·오더 상태 결정은 전부 DB 함수 cancel_job_start(0047) 가 **한 트랜잭션**으로 한다.
 * 여러 번 나눈 Supabase 호출로는 "검사 뒤 들어온 항목 실적이 삭제와 함께 사라지는" 경합과
 * "감사 기록만 남거나 감사 기록만 사라지는" 부분 실패를 막을 수 없기 때문이다(GMP/ALCOA+).
 * 이 함수는 사유 검사 + 함수 호출 + 오류 번역 + 커밋 뒤 알림만 한다.
 *
 * ⚠️ 함수가 없을 때 비원자 경로로 폴백하지 않는다 — 폴백은 위 경합을 조용히 되살린다.
 */
export async function cancelJobStart(
  jobId: string, userSub: string, reason: unknown,
): Promise<CancelJobStartResult> {
  if (typeof reason !== 'string') throw new Error('시작 취소 사유를 입력해 주세요.')
  const note = reason.trim()
  if (note.length < 2) {
    throw new Error('시작 취소 사유를 2자 이상 입력해 주세요.')
  }

  // 사용자 id 는 로그인 토큰에서 온 값이다 — 함수는 이 값을 믿으므로 실행 권한은 service_role 뿐이다.
  const { data, error } = await rpcWithDeadlockRetry('cancel_job_start', {
    p_job_id: jobId, p_user_id: userSub, p_reason: note,
  })
  if (error) {
    // 함수가 던진 업무 거절(한국어 메시지)
    if (error.code === 'P0001') throw new Error(error.message)
    if (error.code === 'PGRST202' || error.code === '42883') {
      throw new Error('시작 취소 기능의 DB 설치(0047 마이그레이션)가 아직 적용되지 않았습니다. 관리자에게 문의하세요.')
    }
    throw error
  }

  const res = data as {
    qcNo: string; orderId: string; productName: string | null; batchNo: string | null
    orderStatusBefore: string; orderStatusAfter: string
  }

  // ── 여기부터는 취소가 커밋된 뒤다. 알림 실패는 취소를 되돌리지 않고 경고로 돌려준다 ──
  // 기존 "작업 시작" 알림은 지우지 않는다(두 건이 짝을 이뤄 정정 사건이 된다).
  // 작업 행은 이미 지워졌으므로 related_qc_job_id 는 비운다(FK).
  let warning: string | undefined
  try {
    await createNotification({
      type: 'status_changed',
      title: '작업 시작 취소',
      body: `${res.productName ?? ''} / ${res.batchNo ?? ''} — QC ${res.qcNo} 작업 시작이 취소되었습니다. (사유: ${note})`,
      relatedOrderId: res.orderId, relatedQcJobId: null, severity: 'warning',
    })
  } catch (err) {
    console.error('[qcJobs.cancelJobStart] 취소 알림 생성 실패 — 취소와 감사 기록은 반영됨:', jobId, err)
    warning = '작업 시작은 취소됐지만 관리자 알림 생성에 실패했습니다.'
  }

  return {
    qcNo: res.qcNo,
    orderId: res.orderId,
    orderStatusBefore: res.orderStatusBefore,
    orderStatusAfter: res.orderStatusAfter,
    ...(warning ? { warning } : {}),
  }
}

/** 시작/종료일 수정 */
export async function updateJobDates(jobId: string, userSub: string, dates: { workStartDate?: string | null; workEndDate?: string | null }): Promise<void> {
  await assertOwner(jobId, userSub)

  // [원칙2] 승인 단계(승인전·승인완료)에 들어간 작업의 수행일자는 담당자가 바꿀 수 없다.
  // 항목 단위 검토(0048) 뒤로 검토전·검토중 작업에도 시험이 이어질 수 있어 그 단계까지는 허용한다(결정 Q7).
  const { data: job } = await supabaseAdmin
    .from('qc_jobs').select('status, work_start_date, work_end_date').eq('id', jobId).maybeSingle()
  if (!job) throw new Error('작업을 찾을 수 없습니다.')
  if (!ITEM_EDITABLE_JOB_STATUSES.has(job.status as string)) {
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
 * 병렬 배정 이전에는 오더당 작업이 항상 1건이라 "작업 상태를 오더 상태에 그대로
 * 덮어쓴다"가 곧 정답이었다. 병렬 배정에서는 오더당 작업이 최대 5건(담당자별)이라
 * 한 사람 상태만 보고 덮어쓰면, 담당자 1이 먼저 끝내 '검토전'으로 넘어가도 다른 담당자는
 * 아직 '진행중'인데 오더가 검토 단계로 넘어가 버린다.
 *
 * 그래서 오더 상태는 **그 오더의 모든 작업 중 가장 뒤처진(진척도가 가장 낮은) 단계**로
 * 정한다 — JOB_STAGES 의 배열 순서를 진척도 기준으로 삼는다. '지연'은 단계가 아니라
 * 납기 경과 표시이므로, 하나라도 '지연'이면 오더도 '지연'로 본다(진척도 비교 대상에서 뺀다).
 *
 * 병렬 배정이 아닌 오더(작업 1건)에서는 그 작업의 상태가 곧 "가장 뒤처진 단계"이므로
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
  // 그대로 두면 담당자 1이 자기 몫을 끝낸 순간 오더가 '검토전'으로 넘어가는데, 다른 담당자는
  // 아직 시작도 못 했다(그리고 오더가 '대기'가 아니게 되어 시작 목록에서도 사라진다).
  // 그래서 시작하지 않은 담당자가 남아 있으면 오더는 '진행중'을 넘어설 수 없게 묶는다.
  const stillUnstarted = await hasUnstartedAssignee(orderId, jobs.map(j => j.assignee_tester_id as string | null))
  if (stillUnstarted) leastIdx = Math.min(leastIdx, JOB_STAGES.indexOf(IN_PROGRESS_STATUS))

  await supabaseAdmin.from('pct_orders').update({ status: JOB_STAGES[leastIdx] }).eq('id', orderId)
}

/**
 * 병렬 배정 오더에서 "배정은 됐는데 아직 작업을 시작하지 않은 담당자"가 한 명이라도 남아 있는가.
 *
 * 슬롯에 진행할 항목이 하나도 없는 담당자(관리자가 항목을 다른 담당자에게 몰아뒀거나, 작업 시작 뒤
 * 추가돼 아직 항목을 넘겨받지 않은 담당자)는 시작할 것이 없으므로 세지 않는다 —
 * 그러지 않으면 오더가 '진행중'에서 영원히 못 벗어난다.
 *
 * N+1 금지: 담당자 구성 1회 + 슬롯별 활성 항목 수 1회(countActiveBySlot)만 읽는다.
 * 1인 배정(행 1개 이하) 오더는 즉시 false. 0049 미적용이면 1인 배정처럼 false(오더 동기화를 막지 않는다).
 */
async function hasUnstartedAssignee(orderId: string, startedTesterIds: (string | null)[]): Promise<boolean> {
  const slots = (await loadAssigneesByOrder([orderId], { mirror: [] })).get(orderId) ?? []
  if (!isParallelAssignment(slots)) return false

  const started = new Set(startedTesterIds.filter((t): t is string => !!t))
  const unstarted = slots.filter(a => !started.has(a.testerId))
  if (unstarted.length === 0) return false

  const counts = (await countActiveBySlot([orderId])).get(orderId)
  for (const { slot } of unstarted) {
    // 스냅샷이 아직 없으면(맵에 없음) 품목 전 항목이 대표(슬롯 1) 몫이다 — 대표만 할 일이 있다고 본다.
    if (!counts) {
      if (slot === PRIMARY_ASSIGNEE_SLOT) return true
      continue
    }
    if ((counts.get(slot) ?? 0) > 0) return true      // 할 일이 남았는데 아직 시작 안 함
  }
  return false
}

// ─── 작업 단계 도출 (0048 — DB 함수가 단일 기준) ──────────────────────────────
/** recompute_job_stage 반환값 */
export interface StageRecomputeResult {
  jobId: string
  orderId: string
  qcNo: string
  from: string
  to: string
  /** 도출로 작업 단계가 실제로 바뀌었는가 — 커밋 뒤 오더 동기화·알림 여부 */
  changed: boolean
  /** 바뀐 경우 상태 이력(qc_job_status_history.note)에 적힌 문구 */
  note?: string
}

/**
 * 0048 DB 함수 호출 오류를 사용자에게 보일 Error 로 바꾼다.
 *  - P0001: 함수가 던진 업무 거절(한국어 메시지 그대로)
 *  - 함수 없음(PGRST202/42883): 설치 안내 (비원자 폴백은 하지 않는다)
 *  - 잘못된 uuid(22P02): "찾을 수 없습니다"
 *  - 그 밖(함수 본문의 컬럼 오류 등 실제 버그): 원인을 붙인 한국어 메시지 — 설치 안내로 가리지 않는다
 */
export function translateItemReviewRpcError(
  error: { code?: string; message?: string },
  notFoundMessage = '시험항목을 찾을 수 없습니다.',
): Error {
  if (error.code === 'P0001') return new Error(error.message ?? '요청을 처리할 수 없습니다.')
  if (error.code === 'PGRST202' || error.code === '42883') return new Error(ITEM_REVIEW_INSTALL_MESSAGE)
  if (error.code === '22P02') return new Error(notFoundMessage)
  return new Error(`시험항목 검토 처리 중 DB 오류가 발생했습니다. 관리자에게 문의하세요. (원인: ${error.message || error.code || '알 수 없음'})`)
}

/**
 * 작업 단계를 시험항목 상태로 다시 맞춘다 — DB 함수 recompute_job_stage(0048).
 *
 * 규칙(승인완료·지연은 건너뜀 → 전 항목 검토 완료 = 승인전 → 검토 흔적 1건 이상 = 검토중 →
 * 전 항목 완료 = 검토전 → 그 외 진행중)은 DB 에만 있다. 여기서 다시 계산하지 않는다(규칙 두 벌 금지).
 * 단계가 바뀌면 함수가 같은 트랜잭션에서 상태 이력(source auto)까지 남긴다.
 * 오더 상태·슬랙·앱 알림은 커밋 뒤 notifyStageRecomputed 가 한다.
 *
 * 재실행 안전: 호출마다 잠금 아래에서 현재 항목을 다시 읽어 수렴한다(F1-5).
 * F2(항목 담당자 변경)의 reassign_job_item 은 같은 함수를 DB 안에서 부른다.
 */
export async function recomputeJobStage(
  jobId: string, actorUserId: string | null, note: string,
): Promise<StageRecomputeResult> {
  const { data, error } = await rpcWithDeadlockRetry('recompute_job_stage', {
    p_job_id: jobId, p_actor: actorUserId, p_note: note,
  })
  if (error) throw translateItemReviewRpcError(error, '작업을 찾을 수 없습니다.')
  return data as StageRecomputeResult
}

/**
 * 항목 상태로 도출한 작업 단계(순수 조회) — DB 함수 derive_job_stage(0048).
 * 관리자 직접 변경의 일치 판정(F1-7)과 지연 해제 복귀(F1-3)에 쓴다. 없는 작업이면 null.
 */
export async function deriveJobStage(jobId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin.rpc('derive_job_stage', { p_job_id: jobId })
  if (error) throw translateItemReviewRpcError(error, '작업을 찾을 수 없습니다.')
  return (data as string | null) ?? null
}

/** 승인 거절 문구 — 전 항목 검토 완료 전 (리뷰 M2) */
const APPROVAL_NEEDS_REVIEW_MESSAGE = '모든 시험항목의 검토가 끝나야 승인할 수 있습니다.'

/**
 * 승인(승인전 → 승인완료) 전 확인 — 0048 이 적용된 환경이면 그 작업의 전 항목이 검토 완료여야 한다.
 * 도출 규칙상 "전 항목 reviewed" = derive_job_stage 가 '승인전'. 규칙을 TS 에 다시 쓰지 않고 그 값으로 판정한다.
 * 0048 미적용(함수 없음)이면 검토 기록 자체가 없으므로 기존처럼 허용한다.
 */
async function assertAllItemsReviewed(jobId: string): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc('derive_job_stage', { p_job_id: jobId })
  if (error) {
    if (error.code === 'PGRST202' || error.code === '42883') return
    throw translateItemReviewRpcError(error, '작업을 찾을 수 없습니다.')
  }
  if (data !== APPROVAL_READY_STATUS) throw new Error(APPROVAL_NEEDS_REVIEW_MESSAGE)
}

/**
 * 사람이 작업을 도출 단계로 옮긴(지연 해제·직접 변경) **커밋 뒤** 한 번 더 재도출해 수렴시킨다(리뷰 M3).
 * 도출값은 잠금 밖에서 구했으므로, 그 사이 항목 검토가 커밋됐으면 틀린 단계가 남는다 — 전 항목이
 * 검토 완료면 더 올 항목 이벤트가 없어 영구히 남을 수 있다. recompute 는 재실행 안전이다.
 * 실패해도 사람의 변경은 이미 커밋됐다 — 로그만 남기고 현재 단계를 돌려준다.
 */
async function settleDerivedStage(jobId: string, actor: string, fallback: string): Promise<string> {
  if (!DERIVED_JOB_STAGES.has(fallback)) return fallback
  try {
    const stage = await recomputeJobStage(jobId, actor, '상태 변경 직후 시험항목 상태에 따라 서버가 자동 전환했습니다.')
    await notifyStageRecomputed(stage)
    return stage.to
  } catch (err) {
    console.error('[qcJobs.settleDerivedStage] 재도출 실패 — 상태 변경은 반영됨:', jobId, err)
    return fallback
  }
}

/** 요청한 단계와 실제로 된 단계가 다를 때 화면에 보일 문구 */
function stageDiffMessage(requested: string, actual: string): string | undefined {
  return requested === actual
    ? undefined
    : `요청한 "${requested}" 대신 시험항목 상태에 따라 "${actual}" 단계가 되었습니다.`
}

/**
 * 도출로 작업 단계가 바뀐 **커밋 뒤** 후속 처리 — 오더 상태 동기화 → 슬랙 → 앱 알림(spec §7).
 * 단계가 바뀌지 않았으면 아무것도 하지 않는다(항목 검토마다 알리지 않는다).
 * 여기서의 실패는 검토·단계를 되돌리지 않는다 — 서버 로그만 남기고 삼킨다.
 */
export async function notifyStageRecomputed(stage: StageRecomputeResult | null): Promise<void> {
  if (!stage?.changed) return
  const note = stage.note ?? '시험항목 상태에 따라 서버가 자동 전환했습니다.'
  try {
    // 오더 상태는 현행 규칙(지연 우선 → 가장 덜 진행된 작업 단계 → 미시작 담당자 상한) 그대로(결정 Q2)
    await syncOrderStatusFromJobs(stage.orderId)
  } catch (err) {
    console.error('[qcJobs.notifyStageRecomputed] 오더 상태 동기화 실패 — 작업 단계는 반영됨:', stage, err)
  }

  // 슬랙 알림은 부가 기능이다 — 응답을 붙잡지 않도록 await 하지 않는다.
  void notifyStageChangeToSlack({
    jobId: stage.jobId, orderId: stage.orderId,
    fromStatus: stage.from, toStatus: stage.to, source: 'auto', note,
  }).catch(() => {})

  try {
    if (stage.to === REVIEW_READY_STATUS) {
      await createNotification({
        type: 'status_changed',
        title: '검토 대기',
        body: `모든 시험항목이 완료되어 작업 상태가 "${REVIEW_READY_STATUS}" 으로 자동 변경되었습니다.`,
        relatedOrderId: stage.orderId, relatedQcJobId: stage.jobId, severity: 'info',
      })
    } else {
      // 앞으로 가는 전이는 info, 뒤로 가는 전이(재실시·검토 취소)는 warning
      const forward = JOB_STAGES.indexOf(stage.to as JobStage) > JOB_STAGES.indexOf(stage.from as JobStage)
      await createNotification({
        type: 'status_changed',
        title: '작업 단계 자동 변경',
        body: `QC ${stage.qcNo} 작업이 "${stage.from}" → "${stage.to}" 단계로 자동 변경되었습니다. (${note})`,
        relatedOrderId: stage.orderId, relatedQcJobId: stage.jobId,
        severity: forward ? 'info' : 'warning',
      })
    }
  } catch (err) {
    console.error('[qcJobs.notifyStageRecomputed] 앱 알림 생성 실패 — 작업 단계는 반영됨:', stage, err)
  }
}

/**
 * 승인 — 승인전 ─[승인]─▶ 승인완료 (관리자 전용).
 *
 * 항목 단위 검토(0048) 뒤로 작업 단위 [검토 시작]·[검토 완료] 는 없다. 검토전·검토중·승인전은
 * 시험항목 검토에서 서버가 도출하고, 사람이 작업 단위로 넘기는 것은 승인 하나뿐이다.
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
  if (!isJobStage(current) || !canAdvanceByAdmin(current)) {
    throw new Error('승인은 "승인전" 단계의 작업에서만 할 수 있습니다. 검토는 시험항목별로 진행합니다.')
  }
  const target = NEXT_STAGE[current]
  if (!target) throw new Error(`"${current}" 단계에서는 넘길 다음 단계가 없습니다.`)
  if (target === CLOSED_STAGE) await assertAllItemsReviewed(jobId)

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

/** 항목을 만지기 전 공통 확인 — 소유권 + 작업 단계 + 항목 존재 + 검토 흔적.
 *
 *  [원칙2] 승인 단계(승인전·승인완료)로 넘어간 작업의 항목은 더 이상 손댈 수 없다.
 *  예전에는 상태를 보지 않아 '승인완료' 작업에도 cleared_at 을 쓰고 알림까지 보냈다.
 *  항목 단위 검토(0048) 뒤로는 검토전·검토중 작업의 **검토가 시작되지 않은** 항목은 계속 시험한다.
 *  검토 흔적이 있는 항목은 거절한다. 0048 미적용이면 검토 상태를 읽지 못해 **쓰기 전에** 안내로 거절한다.
 */
async function loadItemForEdit(jobId: string, itemId: string, userSub: string) {
  await assertOwner(jobId, userSub)

  const { data: job } = await supabaseAdmin
    .from('qc_jobs').select('work_started_at, created_at, order_id, status').eq('id', jobId).single()
  if (job && !ITEM_EDITABLE_JOB_STATUSES.has(job.status as string)) {
    throw new Error(`"${job.status}" 단계의 작업은 시험항목을 변경할 수 없습니다.`)
  }

  const { data: item, error: itemErr } = await supabaseAdmin
    .from('qc_job_items').select('id, test_item_name, status, started_at, review_status')
    .eq('id', itemId).eq('qc_job_id', jobId).maybeSingle()
  if (itemErr) {
    if (isSchemaMissingError(itemErr)) {
      throw describeSchemaError(itemErr, ITEM_REVIEW_FEATURE, ITEM_REVIEW_MIGRATION)
    }
    throw itemErr
  }
  // 그 작업에 없는 항목 = 옛 화면에서 조작했는데 그 사이 다른 담당자에게 넘어갔거나 작업이 바뀐 경우(L2 — 결정 문구로 통일)
  if (!item) throw new Error(ITEM_STATE_CHANGED_MESSAGE)
  if (hasReviewTrace(item.review_status as string)) {
    throw new Error('검토가 시작된 시험항목은 변경할 수 없습니다.')
  }

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
  // 화면은 완료 항목에 이 버튼을 보이지 않는다 — 옛 화면·다른 탭에서 이미 완료된 경우(L2)
  if (item.status === ITEM_CLEARED) throw new Error(ITEM_STATE_CHANGED_MESSAGE)
  // 이미 진행 중이면 시작 시각을 다시 쓰지 않는다 — 두 번 눌러 소요시간이 깎이면 안 된다.
  if (item.status === ITEM_IN_PROGRESS && item.started_at) {
    return { startedAt: item.started_at as string }
  }

  const now = new Date().toISOString()
  // 조건부 update(F2-6): 읽은 뒤 그 사이 항목이 다른 담당자에게 넘어갔거나(qc_job_id 불일치) 상태가 바뀌었으면 0행이다.
  const { data: updated, error } = await supabaseAdmin
    .from('qc_job_items')
    .update({ status: ITEM_IN_PROGRESS, started_at: now })
    .eq('id', itemId).eq('qc_job_id', jobId).eq('status', item.status as string)
    .select('id')
  // 23514 = 검토 흔적 CHECK(0048) — 확인 뒤 그 사이 항목이 완료·검토된 경합
  if (error?.code === '23514') throw new Error(ITEM_STATE_CHANGED_MESSAGE)
  if (error) throw error
  if (!updated || updated.length === 0) throw new Error(ITEM_STATE_CHANGED_MESSAGE)
  return { startedAt: now }
}

/** 시작 취소 — 잘못 누른 항목을 대기로 되돌린다. 시작 시각도 함께 지운다. */
export async function cancelItemStart(
  jobId: string, itemId: string, userSub: string,
): Promise<void> {
  const { item } = await loadItemForEdit(jobId, itemId, userSub)
  if (item.status === ITEM_CLEARED) {
    throw new Error(ITEM_STATE_CHANGED_MESSAGE)
  }
  // 조건부 update(F2-6) — 0행이면 그 사이 넘어갔거나 상태가 바뀐 것이다(거짓 성공 금지)
  const { data: updated, error } = await supabaseAdmin
    .from('qc_job_items')
    .update({ status: ITEM_PENDING, started_at: null })
    .eq('id', itemId).eq('qc_job_id', jobId).eq('status', item.status as string)
    .select('id')
  // 23514 = 검토 흔적 CHECK(0048) — 확인 뒤 그 사이 항목이 완료·검토된 경합
  if (error?.code === '23514') throw new Error(ITEM_STATE_CHANGED_MESSAGE)
  if (error) throw error
  if (!updated || updated.length === 0) throw new Error(ITEM_STATE_CHANGED_MESSAGE)
}

/** 항목 클리어 — 시간 적재 + 감독관 알림 + 작업 단계 재도출(recompute_job_stage)
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
): Promise<{ allCleared: boolean; statusChangedTo: string | null; stageSyncFailed?: boolean }> {
  const { job, item } = await loadItemForEdit(jobId, itemId, userSub)
  // 화면은 완료 항목에 이 버튼을 보이지 않는다 — 옛 화면·다른 탭에서 이미 완료된 경우(L2)
  if (item.status === ITEM_CLEARED) throw new Error(ITEM_STATE_CHANGED_MESSAGE)
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

  const { data: updated, error } = await supabaseAdmin
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
    // 조건부 update(F2-6) — 읽은 뒤 넘어갔거나 상태가 바뀐 항목에 완료 기록을 쓰지 않고, 0행이면 실패로 응답한다
    .eq('id', itemId).eq('qc_job_id', jobId).eq('status', item.status as string)
    .select('id')
  if (error?.code === '23514') throw new Error(ITEM_STATE_CHANGED_MESSAGE)
  if (error) throw error
  if (!updated || updated.length === 0) throw new Error(ITEM_STATE_CHANGED_MESSAGE)

  // ── 여기부터는 항목 완료가 커밋된 뒤다. 이 뒤의 어떤 실패도 실패 응답으로 바꾸지 않는다(리뷰 F2 M1) ──
  // 순서: 단계 재도출 → 단계 전환 알림 → 항목 완료 알림(마지막). 알림 insert 는 FK 검사로 pct_orders → qc_jobs 를
  // 공유 잠금해 reassign_job_item·cancel_job_start 와 교착할 수 있다 — 알림이 중단돼도 재도출은 이미 끝나 있어야 한다.

  // 작업 단계 재도출 — 항목 완료는 기존 TS 경로를 유지하고 커밋 뒤 DB 함수를 부른다(F1-5).
  // 실패해도 항목 완료는 이미 커밋됐다. 함수는 재실행 안전이라 다음 항목 이벤트 때 단계가 맞춰진다.
  const note = `시험항목 "${item.test_item_name as string}" 완료로 서버가 자동 전환했습니다.`
  let stage: StageRecomputeResult | null = null
  let stageSyncFailed = false
  try {
    stage = await recomputeJobStage(jobId, userSub, note)
  } catch (err) {
    stageSyncFailed = true
    console.error('[qcJobs.clearItem] 작업 단계 재도출 실패 — 항목 완료는 반영됨:', jobId, err)
  }
  await notifyStageRecomputed(stage)

  try {
    await createNotification({
      type: 'item_cleared',
      title: '시험항목 완료',
      body: `시험항목 "${item.test_item_name}" 완료 (작업 시작 후 ${elapsedTotal}분, 항목 소요 ${elapsed}분)`,
      relatedOrderId: (job?.order_id as string) ?? null,
      relatedQcJobId: jobId, severity: 'info',
    })
  } catch (err) {
    console.error('[qcJobs.clearItem] 항목 완료 알림 생성 실패 — 항목 완료·단계 재도출은 반영됨:', jobId, err)
  }

  const { count: remaining, error: cntErr } = await supabaseAdmin
    .from('qc_job_items')
    .select('id', { count: 'exact', head: true })
    .eq('qc_job_id', jobId)
    .neq('status', ITEM_CLEARED)
  const allCleared = !cntErr && remaining === 0

  // statusChangedTo = 이번 항목 완료로 **도출된 작업 단계가 바뀐 경우** 그 단계(바뀌지 않았으면 null)
  // stageSyncFailed = 항목 완료는 반영됐지만 작업 단계를 맞추지 못함(다음 항목 이벤트·관리자 검토 때 수렴)
  return { allCleared, statusChangedTo: stage?.changed ? stage.to : null, ...(stageSyncFailed ? { stageSyncFailed } : {}) }
}

/** 작업 상태 변경(담당자) — 진행중 ↔ 지연만. 오더 상태 동기화 + 감독관 알림.
 *
 *  출발·목표 집합은 TESTER_STATUS_CHANGE_STATUSES(@shared/qc-status)다. 항목 조작 집합
 *  (ITEM_EDITABLE_JOB_STATUSES)과 섞으면 시험자가 검토중 작업을 진행중으로 되돌릴 수 있게 된다.
 *
 *  지연 해제(F1-3): 지연에서 벗어날 때는 요청값 대신 **항목 상태로 도출한 단계**로 되돌린다
 *  (검토가 이미 시작된 작업이면 진행중이 아니라 검토중·승인전으로 돌아간다).
 */
export async function changeJobStatus(
  jobId: string, userSub: string, status: string,
): Promise<{ from: string; to: string; message?: string }> {
  await assertOwner(jobId, userSub)
  if (!TESTER_STATUS_CHANGE_STATUSES.has(status)) {
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
  if (!TESTER_STATUS_CHANGE_STATUSES.has(current)) {
    throw new Error(
      `"${current}" 단계의 작업은 담당자가 상태를 바꿀 수 없습니다. 관리자에게 문의하세요.`,
    )
  }
  if (current === status) return { from: current, to: status }   // 변경 없음

  // F1-3 — 지연 해제는 도출 단계로 복귀
  let target = status
  let note = '담당자 상태 변경'
  if (current === DELAYED_STATUS) {
    const derived = await deriveJobStage(jobId)
    if (!derived) throw new Error('작업을 찾을 수 없습니다.')
    target = derived
    if (derived !== status) note = `담당자 상태 변경 — 항목 상태에 따라 '${derived}' 로 복귀`
  }

  const patch: Record<string, unknown> = { status: target }
  const { data: job, error } = await supabaseAdmin
    .from('qc_jobs').update(patch).eq('id', jobId)
    .eq('status', current)          // 낙관적 잠금 — 그 사이 바뀌었으면 실패
    .select('order_id').maybeSingle()
  if (error) throw error
  if (!job) throw new Error('작업 상태가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.')
  await syncOrderStatusFromJobs(job.order_id as string)
  await logJobStatusChange({
    jobId, orderId: job.order_id as string,
    fromStatus: current, toStatus: target,
    changedBy: userSub, source: 'manual', note,
  })

  // 슬랙 알림은 부가 기능이다 — 응답을 붙잡지 않도록 await 하지 않는다.
  // 이 뒤의 return 값이 곧 HTTP 응답이라, await 하면 전이 API 가 슬랙 왕복만큼 느려진다.
  void notifyStageChangeToSlack({
    jobId, orderId: job.order_id as string,
    fromStatus: current, toStatus: target, source: 'manual',
    ...(target !== status ? { note } : {}),
  }).catch(() => {})

  await createNotification({
    type: 'status_changed',
    title: '상태 변경',
    body: `작업 상태가 "${target}" 로 변경되었습니다.`,
    relatedOrderId: job.order_id as string, relatedQcJobId: jobId, severity: 'info',
  })

  // 리뷰 M3 — 잠금 밖 도출값의 경합을 수렴시킨다
  const finalStage = await settleDerivedStage(jobId, userSub, target)
  const message = stageDiffMessage(status, finalStage)
  return { from: current, to: finalStage, ...(message ? { message } : {}) }
}

/**
 * 관리자 상태 직접 변경 — 정해진 순서(advanceJobStage) 밖으로 상태를 옮긴다.
 *
 * 지연 지정/해제, 승인 되돌리기처럼 순차 전이로는 표현할 수 없는 정정이 실제로 필요하다.
 * 다만 임의 변경은 시험 기록의 신뢰도를 떨어뜨리므로
 *  ① 관리자만(라우트에서 requireAdmin), ② **사유 필수**, ③ 상태 이력에 사유까지 남긴다.
 *
 * 항목 단위 검토(0048) 뒤의 허용 규칙 — spec §3.4
 *  - 승인완료로는 **승인전에서만**, 승인완료에서는 **승인전으로만**(F1-6)
 *  - 지연에서 벗어나면 요청값 대신 항목 상태로 도출한 단계로 복귀(F1-3)
 *  - 그 밖에 도출 단계(진행중·검토전·검토중·승인전)로 옮기려면 **도출값과 같아야** 한다(F1-7).
 *    판정은 DB 함수 derive_job_stage 로 하고, 판정~쓰기 사이 경합은 조건부 update 로 막는다.
 *  - 도출 단계 → 지연, 승인전 ↔ 승인완료 는 자유
 *
 * work_end_date 는 종결 여부를 따라간다 — 승인완료로 가면 오늘로 기록하고,
 * 승인완료에서 되돌리면 지운다(완료일이 남아 있으면 완료 집계·공수 통계가 어긋난다).
 */
export async function setJobStatusByAdmin(
  jobId: string, adminUserSub: string, status: string, reason: string,
): Promise<{ from: string; to: string; message?: string }> {
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

  // F1-6 — 승인완료는 승인전과만 오간다
  if ((status === CLOSED_STAGE && current !== APPROVAL_READY_STATUS)
    || (current === CLOSED_STAGE && status !== APPROVAL_READY_STATUS)) {
    throw new Error('승인완료는 승인전 단계에서만 변경할 수 있습니다.')
  }
  // 리뷰 M2 — 승인은 전 항목 검토 완료 뒤에만(0048 적용 환경)
  if (status === CLOSED_STAGE) await assertAllItemsReviewed(jobId)

  let target = status
  let restoreNote = ''
  if (current === DELAYED_STATUS) {
    // F1-3 — 지연 해제는 요청값 대신 도출 단계로 복귀
    const derived = await deriveJobStage(jobId)
    if (!derived) throw new Error('작업을 찾을 수 없습니다.')
    target = derived
    if (derived !== status) restoreNote = ` (항목 상태에 따라 '${derived}' 로 복귀)`
  } else if (DERIVED_JOB_STAGES.has(status) && current !== CLOSED_STAGE) {
    // F1-7 — 도출 단계로의 직접 변경은 항목 상태와 일치할 때만 (승인완료 → 승인전 되돌림은 자유)
    const derived = await deriveJobStage(jobId)
    if (derived !== status) {
      throw new Error('항목 상태와 맞지 않습니다 — 항목 재실시/검토 취소로 조정하세요.')
    }
  }
  if (target === current) return { from: current, to: target }

  const patch: Record<string, unknown> = { status: target }
  if (target === CLOSED_STAGE) {
    if (!before.work_end_date) patch.work_end_date = kstToday()
  } else if (current === CLOSED_STAGE) {
    patch.work_end_date = null
  }

  const { data: updated, error } = await supabaseAdmin
    .from('qc_jobs').update(patch).eq('id', jobId)
    .eq('status', current)          // 조건부 update — 판정 뒤 그 사이 바뀌었으면 0행(F1-7)
    .select('order_id').maybeSingle()
  if (error) throw error
  if (!updated) throw new Error('작업 상태가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.')

  await syncOrderStatusFromJobs(updated.order_id as string)
  await logJobStatusChange({
    jobId, orderId: updated.order_id as string,
    fromStatus: current, toStatus: target,
    changedBy: adminUserSub, source: 'manual', note: `관리자 직접 변경 — ${note}${restoreNote}`,
  })

  // 슬랙 알림은 부가 기능이다 — 응답을 붙잡지 않도록 await 하지 않는다.
  // 이 뒤의 return 값이 곧 HTTP 응답이라, await 하면 전이 API 가 슬랙 왕복만큼 느려진다.
  void notifyStageChangeToSlack({
    jobId, orderId: updated.order_id as string,
    fromStatus: current, toStatus: target, source: 'manual', note: `${note}${restoreNote}`,
  }).catch(() => {})

  await createNotification({
    type: 'status_changed',
    title: '관리자 상태 변경',
    body: `QC ${before.qc_no} 작업 상태가 "${current}" → "${target}" 로 변경되었습니다. (사유: ${note})${restoreNote}`,
    relatedOrderId: updated.order_id as string,
    relatedQcJobId: jobId,
    severity: 'warning',
  })

  // 리뷰 M3 — 도출 단계로 옮긴 경우 잠금 아래에서 한 번 더 수렴
  const finalStage = await settleDerivedStage(jobId, adminUserSub, target)
  const message = stageDiffMessage(status, finalStage)
  return { from: current, to: finalStage, ...(message ? { message } : {}) }
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
  /** 읽은 뒤 그 사이 상태가 바뀌었거나 다른 담당자에게 넘어가 건너뛴 (작업, 항목) 수 — 리뷰 F2 M3 */
  skipped: number
  /** 건드린 작업 수 */
  jobs: number
  /** 이번 항목 완료로 **도출된 작업 단계가 바뀐** 작업의 QC번호(대개 전 항목 완료 → '검토전') */
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
  // 승인 단계로 넘어간 작업은 항목을 더 이상 건드리지 않는다(loadItemForEdit 과 같은 규칙).
  return (jobs ?? [])
    .filter(j => ITEM_EDITABLE_JOB_STATUSES.has(j.status as string))
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
  let skipped = 0
  const touchedJobs = new Set<string>()
  for (const r of targets) {
    const jobId = r.qc_job_id as string
    // 개별 경로(startItem/clearItem/cancelItemStart)를 그대로 재사용한다.
    // 소요시간 적재·알림·전체완료 전환 규칙을 여기서 다시 쓰면 언젠가 갈라진다.
    // 개별 경로는 조건부 update 가 0행이면(그 사이 상태가 바뀌었거나 넘어감) ITEM_STATE_CHANGED_MESSAGE 로 던진다(F2-6).
    // 그룹 조작에서는 그 배치만 **건너뛰고 계속** 처리한다 — 앞 배치만 기록되고 뒤 배치가 멈추면 다시 누를 때
    // 배치마다 완료 시각이 달라진다(리뷰 F2 M3). 권한·DB 오류 등 진짜 오류는 그대로 실패한다.
    try {
      if (action === 'start') await startItem(jobId, r.id as string, userSub)
      else if (action === 'cancel') await cancelItemStart(jobId, r.id as string, userSub)
      else {
        const res = await clearItem(jobId, r.id as string, userSub)
        if (res.statusChangedTo) advanced.push(jobs.find(j => j.id === jobId)?.qcNo ?? '')
      }
    } catch (err) {
      if (err instanceof Error && err.message === ITEM_STATE_CHANGED_MESSAGE) { skipped++; continue }
      throw err
    }
    affected++
    touchedJobs.add(jobId)
  }
  return { affected, skipped, jobs: touchedJobs.size, advanced: advanced.filter(Boolean) }
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
