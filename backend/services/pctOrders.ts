/**
 * [BACKEND] PCT 오더 조회 / 수정(사유 필수) / 수정이력
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { DELETED_STATUS, PENDING_STATUS, ORDER_STATUSES } from '@shared/qc-status'
import {
  PRIMARY_ASSIGNEE_SLOT,
  assigneeSlotLabel,
  isParallelAssignment,
  type AssigneeSlot,
  type OrderAssignee,
  type OrderAssigneeInput,
} from '@shared/assignment'
import { assertTesterAssignable } from '@backend/services/testers'
import { logReassignment } from '@backend/services/reassignmentHistory'
import { warnIfAssigneeOnLeave } from '@backend/services/leaveConflicts'
import { ASSIGNED_TESTER_FILTER_COLUMN, withAssignedTesterEmbed } from '@backend/lib/assigneeFilter'
import { describeSchemaError } from '@backend/lib/schemaError'
import {
  PARALLEL_ASSIGN_FEATURE,
  PARALLEL_ASSIGN_MIGRATION,
  assigneesOfOrderForWrite,
  loadAssigneesByOrder,
  normalizeAssigneeInput,
  setOrderAssignees,
  setOrderPrimaryAssignee,
  type AssigneeSlotRow,
} from '@backend/services/orderAssignees'
import {
  METHOD_ALL, METHOD_PARTIAL, normalizeForMethod, replaceForOrder,
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
  /** 대표 담당자(담당자 1 = 슬롯 1) */
  assigneeTesterId: string | null
  assigneeName: string | null
  /**
   * 병렬 배정(0049) — 담당자 슬롯 목록(슬롯 오름차순, 번호 구멍 허용).
   * 1인 배정이면 1개, 미배정이면 빈 배열. 각 담당자가 이미 시작했으면 startedQcNo 가 있다.
   */
  assignees: OrderAssignee[]
  /** 담당자 2명 이상 = 병렬 배정 (assignees 에서 파생 — 플래그 컬럼이 아니다) */
  isParallel: boolean
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
// assigneeTesterId 는 1인 배정(대표 담당자만) 수정용이며 컬럼에 직접 쓰지 않는다 —
// DB 함수 set_order_primary_assignee 로만 반영한다(미러 불일치 금지). 병렬 구성은 assignees 로 받는다.
const EDITABLE_FIELDS = [
  'productCode', 'productName', 'batchNo', 'dosageForm', 'validationType',
  'packagingDate', 'dueDate', 'plannedStartDate', 'isUrgent', 'method', 'status', 'note', 'assigneeTesterId',
] as const
type EditableField = (typeof EDITABLE_FIELDS)[number]
// 구분도 제조팀 시트가 원본이다 — 자동 적재 오더에서는 고정하고,
// 수동 생성 오더에서만 관리자가 지정한다(품목코드·품목명·제조번호와 같은 취급).
const AUTO_IMMUTABLE_FIELDS = ['productCode', 'productName', 'batchNo', 'validationType'] as const

/**
 * 0049 이전 화면이 보내던 2인 배정 필드. 이제 받지 않는다 — 조용히 무시하면 관리자는
 * 저장됐다고 믿는데 담당자2가 바뀌지 않는다. 새로고침을 안내하고 거절한다.
 */
const LEGACY_DUAL_FIELDS = ['isDualAssignment', 'assigneeTesterId2'] as const

/**
 * [원칙3] 확정(LOCK) 시 변경을 막는 필드.
 *
 * 2026-08-23 수정: 예전에는 assigneeTesterId 하나만 막고 있었다. 그런데
 * packagingDate/dueDate 는 엔진의 스케줄 윈도우 입력(computeWindow)이고
 * method/isUrgent 는 배정 방식 자체를 바꾸므로, 이것들이 열려 있으면
 * "확정된 일정"이 확정되지 않은 것과 같다.
 * note 는 메모라서 LOCK 후에도 남겨둔다.
 * 담당자 구성(병렬 배정 포함)도 잠긴다 — 서비스가 선검사하고 DB 함수가 최종 판정한다.
 */
const LOCKED_IMMUTABLE_FIELDS = [
  // plannedStartDate 도 엔진·달력이 읽는 일정 입력이다 — 열어 두면 확정이 확정이 아니다.
  'assigneeTesterId', 'packagingDate', 'dueDate', 'plannedStartDate', 'isUrgent', 'method',
] as const

/** LOCK 오더의 담당자 변경 거절 문구 — DB 함수(0049)와 같은 문구 */
const LOCKED_ASSIGNEE_MESSAGE = '확정(LOCK)된 오더는 담당자를 변경할 수 없습니다. 확정 해제 후 다시 시도해 주세요.'

/**
 * [원칙2] QC 작업이 시작된 뒤에는 변경을 막는 필드.
 * "시험 시작(IN_PROGRESS)/완료 후 일정 변경 금지". status 는 작업 진행에 따라
 * 서버가 동기화하므로(qcJobs.advanceJobStage) 여기서 제외한다.
 *
 * 담당자는 여기 없다 — "오더에 작업이 하나라도 있으면 담당자 변경 금지" 가 아니라
 * 병렬 배정 규칙(0049 set_order_assignees)을 따른다:
 *   · 담당자 추가는 작업 시작 뒤에도 허용(5명 이하, 새 담당자는 시험항목 0개로 시작)
 *   · 삭제는 그 담당자의 작업이 없고 활성 시험항목이 0개일 때만
 *   · 이미 시작한 담당자의 교체·해제 금지, 담당자 1(대표) 삭제 불가
 * 1인 배정 오더는 작업이 있으면 항상 그 작업의 담당자가 곧 대표이므로 결과는 예전과 같다.
 */
const STARTED_IMMUTABLE_FIELDS = [
  // plannedStartDate 는 **여기 넣지 않는다.** 넣었다가 되돌린 이유를 남긴다:
  // 배정 다이얼로그는 담당자와 착수 예정일을 한 패치로 보낸다. 이 목록에 넣으면 작업이
  // 하나라도 시작된 오더에서 그 패치가 통째로 거부돼, 예전에는 성공하던 배정까지 실패한다
  // (병렬 배정에서 한 담당자가 이미 시작한 오더에 담당자를 더 붙이는 경우 등).
  // 시작 후에는 실제 착수일(qc_jobs.work_start_date)이 달력에서 계획을 이기므로 이 값은
  // 어차피 무시된다 — 무시되는 값을 쓰게 두는 쪽이, 되는 배정을 막는 쪽보다 낫다.
  'packagingDate', 'dueDate', 'isUrgent', 'method',
  'productCode', 'productName', 'batchNo',
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
}

/** 담당자 행 수가 이 값을 넘으면 id 목록 대신 담당자 테이블 전체를 한 번에 읽는다 */
const LOAD_ALL_ASSIGNEES_THRESHOLD = 300

export async function listOrders(filters: {
  status?: string
  assigneeTesterId?: string
  includeDeleted?: boolean
} = {}): Promise<PctOrderRow[]> {
  // 담당자 필터 — 담당자 1~5 어느 슬롯이든 "내 오더"다(0049). 필터는 assigneeFilter 한 곳에서만 만든다.
  // 이 값은 쿼리스트링(app/api/pct-orders/route.ts)에서 온다. PostgREST 필터에 들어가는
  // 자리라 UUID 형식을 강제한다(notifications.ts 의 scopeToViewer 와 동일한 가드).
  const assigneeFilter = filters.assigneeTesterId ?? null
  if (assigneeFilter && !/^[0-9a-fA-F-]{36}$/.test(assigneeFilter)) throw new Error('잘못된 담당자 식별자입니다.')

  let query = supabaseAdmin
    .from('pct_orders')
    .select(withAssignedTesterEmbed('*', assigneeFilter))
    .order('packaging_date', { ascending: true, nullsFirst: false })

  if (!filters.includeDeleted) query = query.neq('status', DELETED_STATUS)
  if (filters.status) query = query.eq('status', filters.status)
  if (assigneeFilter) query = query.eq(ASSIGNED_TESTER_FILTER_COLUMN, assigneeFilter)

  // Supabase 기본 1000행 상한 회피. pct_orders 는 소프트 삭제만 하므로 단조 증가한다.
  const { data, error } = await query.range(0, 9999)
  if (error) throw assigneeFilter ? describeSchemaError(error, PARALLEL_ASSIGN_FEATURE, PARALLEL_ASSIGN_MIGRATION) : error
  const orders = (data ?? []) as unknown as Record<string, unknown>[]
  if (orders.length === 0) return []
  const orderIds = orders.map(o => o.id as string)

  // 담당자 슬롯(0049) — 미적용이면 설치 안내 오류를 던진다(핵심 화면)
  const assigneeMap = orders.length > LOAD_ALL_ASSIGNEES_THRESHOLD
    ? await loadAssigneesByOrder()
    : await loadAssigneesByOrder(orderIds)

  // 담당자 이름 (슬롯 1~5 전부)
  const testerIds = [...new Set(orderIds.flatMap(id => (assigneeMap.get(id) ?? []).map(a => a.testerId)))]
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
      supabaseAdmin.from('pct_order_test_items').select('order_id, is_excluded').in('order_id', orderIds),
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
  // QC 작업 시작 여부 + 담당자별 시작 QC번호(오더 수정 서랍의 "시작한 담당자" 잠금 표시)
  const startedQcByOrderTester = new Map<string, string>()
  {
    const { data: jobs } = await supabaseAdmin
      .from('qc_jobs').select('order_id, assignee_tester_id, qc_no').in('order_id', orderIds)
    for (const j of jobs ?? []) {
      jobOrderIds.add(j.order_id as string)
      if (j.assignee_tester_id) startedQcByOrderTester.set(`${j.order_id as string}::${j.assignee_tester_id as string}`, j.qc_no as string)
    }
  }

  return orders.map(o => {
    const id = o.id as string
    const assignees: OrderAssignee[] = (assigneeMap.get(id) ?? []).map(a => ({
      slot: a.slot,
      testerId: a.testerId,
      name: nameByTester.get(a.testerId) ?? null,
      startedQcNo: startedQcByOrderTester.get(`${id}::${a.testerId}`) ?? null,
    }))
    const primary = assignees.find(a => a.slot === PRIMARY_ASSIGNEE_SLOT) ?? null
    return {
      id,
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
      assigneeTesterId: primary?.testerId ?? null,
      assigneeName: primary?.name ?? null,
      assignees,
      isParallel: isParallelAssignment(assignees),
      productSynced: !!o.product_synced,
      note: (o.note as string) ?? null,
      ingestState: o.ingest_state as string,
      source: o.ingest_state === 'manual' ? 'manual' : 'auto',
      testItemCount: testItemCountByOrder.get(id) ?? baselineItemCountByCode.get(o.product_code as string) ?? null,
      workdays: workdaysByCode.get(o.product_code as string) ?? null,
      hasJob: jobOrderIds.has(id),
      locked: !!o.locked,   // select('*') 결과. 컬럼 미적용 시 undefined → false
      createdAt: o.created_at as string,
      updatedAt: o.updated_at as string,
    }
  })
}

/**
 * 수동 오더 생성 (오더배정 화면에서 직접 등록).
 * 제조팀 시트 적재가 아닌 사용자 입력 오더 — product_synced=false, ingest_state='manual'.
 * 자연키(batch_no, product_code) 중복 시 명확한 에러를 던진다.
 *
 * 담당자는 항상 1인(대표)으로 시작한다 — 병렬 배정은 오더 수정 화면에서만 켠다(스펙 확정).
 * 담당자 기록은 insert 에 넣지 않고 DB 함수 set_order_primary_assignee(0049)로 한다(슬롯 1 행·미러·감사를 함께).
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
  /** 만든 사람(users.id) — 담당자 지정 감사 기록에 남는다 */
  createdBy?: string | null
}): Promise<PctOrderRow> {
  const code = (input.productCode ?? '').trim()
  const name = (input.productName ?? '').trim()
  const batch = (input.batchNo ?? '').trim()
  if (!code || !name || !batch) throw new Error('품목코드·품목명·제조번호는 필수입니다.')
  // 비활성 시험자는 담당자로 지정할 수 없다 (최종 판정은 DB 함수 — 여기는 오더를 만들기 전 선검사)
  const assigneeTesterId = input.assigneeTesterId || null
  await assertTesterAssignable(assigneeTesterId)
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

  // 담당자 지정 — 슬롯 1·미러·감사를 DB 함수 한 트랜잭션으로. 실패하면 방금 만든 오더를 되돌린다
  // (담당자 없이 만들어진 오더가 남으면 관리자는 지정한 줄 알고 넘어간다).
  if (assigneeTesterId) {
    try {
      await setOrderPrimaryAssignee(o.id as string, assigneeTesterId, input.createdBy ?? null, '수동 오더 생성 — 담당자 지정')
    } catch (e) {
      await supabaseAdmin.from('pct_orders').delete().eq('id', o.id as string)
      throw e
    }
  }

  // 신규 오더에 담당자를 바로 지정한 경우도 휴가 충돌을 알린다(차단하지 않음).
  await warnIfAssigneeOnLeave({
    orderId:     o.id as string,
    testerId:    assigneeTesterId,
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
  if (assigneeTesterId) {
    const { data: t } = await supabaseAdmin.from('testers').select('name').eq('id', assigneeTesterId).maybeSingle()
    assigneeName = (t?.name as string) ?? null
  }
  const assignees: OrderAssignee[] = assigneeTesterId
    ? [{ slot: PRIMARY_ASSIGNEE_SLOT, testerId: assigneeTesterId, name: assigneeName, startedQcNo: null }]
    : []
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
    assigneeTesterId,
    assigneeName,
    assignees,
    isParallel: false,
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

/** 담당자 변경 계획 — 무엇을 어느 DB 함수로 바꿀지 */
type AssignmentPlan =
  | { kind: 'none' }
  | { kind: 'primary'; testerId: string | null }
  | { kind: 'set'; assignees: OrderAssigneeInput[] }
  /** 병렬 배정 오더를 한 번에 미배정으로 — 병렬 담당자 빼기(set) 뒤 대표 비우기(primary null) */
  | { kind: 'clearParallel'; primaryTesterId: string }

/** 슬롯 구성 비교용 키 */
function slotsKey(rows: ReadonlyArray<{ slot: number; testerId: string }>): string {
  return [...rows].sort((a, b) => a.slot - b.slot).map(r => `${r.slot}:${r.testerId}`).join(',')
}

/**
 * 요청을 담당자 변경 계획으로 바꾼다.
 *  - assignees(병렬 구성) 가 오면 그것이 기준이다. 빈 배열 = 미배정.
 *    병렬이 아니던 오더의 대표 1명 변경·해제는 대표 전용 함수로(감사 키 assigneeTesterId 연속성, F3-3).
 *  - 아니면 예전 patch.assigneeTesterId(1인 배정·일괄 배정 화면) = 대표 전용 함수.
 */
function planAssignment(
  requested: OrderAssigneeInput[] | null,
  legacyPrimary: { given: boolean; testerId: string | null },
  current: AssigneeSlotRow[],
): AssignmentPlan {
  const currentPrimary = current.find(a => a.slot === PRIMARY_ASSIGNEE_SLOT)?.testerId ?? null
  const onlyPrimaryNow = current.every(a => a.slot === PRIMARY_ASSIGNEE_SLOT)

  if (requested !== null) {
    if (slotsKey(requested) === slotsKey(current)) return { kind: 'none' }
    if (requested.length === 0) {
      // 병렬 해제와 담당자 1 미배정을 한 번에 저장한 경우 — 대표 함수만 부르면 "병렬 담당자를 먼저 빼세요" 로
      // 방금 뺀 사람을 또 빼라고 한다. 병렬 담당자를 먼저 빼고 대표를 비운다.
      if (current.length > 1 && currentPrimary) return { kind: 'clearParallel', primaryTesterId: currentPrimary }
      return { kind: 'primary', testerId: null }
    }
    if (onlyPrimaryNow && requested.length === 1 && requested[0].slot === PRIMARY_ASSIGNEE_SLOT) {
      return { kind: 'primary', testerId: requested[0].testerId }
    }
    return { kind: 'set', assignees: requested }
  }
  if (legacyPrimary.given && legacyPrimary.testerId !== currentPrimary) {
    return { kind: 'primary', testerId: legacyPrimary.testerId }
  }
  return { kind: 'none' }
}

/** 커밋 뒤 재배정 이력·휴가 알림에 쓰는 슬롯별 변경 */
interface SlotChange { slot: AssigneeSlot; before: string | null; after: string | null }

/**
 * 사유 필수 수정. 변경된 각 필드마다 pct_order_edits 이력을 남긴다.
 *
 * 담당자(대표·병렬 구성) 변경은 DB 함수(0049)가 감사까지 한 트랜잭션으로 하고,
 * 커밋 뒤 재배정 이력(reassignment_history)·휴가 겹침 알림을 **바뀐 슬롯마다** 남긴다 —
 * AI 자동배정/수동배정과 같은 저장소를 써야 재배정 통계가 누락되지 않는다.
 *
 * 한 번의 [저장]에 다른 필드와 담당자 구성이 함께 오면 **다른 필드 먼저, 담당자 구성 DB 함수 마지막**(F3-5).
 * 담당자 구성만 실패하면 "담당자 구성 저장에 실패했습니다: {원인} (다른 수정 사항은 저장되었습니다)".
 *
 * @param opts.assignees 병렬 배정 구성 [{slot, testerId}] — 빈 배열이면 미배정. 없으면 담당자 구성을 건드리지 않는다
 *                       (patch.assigneeTesterId 가 오면 대표 1명만 바꾼다 — 1인 배정·일괄 배정 화면).
 */
export async function updateOrderWithReason(
  id: string,
  patch: Partial<Record<EditableField, string | boolean | null>>,
  reason: string,
  editedBy: string | null,
  opts: { assignees?: unknown } = {},
): Promise<void> {
  const trimmedReason = (reason ?? '').trim()
  if (!trimmedReason) throw new Error('수정 사유는 필수입니다.')

  for (const legacy of LEGACY_DUAL_FIELDS) {
    if (legacy in (patch as Record<string, unknown>)) {
      throw new Error('화면이 최신 버전이 아닙니다. 새로고침한 뒤 다시 저장해 주세요. (2인 배정은 병렬 배정으로 바뀌었습니다)')
    }
  }

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
  // 병렬 구성 형식 검증(서비스 선검증 — 최종 판정은 DB 함수). 빈 배열 = 미배정.
  const requestedAssignees: OrderAssigneeInput[] | null = opts.assignees === undefined
    ? null
    : (Array.isArray(opts.assignees) && opts.assignees.length === 0 ? [] : normalizeAssigneeInput(opts.assignees))

  // 현재값 로드 (locked 컬럼까지 받기 위해 select('*') — 0015 미적용 환경에서는 자동 누락)
  const { data: current, error: curErr } = await supabaseAdmin
    .from('pct_orders')
    .select('*')
    .eq('id', id)
    .single()
  if (curErr) throw curErr

  const currentRow = current as Record<string, unknown>

  const legacyPrimaryGiven = requestedAssignees === null && 'assigneeTesterId' in patch
  const touchesAssignment = requestedAssignees !== null || legacyPrimaryGiven
  const datesTouched = ['packagingDate', 'dueDate', 'plannedStartDate'].some(f => f in patch)
  // 담당자 구성을 건드리는 요청이면 쓰기 경로 조회(0049 미적용 → 설치 안내로 거절).
  // 날짜만 바꾸는 요청은 휴가 알림용 조회라 실패해도 수정 자체를 막지 않는다.
  let currentSlots: AssigneeSlotRow[] = []
  if (touchesAssignment) {
    currentSlots = await assigneesOfOrderForWrite(id)
  } else if (datesTouched) {
    currentSlots = await assigneesOfOrderForWrite(id).catch(() => (
      currentRow.assignee_tester_id
        ? [{ slot: PRIMARY_ASSIGNEE_SLOT, testerId: currentRow.assignee_tester_id as string }]
        : []
    ))
  }

  const plan = planAssignment(
    requestedAssignees,
    { given: legacyPrimaryGiven, testerId: ((patch.assigneeTesterId as string | null | undefined) || null) },
    currentSlots,
  )

  const isManual = currentRow.ingest_state === 'manual'
  const dbPatch: Record<string, unknown> = {}
  const edits: Array<{ field: string; old_value: string | null; new_value: string | null }> = []

  for (const field of EDITABLE_FIELDS) {
    // 담당자는 컬럼에 직접 쓰지 않는다 — 아래 DB 함수가 슬롯·미러·감사를 함께 쓴다.
    if (field === 'assigneeTesterId') continue
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

  if (edits.length === 0 && plan.kind === 'none') return  // 변경 없음

  const changed = new Set(edits.map(e => e.field))

  // [원칙3] 확정(LOCK)된 오더는 담당자뿐 아니라 일정·진행방법·긴급여부까지 잠근다.
  // 담당자 변경도 여기서 먼저 거절한다 — 다른 필드만 저장되고 담당자만 실패하는 부분 반영을 줄인다.
  if (currentRow.locked) {
    if (plan.kind !== 'none') throw new Error(LOCKED_ASSIGNEE_MESSAGE)
    const blocked = LOCKED_IMMUTABLE_FIELDS.filter(f => changed.has(f))
    if (blocked.length > 0) {
      throw new Error(
        `확정(LOCK)된 오더는 ${blocked.map(fieldLabel).join('·')} 를 변경할 수 없습니다. ` +
        '확정 해제 후 다시 시도해 주세요.',
      )
    }
  }

  // 새로 들어오는 담당자의 활성 여부 선검사(최종 판정은 DB 함수)
  if (plan.kind === 'primary' && plan.testerId) await assertTesterAssignable(plan.testerId)
  if (plan.kind === 'set') {
    const existing = new Set(currentSlots.map(a => a.testerId))
    for (const a of plan.assignees) if (!existing.has(a.testerId)) await assertTesterAssignable(a.testerId)
  }

  // [원칙2] QC 작업이 시작된 오더는 일정·품목 등을 변경하지 않는다.
  // 병렬 배정에서는 오더당 작업이 여러 건(담당자별)일 수 있어 존재 여부만 count 로 본다
  // (.maybeSingle() 은 2건이면 "복수 행" 에러를 던진다 — 예전 코드의 버그).
  if (edits.length > 0) {
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
  }

  // ── ① 담당자 외 필드 ─────────────────────────────────────────────────────────
  // [GMP/ALCOA+] 감사 이력을 **먼저** 남기고 값을 바꾼다.
  //
  // 예전에는 update → insert 순서였고 둘 다 별개 요청(트랜잭션 아님)이라,
  // 이력 insert 가 실패하면 "사유·작성자 기록 없이 값만 바뀐 오더"가 남았다.
  // 순서를 뒤집으면 최악의 경우가 "이력은 있는데 값은 안 바뀐" 쪽이 된다 —
  // 감사 관점에서 설명 가능한 실패다. 값 변경이 실패하면 방금 쓴 이력을 되돌린다.
  //
  // 근본 해결은 update+insert 를 한 트랜잭션(RPC)이나 DB 트리거로 옮기는 것이다.
  // (담당자 구성은 이미 DB 함수 한 트랜잭션이다 — 아래 ②)
  if (edits.length > 0) {
    const { data: insertedEdits, error: logErr } = await supabaseAdmin
      .from('pct_order_edits')
      .insert(
        edits.map(e => ({ order_id: id, field: e.field, old_value: e.old_value, new_value: e.new_value, reason: trimmedReason, edited_by: editedBy })),
      )
      .select('id')
    if (logErr) throw new Error(`수정 이력 기록 실패로 변경을 취소했습니다: ${logErr.message}`)

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
  }

  // ── ② 담당자 구성 — DB 함수 한 트랜잭션(슬롯·미러·구 컬럼·항목 되돌림·감사), 마지막에 ────────
  let slotChanges: SlotChange[] = []
  let finalSlots: AssigneeSlotRow[] = currentSlots
  let assignmentError: Error | null = null
  try {
    if (plan.kind === 'primary') {
      const res = await setOrderPrimaryAssignee(id, plan.testerId, editedBy, trimmedReason)
      if (res.changed) {
        slotChanges = [{ slot: PRIMARY_ASSIGNEE_SLOT, before: res.beforeTesterId, after: res.afterTesterId }]
        finalSlots = [
          ...(res.afterTesterId ? [{ slot: PRIMARY_ASSIGNEE_SLOT, testerId: res.afterTesterId }] : []),
          ...currentSlots.filter(a => a.slot !== PRIMARY_ASSIGNEE_SLOT),
        ]
      }
    } else if (plan.kind === 'clearParallel') {
      // 두 함수는 각각 한 트랜잭션이다(미러가 갈라지지 않음). 둘째가 실패하면 병렬 담당자만 빠진 상태로 남고 오류를 알린다.
      const removed = await setOrderAssignees(id, [{ slot: PRIMARY_ASSIGNEE_SLOT, testerId: plan.primaryTesterId }], editedBy, trimmedReason)
      if (removed.changed) {
        const afterSlots = new Set(removed.after.map(a => a.slot as number))
        slotChanges = removed.before
          .filter(a => !afterSlots.has(a.slot))
          .map(a => ({ slot: a.slot, before: a.testerId, after: null }))
        finalSlots = removed.after.map(a => ({ slot: a.slot, testerId: a.testerId }))
      }
      const res = await setOrderPrimaryAssignee(id, null, editedBy, trimmedReason)
      if (res.changed) {
        slotChanges = [...slotChanges, { slot: PRIMARY_ASSIGNEE_SLOT, before: res.beforeTesterId, after: null }]
        finalSlots = []
      }
    } else if (plan.kind === 'set') {
      const res = await setOrderAssignees(id, plan.assignees, editedBy, trimmedReason)
      if (res.changed) {
        const beforeBySlot = new Map(res.before.map(a => [a.slot, a.testerId]))
        const afterBySlot = new Map(res.after.map(a => [a.slot, a.testerId]))
        const slots = [...new Set([...beforeBySlot.keys(), ...afterBySlot.keys()])].sort((a, b) => a - b)
        slotChanges = slots
          .map(slot => ({ slot, before: beforeBySlot.get(slot) ?? null, after: afterBySlot.get(slot) ?? null }))
          .filter(c => c.before !== c.after)
        finalSlots = res.after.map(a => ({ slot: a.slot, testerId: a.testerId }))
      }
    }
  } catch (e) {
    assignmentError = e instanceof Error ? e : new Error('담당자 구성 저장에 실패했습니다.')
  }

  // ── ③ 커밋 뒤 — 재배정 이력·휴가 겹침 알림 (실패해도 수정은 되돌리지 않는다) ─────────────
  // 재배정 이력(logReassignment)은 담당자가 실제로 바뀐 슬롯에만 남긴다 — 날짜 수정 건까지 섞이면
  // 재배정 통계(대시보드)가 오염된다.
  for (const c of slotChanges) {
    await logReassignment({
      orderId:    id,
      beforeUser: c.before,
      afterUser:  c.after,
      reason:     trimmedReason,
      changedBy:  editedBy,
    }).catch(() => {})
  }

  // 휴가 겹침 알림 — 새로 들어온 담당자, 그리고 날짜가 바뀌었으면 남은 담당자 전원.
  // 날짜만 바뀌어도(담당자는 그대로) 휴가 경고가 돌아야 한다 — 화면(EditModal)이 담당자
  // 미변경 시에도 "그대로 저장하면 관리자 알림이 남습니다" 라고 약속하기 때문이다.
  const datesChanged = changed.has('packagingDate') || changed.has('dueDate') || changed.has('plannedStartDate')
  const warnTargets = new Map<string, AssigneeSlot>()
  for (const c of slotChanges) if (c.after) warnTargets.set(c.after, c.slot)
  if (datesChanged) for (const a of finalSlots) if (!warnTargets.has(a.testerId)) warnTargets.set(a.testerId, a.slot)
  for (const [testerId, slot] of warnTargets) {
    // 수동 배정은 차단하지 않는다. 휴가·출장과 겹치면 관리자 알림만 남긴다.
    // 날짜도 같은 수정에서 바뀔 수 있으므로 패치 적용 후 값을 기준으로 판정한다.
    await warnIfAssigneeOnLeave({
      orderId: id,
      testerId,
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
      // 알림에서 어느 담당자 배정인지 구분되게 한다 — 병렬 배정 오더는 같은 오더에 알림이 여럿 뜬다.
      via:         slot === PRIMARY_ASSIGNEE_SLOT ? '오더 수정' : `오더 수정(${assigneeSlotLabel(slot)})`,
    })
  }

  if (assignmentError) {
    if (edits.length > 0) {
      throw new Error(`담당자 구성 저장에 실패했습니다: ${assignmentError.message} (다른 수정 사항은 저장되었습니다)`)
    }
    throw assignmentError
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
