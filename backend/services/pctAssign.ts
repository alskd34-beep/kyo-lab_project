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
import { testersOnLeave } from '@backend/services/operatorSchedule'
import { createNotification } from '@backend/services/notifications'
import { logReassignment } from '@backend/services/reassignmentHistory'
import {
  isPsychotropic,
  PSYCHOTROPIC_EXCLUDED_NAMES,
  isoWeekIndex,
  heavyMetalAssigneeForWeek,
  emergencyAllowed,
  difficultyPenalty,
} from '@backend/services/assignRules'
import { codexAssignEnabled, runCodexJson } from '@backend/lib/codexCli'
import {
  generatePctSchedule,
  type EnginePctRow,
  type EngineProductItems,
  type EngineEquip,
  type EngineWorkload,
} from '@backend/services/scheduleEngine'
import { buildGroupsFromOrders, type OrderForGrouping } from '@backend/services/concurrentGroups'

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
  due_date: string | null
  is_urgent: boolean
  method: string
}

/** 배정 선택 함수 — 오더 1건 → 시험자(또는 null) */
type PickFn = (order: OrderForAssign) => { id: string; name: string } | null

/** 대상 오더 로드 (orderIds 미지정 시 미배정 '대기' 전체) */
async function loadTargetOrders(orderIds?: string[]): Promise<OrderForAssign[]> {
  // select('*') 로 locked 컬럼까지 받되(0015 미적용 시 자동 누락), 잠긴 오더는 배정 제외.
  let q = supabaseAdmin
    .from('pct_orders')
    .select('*')
    .neq('status', '삭제')
  if (orderIds && orderIds.length > 0) q = q.in('id', orderIds)
  else q = q.eq('status', '대기').is('assignee_tester_id', null)
  const { data, error } = await q
  if (error) throw error
  // [원칙3] LOCK(확정) 오더는 자동배정/재배정 대상에서 제외
  return (data ?? []).filter(o => !o.locked) as OrderForAssign[]
}

/**
 * [동시분석] 대상 오더를 동시분석 그룹으로 묶고, 그룹별 대표 오더를 선정한다.
 * - 그룹핑 규칙은 concurrentGroups.buildGroupsFromOrders 와 100% 동일(코드 일원화).
 * - 대표(rep) = 그룹 내 최소 id (concurrentGroups 의 group_key 규칙과 일치 → 결정적).
 * - 엔진/LLM 에는 대표만 태워 공수를 그룹당 1회만 계산(PRD 원칙4: 동시분석 시 공수 미증가).
 * - 배정 후 그룹의 모든 멤버에 대표의 시험자를 전파 → 동일/유사 품목을 한 사람이 동시분석.
 *
 * @returns reps 대표 오더 목록, memberToRep 멤버 orderId → 대표 오더
 */
function groupOrders(orders: OrderForAssign[]): {
  reps: OrderForAssign[]
  memberToRep: Map<string, OrderForAssign>
} {
  const forGrouping: OrderForGrouping[] = orders.map(o => ({
    id: o.id,
    productCode: o.product_code,
    productName: o.product_name,
    batchNo: o.batch_no,
    packagingDate: o.packaging_date,
    dueDate: o.due_date,
  }))
  const built = buildGroupsFromOrders(forGrouping)
  const orderById = new Map(orders.map(o => [o.id, o]))
  const reps: OrderForAssign[] = []
  const memberToRep = new Map<string, OrderForAssign>()
  for (const g of built) {
    const repId = g.items.map(i => i.orderId).reduce((a, b) => (a < b ? a : b))
    const rep = orderById.get(repId)
    if (!rep) continue
    reps.push(rep)
    for (const it of g.items) memberToRep.set(it.orderId, rep)
  }
  return { reps, memberToRep }
}

/**
 * 대상 오더 기준 휴가 점검 구간 [from, to] 산출.
 * 포장일이 있으면 그 범위, 없으면 오늘. 시험 진행 여력을 감안해 종료측에 14일 버퍼.
 */
function leaveWindow(orders: OrderForAssign[]): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10)
  const dates = orders.map(o => o.packaging_date).filter((d): d is string => !!d).sort()
  const from = dates[0] ?? today
  const base = dates[dates.length - 1] ?? today
  const to = new Date(new Date(base + 'T00:00:00Z').getTime() + 14 * 86400000)
    .toISOString().slice(0, 10)
  return { from: from < today ? from : today, to: to > today ? to : today }
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

// ─── 규칙2: 개별 중금속 시험 (금요일 순환 강제배정) ──────────────────────────
/** 시험항목명에서 개별 중금속 시험을 식별하는 키워드 */
const HEAVY_METAL_KEYWORD = '중금속'

/** 해당 오더가 "개별 중금속" 시험(개별항목 + 중금속 항목 포함)인지 판정 */
function isHeavyMetalIndividual(order: OrderForAssign, itemsByCode: Map<string, string[]>): boolean {
  if (order.method !== '개별항목') return false
  const items = itemsByCode.get(order.product_code) ?? []
  return items.some(n => n.includes(HEAVY_METAL_KEYWORD))
}

/**
 * 배정 pick 함수에 도메인 강제규칙을 덧씌운다.
 * - [규칙2] 개별 중금속 시험: 매주 금요일 기준 주차 순환(박성호→이영남→정예찬)으로 강제배정(1DAY 고정).
 *   해당 주차 담당자가 후보(testers)에 있으면 역량/부하 무관하게 우선 배정한다.
 * 그 외 오더는 기존 base pick 결과를 그대로 사용한다.
 */
function withForcedRules(
  base: (order: OrderForAssign) => { id: string; name: string } | null,
  ctx: { itemsByCode: Map<string, string[]>; testers: Array<{ id: string; name: string }>; weekIndex: number },
): (order: OrderForAssign) => { id: string; name: string } | null {
  return (order) => {
    if (isHeavyMetalIndividual(order, ctx.itemsByCode)) {
      const t = heavyMetalAssigneeForWeek(ctx.weekIndex, ctx.testers)
      if (t) return { id: t.id, name: t.name }
    }
    return base(order)
  }
}

/**
 * [규칙4] 시험자별 최근 HIGH 난이도 부담 수 → penalty 점수(Record).
 * PRD: "최근 2주 기준 HIGH 난이도 업무가 많으면 차주 MEDIUM/LOW 우선 배정".
 * 최근 14일 내 받은(created_at) HIGH 난이도 배정 건수를 집계해,
 * 엔진 초기 부하(initialLoad)로 실어 차주 MEDIUM/LOW 배정에서 후순위로 민다.
 */
async function highDifficultyPenalty(): Promise<Record<string, number>> {
  const twoWeeksAgoIso = new Date(Date.now() - 14 * 86400000).toISOString()
  const [{ data: orders }, { data: prods }] = await Promise.all([
    supabaseAdmin
      .from('pct_orders')
      .select('assignee_tester_id, product_code')
      .not('assignee_tester_id', 'is', null)
      .neq('status', '삭제')
      .gte('created_at', twoWeeksAgoIso),   // [규칙4] 최근 2주(14일)
    supabaseAdmin.from('products').select('product_code, difficulty'),
  ])
  const diffByCode = new Map<string, string>()
  for (const p of prods ?? []) diffByCode.set(String(p.product_code), (p.difficulty as string) ?? '')
  const counts = new Map<string, number>()
  for (const o of orders ?? []) {
    if (diffByCode.get(String(o.product_code)) === 'High') {
      const id = o.assignee_tester_id as string
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
  }
  const penalty: Record<string, number> = {}
  for (const [id, cnt] of counts) penalty[id] = difficultyPenalty(cnt)
  return penalty
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
    // [규칙1] 향정신성 의약품(자이렌정·아디펙스정)은 강지윤·김정호 배정 불가
    if (hit?.id && isPsychotropic(o.product_name) && PSYCHOTROPIC_EXCLUDED_NAMES.includes(hit.name as never)) {
      details.push({ orderId: o.id, testerId: null, testerName: null, note: '향정신성 제외 대상(배정 불가)' })
      continue
    }
    if (hit?.id) {
      await supabaseAdmin.from('pct_orders').update({ assignee_tester_id: hit.id }).eq('id', o.id)
      assigned++
      details.push({ orderId: o.id, testerId: hit.id, testerName: hit.name, note: '배정됨' })
      // [규칙1] 향정신성 의약품 배정 시 관리자 알림 필수
      if (isPsychotropic(o.product_name)) {
        await createNotification({
          type: 'status_changed',
          severity: 'warning',
          title: '향정신성 의약품 배정',
          body: `${o.product_name} (${o.batch_no}) → ${hit.name} 배정. 관리자 확인이 필요합니다.`,
          relatedOrderId: o.id,
        }).catch(() => {})
      }
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

async function autoAssignCodex(orders: OrderForAssign[], excludedTesterIds: Set<string>): Promise<{ mode: 'codex'; pick: PickFn }> {
  const [allTesters, capabilities, matrix, itemsByCode, workload] = await Promise.all([
    listTesters(), listCapabilities(), listCapabilityMatrix(), productItemsByCode(), currentWorkload(),
  ])
  // 휴가/출장 중인 시험자는 배정 후보에서 제외
  const testers = allTesters.filter(t => !excludedTesterIds.has(t.id))

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

  const basePick = (o: OrderForAssign): { id: string; name: string } | null => {
    const tid = byOrder.get(o.id)
    if (tid && testerById.has(tid)) return { id: tid, name: testerById.get(tid)! }
    return null
  }
  // [규칙2] 개별 중금속 금요일 순환 강제배정을 LLM 결과 위에 덧씌운다.
  const pick = withForcedRules(basePick, {
    itemsByCode,
    testers: testers.map(t => ({ id: t.id, name: t.name })),
    weekIndex: isoWeekIndex(new Date()),
  })
  return { mode: 'codex', pick }
}

// ─── 규칙엔진 배분 (폴백) ──────────────────────────────────────────────────────
async function autoAssignRule(orders: OrderForAssign[], excludedTesterIds: Set<string>): Promise<{ mode: 'rule'; pick: PickFn }> {
  const [allTesters, capabilities, matrix, productsRes, ptiRes, testItemsRes, equipRes, workloadRes] =
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

  // 휴가/출장 중인 시험자는 배정 후보에서 제외
  const testers = allTesters.filter(t => !excludedTesterIds.has(t.id))

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

  // [규칙3] 긴급 ≤3DAY 제한: 공수(avg_workdays)가 3일을 초과하는 품목은 긴급으로 취급하지 않는다.
  const workdaysByCode = new Map<string, number>()
  for (const w of workload) workdaysByCode.set(w.productCode, w.avgWorkdays)

  const rows: EnginePctRow[] = orders.map(o => {
    const code = (o.product_code ?? '').trim()
    const wd = workdaysByCode.get(code)
    // [규칙3] 긴급은 공수 ≤3DAY 품목만 허용(PRD). 공수 미상정 품목은 ≤3DAY 보장이 안 되므로 긴급 제외.
    const urgent = !!o.is_urgent && wd != null && emergencyAllowed(wd)
    return {
      품목코드: code,
      품목명:   o.product_name ?? '',
      제조번호: o.batch_no ?? '',
      포장일:   o.packaging_date ?? '',
      긴급:     urgent,
      진행방법: o.method === '개별항목' ? '개별항목' : '전항목',
    }
  })

  // [규칙4] 최근 HIGH 난이도 부담을 초기 부하로 실어 차주 MEDIUM/LOW 배정에서 후순위로 민다.
  const initialLoad = await highDifficultyPenalty().catch(() => ({}))

  const engine = generatePctSchedule({
    rows, testers, capabilities,
    matrix: matrix.map(m => ({ testerId: m.testerId, capabilityId: m.capabilityId, level: m.proficiencyLevel })),
    productItems, equipment, workload, year: new Date().getFullYear(), initialLoad,
  })

  const testerByKey = new Map<string, { id: string; name: string }>()
  for (const a of engine.assignments) testerByKey.set(`${a.productCode}|${a.batchNo}`, { id: a.testerId, name: a.testerName })

  // [규칙2] 개별 중금속 금요일 순환 강제배정을 엔진 결과 위에 덧씌운다.
  const pick = withForcedRules(
    (o) => testerByKey.get(`${o.product_code}|${o.batch_no}`) ?? null,
    { itemsByCode, testers: testers.map(t => ({ id: t.id, name: t.name })), weekIndex: isoWeekIndex(new Date()) },
  )
  return { mode: 'rule', pick }
}

/**
 * 자동배정 진입점. Codex 활성 시 Codex 시도 → 실패하면 규칙엔진 폴백.
 */
export async function autoAssign(orderIds?: string[]): Promise<AssignResult> {
  const orders = await loadTargetOrders(orderIds)
  if (orders.length === 0) return { mode: 'rule', assigned: 0, unassigned: 0, details: [] }

  // [동시분석] 동일 품목코드/유사 품목명을 한 그룹으로 묶고 대표만 배정 대상으로 삼는다.
  // 엔진/LLM 에는 reps 만 태워 공수를 그룹당 1회 계산하고, 배정 결과를 멤버 전체에 전파한다.
  const { reps, memberToRep } = groupOrders(orders)

  // 휴가/출장 중인 시험자 제외 (요구사항: 휴가 기간 중인 시험자는 자동 배정 대상 제외)
  const { from, to } = leaveWindow(orders)
  const excludedTesterIds = await testersOnLeave(from, to).catch(() => new Set<string>())

  let resolved: { mode: 'codex' | 'rule'; pick: PickFn } | null = null
  if (codexAssignEnabled()) {
    try {
      resolved = await autoAssignCodex(reps, excludedTesterIds)
    } catch (err) {
      console.error('[pctAssign] Codex 배분 실패 — 규칙엔진 폴백:', err)
    }
  }
  if (!resolved) resolved = await autoAssignRule(reps, excludedTesterIds)

  // [동시분석] 각 멤버는 자신이 속한 그룹 대표의 배정 결과를 따른다(한 시험자가 동시분석).
  const groupPick: PickFn = (o) => resolved!.pick(memberToRep.get(o.id) ?? o)
  const applied = await applyAssignments(orders, groupPick)
  return { mode: resolved.mode, ...applied }
}

/** 수동 단일 배정 (담당자 변경 시 재배정 이력 기록) */
export async function assignManually(
  orderId: string,
  testerId: string | null,
  opts: { changedBy?: string | null; reason?: string | null } = {},
): Promise<void> {
  // 변경 전 담당자 조회 → 재배정 이력용
  const { data: before } = await supabaseAdmin
    .from('pct_orders')
    .select('assignee_tester_id')
    .eq('id', orderId)
    .maybeSingle()
  const beforeUser = (before?.assignee_tester_id as string) ?? null

  const { error } = await supabaseAdmin.from('pct_orders').update({ assignee_tester_id: testerId }).eq('id', orderId)
  if (error) throw error

  // 담당자가 실제로 바뀐 경우에만 이력 기록 (분석용: 누가/왜/어느 품목에서 변경되는가)
  if (beforeUser !== testerId) {
    await logReassignment({
      orderId,
      beforeUser,
      afterUser: testerId,
      reason: opts.reason ?? null,
      changedBy: opts.changedBy ?? null,
    }).catch(() => {})
  }
}
