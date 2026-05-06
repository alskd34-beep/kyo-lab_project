/**
 * [BACKEND] Tests 서비스 - Supabase에서 시험 목록을 조회합니다.
 */

import { supabase } from '@backend/lib/supabase'
import type { TestRow, StatusKey } from '@shared/qc'

interface TestsQuery {
  from?: string          // YYYY-MM-DD
  to?: string            // YYYY-MM-DD
  search?: string
  status?: StatusKey
  deviationOnly?: boolean
}

interface DbTestRow {
  id: string
  test_no: string
  category: string
  type: string
  product: string
  items: string
  receive_date: string
  due_date: string | null
  status: StatusKey
  contractors: { name: string } | null
  managers: { name: string; initial: string } | null
}

export async function listTests(q: TestsQuery = {}): Promise<TestRow[]> {
  let query = supabase
    .from('tests')
    .select(`
      id, test_no, category, type, product, items,
      receive_date, due_date, status,
      contractors ( name ),
      managers   ( name, initial )
    `)
    .order('receive_date', { ascending: false })

  if (q.from)           query = query.gte('receive_date', q.from)
  if (q.to)             query = query.lte('receive_date', q.to)
  if (q.status)         query = query.eq('status', q.status)
  if (q.deviationOnly)  query = query.eq('is_deviation', true)
  if (q.search) {
    query = query.or(
      `product.ilike.%${q.search}%,test_no.ilike.%${q.search}%`,
    )
  }

  const { data, error } = await query
  if (error) throw error

  const rows = (data ?? []) as unknown as DbTestRow[]

  return rows.map((r, i) => ({
    id:           i + 1,
    category:     r.category,
    type:         r.type,
    product:      r.product,
    testNo:       r.test_no,
    items:        r.items,
    contractor:   r.contractors?.name    ?? '',
    manager:      r.managers?.name       ?? '',
    managerInit:  r.managers?.initial    ?? '',
    receiveDate:  r.receive_date.replaceAll('-', '.'),
    dueDate:      (r.due_date ?? '').replaceAll('-', '.'),
    status:       r.status,
  }))
}
