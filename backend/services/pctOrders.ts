/**
 * [BACKEND] PCT 오더 조회 / 수정(사유 필수) / 수정이력
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { DELETED_STATUS, PENDING_STATUS, ORDER_STATUSES } from '@shared/qc-status'
import { assertTesterAssignable } from '@backend/services/testers'
import { logReassignment } from '@backend/services/reassignmentHistory'
import { warnIfAssigneeOnLeave } from '@backend/services/leaveConflicts'
import { assignedToTesterFilter } from '@backend/lib/assigneeFilter'
import {
  METHOD_ALL, METHOD_PARTIAL, normalizeForMethod, replaceForOrder, resetAssigneeSlots,
  type OrderTestItemInput,
} from '@backend/services/pctOrderTestItems'

export interface PctOrderRow {
  id: string
  productCode: string
  productName: string
  batchNo: string
  dosageForm: string | null
  /** 구분(제조팀 시트 원본). 일반/PV1/CV/MV/… · 0039 미적용 환경에서는 null */
  validationType: string | null
  packagingDate: string | null
  dueDate: string | null
  /** 관리자가 정한 착수 예정일(0042). null = 미지정(포장일·납기로 추정) */
  plannedStartDate: string | null
  isUrgent: boolean
  method: string
  status: string
  assigneeTesterId: string | null
  assigneeName: string | null
  /** 2인 배정(0037) — 켜져 있으면 시험항목을 담당자1/2 로 나눠 배분한다 */
  isDualAssignment: boolean
  assigneeTesterId2: string | null
  assigneeName2: string | null
  productSynced: boolean
  note: string | null
  ingestState: string
  source: 'manual' | 'auto'
  testItemCount: number | null
  workdays: number | null   // 품목코드 기준 공수(일, DAY) — product_workload.avg_workdays
  hasJob: boolean           // QC 작업 시작 여부
  locked: boolean           // 관리자 확정/LOCK (원칙1·3). 컬럼 미적용 환경에서는 false
  createdAt: string
  updatedAt: string
}

// 수정 가능 필드. 자동 적재 오더는 품목코드·품목명·제조번호를 서버에서 보호한다.
const EDITABLE_FIELDS = [
  'productCode', 'productName', 'batchNo', 'dosageForm', 'validationType',
  'packagingDate', 'dueDate', 'plannedStartDate', 'isUrgent', 'method', 'status', 'note', 'assigneeTesterId',
  'isDualAssignment', 'assigneeTesterId2',
] as const
type EditableField = (typeof EDITABLE_FIELDS)[number]
// 구분도 제조팀 시트가 원본이다 — 자동 적재 오더에서는 고정하고,
// 수동 생성 오더에서만 관리자가 지정한다(품목코드·품목명·제조번호와 같은 취급).
const AUTO_IMMUTABLE_FIELDS = ['productCode', 'productName', 'batchNo', 'validationType'] as const

/**
 * [원칙3] 확정(LOCK) 시 변경을 막는 필드.
 *
 * 2026-08-23 수정: 예전에는 assigneeTesterId 하나만 막고 있었다. 그런데
 * packagingDate/dueDate 는 엔진의 스케줄 윈도우 입력(computeWindow)이고
 * method/isUrgent 는 배정 방식 자체를 바꾸므로, 이것들이 열려 있으면
 * "확정된 일정"이 확정되지 않은 것과 같다.
 * note 는 메모라서 LOCK 후에도 남겨둔다.
 * 2인 배정(isDualAssignment/assigneeTesterId2)도 담당자 배정의 일부라 같이 잠근다.
 */
const LOCKED_IMMUTABLE_FIELDS = [
  // plannedStartDate 도 엔진·달력이 읽는 일정 입력이다 — 열어 두면 확정이 확정이 아니다.
  'assigneeTesterId', 'packagingDate', 'dueDate', 'plannedStartDate', 'isUrgent', 'method',
  'isDualAssignment', 'assigneeTesterId2',
] as const

/**
 * [원칙2] QC 작업이 시작된 뒤에는 변경을 막는 필드.
 * "시험 시작(IN_PROGRESS)/완료 후 일정 변경 금지". status 는 작업 진행에 따라
 * 서버가 동기화하므로(qcJobs.advanceJobStage) 여기서 제외한다.
 *
 * assigneeTesterId/assigneeTesterId2 는 여기 없다 — 2인 배정에서는 "오더에 작업이
 * 하나라도 있으면 담당자 변경 금지" 가 아니라 "그 담당자 본인이 이미 시작했으면
 * 그 슬롯만 변경 금지" 가 맞는 규칙이라 별도로(슬롯 단위) 검사한다. 1인 배정 오더는
 * 작업이 있으면 항상 그 작업의 담당자가 곧 assigneeTesterId 이므로 결과는 동일하다.
 *
 * isDualAssignment 는 반대로 여기 **있어야** 한다.
 *  · 끄면 slot=2 항목이 전부 slot=1 로 돌아오는데(resetAssigneeSlots), 담당자1의
 *    체크리스트는 이미 시작 시점에 굳어 그 항목들이 없다 → 아무도 시험하지 않게 된다.
 *  · 켜도 담당자1의 체크리스트에 이미 전 항목이 들어가 있고, 작업이 시작된 뒤에는
 *    슬롯 이동 자체가 막히므로(setAssigneeSlot) 담당자2는 맡을 항목이 0개가 된다.
 * 어느 쪽도 성립하지 않으므로 작업 시작 후에는 2인 배정 전환을 통째로 막는다.
 */
const STARTED_IMMUTABLE_FIELDS = [
  // plannedStartDate 는 **여기 넣지 않는다.** 넣었다가 되돌린 이유를 남긴다:
  // 배정 다이얼로그는 담당자와 착수 예정일을 한 패치로 보낸다. 이 목록에 넣으면 작업이
  // 하나라도 시작된 오더에서 그 패치가 통째로 거부돼, 예전에는 성공하던 배정까지 실패한다
  // (2인 배정에서 담당자1이 이미 시작한 오더에 담당자2를 붙이는 경우 등).
  // 시작 후에는 실제 착수일(qc_jobs.work_start_date)이 달력에서 계획을 이기므로 이 값은
  // 어차피 무시된다 — 무시되는 값을 쓰게 두는 쪽이, 되는 배정을 막는 쪽보다 낫다.
  'packagingDate', 'dueDate', 'isUrgent', 'method',
  'productCode', 'productName', 'batchNo', 'isDualAssignment',
] as const

/** 오류 메시지용 한국어 필드명 */
const FIELD_LABEL: Record<EditableField, string> = {
  productCode: '품목코드',
  productName: '품목명',
  batchNo: '제조번호',
  dosageForm: '제형',
  validationType: '구분',
  packagingDate: '포장일',
  dueDate: '완료예정일',
  plannedStartDate: '착수 예정일',
  isUrgent: '긴급여부',
  method: '진행방법',
  status: '상태',
  note: '비고',
  assigneeTesterId: '담당자',
  isDualAssignment: '2인 배정',
  assigneeTesterId2: '담당자2',
}
function fieldLabel(f: EditableField): string {
  return FIELD_LABEL[f] ?? f
}

const FIELD_TO_COL: Record<EditableField, string> = {
  productCode: 'product_code',
  productName: 'product_name',
  batchNo: 'batch_no',
  dosageForm: 'dosage_form',
  validationType: 'validation_type',
  packagingDate: 'packaging_date',
  dueDate: 'due_date',
  plannedStartDate: 'planned_start_date',
  isUrgent: 'is_urgent',
  method: 'method',
  status: 'status',
  note: 'note',
  assigneeTesterId: 'assignee_tester_id',
  isDualAssignment: 'is_dual_assignment',
  assigneeTesterId2: 'assignee_tester_id_2',
}

export async function listOrders(filters: {
  status?: string
  assigneeTesterId?: string
  includeDeleted?: boolean
} = {}): Promise<PctOrderRow[]> {
  let query = supabaseAdmin
    .from('pct_orders')
    .select('*')
    .order('packaging_date', { ascending: true, nullsFirst: false })

  if (!filters.includeDeleted) query = query.neq('status', DELETED_STATUS)
  if (filters.status) query = query.eq('status', filters.status)
  // 담당자1만 보면 2인 배정 오더의 담당자2에게는 자기 오더가 아예 안 잡힌다
  // (휴가 등록 시 겹침 경고가 담당자2에서만 침묵하던 원인). 필터 문자열은
  // assignedToTesterFilter 한 곳에서만 만든다 — 손으로 적으면 또 어긋난다.
  if (filters.assigneeTesterId) {
    const id = filters.assigneeTesterId
    // 이 값은 쿼리스트링(app/api/pct-orders/route.ts)에서 온다. PostgREST 필터 문자열에
    // 그대로 보간되는 자리라 UUID 형식을 강제한다(notifications.ts 의 scopeToViewer 와 동일한 가드).
    if (!/^[0-9a-fA-F-]{36}$/.test(id)) throw new Error('잘못된 담당자 식별자입니다.')
    query = query.or(assignedToTesterFilter(id))
  }

  // Supabase 기본 1000행 상한 회피. pct_orders 는 소프트 삭제만 하므로 단조 증가한다.
  const { data, error } = await query.range(0, 9999)
  if (error) throw error
  const orders = (data ?? []) as Record<string, unknown>[]
  if (orders.length === 0) return []

  // 담당자 이름 (2인 배정의 담당자2 포함 — 같은 맵을 공유해도 무방하다)
  const testerIds = [...new Set(
    orders.flatMap(o => [o.assignee_tester_id, o.assignee_tester_id_2]).filter(Boolean) as string[],
  )]
  const nameByTester = new Map<string, string>()
  if (testerIds.length > 0) {
    const { data: testers } = await supabaseAdmin.from('testers').select('id, name').in('id', testerIds)
    for (const t of testers ?? []) nameByTester.set(t.id as string, t.name as string)
  }

  // 공수: product_code → product_workload.avg_workdays(일, 단일 소스)
  const codes = [...new Set(orders.map(o => o.product_code as string))]
  const workdaysByCode = new Map<string, number>()
  const jobOrderIds = new Set<string>()
  const testItemCountByOrder = new Map<string, number>()
  const baselineItemCountByCode = new Map<string, number>()
  {
    const { data: wl } = await supabaseAdmin
      .from('product_workload')
      .select('product_code, avg_workdays')
      .in('product_code', codes)
    for (const w of wl ?? []) {
      const d = Number(w.avg_workdays) || 0
      if (d > 0) workdaysByCode.set(w.product_code as string, d)
    }
  }
  {
    const [{ data: products }, { data: orderItems }] = await Promise.all([
      supabaseAdmin.from('products').select('id, product_code').in('product_code', codes),
      supabaseAdmin.from('pct_order_test_items').select('order_id, is_excluded').in('order_id', orders.map(o => o.id as string)),
    ])
    const codeByProductId = new Map((products ?? []).map(p => [p.id as string, p.product_code as string]))
    const productIds = [...codeByProductId.keys()]
    if (productIds.length > 0) {
      const { data: productItems } = await supabaseAdmin
        .from('product_test_items')
        .select('product_id')
        .in('product_id', productIds)
      for (const item of productItems ?? []) {
        const code = codeByProductId.get(item.product_id as string)
        if (code) baselineItemCountByCode.set(code, (baselineItemCountByCode.get(code) ?? 0) + 1)
      }
    }
    const hasOrderItems = new Set<string>()
    for (const item of orderItems ?? []) {
      const orderId = item.order_id as string
      hasOrderItems.add(orderId)
      if (!item.is_excluded) testItemCountByOrder.set(orderId, (testItemCountByOrder.get(orderId) ?? 0) + 1)
    }
    for (const orderId of hasOrderItems) {
      if (!testItemCountByOrder.has(orderId)) testItemCountByOrder.set(orderId, 0)
    }
  }
  // QC 작업 시작 여부
  {
    const { data: jobs } = await supabaseAdmin.from('qc_jobs').select('order_id').in('order_id', orders.map(o => o.id as string))
    for (const j of jobs ?? []) jobOrderIds.add(j.order_id as string)
  }

  return orders.map(o => ({
    id: o.id as string,
    productCode: o.product_code as string,
    productName: o.product_name as string,
    batchNo: o.batch_no as string,
    dosageForm: (o.dosage_form as string) ?? null,
    validationType: (o.validation_type as string) ?? null,
    packagingDate: (o.packaging_date as string) ?? null,
    dueDate: (o.due_date as string) ?? null,
    // 0042 미적용 DB 에서는 키 자체가 없다 — select('*') 라 조회는 깨지지 않고 null 이 된다.
    plannedStartDate: (o.planned_start_date as string) ?? null,
    isUrgent: !!o.is_urgent,
    method: o.method as string,
    status: o.status as string,
    assigneeTesterId: (o.assignee_tester_id as string) ?? null,
    assigneeName: o.assignee_tester_id ? (nameByTester.get(o.assignee_tester_id as string) ?? null) : null,
    isDualAssignment: !!o.is_dual_assignment,
    assigneeTesterId2: (o.assignee_tester_id_2 as string) ?? null,
    assigneeName2: o.assignee_tester_id_2 ? (nameByTester.get(o.assignee_tester_id_2 as string) ?? null) : null,
    productSynced: !!o.product_synced,
    note: (o.note as string) ?? null,
    ingestState: o.ingest_state as string,
    source: o.ingest_state === 'manual' ? 'manual' : 'auto',
    testItemCount: testItemCountByOrder.get(o.id as string) ?? baselineItemCountByCode.get(o.product_code as string) ?? null,
    workdays: workdaysByCode.get(o.product_code as string) ?? null,
    hasJob: jobOrderIds.has(o.id as string),
    locked: !!o.locked,   // select('*') 결과. 컬럼 미적용 시 undefined → false
    createdAt: o.created_at as string,
    updatedAt: o.updated_at as string,
  }))
}

/**
 * 수동 오더 생성 (오더배정 화면에서 직접 등록).
 * 제조팀 시트 적재가 아닌 사용자 입력 오더 — product_synced=false, ingest_state='manual'.
 * 자연키(batch_no, product_code) 중복 시 명확한 에러를 던진다.
 */
export async function createOrder(input: {
  productCode: string
  productName: string
  batchNo: string
  dosageForm?: string | null
  validationType?: string | null
  packagingDate?: string | null
  dueDate?: string | null
  plannedStartDate?: string | null
  isUrgent?: boolean
  method?: string
  status?: string
  assigneeTesterId?: string | null
  note?: string | null
  /** 진행방법이 '개별항목'일 때 배정할 시험항목. '전항목'이면 무시된다. */
  testItems?: OrderTestItemInput[]
}): Promise<PctOrderRow> {
  const code = (input.productCode ?? '').trim()
  const name = (input.productName ?? '').trim()
  const batch = (input.batchNo ?? '').trim()
  if (!code || !name || !batch) throw new Error('품목코드·품목명·제조번호는 필수입니다.')
  // 비활성 시험자는 담당자로 지정할 수 없다
  await assertTesterAssignable(input.assigneeTesterId)
  // 오더를 만들기 전에 검증한다 — 만든 뒤 실패하면 항목 없는 개별항목 오더가 남는다
  const method = input.method || '전항목'
  const selectedItems = normalizeForMethod(method, input.testItems)

  const { data, error } = await supabaseAdmin
    .from('pct_orders')
    .insert({
      product_code:       code,
      product_name:       name,
      batch_no:           batch,
      dosage_form:        input.dosageForm?.trim() || null,
      // 0039 미적용 환경에서 undefined 를 넣으면 supabase-js 가 키를 빼주므로 안전하다.
      // 값이 없으면 아예 보내지 않아 컬럼이 없어도 수동 오더 생성이 실패하지 않는다.
      ...(input.validationType?.trim() ? { validation_type: input.validationType.trim().toUpperCase() } : {}),
      packaging_date:     input.packagingDate || null,
      due_date:           input.dueDate || null,
      ...(input.plannedStartDate ? { planned_start_date: input.plannedStartDate } : {}),
      is_urgent:          input.isUrgent ?? false,
      method:             method,
      status:             input.status || PENDING_STATUS,
      assignee_tester_id: input.assigneeTesterId || null,
      note:               input.note?.trim() || null,
      product_synced:     false,       // 수동 등록 — 품목마스터 자동동기화 대상 아님
      ingest_state:       'manual',    // 적재가 아닌 수동 생성 표시
    })
    .select('*')
    .single()
  if (error) {
    if ((error as { code?: string }).code === '23505') {
      throw new Error('이미 동일한 제조번호·품목코드의 오더가 있습니다.')
    }
    throw error
  }

  const o = data as Record<string, unknown>

  // 개별항목 오더의 선택 목록 저장. 실패하면 항목 없는 오더가 남으므로 오더를 되돌린다.
  if (method === METHOD_PARTIAL) {
    try {
      await replaceForOrder(o.id as string, selectedItems)
    } catch (e) {
      await supabaseAdmin.from('pct_orders').delete().eq('id', o.id as string)
      throw e
    }
  }

  // 신규 오더에 담당자를 바로 지정한 경우도 휴가 충돌을 알린다(차단하지 않음).
  await warnIfAssigneeOnLeave({
    orderId:     o.id as string,
    testerId:    (o.assignee_tester_id as string) ?? null,
    order: {
      packagingDate: (o.packaging_date as string) ?? null,
      dueDate:       (o.due_date as string) ?? null,
      plannedStartDate: (o.planned_start_date as string) ?? null,
    },
    productName: name,
    batchNo:     batch,
    via:         '오더 추가',
  })

  let assigneeName: string | null = null
  if (o.assignee_tester_id) {
    const { data: t } = await supabaseAdmin.from('testers').select('name').eq('id', o.assignee_tester_id as string).maybeSingle()
    assigneeName = (t?.name as string) ?? null
  }
  return {
    id: o.id as string,
    productCode: o.product_code as string,
    productName: o.product_name as string,
    batchNo: o.batch_no as string,
    dosageForm: (o.dosage_form as string) ?? null,
    validationType: (o.validation_type as string) ?? null,
    packagingDate: (o.packaging_date as string) ?? null,
    dueDate: (o.due_date as string) ?? null,
    // 0042 미적용 DB 에서는 키 자체가 없다 — select('*') 라 조회는 깨지지 않고 null 이 된다.
    plannedStartDate: (o.planned_start_date as string) ?? null,
    isUrgent: !!o.is_urgent,
    method: o.method as string,
    status: o.status as string,
    assigneeTesterId: (o.assignee_tester_id as string) ?? null,
    assigneeName,
    // 수동 오더 생성은 항상 1인 배정으로 시작한다 — 2인 배정은 오더 수정 화면에서만 켠다(스펙 확정).
    isDualAssignment: false,
    assigneeTesterId2: null,
    assigneeName2: null,
    productSynced: !!o.product_synced,
    note: (o.note as string) ?? null,
    ingestState: o.ingest_state as string,
    source: 'manual',
    testItemCount: null,
    workdays: null,
    hasJob: false,
    locked: !!o.locked,
    createdAt: o.created_at as string,
    updatedAt: o.updated_at as string,
  }
}

/**
 * 관리자 확정/LOCK 토글 (PRD 원칙1: 확정 → LOCK / 원칙3: LOCK 존중).
 * lock=true 면 자동배정·재배정·시트 자동반영 대상에서 제외된다.
 * locked 컬럼(0015) 미적용 환경에서는 명확한 에러를 던진다.
 */
export async function setOrderLock(orderId: string, lock: boolean, userId: string | null): Promise<void> {
  const { error } = await supabaseAdmin
    .from('pct_orders')
    .update({ locked: lock, locked_by: lock ? userId : null, locked_at: lock ? new Date().toISOString() : null })
    .eq('id', orderId)
  if (error) {
    // 컬럼 미존재(마이그레이션 0015 미적용) 등
    throw new Error(`확정/잠금 실패: ${error.message} (마이그레이션 0015 적용 필요 가능)`)
  }
}

/**
 * 사유 필수 수정. 변경된 각 필드마다 pct_order_edits 이력을 남긴다.
 * 담당자(assigneeTesterId) 변경·해제는 재배정 이력(reassignment_history)에도 함께 적재한다 —
 * AI 자동배정/수동배정과 같은 저장소를 써야 재배정 통계가 누락되지 않는다.
 */
export async function updateOrderWithReason(
  id: string,
  patch: Partial<Record<EditableField, string | boolean | null>>,
  reason: string,
  editedBy: string | null,
): Promise<void> {
  const trimmedReason = (reason ?? '').trim()
  if (!trimmedReason) throw new Error('수정 사유는 필수입니다.')

  // 열거값 검증 — types/qc-status.ts 가 단일 기준이다.
  // 예전에는 검증이 없어 임의 문자열이 status 에 저장됐고, 그러면
  // OPEN_STATUSES / ACTIVE_JOB_STATUSES / LOCKED_STATUSES 기반 필터가 전부
  // 그 오더를 놓쳐 대시보드·공수집계·적재차단에서 조용히 사라졌다.
  if (patch.status !== undefined && patch.status !== null) {
    const s = String(patch.status)
    if (!ORDER_STATUSES.includes(s)) {
      throw new Error(`허용되지 않는 상태값입니다: ${s} (가능: ${ORDER_STATUSES.join(', ')})`)
    }
  }
  if (patch.method !== undefined && patch.method !== null) {
    const m = String(patch.method)
    if (m !== METHOD_ALL && m !== METHOD_PARTIAL) {
      throw new Error(`허용되지 않는 진행방법입니다: ${m} (가능: ${METHOD_ALL}, ${METHOD_PARTIAL})`)
    }
  }
  // 담당자를 바꾸는 수정이면 비활성 시험자 지정을 차단한다
  if (patch.assigneeTesterId) await assertTesterAssignable(String(patch.assigneeTesterId))
  if (patch.assigneeTesterId2) await assertTesterAssignable(String(patch.assigneeTesterId2))

  // 현재값 로드 (locked 컬럼까지 받기 위해 select('*') — 0015 미적용 환경에서는 자동 누락)
  const { data: current, error: curErr } = await supabaseAdmin
    .from('pct_orders')
    .select('*')
    .eq('id', id)
    .single()
  if (curErr) throw curErr

  const currentRow = current as Record<string, unknown>

  // [2인 배정] 패치가 적용된 뒤 최종적으로 남을 값 기준으로 검증한다
  // (패치에 없는 필드는 현재값을 그대로 쓴다 — 예: 담당자2만 바꾸고 2인 배정 플래그는
  // 건드리지 않는 요청도 이미 켜져 있던 2인 배정 기준으로 판정해야 한다).
  const effectiveDual = 'isDualAssignment' in patch
    ? !!patch.isDualAssignment
    : !!currentRow.is_dual_assignment
  const effectiveTester1 = 'assigneeTesterId' in patch
    ? ((patch.assigneeTesterId as string | null) ?? null)
    : ((currentRow.assignee_tester_id as string | null) ?? null)
  const effectiveTester2 = 'assigneeTesterId2' in patch
    ? ((patch.assigneeTesterId2 as string | null) ?? null)
    : ((currentRow.assignee_tester_id_2 as string | null) ?? null)

  const isManual = currentRow.ingest_state === 'manual'
  const dbPatch: Record<string, unknown> = {}
  const edits: Array<{ field: string; old_value: string | null; new_value: string | null }> = []

  for (const field of EDITABLE_FIELDS) {
    if (!(field in patch)) continue
    const col = FIELD_TO_COL[field]
    const newVal = patch[field] ?? null
    const oldVal = currentRow[col] ?? null
    const oldStr = oldVal === null ? null : String(oldVal)
    const newStr = newVal === null ? null : String(newVal)
    if (oldStr === newStr) continue
    if (!isManual && AUTO_IMMUTABLE_FIELDS.includes(field as (typeof AUTO_IMMUTABLE_FIELDS)[number])) {
      // 보호 필드가 늘어날 때마다 문구를 고쳐야 하는 하드코딩 목록이었다 —
      // 실제로 막힌 필드 이름을 그대로 알려주는 편이 정확하고 유지보수도 없다.
      throw new Error(`자동 적재 오더는 ${fieldLabel(field)}을(를) 수정할 수 없습니다. 제조팀 시트가 원본입니다.`)
    }
    dbPatch[col] = newVal
    edits.push({ field, old_value: oldStr, new_value: newStr })
  }

  // [2인 배정] 끄는 순간 담당자2는 항상 비운다 — 프런트가 값을 함께 보내지 않아도,
  // 혹은 실수로 다른 값을 보내도 서버가 강제로 정리한다(단일 기준: is_dual_assignment=false
  // 인 오더는 assignee_tester_id_2 가 항상 null 이라는 불변식을 지킨다).
  const dualTurnedOff = edits.some(e => e.field === 'isDualAssignment' && e.new_value === 'false')
  if (dualTurnedOff) {
    dbPatch.assignee_tester_id_2 = null
    const oldVal2 = currentRow.assignee_tester_id_2 ? String(currentRow.assignee_tester_id_2) : null
    const existingIdx = edits.findIndex(e => e.field === 'assigneeTesterId2')
    if (existingIdx >= 0) {
      edits[existingIdx] = { field: 'assigneeTesterId2', old_value: oldVal2, new_value: null }
    } else if (oldVal2 !== null) {
      edits.push({ field: 'assigneeTesterId2', old_value: oldVal2, new_value: null })
    }
  }

  if (edits.length === 0) return  // 변경 없음

  const changed = new Set(edits.map(e => e.field))

  // [2인 배정] 배정을 **실제로 건드리는 수정일 때만** 검증한다.
  //
  // 예전에는 패치 내용과 무관하게 항상 검증해서, 한 번 깨진 오더가 영영 수정 불가로 굳었다.
  // `assignee_tester_id_2` 는 `on delete set null` 이라 시험자를 하드 삭제하면
  // `is_dual_assignment = true` 인데 담당자2가 null 인 상태가 만들어지는데, 그 뒤로는
  // **비고 한 줄만 고쳐도** "담당자 2명을 모두 선택해야 합니다" 로 400 이 났다.
  // 작업이 시작된 오더면 2인 배정 체크박스도 잠겨 있어 빠져나갈 길이 없었다.
  //
  // 배정 필드를 건드릴 때만 막으면, 관리자가 담당자2를 다시 지정해 스스로 복구할 수 있고
  // 무관한 수정은 그대로 통과한다.
  const touchesAssignment =
    changed.has('isDualAssignment') || changed.has('assigneeTesterId') || changed.has('assigneeTesterId2')
  if (touchesAssignment) {
    if (effectiveDual && (!effectiveTester1 || !effectiveTester2)) {
      throw new Error('2인 배정은 담당자 2명을 모두 선택해야 합니다.')
    }
    if (effectiveTester1 && effectiveTester2 && effectiveTester1 === effectiveTester2) {
      throw new Error('같은 담당자를 두 번 배정할 수 없습니다.')
    }
  }

  // [원칙3] 확정(LOCK)된 오더는 담당자뿐 아니라 일정·진행방법·긴급여부까지 잠근다.
  if (currentRow.locked) {
    const blocked = LOCKED_IMMUTABLE_FIELDS.filter(f => changed.has(f))
    if (blocked.length > 0) {
      throw new Error(
        `확정(LOCK)된 오더는 ${blocked.map(fieldLabel).join('·')} 를 변경할 수 없습니다. ` +
        '확정 해제 후 다시 시도해 주세요.',
      )
    }
  }

  // [원칙2] QC 작업이 시작된 오더는 일정·품목 등을 변경하지 않는다.
  // 2인 배정에서는 오더당 작업이 최대 2건(담당자별)일 수 있어 존재 여부만 count 로 본다
  // (.maybeSingle() 은 2건이면 "복수 행" 에러를 던진다 — 예전 코드의 버그).
  const { count: startedJobCount, error: startedCntErr } = await supabaseAdmin
    .from('qc_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', id)
  if (startedCntErr) throw startedCntErr
  if ((startedJobCount ?? 0) > 0) {
    const blocked = STARTED_IMMUTABLE_FIELDS.filter(f => changed.has(f))
    if (blocked.length > 0) {
      throw new Error(
        `이미 시험이 시작된 오더는 ${blocked.map(fieldLabel).join('·')} 를 변경할 수 없습니다.`,
      )
    }
  }

  // [2인 배정] 이미 작업을 시작한 담당자를 해제·교체하는 것은 막는다.
  // "오더에 작업이 있으면 담당자 전체를 잠근다"가 아니라 "그 담당자 본인이 이미
  // 시작했으면 그 슬롯만 잠근다"가 맞는 규칙이다 — 슬롯별로 독립 판정한다.
  // (1인 배정 오더는 작업이 있으면 항상 그 작업의 담당자가 곧 assigneeTesterId 이므로
  //  이 검사가 곧 예전의 "작업이 있으면 담당자 변경 금지"와 동일하게 동작한다.)
  for (const slotField of ['assigneeTesterId', 'assigneeTesterId2'] as const) {
    if (!changed.has(slotField)) continue
    const oldTesterId = (currentRow[FIELD_TO_COL[slotField]] as string | null) ?? null
    if (!oldTesterId) continue
    const { data: startedByThis } = await supabaseAdmin
      .from('qc_jobs')
      .select('qc_no')
      .eq('order_id', id)
      .eq('assignee_tester_id', oldTesterId)
      .maybeSingle()
    if (startedByThis) {
      throw new Error(
        `이미 작업을 시작한 담당자(QC ${startedByThis.qc_no})는 변경할 수 없습니다. 작업을 먼저 정리하세요.`,
      )
    }
  }

  // [GMP/ALCOA+] 감사 이력을 **먼저** 남기고 값을 바꾼다.
  //
  // 예전에는 update → insert 순서였고 둘 다 별개 요청(트랜잭션 아님)이라,
  // 이력 insert 가 실패하면 "사유·작성자 기록 없이 값만 바뀐 오더"가 남았다.
  // 순서를 뒤집으면 최악의 경우가 "이력은 있는데 값은 안 바뀐" 쪽이 된다 —
  // 감사 관점에서 설명 가능한 실패다. 값 변경이 실패하면 방금 쓴 이력을 되돌린다.
  //
  // 근본 해결은 update+insert 를 한 트랜잭션(RPC)이나 DB 트리거로 옮기는 것이다.
  const { data: insertedEdits, error: logErr } = await supabaseAdmin
    .from('pct_order_edits')
    .insert(
      edits.map(e => ({ order_id: id, field: e.field, old_value: e.old_value, new_value: e.new_value, reason: trimmedReason, edited_by: editedBy })),
    )
    .select('id')
  if (logErr) throw new Error(`수정 이력 기록 실패로 변경을 취소했습니다: ${logErr.message}`)

  // [2인 배정] 2인 배정을 끄면 담당자별로 나눠뒀던 항목 배분도 되돌린다 —
  // 담당자2 가 사라졌는데 항목이 slot=2 로 남으면 그 항목은 아무에게도 표시되지 않는다.
  //
  // 오더 UPDATE **앞에서** 되돌리는 이유: 뒤에 두면 여기서 실패했을 때 오더는 이미
  // is_dual_assignment=false 로 커밋됐는데 slot=2 인 고아 항목이 남고, 사용자에게는
  // "저장 실패"로 보이지만 재시도는 edits.length===0 으로 아무것도 하지 않아 손쓸 방법이 없다.
  // 앞에 두면 최악의 경우가 "2인 배정은 아직 켜져 있는데 항목이 전부 slot=1" 인데,
  // 이는 관리자가 다시 배분하면 되는 복구 가능한 상태다.
  if (dualTurnedOff) {
    await resetAssigneeSlots(id, editedBy)
  }

  const { error: updErr } = await supabaseAdmin.from('pct_orders').update(dbPatch).eq('id', id)
  if (updErr) {
    // 값 변경이 실패했으므로 방금 남긴 이력을 제거해 "일어나지 않은 변경"이 남지 않게 한다.
    const ids = (insertedEdits ?? []).map(r => r.id as string)
    if (ids.length > 0) {
      await supabaseAdmin.from('pct_order_edits').delete().in('id', ids).then(
        undefined,
        () => console.error('[pctOrders] 이력 롤백 실패 — 수동 정리 필요:', ids),
      )
    }
    throw updErr
  }

  // 담당자 변경·해제는 재배정 이력에도 남긴다(자동배정/수동배정과 동일 저장소).
  // 이력 적재 실패가 수정 자체를 되돌리지는 않는다.
  //
  // 담당자1(assigneeTesterId)과 담당자2(assigneeTesterId2)를 **똑같이** 다룬다.
  // 예전에는 담당자1만 봐서, 담당자2 배정은 reassignment_history 에 한 건도 남지 않았고
  // (대시보드의 재배정 통계가 통째로 놓쳤다) 휴가 겹침 알림도 돌지 않았다 —
  // 화면은 저장 직전에 "그대로 저장하면 관리자 알림이 남습니다" 라고 약속하는데
  // 담당자2에 대해서는 그 약속이 지켜지지 않았다.
  // 날짜만 바뀌어도(담당자는 그대로) 휴가 경고가 돌아야 한다 — 화면(EditModal)이 담당자
  // 미변경 시에도 "그대로 저장하면 관리자 알림이 남습니다" 라고 약속하기 때문이다. 여기서
  // 안 돌리면 화면이 없는 안전망을 있다고 믿게 만드는 셈이 된다.
  const datesChanged = changed.has('packagingDate') || changed.has('dueDate') || changed.has('plannedStartDate')

  for (const slotField of ['assigneeTesterId', 'assigneeTesterId2'] as const) {
    const assigneeEdit = edits.find(e => e.field === slotField)
    if (!assigneeEdit && !datesChanged) continue

    // 재배정 이력(logReassignment)은 담당자가 실제로 바뀐 경우에만 남긴다 — 날짜 수정
    // 건까지 섞이면 재배정 통계(대시보드)가 오염된다. 위 datesChanged 분기와 반드시 분리 유지.
    if (assigneeEdit) {
      await logReassignment({
        orderId:    id,
        beforeUser: assigneeEdit.old_value,
        afterUser:  assigneeEdit.new_value,
        reason:     trimmedReason,
        changedBy:  editedBy,
      }).catch(() => {})
    }

    // 수동 배정은 차단하지 않는다. 휴가·출장과 겹치면 관리자 알림만 남긴다.
    // 담당자가 이번 수정에서 안 바뀌었으면(날짜만 수정) 그 슬롯의 현재 담당자를 그대로 쓴다 —
    // pickPatched 는 패치에 없는 컬럼이면 currentRow 값을 돌려주므로 그대로 재사용한다.
    // 날짜도 같은 수정에서 바뀔 수 있으므로 패치 적용 후 값을 기준으로 판정한다.
    await warnIfAssigneeOnLeave({
      orderId:     id,
      testerId:    assigneeEdit ? assigneeEdit.new_value : pickPatched(dbPatch, currentRow, FIELD_TO_COL[slotField]),
      order: {
        // 'packaging_date' in dbPatch 로 판단한다 — 날짜를 비우는 수정(null)도 패치값이 이겨야 한다.
        packagingDate: pickPatched(dbPatch, currentRow, 'packaging_date'),
        dueDate:       pickPatched(dbPatch, currentRow, 'due_date'),
        // 착수 예정일을 바꾸는 수정이 곧 "휴가를 피해 날짜를 옮기는" 동작이다 —
        // 판정에 넣지 않으면 옮겨 놓고도 같은 경고 알림이 다시 쌓인다.
        plannedStartDate: pickPatched(dbPatch, currentRow, 'planned_start_date'),
      },
      productName: (currentRow.product_name as string) ?? '',
      batchNo:     (currentRow.batch_no as string) ?? '',
      // 알림에서 어느 슬롯 배정인지 구분되게 한다 — 2인 배정 오더는 같은 오더에 알림이 둘 뜬다.
      via:         slotField === 'assigneeTesterId2' ? '오더 수정(담당자2)' : '오더 수정',
    })
  }
}

/** 수정 후 실제 값 — 패치에 그 컬럼이 있으면(null 로 비우는 경우 포함) 패치값이 이긴다. */
function pickPatched(
  patch: Record<string, unknown>,
  current: Record<string, unknown>,
  column: string,
): string | null {
  const source = column in patch ? patch : current
  return (source[column] as string) ?? null
}

export interface OrderEditRow {
  id: string
  field: string
  oldValue: string | null
  newValue: string | null
  reason: string
  editedBy: string | null
  editedByName: string | null
  editedAt: string
}

export interface IngestLogRow {
  id: string
  runAt: string
  orderKey: string
  batchNo: string
  productCode: string
  productName: string | null
  changeType: string
  status: string | null
  fileId: string | null
}

/** 가져온(적재) 이력 — 최신순 (품목명은 pct_orders에서 보강) */
export async function listIngestLog(limit = 100): Promise<IngestLogRow[]> {
  const { data, error } = await supabaseAdmin
    .from('pct_ingest_log')
    .select('id, run_at, order_key, change_type, status, file_id')
    .order('run_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  const rows = data ?? []

  // order_key(batch|code) → 품목명 보강 (한 번에 조회)
  const codes = Array.from(new Set(rows.map(r => String(r.order_key).split('|')[1]).filter(Boolean)))
  const nameByCode = new Map<string, string>()
  if (codes.length > 0) {
    const { data: prods } = await supabaseAdmin
      .from('pct_orders')
      .select('product_code, product_name')
      .in('product_code', codes)
    for (const p of prods ?? []) {
      nameByCode.set(String(p.product_code), p.product_name as string)
    }
  }

  return rows.map(r => {
    const orderKey = r.order_key as string
    const [batchNo, productCode] = orderKey.split('|')
    return {
      id: r.id as string,
      runAt: r.run_at as string,
      orderKey,
      batchNo: batchNo ?? '',
      productCode: productCode ?? '',
      productName: nameByCode.get(productCode ?? '') ?? null,
      changeType: r.change_type as string,
      status: (r.status as string) ?? null,
      fileId: (r.file_id as string) ?? null,
    }
  })
}

export async function listEdits(orderId: string): Promise<OrderEditRow[]> {
  const { data, error } = await supabaseAdmin
    .from('pct_order_edits')
    .select('id, field, old_value, new_value, reason, edited_by, edited_at')
    .eq('order_id', orderId)
    .order('edited_at', { ascending: false })
  if (error) throw error
  const rows = data ?? []

  // 작성자 id → 표시명 보강
  const editorIds = Array.from(new Set(rows.map(e => e.edited_by as string).filter(Boolean)))
  const nameById = new Map<string, string>()
  if (editorIds.length > 0) {
    const { data: users } = await supabaseAdmin
      .from('users')
      .select('id, display_name, username')
      .in('id', editorIds)
    for (const u of users ?? []) {
      nameById.set(u.id as string, (u.display_name as string) || (u.username as string) || '')
    }
  }

  return rows.map(e => ({
    id: e.id as string,
    field: e.field as string,
    oldValue: (e.old_value as string) ?? null,
    newValue: (e.new_value as string) ?? null,
    reason: e.reason as string,
    editedBy: (e.edited_by as string) ?? null,
    editedByName: e.edited_by ? (nameById.get(e.edited_by as string) ?? null) : null,
    editedAt: e.edited_at as string,
  }))
}
