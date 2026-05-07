import { supabase } from '@backend/lib/supabase'
import type { BatchStatus, BatchSummary, AssignmentStatus } from '@shared/pqm'

interface BatchesQuery {
  status?: BatchStatus
  from?: string
  to?: string
  search?: string
  productId?: string
}

export interface CreateBatchInput {
  productId: string
  spec?: string
  batchNo: string
  dosageFormId?: string
  packagingPlannedDate?: string
  recordReviewDeadline?: string
  qcPlannedCompletionDate?: string
  status?: BatchStatus
}

interface DbBatch {
  id: string
  product_id: string
  spec: string | null
  batch_no: string
  dosage_form_id: string | null
  packaging_planned_date: string | null
  record_review_deadline: string | null
  qc_planned_completion_date: string | null
  qc_actual_completion_date: string | null
  status: BatchStatus
  notes: string | null
  created_at: string
  updated_at: string
  products: {
    product_code: string
    name: string
  } | null
  dosage_forms: {
    name: string
  } | null
}

interface DbAssignment {
  id: string
  batch_id: string
  test_item_id: string
  primary_tester_id: string | null
  secondary_tester_id: string | null
  status: AssignmentStatus
  result: string | null
  scheduled_start_at: string | null
  scheduled_end_at: string | null
  estimated_hours: number | null
  test_items: {
    name: string
  } | null
}

function calcDDay(dateStr: string | null): number | null {
  if (!dateStr) return null
  const deadline = new Date(dateStr).getTime()
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return Math.ceil((deadline - today.getTime()) / 86400000)
}

function toBatchSummary(r: DbBatch, assignments: DbAssignment[]): BatchSummary {
  const total = assignments.length
  const inProgress = assignments.filter(a => a.status === 'IN_PROGRESS').length
  const completed = assignments.filter(a => a.status === 'COMPLETED').length
  const progress = total > 0 ? completed / total : 0

  return {
    id:                        r.id,
    batch_no:                  r.batch_no,
    product_id:                r.product_id,
    product_code:              r.products?.product_code ?? '',
    product_name:              r.products?.name ?? '',
    spec:                      r.spec,
    dosage_form_name:          r.dosage_forms?.name ?? null,
    packaging_planned_date:    r.packaging_planned_date,
    record_review_deadline:    r.record_review_deadline,
    qc_planned_completion_date: r.qc_planned_completion_date,
    qc_actual_completion_date:  r.qc_actual_completion_date,
    status:                    r.status,
    total_assignments:         total,
    in_progress_count:         inProgress,
    completed_count:           completed,
    d_day:                     calcDDay(r.qc_planned_completion_date),
    progress_ratio:            progress,
  }
}

export async function listBatches(q: BatchesQuery = {}): Promise<BatchSummary[]> {
  let query = supabase
    .from('production_batches')
    .select(`
      id, product_id, spec, batch_no, dosage_form_id,
      packaging_planned_date, record_review_deadline,
      qc_planned_completion_date, qc_actual_completion_date,
      status, notes, created_at, updated_at,
      products ( product_code, name ),
      dosage_forms ( name )
    `)
    .order('created_at', { ascending: false })

  if (q.status)    query = query.eq('status', q.status)
  if (q.productId) query = query.eq('product_id', q.productId)
  if (q.from)      query = query.gte('packaging_planned_date', q.from)
  if (q.to)        query = query.lte('packaging_planned_date', q.to)
  if (q.search) {
    query = query.or(
      `batch_no.ilike.%${q.search}%,spec.ilike.%${q.search}%`,
    )
  }

  const { data, error } = await query
  if (error) throw error

  const batches = (data ?? []) as unknown as DbBatch[]

  if (batches.length === 0) return []

  const batchIds = batches.map(b => b.id)
  const { data: assignData, error: assignError } = await supabase
    .from('batch_test_assignments')
    .select('id, batch_id, status')
    .in('batch_id', batchIds)

  if (assignError) throw assignError

  const assignmentsByBatch = new Map<string, DbAssignment[]>()
  for (const a of (assignData ?? []) as unknown as DbAssignment[]) {
    const list = assignmentsByBatch.get(a.batch_id) ?? []
    list.push(a)
    assignmentsByBatch.set(a.batch_id, list)
  }

  return batches.map(b => toBatchSummary(b, assignmentsByBatch.get(b.id) ?? []))
}

export interface BatchDetail extends BatchSummary {
  assignments: AssignmentDetail[]
}

export interface AssignmentDetail {
  id: string
  batchId: string
  testItemId: string
  testItemName: string
  primaryTesterId: string | null
  secondaryTesterId: string | null
  status: AssignmentStatus
  result: string | null
  scheduledStartAt: string | null
  scheduledEndAt: string | null
  estimatedHours: number | null
}

export async function getBatch(id: string): Promise<BatchDetail> {
  const { data: batchData, error: batchError } = await supabase
    .from('production_batches')
    .select(`
      id, product_id, spec, batch_no, dosage_form_id,
      packaging_planned_date, record_review_deadline,
      qc_planned_completion_date, qc_actual_completion_date,
      status, notes, created_at, updated_at,
      products ( product_code, name ),
      dosage_forms ( name )
    `)
    .eq('id', id)
    .single()

  if (batchError) throw batchError

  const { data: assignData, error: assignError } = await supabase
    .from('batch_test_assignments')
    .select(`
      id, batch_id, test_item_id,
      primary_tester_id, secondary_tester_id,
      status, result,
      scheduled_start_at, scheduled_end_at,
      estimated_hours,
      test_items ( name )
    `)
    .eq('batch_id', id)
    .order('test_item_id', { ascending: true })

  if (assignError) throw assignError

  const batch = batchData as unknown as DbBatch
  const rawAssignments = (assignData ?? []) as unknown as DbAssignment[]

  const assignments: AssignmentDetail[] = rawAssignments.map(a => ({
    id:                 a.id,
    batchId:            a.batch_id,
    testItemId:         a.test_item_id,
    testItemName:       a.test_items?.name ?? '',
    primaryTesterId:    a.primary_tester_id,
    secondaryTesterId:  a.secondary_tester_id,
    status:             a.status,
    result:             a.result,
    scheduledStartAt:   a.scheduled_start_at,
    scheduledEndAt:     a.scheduled_end_at,
    estimatedHours:     a.estimated_hours,
  }))

  return {
    ...toBatchSummary(batch, rawAssignments),
    assignments,
  }
}

export async function createBatch(data: CreateBatchInput): Promise<BatchDetail> {
  const { data: batchData, error: batchError } = await supabase
    .from('production_batches')
    .insert({
      product_id:                 data.productId,
      spec:                       data.spec ?? null,
      batch_no:                   data.batchNo,
      dosage_form_id:             data.dosageFormId ?? null,
      packaging_planned_date:     data.packagingPlannedDate ?? null,
      record_review_deadline:     data.recordReviewDeadline ?? null,
      qc_planned_completion_date: data.qcPlannedCompletionDate ?? null,
      status:                     data.status ?? 'PLANNED',
    })
    .select('id')
    .single()

  if (batchError) throw batchError

  const batchId = (batchData as { id: string }).id

  const { data: ptiData, error: ptiError } = await supabase
    .from('product_test_items')
    .select('test_item_id, is_mandatory, sequence_order, test_items ( estimated_hours )')
    .eq('product_id', data.productId)

  if (ptiError) throw ptiError

  if (ptiData && ptiData.length > 0) {
    const assignments = (ptiData as unknown as Array<{
      test_item_id: string
      test_items: { estimated_hours: number | null } | null
    }>).map(pti => ({
      batch_id:        batchId,
      test_item_id:    pti.test_item_id,
      status:          'PLANNED' as AssignmentStatus,
      estimated_hours: pti.test_items?.estimated_hours ?? null,
    }))

    const { error: insertError } = await supabase
      .from('batch_test_assignments')
      .insert(assignments)

    if (insertError) throw insertError
  }

  return getBatch(batchId)
}

export async function updateBatch(
  id: string,
  data: Partial<CreateBatchInput>,
): Promise<BatchDetail> {
  const update: Record<string, unknown> = {}
  if (data.productId              !== undefined) update.product_id                  = data.productId
  if (data.spec                   !== undefined) update.spec                         = data.spec
  if (data.batchNo                !== undefined) update.batch_no                    = data.batchNo
  if (data.dosageFormId           !== undefined) update.dosage_form_id              = data.dosageFormId
  if (data.packagingPlannedDate   !== undefined) update.packaging_planned_date      = data.packagingPlannedDate
  if (data.recordReviewDeadline   !== undefined) update.record_review_deadline      = data.recordReviewDeadline
  if (data.qcPlannedCompletionDate !== undefined) update.qc_planned_completion_date = data.qcPlannedCompletionDate
  if (data.status                 !== undefined) update.status                      = data.status

  const { error } = await supabase
    .from('production_batches')
    .update(update)
    .eq('id', id)

  if (error) throw error

  return getBatch(id)
}

export interface DashboardStats {
  totalBatches: number
  inProgress: number
  completed: number
  urgentCount: number
}

export async function getDashboardStats(): Promise<DashboardStats> {
  const { data, error } = await supabase
    .from('production_batches')
    .select('id, status, qc_planned_completion_date')

  if (error) throw error

  const rows = (data ?? []) as Array<{
    id: string
    status: BatchStatus
    qc_planned_completion_date: string | null
  }>

  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const sevenDaysMs = 7 * 86400000

  let inProgress = 0
  let completed = 0
  let urgentCount = 0

  for (const r of rows) {
    if (r.status === 'IN_PROGRESS') inProgress++
    if (r.status === 'COMPLETED') completed++

    if (r.qc_planned_completion_date && r.status !== 'COMPLETED' && r.status !== 'CANCELLED') {
      const deadline = new Date(r.qc_planned_completion_date).getTime()
      const diff = deadline - today.getTime()
      if (diff >= 0 && diff <= sevenDaysMs) urgentCount++
    }
  }

  return {
    totalBatches: rows.length,
    inProgress,
    completed,
    urgentCount,
  }
}
