/**
 * [BACKEND] PCT 오더 AI 자동배정
 *
 * 1순위: Codex CLI(구독) 로 LLM 배분 — ENABLE_CODEX_ASSIGN=1 일 때.
 * 폴백:  기존 규칙엔진(scheduleEngine) — Codex 미사용/실패 시.
 *
 * 두 방식 모두 "업무가 적은 담당자 우선 + 공수/역량 고려" 정책을 따른다.
 * 결과의 testerId 를 pct_orders.assignee_tester_id 에 영속한다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { listTesters, listCapabilities, listCapabilityMatrix } from '@backend/services/testers'
import { codexAssignEnabled, runCodexJson } from '@backend/lib/codexCli'
import {
  generatePctSchedule,
  type EnginePctRow,
  type EngineProductItems,
  type EngineEquip,
  type EngineWorkload,
} from '@backend/services/scheduleEngine'

export interface AssignResult {
  mode: 'codex' | 'rule'
  assigned: number
  unassigned: number
  details: Array<{ orderId: string; testerId: string | null; testerName: string | null; note: string }>
}

interface OrderForAssign {
  id: string
  product_code: string
  product_name: string
  batch_no: string
  packaging_date: string | null
  is_urgent: boolean
  method: string
}

/** 대상 오더 로드 (orderIds 미지정 시 미배정 '대기' 전체) */
async function loadTargetOrders(orderIds?: string[]): Promise<OrderForAssign[]> {
  let q = supabaseAdmin
    .from('pct_orders')
    .select('id, product_code, product_name, batch_no, packaging_date, is_urgent, method')
    .neq('status', '삭제')
  if (orderIds && orderIds.length > 0) q = q.in('id', orderIds)
  else q = q.eq('status', '대기').is('assignee_tester_id', null)
  const { data, error } = await q
  if (error) throw error
  return (data ?? []) as OrderForAssign[]
}

/** 진행 중(미완료) 배정 건수 → 담당자별 현재 업무량 */
async function currentWorkload(): Promise<Map<string, number>> {
  const { data } = await supabaseAdmin
    .from('pct_orders')
    .select('assignee_tester_id, status')
    .not('assignee_tester_id', 'is', null)
    .not('status', 'in', '("완료","삭제")')
  const m = new Map<string, number>()
  for (const r of data ?? []) {
    const id = r.assignee_tester_id as string
    m.set(id, (m.get(id) ?? 0) + 1)
  }
  return m
}

/** 품목코드 → 시험항목명 목록 */
async function productItemsByCode(): Promise<Map<string, string[]>> {
  const [productsRes, ptiRes, testItemsRes] = await Promise.all([
    supabaseAdmin.from('products').select('id, product_code'),
    supabaseAdmin.from('product_test_items').select('product_id, test_item_id'),
    supabaseAdmin.from('test_items').select('id, name'),
  ])
  const codeById = new Map<string, string>()
  for (const p of productsRes.data ?? []) codeById.set(p.id as string, String(p.product_code))
  const nameById = new Map<string, string>()
  for (const t of testItemsRes.data ?? []) nameById.set(t.id as string, t.name as string)
  const byCode = new Map<string, string[]>()
  for (const link of ptiRes.data ?? []) {
    const code = codeById.get(link.product_id as string)
    const name = nameById.get(link.test_item_id as string)
    if (!code || !name) continue
    const arr = byCode.get(code) ?? []
    arr.push(name)
    byCode.set(code, arr)
  }
  return byCode
}

/** 배정 결과 적용 (testerId 검증 후 update) */
async function applyAssignments(
  orders: OrderForAssign[],
  pick: (order: OrderForAssign) => { id: string; name: string } | null,
): Promise<Omit<AssignResult, 'mode'>> {
  const details: AssignResult['details'] = []
  let assigned = 0
  for (const o of orders) {
    const hit = pick(o)
    if (hit?.id) {
      await supabaseAdmin.from('pct_orders').update({ assignee_tester_id: hit.id }).eq('id', o.id)
      assigned++
      details.push({ orderId: o.id, testerId: hit.id, testerName: hit.name, note: '배정됨' })
    } else {
      details.push({ orderId: o.id, testerId: null, testerName: null, note: '배정 가능한 담당자 없음' })
    }
  }
  return { assigned, unassigned: orders.length - assigned, details }
}

// ─── Codex CLI 배분 ───────────────────────────────────────────────────────────
interface CodexAssignResponse {
  assignments: Array<{ orderId: string; testerId: string | null }>
}

async function autoAssignCodex(orders: OrderForAssign[]): Promise<AssignResult> {
  const [testers, capabilities, matrix, itemsByCode, workload] = await Promise.all([
    listTesters(), listCapabilities(), listCapabilityMatrix(), productItemsByCode(), currentWorkload(),
  ])

  // 시험자별 보유 역량명 (Y/O 만)
  const capNameById = new Map<string, string>()
  for (const c of capabilities) capNameById.set(c.id, c.name ?? c.code ?? c.id)
  const capsByTester = new Map<string, string[]>()
  for (const m of matrix) {
    if (m.proficiencyLevel === 'Y' || m.proficiencyLevel === 'O') {
      const arr = capsByTester.get(m.testerId) ?? []
      const nm = capNameById.get(m.capabilityId)
      if (nm) arr.push(nm)
      capsByTester.set(m.testerId, arr)
    }
  }

  const testerCtx = testers.map(t => ({
    testerId: t.id,
    name: t.name,
    currentWorkload: workload.get(t.id) ?? 0,
    capabilities: capsByTester.get(t.id) ?? [],
  }))
  const orderCtx = orders.map(o => ({
    orderId: o.id,
    productName: o.product_name,
    batchNo: o.batch_no,
    isUrgent: o.is_urgent,
    method: o.method,
    testItems: itemsByCode.get(o.product_code) ?? [],
  }))

  const system = [
    '너는 QC 시험 업무 배정 담당이다.',
    '각 오더(order)를 시험자(tester) 한 명에게 배정한다.',
    '규칙:',
    '1) 현재 업무량(currentWorkload)이 적은 시험자를 우선한다.',
    '2) 오더의 testItems 를 수행할 역량(capabilities)을 갖춘 시험자만 배정한다.',
    '3) 긴급(isUrgent=true) 오더를 먼저 고려한다.',
    '4) 적합한 시험자가 없으면 testerId 를 null 로 둔다.',
    '반드시 아래 JSON 형식으로만 답한다: {"assignments":[{"orderId":"...","testerId":"...|null"}]}',
  ].join('\n')

  const user = JSON.stringify({ testers: testerCtx, orders: orderCtx })

  const resp = await runCodexJson<CodexAssignResponse>(`${system}\n\n입력:\n${user}`)
  const byOrder = new Map<string, string | null>()
  for (const a of resp.assignments ?? []) byOrder.set(a.orderId, a.testerId ?? null)
  const testerById = new Map(testers.map(t => [t.id, t.name]))

  const applied = await applyAssignments(orders, (o) => {
    const tid = byOrder.get(o.id)
    if (tid && testerById.has(tid)) return { id: tid, name: testerById.get(tid)! }
    return null
  })
  return { mode: 'codex', ...applied }
}

// ─── 규칙엔진 배분 (폴백) ──────────────────────────────────────────────────────
async function autoAssignRule(orders: OrderForAssign[]): Promise<AssignResult> {
  const [testers, capabilities, matrix, productsRes, ptiRes, testItemsRes, equipRes, workloadRes] =
    await Promise.all([
      listTesters(),
      listCapabilities(),
      listCapabilityMatrix(),
      supabaseAdmin.from('products').select('id, product_code'),
      supabaseAdmin.from('product_test_items').select('product_id, test_item_id'),
      supabaseAdmin.from('test_items').select('id, name, requires_duo'),
      supabaseAdmin.from('test_item_equipment').select('test_item, required_equipment, is_universal'),
      supabaseAdmin.from('product_workload').select('product_code, avg_workdays'),
    ])

  const codeById = new Map<string, string>()
  for (const p of productsRes.data ?? []) codeById.set(p.id as string, String(p.product_code))
  const itemNameById = new Map<string, string>()
  const requiresDuoByName = new Map<string, boolean>()
  for (const t of testItemsRes.data ?? []) {
    itemNameById.set(t.id as string, t.name as string)
    requiresDuoByName.set(t.name as string, !!t.requires_duo)
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
  const productItems: EngineProductItems[] = [...itemsByCode].map(([productCode, testItems]) => ({ productCode, testItems }))
  const equipment: EngineEquip[] = (equipRes.data ?? []).map(e => ({
    testItem: e.test_item as string,
    requiredEquipment: (e.required_equipment as string) ?? '',
    isUniversal: !!e.is_universal,
    requiresDuo: requiresDuoByName.get(e.test_item as string) ?? false,
  }))
  const workload: EngineWorkload[] = (workloadRes.data ?? []).map(w => ({
    productCode: String(w.product_code),
    avgWorkdays: Number(w.avg_workdays) || 0,
  }))

  const rows: EnginePctRow[] = orders.map(o => ({
    품목코드: (o.product_code ?? '').trim(),
    품목명:   o.product_name ?? '',
    제조번호: o.batch_no ?? '',
    포장일:   o.packaging_date ?? '',
    긴급:     !!o.is_urgent,
    진행방법: o.method === '개별항목' ? '개별항목' : '전항목',
  }))

  const engine = generatePctSchedule({
    rows, testers, capabilities,
    matrix: matrix.map(m => ({ testerId: m.testerId, capabilityId: m.capabilityId, level: m.proficiencyLevel })),
    productItems, equipment, workload, year: new Date().getFullYear(),
  })

  const testerByKey = new Map<string, { id: string; name: string }>()
  for (const a of engine.assignments) testerByKey.set(`${a.productCode}|${a.batchNo}`, { id: a.testerId, name: a.testerName })

  const applied = await applyAssignments(orders, (o) => testerByKey.get(`${o.product_code}|${o.batch_no}`) ?? null)
  return { mode: 'rule', ...applied }
}

/**
 * 자동배정 진입점. Codex 활성 시 Codex 시도 → 실패하면 규칙엔진 폴백.
 */
export async function autoAssign(orderIds?: string[]): Promise<AssignResult> {
  const orders = await loadTargetOrders(orderIds)
  if (orders.length === 0) return { mode: 'rule', assigned: 0, unassigned: 0, details: [] }

  if (codexAssignEnabled()) {
    try {
      return await autoAssignCodex(orders)
    } catch (err) {
      console.error('[pctAssign] Codex 배분 실패 — 규칙엔진 폴백:', err)
    }
  }
  return autoAssignRule(orders)
}

/** 수동 단일 배정 */
export async function assignManually(orderId: string, testerId: string | null): Promise<void> {
  const { error } = await supabaseAdmin.from('pct_orders').update({ assignee_tester_id: testerId }).eq('id', orderId)
  if (error) throw error
}
