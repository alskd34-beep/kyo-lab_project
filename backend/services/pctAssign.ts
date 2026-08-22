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
import {
  CLOSED_STAGE,
  DELETED_STATUS,
  PENDING_STATUS,
} from '@shared/qc-status'
import { selectAll } from '@backend/lib/supabasePage'
import { listTesters, listCapabilities, listCapabilityMatrix, assertTesterAssignable } from '@backend/services/testers'
import { testerAbsences } from '@backend/services/operatorSchedule'
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
  type EngineHalfDayNotice,
  type EnginePctRow,
  type EngineProductItems,
  type EngineEquip,
  type EngineWorkload,
} from '@backend/services/scheduleEngine'
import { notifyLeaveConflict, warnIfAssigneeOnLeave } from '@backend/services/leaveConflicts'
import {
  findAbsenceConflicts, orderTestWindow, todayIso, type TesterAbsence,
} from '@shared/leave'
import { buildGroupsFromOrders, type OrderForGrouping } from '@backend/services/concurrentGroups'
import { loadFamilyByCode } from '@backend/services/concurrentProductFamilies'

/**
 * 반차와 겹친 배정 — 관리자가 "이대로 둘지" 확인하는 용도.
 * 반차는 근무를 하므로 제외 대상이 아니라 확인 대상이다(연차·출장은 애초에 배정되지 않는다).
 */
export interface HalfDayAssignNotice {
  orderId: string
  productName: string
  batchNo: string
  testerId: string
  testerName: string
  /** 반차와 겹친 날짜 */
  dates: string[]
}

export interface AssignResult {
  mode: 'codex' | 'rule'
  assigned: number
  unassigned: number
  details: Array<{ orderId: string; testerId: string | null; testerName: string | null; note: string }>
  /** 반차 겹침 배정(비어 있으면 겹침 없음) — 화면 확인 + 관리자 알림 대상 */
  halfDayNotices: HalfDayAssignNotice[]
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
  assignee_tester_id: string | null
  note: string | null
}

/** 배정 선택 함수 — 오더 1건 → 시험자(또는 null) */
type PickFn = (order: OrderForAssign) => { id: string; name: string } | null

const AUTO_UNASSIGNED_NOTE_PREFIX = '자동배정 미배정 사유:'

function withoutAutoUnassignedNote(note: string | null): string | null {
  const kept = (note ?? '')
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith(AUTO_UNASSIGNED_NOTE_PREFIX))
    .join('\n')
    .trim()
  return kept || null
}

function withAutoUnassignedNote(note: string | null, reason: string): string {
  return [withoutAutoUnassignedNote(note), `${AUTO_UNASSIGNED_NOTE_PREFIX} ${reason}`]
    .filter(Boolean)
    .join('\n')
}

function orderKey(order: OrderForAssign): string {
  return `${order.product_code}|${order.batch_no}`
}

/** 대상 오더 로드 (orderIds 미지정 시 미배정 '대기' 전체) */
async function loadTargetOrders(orderIds?: string[]): Promise<OrderForAssign[]> {
  // select('*') 로 locked 컬럼까지 받되(0015 미적용 시 자동 누락), 잠긴 오더는 배정 제외.
  let q = supabaseAdmin
    .from('pct_orders')
    .select('*')
    .neq('status', DELETED_STATUS)
  if (orderIds && orderIds.length > 0) q = q.in('id', orderIds)
  else q = q.eq('status', PENDING_STATUS).is('assignee_tester_id', null)
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
function groupOrders(orders: OrderForAssign[], familyByCode?: Map<string, string>): {
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
  const built = buildGroupsFromOrders(forGrouping, familyByCode)
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
 * 부재(휴가/출장)를 조회할 기간 [from, to].
 *
 * 시험은 '지금부터 완료예정일 사이'에 수행되므로 그 구간을 본다.
 * 예전에는 packaging_date(제조일) 기준이라, 포장이 끝난 오더는 구간 끝이 '오늘'로 잘려
 * 내일 시작하는 휴가를 놓쳤다. 제조일은 시험 시점과 무관하므로 완료예정일을 쓴다.
 */
function leaveWindow(orders: OrderForAssign[]): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10)
  const ends = orders
    .map(o => o.due_date || o.packaging_date)
    .filter((d): d is string => !!d)
    .sort()
  const last = ends[ends.length - 1] ?? today
  const base = last > today ? last : today
  // 마감 이후로 밀리는 작업까지 감안한 여유
  const to = new Date(new Date(base + 'T00:00:00Z').getTime() + 14 * 86400000)
    .toISOString().slice(0, 10)
  return { from: today, to }
}

/** 진행 중(미완료) 배정 건수 → 담당자별 현재 업무량 */
async function currentWorkload(): Promise<Map<string, number>> {
  const { data } = await supabaseAdmin
    .from('pct_orders')
    .select('assignee_tester_id, status')
    .not('assignee_tester_id', 'is', null)
    .not('status', 'in', `("${CLOSED_STAGE}","삭제")`)
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
    selectAll(supabaseAdmin, 'products', 'id, product_code'),
    selectAll(supabaseAdmin, 'product_test_items', 'product_id, test_item_id'),
    selectAll(supabaseAdmin, 'test_items', 'id, name'),
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
      .neq('status', DELETED_STATUS)
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
  reasonFor: (order: OrderForAssign) => string,
): Promise<Omit<AssignResult, 'mode' | 'halfDayNotices'>> {
  const details: AssignResult['details'] = []
  let assigned = 0
  for (const o of orders) {
    const hit = pick(o)
    // [규칙1] 향정신성 의약품(자이렌정·아디펙스정)은 강지윤·김정호 배정 불가
    if (hit?.id && isPsychotropic(o.product_name) && PSYCHOTROPIC_EXCLUDED_NAMES.includes(hit.name as never)) {
      const note = withAutoUnassignedNote(o.note, '향정신성 의약품 제외 대상(배정 불가)')
      const { error } = await supabaseAdmin.from('pct_orders').update({ note }).eq('id', o.id)
      if (error) throw error
      details.push({ orderId: o.id, testerId: null, testerName: null, note: '향정신성 의약품 제외 대상(배정 불가)' })
      continue
    }
    if (hit?.id) {
      const beforeUser = (o.assignee_tester_id as string | null) ?? null
      const { error } = await supabaseAdmin
        .from('pct_orders')
        .update({ assignee_tester_id: hit.id, note: withoutAutoUnassignedNote(o.note) })
        .eq('id', o.id)
      if (error) throw error
      assigned++
      details.push({ orderId: o.id, testerId: hit.id, testerName: hit.name, note: '배정됨' })
      if (beforeUser !== hit.id) {
        await logReassignment({
          orderId: o.id,
          beforeUser,
          afterUser: hit.id,
          reason: 'AI 자동배정',
          changedBy: null,
        }).catch(() => {})
      }
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
      const reason = reasonFor(o)
      const note = withAutoUnassignedNote(o.note, reason)
      const { error } = await supabaseAdmin.from('pct_orders').update({ note }).eq('id', o.id)
      if (error) throw error
      details.push({ orderId: o.id, testerId: null, testerName: null, note: reason })
    }
  }
  return { assigned, unassigned: orders.length - assigned, details }
}

// ─── Codex CLI 배분 ───────────────────────────────────────────────────────────
interface CodexAssignResponse {
  assignments: Array<{ orderId: string; testerId: string | null }>
}

async function autoAssignCodex(
  orders: OrderForAssign[],
  excludedTesterIds: Set<string>,
): Promise<{ mode: 'codex'; pick: PickFn; reasonByKey: Map<string, string>; halfDayNotices: EngineHalfDayNotice[] }> {
  const [allTesters, capabilities, matrix, itemsByCode, workload] = await Promise.all([
    listTesters({ activeOnly: true }), listCapabilities(), listCapabilityMatrix(), productItemsByCode(), currentWorkload(),
  ])
  // 비활성(퇴사·휴직 등) 시험자와 휴가/출장 중인 시험자는 배정 후보에서 제외
  const testers = allTesters.filter(t => t.isActive && !excludedTesterIds.has(t.id))

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
  // Codex 경로는 엔진을 거치지 않아 반차 판정이 없다 — autoAssign 이 오더 구간 기준으로 채운다.
  return { mode: 'codex', pick, reasonByKey: new Map(), halfDayNotices: [] as EngineHalfDayNotice[] }
}

// ─── 규칙엔진 배분 (폴백) ──────────────────────────────────────────────────────
async function autoAssignRule(
  orders: OrderForAssign[],
  absences: Array<{ testerId: string; from: string; to: string; type: string }>,
): Promise<{ mode: 'rule'; pick: PickFn; reasonByKey: Map<string, string>; halfDayNotices: EngineHalfDayNotice[] }> {
  const [allTesters, capabilities, matrix, productsRes, ptiRes, testItemsRes, equipRes, workloadRes] =
    await Promise.all([
      listTesters({ activeOnly: true }),
      listCapabilities(),
      listCapabilityMatrix(),
      selectAll(supabaseAdmin, 'products', 'id, product_code'),
      selectAll(supabaseAdmin, 'product_test_items', 'product_id, test_item_id'),
      selectAll(supabaseAdmin, 'test_items', 'id, name, requires_duo'),
      selectAll(supabaseAdmin, 'test_item_equipment', 'test_item, required_equipment, is_universal'),
      selectAll(supabaseAdmin, 'product_workload', 'product_code, avg_workdays'),
    ])

  // 비활성(퇴사·휴직) 시험자만 여기서 거른다.
  // 휴가·출장은 엔진이 실제 근무일과 대조해 판정한다(반차는 제외 대신 공수 차감).
  const testers = allTesters.filter(t => t.isActive)

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
      // 완료예정일 전달 → 엔진이 역순 ALAP·마감위험(deadlineRisk)·EDD 정렬에 활용.
      // 일정 기준: 완료예정일 역순(ALAP). NULL이면 포장일 정방향 폴백.
      완료예정일: o.due_date ?? undefined,
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
    absences,
  })

  const testerByKey = new Map<string, { id: string; name: string }>()
  for (const a of engine.assignments) testerByKey.set(`${a.productCode}|${a.batchNo}`, { id: a.testerId, name: a.testerName })
  const reasonByKey = new Map<string, string>()
  for (const item of engine.unassigned) reasonByKey.set(`${item.productCode}|${item.batchNo}`, item.reason)

  // [규칙2] 개별 중금속 금요일 순환 강제배정을 엔진 결과 위에 덧씌운다.
  const pick = withForcedRules(
    (o) => testerByKey.get(`${o.product_code}|${o.batch_no}`) ?? null,
    { itemsByCode, testers: testers.map(t => ({ id: t.id, name: t.name })), weekIndex: isoWeekIndex(new Date()) },
  )
  // 엔진이 근무일 단위로 판정한 반차 겹침을 그대로 올려보낸다(예전엔 여기서 버려졌다).
  return { mode: 'rule', pick, reasonByKey, halfDayNotices: engine.halfDayNotices }
}

/**
 * 자동배정 진입점. Codex 활성 시 Codex 시도 → 실패하면 규칙엔진 폴백.
 */
export async function autoAssign(orderIds?: string[]): Promise<AssignResult> {
  const orders = await loadTargetOrders(orderIds)
  if (orders.length === 0) {
    return { mode: 'rule', assigned: 0, unassigned: 0, details: [], halfDayNotices: [] }
  }

  // [동시분석] 동일 품목군(기준설정 마스터)/유사 품목명을 한 그룹으로 묶고 대표만 배정 대상으로 삼는다.
  // 엔진/LLM 에는 reps 만 태워 공수를 그룹당 1회 계산하고, 배정 결과를 멤버 전체에 전파한다.
  const familyByCode = await loadFamilyByCode().catch(() => new Map<string, string>())
  const { reps, memberToRep } = groupOrders(orders, familyByCode)

  // 부재(휴가/출장) 로드.
  //  - 연차·출장: 배정 제외 (엔진이 근무일 단위로 판정)
  //  - 반차     : 제외하지 않고 가용 공수 0.5일 차감
  // 예전에는 조회 실패를 .catch 로 삼켜 "휴가 없음"으로 배정이 성사됐다.
  // 조용히 넘기면 휴가 중 배정이 성공으로 보고되므로 실패는 그대로 올린다.
  const { from, to } = leaveWindow(orders)
  const absences = await testerAbsences(from, to)
  // LLM 경로는 엔진을 거치지 않으므로 하드 제외분만 미리 걸러 넘긴다
  const excludedTesterIds = new Set(
    absences.filter(a => a.type !== 'HALF_DAY').map(a => a.testerId),
  )

  let resolved: {
    mode: 'codex' | 'rule'
    pick: PickFn
    reasonByKey: Map<string, string>
    halfDayNotices: EngineHalfDayNotice[]
  } | null = null
  if (codexAssignEnabled()) {
    try {
      resolved = await autoAssignCodex(reps, excludedTesterIds)
    } catch (err) {
      console.error('[pctAssign] Codex 배분 실패 — 규칙엔진 폴백:', err)
    }
  }
  if (!resolved) resolved = await autoAssignRule(reps, absences)

  // [동시분석] 각 멤버는 자신이 속한 그룹 대표의 배정 결과를 따른다(한 시험자가 동시분석).
  const groupPick: PickFn = (o) => resolved!.pick(memberToRep.get(o.id) ?? o)
  const reasonFor = (o: OrderForAssign) => {
    const representative = memberToRep.get(o.id) ?? o
    return resolved!.reasonByKey.get(orderKey(representative))
      ?? '자동배정 조건을 만족하는 담당자를 찾지 못했습니다. 담당자 역량·휴가·업무량을 확인해 주세요.'
  }
  const applied = await applyAssignments(orders, groupPick, reasonFor)

  // [반차 확인] 엔진이 계산해 두고 버려졌던 반차 겹침을 오더 단위로 펼쳐
  // 결과에 실어 화면에 보여주고, 같은 내용을 관리자 알림으로도 남긴다.
  const halfDayNotices = collectHalfDayNotices({
    orders, reps, memberToRep, absences,
    engineNotices: resolved!.halfDayNotices,
    details: applied.details,
  })
  await notifyHalfDayNotices(halfDayNotices, orders, absences)

  return { mode: resolved!.mode, ...applied, halfDayNotices }
}

/**
 * 반차 겹침 배정을 실제 오더 단위로 펼친다.
 *
 * - 규칙엔진 경로: 엔진이 근무일 단위로 판정한 engineNotices 를 쓴다(날짜가 정확).
 *   엔진은 그룹 대표(rep)만 계산하므로 같은 그룹 멤버 오더에도 함께 붙인다.
 * - Codex 경로   : 엔진을 거치지 않아 판정이 없다. 오더 시험구간과 반차 구간의
 *   겹침으로 대신 판정한다(근무일 단위가 아니라 다소 보수적으로 잡힌다).
 */
function collectHalfDayNotices(input: {
  orders: OrderForAssign[]
  reps: OrderForAssign[]
  memberToRep: Map<string, OrderForAssign>
  absences: TesterAbsence[]
  engineNotices: EngineHalfDayNotice[]
  details: AssignResult['details']
}): HalfDayAssignNotice[] {
  const { orders, reps, memberToRep, absences, engineNotices, details } = input

  // 실제 배정된 담당자 (미배정 오더는 확인 대상이 아니다)
  const assignedBy = new Map<string, { testerId: string; testerName: string }>()
  for (const d of details) {
    if (d.testerId && d.testerName) assignedBy.set(d.orderId, { testerId: d.testerId, testerName: d.testerName })
  }
  const orderById = new Map(orders.map(o => [o.id, o]))
  const notices: HalfDayAssignNotice[] = []
  const push = (order: OrderForAssign, dates: string[]) => {
    const who = assignedBy.get(order.id)
    if (!who || dates.length === 0) return
    notices.push({
      orderId: order.id,
      productName: order.product_name,
      batchNo: order.batch_no,
      testerId: who.testerId,
      testerName: who.testerName,
      dates,
    })
  }

  if (engineNotices.length > 0) {
    // 대표 오더 키 → 같은 그룹에 속한 모든 오더
    const membersByRepId = new Map<string, OrderForAssign[]>()
    for (const o of orders) {
      const rep = memberToRep.get(o.id) ?? o
      const list = membersByRepId.get(rep.id) ?? []
      list.push(o)
      membersByRepId.set(rep.id, list)
    }
    const repByKey = new Map<string, OrderForAssign>()
    for (const r of reps) repByKey.set(orderKey(r), r)

    for (const n of engineNotices) {
      const rep = repByKey.get(`${n.productCode}|${n.batchNo}`)
      if (!rep) continue
      for (const member of membersByRepId.get(rep.id) ?? [rep]) {
        // 엔진 판정 시점과 최종 배정이 어긋날 수 있어(강제배정 규칙 등) 담당자가 같을 때만 알린다
        if (assignedBy.get(member.id)?.testerId !== n.testerId) continue
        push(member, n.dates)
      }
    }
    return notices
  }

  // Codex 경로 폴백 — 오더 시험구간 기준 반차 겹침
  const today = todayIso()
  const halfDayAbsences = absences.filter(a => a.type === 'HALF_DAY')
  if (halfDayAbsences.length === 0) return notices
  for (const [orderId, who] of assignedBy) {
    const order = orderById.get(orderId)
    if (!order) continue
    const window = orderTestWindow(
      { packagingDate: order.packaging_date, dueDate: order.due_date }, today,
    )
    const hit = findAbsenceConflicts(who.testerId, window, halfDayAbsences)
    if (hit.length === 0) continue
    push(order, hit.map(a => (a.from === a.to ? a.from : `${a.from}~${a.to}`)))
  }
  return notices
}

/** 반차 겹침 배정을 관리자 알림으로 남긴다. 알림 실패가 배정을 되돌리지 않는다. */
async function notifyHalfDayNotices(
  notices: HalfDayAssignNotice[],
  orders: OrderForAssign[],
  absences: TesterAbsence[],
): Promise<void> {
  if (notices.length === 0) return
  const today = todayIso()
  const orderById = new Map(orders.map(o => [o.id, o]))

  for (const n of notices) {
    const order = orderById.get(n.orderId)
    if (!order) continue
    const window = orderTestWindow({ packagingDate: order.packaging_date, dueDate: order.due_date }, today)
    const conflicts = findAbsenceConflicts(n.testerId, window, absences.filter(a => a.type === 'HALF_DAY'))
    if (conflicts.length === 0) continue
    await notifyLeaveConflict({
      orderId: n.orderId,
      productName: n.productName,
      batchNo: n.batchNo,
      testerId: n.testerId,
      conflicts,
      via: 'AI 자동배정',
    }).catch(() => {})
  }
}

/** 수동 단일 배정·배정 해제(testerId=null). 담당자가 실제로 바뀌면 재배정 이력 기록 */
export async function assignManually(
  orderId: string,
  testerId: string | null,
  opts: { changedBy?: string | null; reason?: string | null } = {},
): Promise<void> {
  // 비활성 시험자에게는 수동으로도 배정할 수 없다(계정 비활성 = 업무 제외).
  await assertTesterAssignable(testerId)

  // 변경 전 담당자 조회 → 재배정 이력용 (locked 컬럼까지 받기 위해 select('*'))
  const { data: before } = await supabaseAdmin
    .from('pct_orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle()
  const beforeUser = (before?.assignee_tester_id as string) ?? null

  // [원칙3] 확정(LOCK)된 오더는 배정·해제 대상에서 제외한다.
  if (before?.locked && beforeUser !== testerId) {
    throw new Error('확정(LOCK)된 오더는 담당자를 변경할 수 없습니다. 확정 해제 후 다시 시도해 주세요.')
  }

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

    // 수동 배정은 현장 예외를 막지 않으므로 차단하지 않는다.
    // 다만 휴가·출장 구간과 겹치면 관리자 알림을 남겨 사후 추적이 가능하게 한다.
    await warnIfAssigneeOnLeave({
      orderId,
      testerId,
      order: {
        packagingDate: (before?.packaging_date as string) ?? null,
        dueDate: (before?.due_date as string) ?? null,
      },
      productName: (before?.product_name as string) ?? '',
      batchNo: (before?.batch_no as string) ?? '',
      via: '수동 배정',
    })
  }
}
