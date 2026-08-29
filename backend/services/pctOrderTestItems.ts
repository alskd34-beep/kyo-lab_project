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
  /**
   * 2인 배정 오더에서 이 항목을 누가 맡는지 — 1=담당자1(assignee_tester_id),
   * 2=담당자2(assignee_tester_id_2). 2인 배정이 아닌 오더는 전부 1이고 무시된다.
   */
  assigneeSlot: 1 | 2
}

function mapDetail(r: Record<string, unknown>): OrderTestItemDetail {
  return {
    testItemId:     (r.test_item_id as string) ?? null,
    testItemName:   r.test_item_name as string,
    sequenceOrder:  (r.sequence_order as number) ?? 0,
    isExcluded:     r.is_excluded === true,
    excludedReason: (r.excluded_reason as string) ?? null,
    source:         (r.source as 'product' | 'manual') ?? 'product',
    assigneeSlot:   ((r.assignee_slot as number) === 2 ? 2 : 1),
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
      assignee_slot:  1,   // 2인 배정을 켜기 전까지는 전부 담당자1 몫
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
    assignee_slot:  1,   // 새로 추가한 항목은 일단 담당자1 몫 — 관리자가 필요하면 옮긴다
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
// 2인 배정(0037): 항목별 담당자 슬롯
//
// 담당자는 slot(1|2) 로만 저장한다 — "누가 담당자1/2인가"는 pct_orders 행 하나가
// 갖고, 여기서는 그 슬롯 번호만 참조한다(사람이 바뀌어도 항목 배분은 그대로 유지).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 항목 하나를 담당자1/2 슬롯으로 옮긴다.
 *
 * [원칙2] **작업이 하나라도 시작됐으면 배분을 잠근다.**
 * 체크리스트(qc_job_items)는 startJob 시점의 슬롯 배분으로 굳는 스냅샷이고, 담당자별로
 * 시작 시점이 다르다. 그래서 시작 후에 슬롯을 옮기면 두 체크리스트가 어긋난다.
 *   · 이미 시작한 사람 쪽으로 옮기면 → 그 항목은 굳어버린 체크리스트에 없고, 나중에
 *     만들어질 상대 체크리스트에도 없다. **아무도 시험하지 않은 채 오더가 완료된다.**
 *   · 아직 시작 안 한 사람 쪽으로 옮기면 → 이미 굳은 체크리스트에 그대로 남아 있어
 *     두 사람이 같은 항목을 중복 시험한다.
 * 이미 클리어된 항목과 소요시간까지 건드려야 해서 사후 재동기화는 안전하지 않다.
 * 배분은 작업 시작 전에 확정한다는 규칙으로 못 박는 편이 데이터가 어긋나는 것보다 낫다.
 */
export async function setAssigneeSlot(
  orderId: string, testItemName: string, slot: 1 | 2, changedBy?: string | null,
): Promise<void> {
  const { count, error: cntErr } = await supabaseAdmin
    .from('qc_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('order_id', orderId)
  if (cntErr) throw cntErr
  if ((count ?? 0) > 0) {
    throw new Error(
      '이미 작업이 시작된 오더는 항목별 담당자를 바꿀 수 없습니다. 담당자 배분은 작업 시작 전에 확정해야 합니다.',
    )
  }

  // 바꾸기 전 값을 읽어둔다 — 감사 이력에 "무엇에서 무엇으로" 를 남기려면 필요하다.
  const { data: beforeRow } = await supabaseAdmin
    .from('pct_order_test_items')
    .select('assignee_slot')
    .eq('order_id', orderId)
    .eq('test_item_name', testItemName)
    .maybeSingle()
  const beforeSlot = (beforeRow?.assignee_slot as number) === 2 ? 2 : 1
  if (beforeSlot === slot) return   // 바뀐 게 없으면 이력도 남기지 않는다

  const { error } = await supabaseAdmin
    .from('pct_order_test_items')
    .update({ assignee_slot: slot })
    .eq('order_id', orderId)
    .eq('test_item_name', testItemName)
  if (error) throw error

  await logSlotEdit(orderId, testItemName, slotLabel(beforeSlot), slotLabel(slot), changedBy)
}

/** 감사 이력에 쓸 슬롯 표기 */
function slotLabel(slot: number): string {
  return slot === 2 ? '담당자2' : '담당자1'
}

/**
 * [GMP/ALCOA+] 항목별 담당자 변경을 pct_order_edits 에 남긴다.
 *
 * "이 시험항목을 누가 수행하는가" 는 나중에 반드시 추적 대상이 되는 정보다. 이 저장소는
 * 항목 제외에도 사유를 남기는데, 슬롯 이동만 아무 흔적 없이 지나가면 "왜 이 항목을 B 가
 * 시험했나" 에 답할 수 없다.
 *
 * 이력 적재 실패가 이미 반영된 배분을 되돌리지는 않는다 — 되돌리려다 실패하면 상태가 더
 * 나빠진다. 대신 서버 로그에 남겨 수동 확인이 가능하게 한다.
 * (오더 수정(updateOrderWithReason)은 "이력 먼저, 값 나중" 이지만 여기는 즉시 반영 UI 라
 *  사유 입력 단계가 없다. 이 차이를 감안한 의도적 선택이다.)
 */
async function logSlotEdit(
  orderId: string, testItemName: string,
  oldLabel: string | null, newLabel: string | null, changedBy?: string | null,
): Promise<void> {
  const { error } = await supabaseAdmin.from('pct_order_edits').insert({
    order_id:  orderId,
    field:     'testItemAssignee',
    old_value: oldLabel === null ? null : `${testItemName}: ${oldLabel}`,
    new_value: newLabel === null ? null : `${testItemName}: ${newLabel}`,
    reason:    '항목별 담당자 배분 변경',
    edited_by: changedBy ?? null,
  })
  if (error) {
    console.error('[pctOrderTestItems] 슬롯 변경 이력 기록 실패 — 배분은 반영됨:', orderId, testItemName, error)
  }
}

/**
 * 2인 배정을 해제할 때 — 그 오더의 모든 항목을 담당자1 슬롯으로 되돌린다.
 * 되돌린 항목이 있으면 감사 이력에 한 줄로 남긴다(항목마다 남기면 이력이 수십 줄로 불어난다).
 */
export async function resetAssigneeSlots(orderId: string, changedBy?: string | null): Promise<void> {
  // 되돌리기 전에 몇 건이 담당자2 몫이었는지 세어 둔다 — 이력 문구에 쓴다.
  const { count: movedCount } = await supabaseAdmin
    .from('pct_order_test_items')
    .select('order_id', { count: 'exact', head: true })
    .eq('order_id', orderId)
    .eq('assignee_slot', 2)

  const { error } = await supabaseAdmin
    .from('pct_order_test_items')
    .update({ assignee_slot: 1 })
    .eq('order_id', orderId)
  if (error) throw error

  if ((movedCount ?? 0) > 0) {
    await logSlotEdit(
      orderId, `${movedCount}개 항목`, '담당자2', '담당자1 (2인 배정 해제)', changedBy,
    )
  }
}

/**
 * 실제 배정될 항목(제외되지 않은 것) 중 특정 슬롯(담당자) 몫만, 순번 오름차순으로.
 * 2인 배정 오더에서 담당자별 체크리스트를 만들 때 쓴다(qcJobs.startJob).
 */
export async function activeItemsForSlot(
  orderId: string, productCode: string, slot: 1 | 2,
): Promise<OrderTestItemDetail[]> {
  const rows = await listOrderDetail(orderId, productCode)
  return rows
    .filter(r => !r.isExcluded && r.assigneeSlot === slot)
    .sort((a, b) => a.sequenceOrder - b.sequenceOrder)
}

/**
 * 여러 오더의 슬롯별 유효 항목 수(제외되지 않은 것)를 **한 번에** 센다.
 *
 * qcJobs 의 대기 목록 필터/집계가 오더마다 listOrderDetail 을 따로 부르면 N+1 쿼리가 되고,
 * listOrderDetail 은 ensureSnapshot(스냅샷 insert)을 함께 호출해 "대기 목록 조회"라는
 * 읽기 전용 경로에 쓰기 부작용이 생긴다. 여기서는 있는 행만 `.in()` 한 번으로 읽는다.
 *
 * 반환 맵에 orderId 가 없으면 "그 오더는 스냅샷(행)이 아직 없다"는 뜻이다 —
 * 호출부는 이를 "항목 수 미상"으로 보고 안전한 쪽(대기에 남김)을 택해야 한다.
 */
export async function countActiveBySlot(
  orderIds: string[],
): Promise<Map<string, { slot1: number; slot2: number }>> {
  const out = new Map<string, { slot1: number; slot2: number }>()
  if (orderIds.length === 0) return out
  const { data, error } = await supabaseAdmin
    .from('pct_order_test_items')
    .select('order_id, assignee_slot, is_excluded')
    .in('order_id', orderIds)
  if (error) throw error
  for (const r of data ?? []) {
    const id = r.order_id as string
    const entry = out.get(id) ?? { slot1: 0, slot2: 0 }
    if (!(r.is_excluded === true)) {
      if ((r.assignee_slot as number) === 2) entry.slot2 += 1
      else entry.slot1 += 1
    }
    out.set(id, entry)
  }
  return out
}
