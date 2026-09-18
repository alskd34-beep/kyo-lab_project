/**
 * [BACKEND] 휴가 기간 가용성 기반 "가능 품목" 제안
 *
 * 특정 휴가/출장 기간 [from, to] 동안 시험자가 빠졌을 때:
 *  - 남은(가용) 시험자 역량만으로 "지금 진행 가능한" 대기 PCT 오더 품목
 *  - 휴가자가 빠져 "불가해진" 품목(누가 복귀하면 가능한지)
 *  - 휴가와 무관하게 자격 시험자 자체가 없는 품목
 * 을 계산해 제안한다.
 *
 * 역량 매칭은 AI 배정 엔진(scheduleEngine)과 동일한 buildCapResolver 를 재사용해
 * "배정 가능 판정"과 "제안 판정"이 절대 어긋나지 않게 한다.
 *
 * 후보 = 대기(status='대기') · 미배정 · 미잠금 pct_orders (실제 배정 대기 백로그).
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { PENDING_STATUS } from '@shared/qc-status'
import { selectAll } from '@backend/lib/supabasePage'
import { listTesters, listCapabilities, listCapabilityMatrix } from '@backend/services/testers'
import { testersOnLeave } from '@backend/services/operatorSchedule'
import { buildCapResolver, type EngineCapability } from '@backend/services/scheduleEngine'

export interface ProductSuggestion {
  productCode: string
  productName: string
  waitingCount: number          // 해당 품목의 대기 오더 수
  testItems: string[]           // 등록된 시험항목(없으면 ['전항목'])
  blockingCapabilities?: string[] // 가용 인원으로 못 채우는 역량명(불가 사유)
  recoverableBy?: string[]      // 복귀하면 가능해지는 휴가 시험자 이름
}

export interface LeaveSuggestionResult {
  from: string
  to: string
  excludedTesters: { id: string; name: string }[]
  availableTesters: { id: string; name: string }[]
  testable: ProductSuggestion[]      // 가용 인원으로 지금 가능
  blockedByLeave: ProductSuggestion[] // 휴가자가 빠져 불가(복귀 시 가능)
  blockedAlways: ProductSuggestion[]  // 휴가 무관하게 자격자 없음
}

interface ItemReq { caps: string[]; duo: boolean }

/** 시험항목별 필요 역량 + 듀오 필요 여부 (engine.reqOf 와 동일 규칙) */
function buildReqResolver(
  capabilities: EngineCapability[],
  equipRows: Array<{ test_item: string; required_equipment: string | null; is_universal: boolean }>,
  requiresDuoByItem: Map<string, boolean>,
): (testItem: string) => ItemReq {
  const resolveCaps = buildCapResolver(capabilities)
  const byItem = new Map<string, { requiredEquipment: string; isUniversal: boolean }>()
  for (const e of equipRows) {
    byItem.set(e.test_item, { requiredEquipment: e.required_equipment ?? '', isUniversal: !!e.is_universal })
  }
  return (testItem: string): ItemReq => {
    const duo = requiresDuoByItem.get(testItem) ?? false
    const e = byItem.get(testItem)
    if (!e) return { caps: [], duo }                 // 매핑 없음 → 역량 제약 없음(보수적 통과)
    if (e.isUniversal) return { caps: [], duo }       // 공용 장비 → 제약 없음
    return { caps: resolveCaps(e.requiredEquipment), duo }
  }
}

/**
 * 주어진 시험자 풀이 caps 를 (solo 또는 duo로) 커버할 수 있는지.
 * engine 의 전항목 배정 로직과 동일: needsDuo 면 듀오 조만, 아니면 solo 우선·duo 폴백.
 */
function makeCoverChecker(
  pool: Array<{ id: string; canSolo: boolean; canDuo: boolean }>,
  yesByTester: Map<string, Set<string>>,
) {
  const can = (id: string, caps: string[]): boolean => {
    if (caps.length === 0) return true
    const have = yesByTester.get(id)
    if (!have) return false
    return caps.every(c => have.has(c))
  }
  const soloPool = pool.filter(t => t.canSolo)
  const duoPool = pool.filter(t => t.canDuo)
  const duoCovers = (caps: string[]): boolean => {
    for (const lead of soloPool) {
      for (const partner of duoPool) {
        if (partner.id === lead.id) continue
        const have = new Set<string>([...(yesByTester.get(lead.id) ?? []), ...(yesByTester.get(partner.id) ?? [])])
        if (caps.length === 0 || caps.every(c => have.has(c))) return true
      }
    }
    return false
  }
  return (caps: string[], needsDuo: boolean): boolean => {
    if (!needsDuo && soloPool.some(t => can(t.id, caps))) return true
    return duoCovers(caps)
  }
}

/**
 * 휴가 기간 [from, to] 가용성 기반 제안 계산.
 */
export async function suggestForLeaveWindow(from: string, to: string): Promise<LeaveSuggestionResult> {
  const [allTesters, capabilities, matrix, excludedIds, ordersRes, productsRes, ptiRes, testItemsRes, equipRes] =
    await Promise.all([
      listTesters(),
      listCapabilities(),
      listCapabilityMatrix(),
      testersOnLeave(from, to).catch(() => new Set<string>()),
      // 대기·미배정·미잠금 오더만 (실제 배정 백로그). select('*') 후 locked 필터(0015 미적용 안전).
      supabaseAdmin.from('pct_orders').select('*').eq('status', PENDING_STATUS).is('assignee_tester_id', null),
      selectAll(supabaseAdmin, 'products', 'id, product_code', { orderBy: 'id' }),
      selectAll(supabaseAdmin, 'product_test_items', 'product_id, test_item_id', { orderBy: ['product_id', 'test_item_id'] }),
      selectAll(supabaseAdmin, 'test_items', 'id, name, requires_duo', { orderBy: 'id' }),
      selectAll(supabaseAdmin, 'test_item_equipment', 'test_item, required_equipment, is_universal', { orderBy: ['test_item', 'required_equipment'] }),
    ])
  for (const result of [productsRes, ptiRes, testItemsRes, equipRes]) {
    if (result.error) throw result.error
  }

  const activeTesters = allTesters.filter(t => t.isActive)
  const excludedTesters = activeTesters.filter(t => excludedIds.has(t.id))
  const availableTesters = activeTesters.filter(t => !excludedIds.has(t.id))

  // 시험자별 보유 역량(Y/O) 집합
  const yesByTester = new Map<string, Set<string>>()
  for (const t of activeTesters) yesByTester.set(t.id, new Set())
  for (const m of matrix) {
    if (m.proficiencyLevel === 'Y' || m.proficiencyLevel === 'O') yesByTester.get(m.testerId)?.add(m.capabilityId)
  }
  const capNameById = new Map<string, string>()
  for (const c of capabilities) capNameById.set(c.id, c.name ?? c.code ?? c.id)

  // 품목코드 → 시험항목명
  const codeById = new Map<string, string>()
  for (const p of productsRes.data ?? []) codeById.set(p.id as string, String(p.product_code))
  const itemNameById = new Map<string, string>()
  const requiresDuoByItem = new Map<string, boolean>()
  for (const t of testItemsRes.data ?? []) {
    itemNameById.set(t.id as string, t.name as string)
    requiresDuoByItem.set(t.name as string, !!t.requires_duo)
  }
  const itemsByCode = new Map<string, string[]>()
  for (const link of ptiRes.data ?? []) {
    const code = codeById.get(link.product_id as string)
    const name = itemNameById.get(link.test_item_id as string)
    if (!code || !name) continue
    const arr = itemsByCode.get(code) ?? []
    arr.push(name)
    itemsByCode.set(code, arr)
  }

  const reqOf = buildReqResolver(
    capabilities,
    (equipRes.data ?? []).map(e => ({
      test_item: e.test_item as string,
      required_equipment: (e.required_equipment as string) ?? null,
      is_universal: !!e.is_universal,
    })),
    requiresDuoByItem,
  )

  // 대기 오더 → 품목코드 단위 묶음(대기 건수 집계, 대표 품목명)
  const byCode = new Map<string, { productName: string; count: number }>()
  for (const o of ordersRes.data ?? []) {
    if (o.locked) continue // [원칙3] 확정 오더 제외
    const code = String(o.product_code ?? '').trim()
    if (!code) continue
    const cur = byCode.get(code) ?? { productName: String(o.product_name ?? code), count: 0 }
    cur.count += 1
    byCode.set(code, cur)
  }

  const coverNow = makeCoverChecker(availableTesters, yesByTester)
  const coverAll = makeCoverChecker(activeTesters, yesByTester)

  const testable: ProductSuggestion[] = []
  const blockedByLeave: ProductSuggestion[] = []
  const blockedAlways: ProductSuggestion[] = []

  for (const [code, { productName, count }] of byCode) {
    const items = itemsByCode.get(code) ?? []
    const effectiveItems = items.length > 0 ? items : ['전항목']
    const capSet = new Set<string>()
    let needsDuo = false
    for (const ti of effectiveItems) {
      const { caps, duo } = reqOf(ti)
      caps.forEach(c => capSet.add(c))
      if (duo) needsDuo = true
    }
    const caps = [...capSet]
    const base: ProductSuggestion = { productCode: code, productName, waitingCount: count, testItems: effectiveItems }

    if (coverNow(caps, needsDuo)) {
      testable.push(base)
      continue
    }
    // 가용 인원으로 못 채우는 역량(불가 사유)
    const gaps = caps.filter(c => !availableTesters.some(t => yesByTester.get(t.id)?.has(c)))
    base.blockingCapabilities = gaps.map(c => capNameById.get(c) ?? c)

    if (coverAll(caps, needsDuo)) {
      // 전체로는 가능 → 휴가가 원인. 복귀 시 가능해지는 휴가 시험자 찾기.
      const recoverableBy: string[] = []
      for (const ex of excludedTesters) {
        const probe = makeCoverChecker([...availableTesters, ex], yesByTester)
        if (probe(caps, needsDuo)) recoverableBy.push(ex.name)
      }
      base.recoverableBy = recoverableBy
      blockedByLeave.push(base)
    } else {
      blockedAlways.push(base)
    }
  }

  // 대기 건수 많은 순 정렬(처리 우선순위 감각)
  const byWaiting = (a: ProductSuggestion, b: ProductSuggestion) => b.waitingCount - a.waitingCount
  testable.sort(byWaiting)
  blockedByLeave.sort(byWaiting)
  blockedAlways.sort(byWaiting)

  return {
    from,
    to,
    excludedTesters: excludedTesters.map(t => ({ id: t.id, name: t.name })),
    availableTesters: availableTesters.map(t => ({ id: t.id, name: t.name })),
    testable,
    blockedByLeave,
    blockedAlways,
  }
}
