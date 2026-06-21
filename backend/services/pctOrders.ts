/**
 * [BACKEND] PCT 오더 조회 / 수정(사유 필수) / 수정이력
 */

import { supabaseAdmin } from '@backend/lib/supabase'

export interface PctOrderRow {
  id: string
  productCode: string
  productName: string
  batchNo: string
  dosageForm: string | null
  packagingDate: string | null
  dueDate: string | null
  isUrgent: boolean
  method: string
  status: string
  assigneeTesterId: string | null
  assigneeName: string | null
  productSynced: boolean
  note: string | null
  ingestState: string
  workdays: number | null   // 품목코드 기준 공수(일, DAY) — product_workload.avg_workdays
  hasJob: boolean           // QC 작업 시작 여부
  locked: boolean           // 관리자 확정/LOCK (원칙1·3). 컬럼 미적용 환경에서는 false
  createdAt: string
  updatedAt: string
}

// 수정 가능 필드 (제조팀 제공이 우선순위이나 사유 작성 시 수정 가능)
const EDITABLE_FIELDS = [
  'packagingDate', 'dueDate', 'isUrgent', 'method', 'status', 'note', 'assigneeTesterId',
] as const
type EditableField = (typeof EDITABLE_FIELDS)[number]

const FIELD_TO_COL: Record<EditableField, string> = {
  packagingDate: 'packaging_date',
  dueDate: 'due_date',
  isUrgent: 'is_urgent',
  method: 'method',
  status: 'status',
  note: 'note',
  assigneeTesterId: 'assignee_tester_id',
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

  if (!filters.includeDeleted) query = query.neq('status', '삭제')
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.assigneeTesterId) query = query.eq('assignee_tester_id', filters.assigneeTesterId)

  const { data, error } = await query
  if (error) throw error
  const orders = (data ?? []) as Record<string, unknown>[]
  if (orders.length === 0) return []

  // 담당자 이름
  const testerIds = [...new Set(orders.map(o => o.assignee_tester_id).filter(Boolean) as string[])]
  const nameByTester = new Map<string, string>()
  if (testerIds.length > 0) {
    const { data: testers } = await supabaseAdmin.from('testers').select('id, name').in('id', testerIds)
    for (const t of testers ?? []) nameByTester.set(t.id as string, t.name as string)
  }

  // 공수: product_code → product_workload.avg_workdays(일, 단일 소스)
  const codes = [...new Set(orders.map(o => o.product_code as string))]
  const workdaysByCode = new Map<string, number>()
  const jobOrderIds = new Set<string>()
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
    packagingDate: (o.packaging_date as string) ?? null,
    dueDate: (o.due_date as string) ?? null,
    isUrgent: !!o.is_urgent,
    method: o.method as string,
    status: o.status as string,
    assigneeTesterId: (o.assignee_tester_id as string) ?? null,
    assigneeName: o.assignee_tester_id ? (nameByTester.get(o.assignee_tester_id as string) ?? null) : null,
    productSynced: !!o.product_synced,
    note: (o.note as string) ?? null,
    ingestState: o.ingest_state as string,
    workdays: workdaysByCode.get(o.product_code as string) ?? null,
    hasJob: jobOrderIds.has(o.id as string),
    locked: !!o.locked,   // select('*') 결과. 컬럼 미적용 시 undefined → false
    createdAt: o.created_at as string,
    updatedAt: o.updated_at as string,
  }))
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
 */
export async function updateOrderWithReason(
  id: string,
  patch: Partial<Record<EditableField, string | boolean | null>>,
  reason: string,
  editedBy: string | null,
): Promise<void> {
  const trimmedReason = (reason ?? '').trim()
  if (!trimmedReason) throw new Error('수정 사유는 필수입니다.')

  // 현재값 로드
  const { data: current, error: curErr } = await supabaseAdmin
    .from('pct_orders')
    .select('packaging_date, due_date, is_urgent, method, status, note, assignee_tester_id')
    .eq('id', id)
    .single()
  if (curErr) throw curErr

  const dbPatch: Record<string, unknown> = {}
  const edits: Array<{ field: string; old_value: string | null; new_value: string | null }> = []

  for (const field of EDITABLE_FIELDS) {
    if (!(field in patch)) continue
    const col = FIELD_TO_COL[field]
    const newVal = patch[field] ?? null
    const oldVal = (current as Record<string, unknown>)[col] ?? null
    const oldStr = oldVal === null ? null : String(oldVal)
    const newStr = newVal === null ? null : String(newVal)
    if (oldStr === newStr) continue
    dbPatch[col] = newVal
    edits.push({ field, old_value: oldStr, new_value: newStr })
  }

  if (edits.length === 0) return  // 변경 없음

  const { error: updErr } = await supabaseAdmin.from('pct_orders').update(dbPatch).eq('id', id)
  if (updErr) throw updErr

  const { error: logErr } = await supabaseAdmin.from('pct_order_edits').insert(
    edits.map(e => ({ order_id: id, field: e.field, old_value: e.old_value, new_value: e.new_value, reason: trimmedReason, edited_by: editedBy })),
  )
  if (logErr) throw logErr
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
