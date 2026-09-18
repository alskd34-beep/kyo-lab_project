import { supabaseAdmin as supabase } from '@backend/lib/supabase'
import { selectAll } from '@backend/lib/supabasePage'
import { sanitizeFilterTerm } from '@backend/lib/postgrestFilter'
import type { BatchSummary, DashboardStats } from '@shared/pqm'

function calcDday(dateStr: string | null): number | null {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
}

export async function listBatches(q: {
  status?: string; from?: string; to?: string; search?: string; productId?: string
} = {}): Promise<BatchSummary[]> {
  const hasFilters = !!(q.status && q.status !== 'all') || !!q.productId || !!q.from || !!q.to || !!q.search
  let data: Array<Record<string, unknown>> | null
  let error: { message: string } | null
  if (hasFilters) {
    let query = supabase.from('production_batches').select('*').order('qc_planned_completion_date')
    if (q.status && q.status !== 'all') query = query.eq('status', q.status)
    if (q.productId) query = query.eq('product_id', q.productId)
    if (q.from) query = query.gte('packaging_planned_date', q.from)
    if (q.to)   query = query.lte('packaging_planned_date', q.to)
    // 필터 경로도 기본 1000행 상한을 넘을 수 있다.
    query = query.range(0, 9999)
    // 검색어는 PostgREST 필터 DSL 에 문자열로 삽입되므로 문법 문자를 제거한다(필터 인젝션 방지).
    const search = sanitizeFilterTerm(q.search)
    if (search) query = query.or(`product_name.ilike.%${search}%,batch_no.ilike.%${search}%,product_code.ilike.%${search}%`)
    const result = await query
    data = result.data as Array<Record<string, unknown>> | null
    error = result.error
  } else {
    const result = await selectAll(supabase, 'production_batches', '*', { orderBy: 'id' })
    data = result.data
    error = result.error
  }
  if (error) throw error
  const rows = hasFilters ? (data ?? []) : [...(data ?? [])].sort((a, b) =>
    String(a.qc_planned_completion_date ?? '9999').localeCompare(String(b.qc_planned_completion_date ?? '9999'), 'ko'),
  )
  return rows.map(r => ({
    ...(r as unknown as BatchSummary),
    dDayRecord: calcDday(r.record_review_deadline as string | null),
    dDayQc: calcDday(r.qc_planned_completion_date as string | null),
  }))
}

export async function createBatch(input: {
  productId?: string
  spec?: string
  batchNo: string
  dosageFormId?: string
  packagingPlannedDate?: string
  recordReviewDeadline?: string
  qcPlannedCompletionDate?: string
  status?: string
}): Promise<BatchSummary> {
  const { data, error } = await supabase
    .from('production_batches')
    .insert({
      product_id:                   input.productId,
      spec:                         input.spec,
      batch_no:                     input.batchNo,
      dosage_form_id:               input.dosageFormId,
      packaging_planned_date:       input.packagingPlannedDate,
      record_review_deadline:       input.recordReviewDeadline,
      qc_planned_completion_date:   input.qcPlannedCompletionDate,
      status:                       input.status ?? 'pending',
    })
    .select('*')
    .single()
  if (error) throw error
  return {
    ...(data as unknown as BatchSummary),
    dDayRecord: calcDday(data.record_review_deadline),
    dDayQc:    calcDday(data.qc_planned_completion_date),
  }
}

export async function getBatch(id: string): Promise<BatchSummary> {
  const { data, error } = await supabase
    .from('production_batches')
    .select('*')
    .eq('id', id)
    .single()
  if (error) throw error
  return {
    ...(data as unknown as BatchSummary),
    dDayRecord: calcDday(data.record_review_deadline),
    dDayQc:    calcDday(data.qc_planned_completion_date),
  }
}

export async function updateBatch(id: string, patch: {
  productId?: string
  spec?: string
  batchNo?: string
  dosageFormId?: string
  packagingPlannedDate?: string
  recordReviewDeadline?: string
  qcPlannedCompletionDate?: string
  status?: string
}): Promise<BatchSummary> {
  const fields: Record<string, unknown> = {}
  if (patch.productId !== undefined)               fields.product_id = patch.productId
  if (patch.spec !== undefined)                    fields.spec = patch.spec
  if (patch.batchNo !== undefined)                 fields.batch_no = patch.batchNo
  if (patch.dosageFormId !== undefined)            fields.dosage_form_id = patch.dosageFormId
  if (patch.packagingPlannedDate !== undefined)    fields.packaging_planned_date = patch.packagingPlannedDate
  if (patch.recordReviewDeadline !== undefined)    fields.record_review_deadline = patch.recordReviewDeadline
  if (patch.qcPlannedCompletionDate !== undefined) fields.qc_planned_completion_date = patch.qcPlannedCompletionDate
  if (patch.status !== undefined)                  fields.status = patch.status

  const { data, error } = await supabase
    .from('production_batches')
    .update(fields)
    .eq('id', id)
    .select('*')
    .single()
  if (error) throw error
  return {
    ...(data as unknown as BatchSummary),
    dDayRecord: calcDday(data.record_review_deadline),
    dDayQc:    calcDday(data.qc_planned_completion_date),
  }
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await supabase
    .from('production_batches')
    .select('status, qc_completion_deadline, record_review_deadline')
  if (error) throw error
  const rows = data ?? []
  return {
    totalBatches: rows.length,
    pending: rows.filter(r => r.status === 'pending').length,
    inProgress: rows.filter(r => r.status === 'in_progress').length,
    completed: rows.filter(r => r.status === 'completed').length,
    dueSoon7: rows.filter(r => { const d = calcDday(r.qc_completion_deadline); return d !== null && d >= 0 && d <= 7 }).length,
    dueSoon3: rows.filter(r => { const d = calcDday(r.qc_completion_deadline); return d !== null && d >= 0 && d <= 3 }).length,
    overdueCount: rows.filter(r => { const d = calcDday(r.qc_completion_deadline); return d !== null && d < 0 }).length,
  }
}
