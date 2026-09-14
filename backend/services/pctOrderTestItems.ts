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
import { rpcWithDeadlockRetry } from '@backend/lib/rpcRetry'
import { describeSchemaError } from '@backend/lib/schemaError'
import { isAssigneeSlot, PRIMARY_ASSIGNEE_SLOT, type AssigneeSlot } from '@shared/assignment'
import { translateAssignmentRpcError } from '@backend/services/orderAssignees'

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
  /**
   * 병렬 배정 오더에서 이 항목을 맡는 담당자 번호(1~5, pct_order_assignees.slot).
   * 병렬 배정이 아닌 오더는 전부 1(대표)이고 무시된다.
   */
  assigneeSlot: AssigneeSlot
}

function mapDetail(r: Record<string, unknown>): OrderTestItemDetail {
  return {
    testItemId:     (r.test_item_id as string) ?? null,
    testItemName:   r.test_item_name as string,
    sequenceOrder:  (r.sequence_order as number) ?? 0,
    isExcluded:     r.is_excluded === true,
    excludedReason: (r.excluded_reason as string) ?? null,
    source:         (r.source as 'product' | 'manual') ?? 'product',
    assigneeSlot:   toSlot(r.assignee_slot),
  }
}

/** DB 의 assignee_slot 값 → 1~5 (범위 밖·null 은 대표 슬롯 1) */
function toSlot(v: unknown): AssigneeSlot {
  const n = Number(v)
  return isAssigneeSlot(n) ? n : PRIMARY_ASSIGNEE_SLOT
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
      assignee_slot:  1,   // 병렬 배정으로 나누기 전까지는 전부 담당자 1(대표) 몫
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
    .select('test_item_id, test_item_name, sequence_order, is_excluded, excluded_reason, source, assignee_slot')
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
    assignee_slot:  1,   // 새로 추가한 항목은 일단 담당자 1(대표) 몫 — 관리자가 필요하면 옮긴다
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

// ─────────────────────────────────────────────────────────────────────────────
// 병렬 배정(0037 → 0049): 항목별 담당자 슬롯
//
// 담당자는 slot(1~5) 로만 저장한다 — "누가 몇 번 담당자인가"는 pct_order_assignees 가
// 갖고, 여기서는 그 슬롯 번호만 참조한다(사람이 바뀌어도 항목 배분은 그대로 유지).
// 담당자 슬롯이 빠질 때의 항목 되돌림은 DB 함수 set_order_assignees(0049)가 같은 트랜잭션에서 한다.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 항목 하나를 담당자 슬롯(1~5)으로 옮긴다 — 관리자, 작업 시작 전 일괄 배분 전용.
 *
 * 판정(병렬 배정 · LOCK 아님 · 그 오더에 있는 슬롯 · 오더에 작업 0건 · 항목 존재)·쓰기·감사는
 * DB 함수 set_order_test_item_slot(0049)이 **한 트랜잭션**으로 한다. 앱에서 "슬롯 확인 → UPDATE" 로 나누면
 * 그 사이 담당자 삭제(set_order_assignees)가 끼어들어 담당자 행이 없는 슬롯에 항목이 남는다
 * (아무도 시험하지 않는 항목). 함수는 담당자 구성 변경과 같은 순서로 오더 행을 잠가 둘을 직렬화한다.
 *
 * [원칙2] **오더에 작업이 하나라도 있으면 이 경로의 배분 이동은 계속 금지한다.**
 * 체크리스트(qc_job_items)는 startJob 시점의 슬롯 배분으로 굳는 스냅샷이고, 담당자별로
 * 시작 시점이 다르다. 그래서 시작 후에 슬롯만 옮기면 체크리스트들이 어긋난다.
 *   · 이미 시작한 사람 쪽으로 옮기면 → 그 항목은 굳어버린 체크리스트에 없고, 나중에
 *     만들어질 다른 체크리스트에도 없다. **아무도 시험하지 않은 채 오더가 완료된다.**
 *   · 아직 시작 안 한 사람 쪽으로 옮기면 → 이미 굳은 체크리스트에 그대로 남아 있어
 *     두 사람이 같은 항목을 중복 시험한다.
 * 진행 중 이동은 항목별 담당자 변경(F2, reassign_job_item)이 체크리스트까지 함께 옮긴다.
 *
 * ⚠️ 함수가 없을 때(0049 미적용) 비원자 경로로 폴백하지 않는다 — 설치 안내로 거절한다.
 */
export async function setAssigneeSlot(
  orderId: string, testItemName: string, slot: AssigneeSlot, changedBy?: string | null,
): Promise<void> {
  const { error } = await rpcWithDeadlockRetry('set_order_test_item_slot', {
    p_order_id: orderId,
    p_test_item_name: testItemName,
    p_slot: slot,
    p_user_id: changedBy ?? null,
  })
  if (error) throw translateAssignmentRpcError(error)
}

/**
 * 실제 배정될 항목(제외되지 않은 것) 중 특정 슬롯(담당자) 몫만, 순번 오름차순으로.
 * 병렬 배정 오더에서 담당자별 체크리스트를 만들 때 쓴다(qcJobs.startJob).
 */
export async function activeItemsForSlot(
  orderId: string, productCode: string, slot: AssigneeSlot,
): Promise<OrderTestItemDetail[]> {
  const rows = await listOrderDetail(orderId, productCode)
  return rows
    .filter(r => !r.isExcluded && r.assigneeSlot === slot)
    .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
}

/** countActiveBySlot 의 in() 조각 크기·페이지 크기(PostgREST max-rows 1000 이하) */
const COUNT_IN_CHUNK = 150
const COUNT_PAGE = 1000

/**
 * 여러 오더의 슬롯별 유효 항목 수(제외되지 않은 것)를 **한 번에** 센다.
 *
 * qcJobs 의 대기 목록 필터/집계·오더 상태 동기화가 오더·슬롯마다 listOrderDetail 을 따로 부르면
 * N+1 쿼리가 되고, listOrderDetail 은 ensureSnapshot(스냅샷 insert)을 함께 호출해 읽기 경로에
 * 쓰기 부작용이 생긴다. 여기서는 있는 행만 `.in()` 조각·페이지로 끝까지 읽는다(오더당 쿼리 없음).
 *
 * 반환: Map<orderId, Map<slot, 활성 항목 수>>. 행은 있는데 그 슬롯 항목이 없으면 슬롯 키가 없다(= 0).
 * 반환 맵에 orderId 가 없으면 "그 오더는 스냅샷(행)이 아직 없다"는 뜻이다 —
 * 호출부는 이를 "항목 수 미상"으로 보고 안전한 쪽을 택해야 한다.
 */
export async function countActiveBySlot(
  orderIds: string[],
): Promise<Map<string, Map<number, number>>> {
  const out = new Map<string, Map<number, number>>()
  if (orderIds.length === 0) return out
  // 잘림 방지: 오더 id 는 150건씩 나눠(URL 길이) 넣고, 한 조각 안에서도 max-rows(1000)에 잘리지 않게
  // (order_id, test_item_name) 고정 순서로 끝까지 페이지를 넘긴다. 일부 행만 잘리면 뒤쪽 슬롯이 0개로 보여
  // 그 담당자의 시작 대기가 조용히 사라진다(supabasePage.ts 의 선례와 같은 문제).
  const ids = [...new Set(orderIds)]
  for (let i = 0; i < ids.length; i += COUNT_IN_CHUNK) {
    const chunk = ids.slice(i, i + COUNT_IN_CHUNK)
    for (let from = 0; ; from += COUNT_PAGE) {
      const { data, error } = await supabaseAdmin
        .from('pct_order_test_items')
        .select('order_id, assignee_slot, is_excluded')
        .in('order_id', chunk)
        .order('order_id', { ascending: true })
        .order('test_item_name', { ascending: true })
        .range(from, from + COUNT_PAGE - 1)
      if (error) throw error
      const rows = data ?? []
      for (const r of rows) {
        const id = r.order_id as string
        const entry = out.get(id) ?? new Map<number, number>()
        if (!(r.is_excluded === true)) {
          const slot = toSlot(r.assignee_slot)
          entry.set(slot, (entry.get(slot) ?? 0) + 1)
        }
        out.set(id, entry)
      }
      if (rows.length < COUNT_PAGE) break
    }
  }
  return out
}
