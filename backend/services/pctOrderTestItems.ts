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
import { describeSchemaError } from '@backend/lib/schemaError'

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

// ─────────────────────────────────────────────────────────────────────────────
// 0029 이후: 스냅샷 + 제외 플래그 모델
//
// 이전에는 진행방법이 '개별항목'인 오더에만 행을 만들었다. 이제는 **모든 오더**가
// 품목 기준(product_test_items)의 스냅샷을 갖고, 그 위에서 개별로 빼거나 더한다.
//   - 빼기 : 행을 지우지 않고 is_excluded = true (무엇을 뺐는지 남긴다)
//   - 더하기: source = 'manual' 로 이 오더에만 추가
// 품목 기준을 나중에 바꿔도 이미 만들어진 오더는 흔들리지 않는다(PRD 원칙2).
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderTestItemDetail extends OrderTestItemRow {
  isExcluded: boolean
  excludedReason: string | null
  /** 'product' = 품목 기준 스냅샷 / 'manual' = 이 오더에만 추가 */
  source: 'product' | 'manual'
}

function mapDetail(r: Record<string, unknown>): OrderTestItemDetail {
  return {
    testItemId:     (r.test_item_id as string) ?? null,
    testItemName:   r.test_item_name as string,
    sequenceOrder:  (r.sequence_order as number) ?? 0,
    isExcluded:     r.is_excluded === true,
    excludedReason: (r.excluded_reason as string) ?? null,
    source:         (r.source as 'product' | 'manual') ?? 'product',
  }
}

/** 품목코드로 품목 기준 시험항목을 읽는다 (순번 오름차순) */
export async function productBaseline(productCode: string): Promise<OrderTestItemInput[]> {
  const { data: prod, error: prodErr } = await supabaseAdmin
    .from('products').select('id').eq('product_code', productCode).maybeSingle()
  if (prodErr) throw prodErr
  if (!prod?.id) return []

  const { data, error } = await supabaseAdmin
    .from('product_test_items')
    .select('test_item_id, sequence_order, test_items!inner(name)')
    .eq('product_id', prod.id as string)
    .order('sequence_order', { ascending: true })
  if (error) throw error

  return (data ?? []).map((r, idx) => {
    const row = r as unknown as { test_item_id: string; sequence_order: number; test_items: { name: string } }
    return {
      testItemId:    row.test_item_id,
      testItemName:  row.test_items.name,
      sequenceOrder: row.sequence_order ?? idx,
    }
  })
}

/**
 * 오더에 품목 기준 스냅샷을 깐다. **이미 행이 있으면 아무것도 하지 않는다**(멱등).
 * 오더 생성·적재 직후에 부르며, 기존 오더는 첫 조회 시 지연 생성된다.
 *
 * @returns 새로 깔린 항목 수 (이미 있었으면 0)
 */
export async function ensureSnapshot(orderId: string, productCode: string): Promise<number> {
  const { count, error: cntErr } = await supabaseAdmin
    .from('pct_order_test_items')
    .select('order_id', { count: 'exact', head: true })
    .eq('order_id', orderId)
  if (cntErr) throw describeSchemaError(cntErr, '오더별 시험항목 가감')
  if ((count ?? 0) > 0) return 0

  const base = await productBaseline(productCode)
  if (base.length === 0) return 0

  const { error } = await supabaseAdmin.from('pct_order_test_items').insert(
    base.map((b, idx) => ({
      order_id:       orderId,
      test_item_id:   b.testItemId || null,
      test_item_name: b.testItemName,
      sequence_order: b.sequenceOrder ?? idx,
      is_excluded:    false,
      source:         'product',
    })),
  )
  if (error) throw describeSchemaError(error, '오더별 시험항목 가감')
  return base.length
}

/**
 * 오더의 전체 항목(제외분 포함)을 돌려준다.
 * 행이 하나도 없으면 품목 기준으로 스냅샷을 먼저 깐다(지연 생성).
 */
export async function listOrderDetail(
  orderId: string, productCode: string,
): Promise<OrderTestItemDetail[]> {
  await ensureSnapshot(orderId, productCode)

  const { data, error } = await supabaseAdmin
    .from('pct_order_test_items')
    .select('test_item_id, test_item_name, sequence_order, is_excluded, excluded_reason, source')
    .eq('order_id', orderId)
    .order('sequence_order', { ascending: true })
  if (error) throw describeSchemaError(error, '오더별 시험항목 가감')
  return (data ?? []).map(r => mapDetail(r as Record<string, unknown>))
}

/** 실제 배정될 항목(제외되지 않은 것)만 이름으로 */
export async function activeItemNames(orderId: string, productCode: string): Promise<string[]> {
  const rows = await listOrderDetail(orderId, productCode)
  return rows.filter(r => !r.isExcluded).map(r => r.testItemName)
}

/** 항목 제외/복구 토글 */
export async function setExcluded(
  orderId: string, testItemName: string, excluded: boolean, reason?: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('pct_order_test_items')
    .update({ is_excluded: excluded, excluded_reason: excluded ? (reason?.trim() || null) : null })
    .eq('order_id', orderId)
    .eq('test_item_name', testItemName)
  if (error) throw error
}

/** 이 오더에만 항목을 추가한다(품목 기준은 건드리지 않는다). 이미 있으면 제외만 해제한다. */
export async function addManualItem(
  orderId: string, testItemId: string | null, testItemName: string,
): Promise<void> {
  const name = (testItemName ?? '').trim()
  if (!name) throw new Error('시험항목명은 필수입니다.')

  const { data: exists, error: exErr } = await supabaseAdmin
    .from('pct_order_test_items')
    .select('test_item_name')
    .eq('order_id', orderId)
    .eq('test_item_name', name)
    .maybeSingle()
  if (exErr) throw exErr
  if (exists) return setExcluded(orderId, name, false)

  const { data: maxRow } = await supabaseAdmin
    .from('pct_order_test_items')
    .select('sequence_order')
    .eq('order_id', orderId)
    .order('sequence_order', { ascending: false })
    .limit(1)
    .maybeSingle()
  const nextSeq = ((maxRow?.sequence_order as number) ?? -1) + 1

  const { error } = await supabaseAdmin.from('pct_order_test_items').insert({
    order_id:       orderId,
    test_item_id:   testItemId || null,
    test_item_name: name,
    sequence_order: nextSeq,
    is_excluded:    false,
    source:         'manual',
  })
  if (error) throw error
}

/** 이 오더에만 추가했던 항목을 되돌린다(품목 기준 스냅샷 행은 지우지 않고 제외 처리). */
export async function removeItem(orderId: string, testItemName: string): Promise<void> {
  const { data: row, error: selErr } = await supabaseAdmin
    .from('pct_order_test_items')
    .select('source')
    .eq('order_id', orderId)
    .eq('test_item_name', testItemName)
    .maybeSingle()
  if (selErr) throw selErr
  if (!row) return

  if ((row.source as string) === 'manual') {
    const { error } = await supabaseAdmin
      .from('pct_order_test_items')
      .delete()
      .eq('order_id', orderId)
      .eq('test_item_name', testItemName)
    if (error) throw error
    return
  }
  await setExcluded(orderId, testItemName, true)
}
