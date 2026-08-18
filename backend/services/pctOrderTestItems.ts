/**
 * [BACKEND] 오더별 선택 시험항목 (pct_order_test_items)
 *
 * 진행방법이 '개별항목'인 오더에서 고른 항목만 담는다.
 * '전항목' 오더는 행을 만들지 않고, 작업 시작 시 품목의 전체 시험항목을 쓴다.
 *
 * 저장 시 test_item_name 을 함께 넣는 이유는 qc_job_items 와 같다 —
 * 시험항목 마스터가 바뀌어도 그 오더에 무엇을 배정했는지는 보존되어야 한다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'

export const METHOD_ALL = '전항목'
export const METHOD_PARTIAL = '개별항목'

export interface OrderTestItemInput {
  testItemId?: string | null
  testItemName: string
  sequenceOrder?: number
}

export interface OrderTestItemRow {
  testItemId: string | null
  testItemName: string
  sequenceOrder: number
}

function mapRow(r: Record<string, unknown>): OrderTestItemRow {
  return {
    testItemId: (r.test_item_id as string) ?? null,
    testItemName: r.test_item_name as string,
    sequenceOrder: (r.sequence_order as number) ?? 0,
  }
}

/** 오더에 배정된 항목 목록 (순번 오름차순) */
export async function listByOrder(orderId: string): Promise<OrderTestItemRow[]> {
  const { data, error } = await supabaseAdmin
    .from('pct_order_test_items')
    .select('test_item_id, test_item_name, sequence_order')
    .eq('order_id', orderId)
    .order('sequence_order', { ascending: true })
  if (error) throw error
  return (data ?? []).map(r => mapRow(r as Record<string, unknown>))
}

/** 여러 오더의 항목을 한 번에 (orderId → 항목명 배열) */
export async function mapByOrders(orderIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>()
  if (orderIds.length === 0) return out
  const { data, error } = await supabaseAdmin
    .from('pct_order_test_items')
    .select('order_id, test_item_name, sequence_order')
    .in('order_id', orderIds)
    .order('sequence_order', { ascending: true })
  if (error) throw error
  for (const r of data ?? []) {
    const id = r.order_id as string
    const arr = out.get(id) ?? []
    arr.push(r.test_item_name as string)
    out.set(id, arr)
  }
  return out
}

/**
 * 오더의 선택 항목을 통째로 교체한다.
 * 빈 배열을 주면 전부 지운다(전항목으로 되돌릴 때).
 * 이름 기준 중복은 제거하고, 준 순서를 순번으로 삼는다.
 */
export async function replaceForOrder(orderId: string, items: OrderTestItemInput[]): Promise<void> {
  const { error: delErr } = await supabaseAdmin
    .from('pct_order_test_items')
    .delete()
    .eq('order_id', orderId)
  if (delErr) throw delErr
  if (items.length === 0) return

  const seen = new Set<string>()
  const rows: Record<string, unknown>[] = []
  items.forEach((it, idx) => {
    const name = (it.testItemName ?? '').trim()
    if (!name || seen.has(name)) return
    seen.add(name)
    rows.push({
      order_id: orderId,
      test_item_id: it.testItemId || null,
      test_item_name: name,
      sequence_order: it.sequenceOrder ?? idx,
    })
  })
  if (rows.length === 0) return

  const { error } = await supabaseAdmin.from('pct_order_test_items').insert(rows)
  if (error) throw error
}

/**
 * 진행방법에 따라 저장할 항목을 정리한다.
 * - 개별항목: 최소 1개 필요. 없으면 무엇을 배정할지 알 수 없어 오더가 의미를 잃는다.
 * - 전항목  : 선택 목록을 저장하지 않는다(품목 마스터를 그대로 따른다).
 */
export function normalizeForMethod(
  method: string | undefined,
  items: OrderTestItemInput[] | undefined,
): OrderTestItemInput[] {
  if (method !== METHOD_PARTIAL) return []
  const list = (items ?? []).filter(i => (i.testItemName ?? '').trim())
  if (list.length === 0) {
    throw new Error('진행방법이 「개별항목」이면 시험항목을 1개 이상 선택해야 합니다.')
  }
  return list
}
