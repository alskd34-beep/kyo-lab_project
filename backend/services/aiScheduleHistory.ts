import { supabaseAdmin } from '@backend/lib/supabase'
import { listIngestLog } from '@backend/services/pctOrders'

export type AiScheduleHistoryType = 'edit' | 'reassign' | 'ingest'

export interface AiScheduleHistoryRow {
  id: string
  type: AiScheduleHistoryType
  occurredAt: string
  orderId: string | null
  productName: string | null
  productCode: string | null
  batchNo: string | null
  title: string
  summary: string
  field: string | null
  beforeValue: string | null
  afterValue: string | null
  reason: string | null
  actorId: string | null
  actorName: string | null
  status: string | null
}

export interface AiScheduleHistoryStats {
  total: number
  edits: number
  reassignments: number
  ingests: number
}

const FIELD_LABEL: Record<string, string> = {
  productCode: '품목코드',
  productName: '품목명',
  batchNo: '제조번호',
  dosageForm: '제형',
  packagingDate: '포장일',
  dueDate: '완료예정일',
  isUrgent: '긴급',
  method: '진행방법',
  status: '상태',
  note: '비고',
  assigneeTesterId: '담당자',
}

const INGEST_LABEL: Record<string, string> = {
  new: '자동 적재 신규',
  updated: '자동 적재 변경',
  deleted: '자동 적재 삭제',
  blocked: '자동 적재 차단',
}

function displayEditValue(field: string, value: string | null, testerNames: Map<string, string>): string | null {
  if (value == null || value === '') return null
  if (field === 'assigneeTesterId') return testerNames.get(value) ?? value
  if (field === 'isUrgent') return value === 'true' ? '긴급' : '일반'
  return value
}

async function loadOrderLookup(orderIds: string[]): Promise<Map<string, { productName: string | null; productCode: string | null; batchNo: string | null }>> {
  const map = new Map<string, { productName: string | null; productCode: string | null; batchNo: string | null }>()
  if (orderIds.length === 0) return map

  const { data } = await supabaseAdmin
    .from('pct_orders')
    .select('id, product_name, product_code, batch_no')
    .in('id', orderIds)

  for (const row of data ?? []) {
    map.set(row.id as string, {
      productName: (row.product_name as string) ?? null,
      productCode: (row.product_code as string) ?? null,
      batchNo:     (row.batch_no as string) ?? null,
    })
  }
  return map
}

async function loadUserNames(userIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (userIds.length === 0) return map

  const { data } = await supabaseAdmin
    .from('users')
    .select('id, username, display_name')
    .in('id', userIds)

  for (const row of data ?? []) {
    const name = (row.display_name as string) || (row.username as string) || ''
    if (name) map.set(row.id as string, name)
  }
  return map
}

async function loadTesterNames(testerIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  if (testerIds.length === 0) return map

  const { data } = await supabaseAdmin
    .from('testers')
    .select('id, name')
    .in('id', testerIds)

  for (const row of data ?? []) map.set(row.id as string, row.name as string)
  return map
}

export async function listAiScheduleHistory(limit = 800): Promise<{ rows: AiScheduleHistoryRow[]; stats: AiScheduleHistoryStats }> {
  const perSourceLimit = Math.max(100, Math.min(limit, 1000))

  const [editRes, reassignRes, ingestRows] = await Promise.all([
    supabaseAdmin
      .from('pct_order_edits')
      .select('id, order_id, field, old_value, new_value, reason, edited_by, edited_at')
      .order('edited_at', { ascending: false })
      .limit(perSourceLimit),
    supabaseAdmin
      .from('reassignment_history')
      .select('id, order_id, group_id, before_user, after_user, reason, changed_by, changed_at')
      .order('changed_at', { ascending: false })
      .limit(perSourceLimit),
    listIngestLog(perSourceLimit),
  ])

  if (editRes.error) throw editRes.error
  if (reassignRes.error) throw reassignRes.error

  const editRaw = (editRes.data ?? []) as Record<string, unknown>[]
  const reassignRaw = (reassignRes.data ?? []) as Record<string, unknown>[]

  const orderIds = Array.from(new Set([
    ...editRaw.map(row => row.order_id as string | null),
    ...reassignRaw.map(row => row.order_id as string | null),
  ].filter(Boolean) as string[]))
  const actorIds = Array.from(new Set([
    ...editRaw.map(row => row.edited_by as string | null),
    ...reassignRaw.map(row => row.changed_by as string | null),
  ].filter(Boolean) as string[]))
  const testerIds = Array.from(new Set([
    ...editRaw.flatMap(row => row.field === 'assigneeTesterId' ? [row.old_value, row.new_value] : []),
    ...reassignRaw.flatMap(row => [row.before_user, row.after_user]),
  ].filter(Boolean) as string[]))

  const [orders, users, testers] = await Promise.all([
    loadOrderLookup(orderIds),
    loadUserNames(actorIds),
    loadTesterNames(testerIds),
  ])

  const editRows: AiScheduleHistoryRow[] = editRaw.map(row => {
    const orderId = (row.order_id as string) ?? null
    const order = orderId ? orders.get(orderId) : null
    const field = row.field as string
    const beforeValue = displayEditValue(field, (row.old_value as string) ?? null, testers)
    const afterValue = displayEditValue(field, (row.new_value as string) ?? null, testers)
    return {
      id: `edit:${row.id as string}`,
      type: 'edit',
      occurredAt: row.edited_at as string,
      orderId,
      productName: order?.productName ?? null,
      productCode: order?.productCode ?? null,
      batchNo: order?.batchNo ?? null,
      title: `${FIELD_LABEL[field] ?? field} 수정`,
      summary: `${beforeValue ?? '(없음)'} → ${afterValue ?? '(없음)'}`,
      field,
      beforeValue,
      afterValue,
      reason: (row.reason as string) ?? null,
      actorId: (row.edited_by as string) ?? null,
      actorName: row.edited_by ? (users.get(row.edited_by as string) ?? null) : null,
      status: null,
    }
  })

  const reassignRows: AiScheduleHistoryRow[] = reassignRaw.map(row => {
    const orderId = (row.order_id as string) ?? null
    const order = orderId ? orders.get(orderId) : null
    const beforeId = (row.before_user as string) ?? null
    const afterId = (row.after_user as string) ?? null
    const beforeName = beforeId ? (testers.get(beforeId) ?? beforeId) : '미배정'
    const afterName = afterId ? (testers.get(afterId) ?? afterId) : '미배정'
    return {
      id: `reassign:${row.id as string}`,
      type: 'reassign',
      occurredAt: row.changed_at as string,
      orderId,
      productName: order?.productName ?? null,
      productCode: order?.productCode ?? null,
      batchNo: order?.batchNo ?? null,
      title: '담당자 배정 변경',
      summary: `${beforeName} → ${afterName}`,
      field: 'assigneeTesterId',
      beforeValue: beforeName,
      afterValue: afterName,
      reason: (row.reason as string) ?? null,
      actorId: (row.changed_by as string) ?? null,
      actorName: row.changed_by ? (users.get(row.changed_by as string) ?? null) : null,
      status: null,
    }
  })

  const ingestHistoryRows: AiScheduleHistoryRow[] = ingestRows.map(row => ({
    id: `ingest:${row.id}`,
    type: 'ingest',
    occurredAt: row.runAt,
    orderId: null,
    productName: row.productName,
    productCode: row.productCode,
    batchNo: row.batchNo,
    title: INGEST_LABEL[row.changeType] ?? `자동 적재 ${row.changeType}`,
    summary: `${row.batchNo || '-'} · ${row.productCode || '-'}${row.status ? ` · ${row.status}` : ''}`,
    field: null,
    beforeValue: null,
    afterValue: null,
    reason: row.fileId ? `fileId: ${row.fileId}` : null,
    actorId: null,
    actorName: '시스템',
    status: row.status,
  }))

  const rows = [...editRows, ...reassignRows, ...ingestHistoryRows]
    .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))
    .slice(0, limit)

  return {
    rows,
    stats: {
      total: rows.length,
      edits: editRows.length,
      reassignments: reassignRows.length,
      ingests: ingestHistoryRows.length,
    },
  }
}
