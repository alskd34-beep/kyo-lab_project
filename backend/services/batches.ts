import { supabase } from '@backend/lib/supabase'
import type { BatchSummary, DashboardStats } from '@shared/pqm'

function calcDday(dateStr: string | null): number | null {
  if (!dateStr) return null
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
}

export async function listBatches(q: {
  status?: string; from?: string; to?: string; search?: string
} = {}): Promise<BatchSummary[]> {
  let query = supabase.from('production_batches').select('*').order('qc_completion_deadline')
  if (q.status && q.status !== 'all') query = query.eq('status', q.status)
  if (q.from) query = query.gte('packaging_date', q.from)
  if (q.to)   query = query.lte('packaging_date', q.to)
  if (q.search) query = query.or(`product_name.ilike.%${q.search}%,batch_no.ilike.%${q.search}%,product_code.ilike.%${q.search}%`)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(r => ({
    ...(r as any),
    dDayRecord: calcDday(r.record_review_deadline),
    dDayQc: calcDday(r.qc_completion_deadline),
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
    ...(data as any),
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
