/**
 * [BACKEND] 재배정 이력 (reassignment_history)
 *
 * 시험자(담당자) 재배정 이력을 적재/조회한다. 관리자 분석용:
 *  - 누가(어떤 시험자가) 자주 (재)배정되는가  → byTester
 *  - 어떤 품목에서 재배정이 잦은가            → byProduct
 *  - 왜 변경되는가                            → reason
 *
 * 조인은 supabase embed 대신, 관련 테이블을 각각 조회해 Map 으로 매핑한다
 * (operatorSchedule.testersOnLeave / pctOrders.listOrders 패턴과 동일).
 *
 * 다른 서비스가 logReassignment() 를 import 해서 재배정 시점에 호출한다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { selectAll } from '@backend/lib/supabasePage'

export interface ReassignmentRow {
  id: string
  groupId: string | null
  orderId: string | null
  productName: string | null
  beforeUser: string | null
  beforeUserName: string | null
  afterUser: string | null
  afterUserName: string | null
  reason: string | null
  changedBy: string | null
  changedByName: string | null
  changedAt: string
}

export interface LogReassignmentInput {
  orderId?: string | null
  groupId?: string | null
  beforeUser: string | null
  afterUser: string | null
  reason?: string | null
  changedBy?: string | null
}

/**
 * 재배정 이력 1건 적재.
 * 재배정을 수행하는 다른 서비스에서 호출하기 위한 진입점이므로 시그니처를 고정한다.
 */
export async function logReassignment(input: LogReassignmentInput): Promise<void> {
  const { error } = await supabaseAdmin
    .from('reassignment_history')
    .insert({
      order_id:    input.orderId ?? null,
      group_id:    input.groupId ?? null,
      before_user: input.beforeUser,
      after_user:  input.afterUser,
      reason:      input.reason ?? null,
      changed_by:  input.changedBy ?? null,
    })
  if (error) throw error
}

/**
 * 이력 목록. changed_at desc.
 * @param opts.afterUser    after_user(변경 후 시험자) 필터.
 * @param opts.productName  품목명 부분검색(조회된 행을 JS 에서 필터).
 * @param opts.limit        최대 행수(기본 200).
 */
export async function listReassignments(opts: {
  afterUser?: string
  productName?: string
  limit?: number
} = {}): Promise<ReassignmentRow[]> {
  let query = supabaseAdmin
    .from('reassignment_history')
    .select('id, group_id, order_id, before_user, after_user, reason, changed_by, changed_at')
    .order('changed_at', { ascending: false })
    .limit(opts.limit ?? 200)

  if (opts.afterUser) query = query.eq('after_user', opts.afterUser)

  const { data, error } = await query
  if (error) throw error
  const raw = (data ?? []) as Record<string, unknown>[]
  if (raw.length === 0) return []

  const { productNameByOrder, nameByTester, nameByUser } = await loadLookups(raw)

  let rows = raw.map(r => mapRow(r, productNameByOrder, nameByTester, nameByUser))

  if (opts.productName) {
    const needle = opts.productName.trim().toLowerCase()
    rows = rows.filter(r => (r.productName ?? '').toLowerCase().includes(needle))
  }
  return rows
}

/**
 * 통계 집계. supabaseAdmin 로 행을 가져와 JS 에서 카운트.
 *  - byTester:  after_user(변경 후 시험자) 별 재배정 횟수 상위 N.
 *  - byProduct: product_name 별 재배정 횟수 상위 N.
 */
export async function reassignmentStats(topN = 10): Promise<{
  byTester: { name: string; count: number }[]
  byProduct: { name: string; count: number }[]
}> {
  // 누적 테이블이라 1000행 기본 limit 에 잘리면 통계가 조용히 축소된다 → selectAll
  const { data, error } = await selectAll(supabaseAdmin, 'reassignment_history', 'order_id, after_user')
  if (error) throw new Error(error.message)
  const raw = (data ?? []) as Record<string, unknown>[]
  if (raw.length === 0) return { byTester: [], byProduct: [] }

  const { productNameByOrder, nameByTester } = await loadLookups(raw)

  const testerCounts = new Map<string, number>()
  const productCounts = new Map<string, number>()
  for (const r of raw) {
    const afterUser = r.after_user as string | null
    if (afterUser) {
      const name = nameByTester.get(afterUser) ?? afterUser
      testerCounts.set(name, (testerCounts.get(name) ?? 0) + 1)
    }
    const orderId = r.order_id as string | null
    const product = orderId ? productNameByOrder.get(orderId) : null
    if (product) productCounts.set(product, (productCounts.get(product) ?? 0) + 1)
  }

  const toSorted = (m: Map<string, number>) =>
    [...m.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, topN)

  return { byTester: toSorted(testerCounts), byProduct: toSorted(productCounts) }
}

// ─── 내부: 조인용 룩업 로드 ─────────────────────────────────────────────────────
async function loadLookups(raw: Record<string, unknown>[]): Promise<{
  productNameByOrder: Map<string, string>
  nameByTester: Map<string, string>
  nameByUser: Map<string, string>
}> {
  const orderIds = [...new Set(raw.map(r => r.order_id).filter(Boolean) as string[])]
  const testerIds = [...new Set(
    raw.flatMap(r => [r.before_user, r.after_user]).filter(Boolean) as string[],
  )]
  const userIds = [...new Set(raw.map(r => r.changed_by).filter(Boolean) as string[])]

  const productNameByOrder = new Map<string, string>()
  const nameByTester = new Map<string, string>()
  const nameByUser = new Map<string, string>()

  if (orderIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('pct_orders')
      .select('id, product_name')
      .in('id', orderIds)
    for (const o of data ?? []) productNameByOrder.set(o.id as string, o.product_name as string)
  }
  if (testerIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('testers')
      .select('id, name')
      .in('id', testerIds)
    for (const t of data ?? []) nameByTester.set(t.id as string, t.name as string)
  }
  if (userIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('users')
      .select('id, username, display_name')
      .in('id', userIds)
    for (const u of data ?? []) {
      const name = (u.display_name as string) ?? (u.username as string) ?? null
      if (name) nameByUser.set(u.id as string, name)
    }
  }
  return { productNameByOrder, nameByTester, nameByUser }
}

function mapRow(
  r: Record<string, unknown>,
  productNameByOrder: Map<string, string>,
  nameByTester: Map<string, string>,
  nameByUser: Map<string, string>,
): ReassignmentRow {
  const orderId = (r.order_id as string) ?? null
  const beforeUser = (r.before_user as string) ?? null
  const afterUser = (r.after_user as string) ?? null
  const changedBy = (r.changed_by as string) ?? null
  return {
    id:             r.id as string,
    groupId:        (r.group_id as string) ?? null,
    orderId,
    productName:    orderId ? (productNameByOrder.get(orderId) ?? null) : null,
    beforeUser,
    beforeUserName: beforeUser ? (nameByTester.get(beforeUser) ?? null) : null,
    afterUser,
    afterUserName:  afterUser ? (nameByTester.get(afterUser) ?? null) : null,
    reason:         (r.reason as string) ?? null,
    changedBy,
    changedByName:  changedBy ? (nameByUser.get(changedBy) ?? null) : null,
    changedAt:      r.changed_at as string,
  }
}
