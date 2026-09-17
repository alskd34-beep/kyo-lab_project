/**
 * [BACKEND] PCT 오더 AI 자동배정
 *
 * 1순위: Codex CLI(구독) 로 LLM 배분 — ENABLE_CODEX_ASSIGN=1 일 때.
 * 폴백:  기존 규칙엔진(scheduleEngine) — Codex 미사용/실패 시.
 *
 * 두 방식 모두 "업무가 적은 담당자 우선 + 공수/역량 고려" 정책을 따른다.
 * 결과의 testerId 를 대표 담당자(슬롯 1)로 영속한다 — DB 함수 set_order_primary_assignee(0049)가
 * pct_order_assignees 슬롯 1·미러(assignee_tester_id)·감사를 한 트랜잭션으로 쓴다.
 * AI 는 병렬 배정을 만들지 않고, 이미 병렬 배정된 오더(담당자 2명 이상)는 건드리지 않는다.
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
  filterPsychotropicCandidates,
  PSYCHOTROPIC_EXCLUDED_NAMES,
  isoWeekIndex,
  heavyMetalAssigneeForWeek,
  emergencyAllowed,
  difficultyPenalty,
} from '@backend/services/assignRules'
import { codexAssignEnabled, runCodexJson } from '@backend/lib/codexCli'
import { getHolidaySet } from '@backend/services/holidays'
import { kstNow, kstToday, kstYear } from '@backend/lib/kstDate'
import {
  NO_PACKAGING_DATE_REASON,
  buildCapResolver,
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
import {
  buildGroupsFromOrders, ensureAutoGroups, type OrderForGrouping,
} from '@backend/services/concurrentGroups'
import { loadFamilyByCode } from '@backend/services/concurrentProductFamilies'
import {
  AssignmentRejectedError, loadAssigneesByOrder, setOrderPrimaryAssignee,
} from '@backend/services/orderAssignees'

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
  /**
   * DB 함수가 업무 규칙으로 거절해 배정하지 못한 오더(LOCK 건너뜀 제외) — 배치는 멈추지 않고 계속한다.
   * 예: 대상 로드 뒤 누군가 작업을 시작함, 추천 시험자가 이미 그 오더의 병렬 담당자, 비활성 전환 등.
   */
  failures: Array<{ orderId: string; productName: string; batchNo: string; reason: string }>
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

/**
 * 배정 결과를 오더에 되붙이는 키 — **오더 id**.
 * 예전에는 `품목코드|제조번호` 였는데, 0052 부터 품목명·구분이 다르면 같은 품목코드·제조번호 오더가
 * 둘 이상 있을 수 있어(자동 + 수동 등) Map 이 덮어써져 배정 결과가 섞인다.
 */
function orderKey(order: OrderForAssign): string {
  return order.id
}

/** 엔진 결과 행의 키 — 입력 행에 실어 보낸 orderId. 없으면(다른 호출부) 예전 키로 */
function engineResultKey(r: { orderId?: string; productCode: string; batchNo: string }): string {
  return r.orderId ?? `${r.productCode}|${r.batchNo}`
}

/**
 * 대상 오더 로드 (orderIds 미지정 시 미배정 '대기' 전체).
 *
 * 2026-08-23 수정: 예전에는 `orderIds` 를 명시하면 status 필터가 통째로 사라져
 * '진행중'/'검토중'/'승인완료' 오더까지 재배정 대상이 됐다(PRD 원칙2 위반 —
 * "시험 시작 후 일정 변경 금지"). 이제 두 경로 모두 '대기' 상태만 대상으로 삼고,
 * 이미 QC 작업이 시작된 오더는 상태와 무관하게 제외한다.
 */
async function loadTargetOrders(orderIds?: string[]): Promise<OrderForAssign[]> {
  // select('*') 로 locked 컬럼까지 받되(0015 미적용 시 자동 누락), 잠긴 오더는 배정 제외.
  // pct_orders 는 소프트 삭제만 하므로 1000행 상한에 걸리지 않도록 페이지네이션한다.
  let q = supabaseAdmin
    .from('pct_orders')
    .select('*')
    .neq('status', DELETED_STATUS)
    // [원칙2] 작업 미시작('대기') 오더만 자동배정/재배정 대상이다.
    .eq('status', PENDING_STATUS)
  if (orderIds && orderIds.length > 0) q = q.in('id', orderIds)
  else q = q.is('assignee_tester_id', null)
  const { data, error } = await q.range(0, 9999)
  if (error) throw error

  // [원칙3] LOCK(확정) 오더는 자동배정/재배정 대상에서 제외
  const candidates = (data ?? []).filter(o => !o.locked) as OrderForAssign[]
  if (candidates.length === 0) return []

  // [원칙2] QC 작업이 이미 생성된 오더는 상태 표기와 무관하게 제외한다.
  const { data: jobs } = await supabaseAdmin
    .from('qc_jobs')
    .select('order_id')
    .in('order_id', candidates.map(o => o.id))
  const started = new Set((jobs ?? []).map(j => j.order_id as string))
  const notStarted = candidates.filter(o => !started.has(o.id))
  if (notStarted.length === 0) return []

  // [병렬 배정] AI 는 병렬 배정(담당자 2명 이상) 오더를 건드리지 않는다 — 명시 orderIds 경로에서도.
  // 대표만 바꾸면 병렬 담당자 구성이 관리자 모르게 흔들린다. 미배정 경로(assignee_tester_id is null)는
  // 담당자 행이 0개라 원래 해당이 없지만 같은 기준으로 한 번에 거른다.
  const assigneeMap = await loadAssigneesByOrder(notStarted.map(o => o.id))
  return notStarted.filter(o => (assigneeMap.get(o.id)?.length ?? 0) < 2)
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
  const today = kstToday()
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
    .select('id, status')
    .not('assignee_tester_id', 'is', null)
    .not('status', 'in', `("${CLOSED_STAGE}","${DELETED_STATUS}")`)
    .range(0, 9999)
  const liveIds = new Set((data ?? []).map(r => r.id as string))
  const m = new Map<string, number>()
  if (liveIds.size === 0) return m
  // [병렬 배정] 담당자 1~5 모두 그 오더를 손에 들고 있다 — 오더당 담당자 N명 각각 +1.
  // 대표만 세면 병렬 담당자로 몇 건을 맡고 있든 부하가 0으로 보여, 자동배정이 그 사람을
  // "가장 한가한 사람"으로 골라 신규 오더를 몰아준다. (AI 가 병렬 배정을 새로 만들지 않는다는
  //  규칙은 그대로다 — 이미 만들어진 병렬 배정을 부하 계산에서 보이게 하는 것뿐이다.)
  // 열린 오더 id 가 많아 in() 대신 담당자 테이블 전체를 한 번 읽어 거른다.
  const assigneeMap = await loadAssigneesByOrder()
  for (const [orderId, slots] of assigneeMap) {
    if (!liveIds.has(orderId)) continue
    for (const a of slots) m.set(a.testerId, (m.get(a.testerId) ?? 0) + 1)
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
      // [규칙1] 향정신성 제외 대상은 강제배정으로도 뚫리지 않아야 한다.
      const eligible = isPsychotropic(order.product_name)
        ? filterPsychotropicCandidates(order.product_name, ctx.testers).candidates
        : ctx.testers
      const t = heavyMetalAssigneeForWeek(ctx.weekIndex, eligible)
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
      .select('id, product_code')
      .not('assignee_tester_id', 'is', null)
      .neq('status', DELETED_STATUS)
      .gte('created_at', twoWeeksAgoIso),   // [규칙4] 최근 2주(14일)
    supabaseAdmin.from('products').select('product_code, difficulty'),
  ])
  const diffByCode = new Map<string, string>()
  for (const p of prods ?? []) diffByCode.set(String(p.product_code), (p.difficulty as string) ?? '')
  // [병렬 배정] 담당자 1~5 모두 그 HIGH 품목을 나눠 맡는다 — 대표만 세던 틈을 함께 고친다.
  const highOrderIds = (orders ?? [])
    .filter(o => diffByCode.get(String(o.product_code)) === 'High')
    .map(o => o.id as string)
  const assigneeMap = await loadAssigneesByOrder(highOrderIds)
  const counts = new Map<string, number>()
  for (const orderId of highOrderIds) {
    for (const a of assigneeMap.get(orderId) ?? []) {
      counts.set(a.testerId, (counts.get(a.testerId) ?? 0) + 1)
    }
  }
  const penalty: Record<string, number> = {}
  for (const [id, cnt] of counts) penalty[id] = difficultyPenalty(cnt)
  return penalty
}

/** LOCK 거절 문구(DB 함수 0049) — 자동배정은 이 경우 오류가 아니라 건너뜀으로 처리한다 */
const LOCKED_ASSIGN_REJECT = '확정(LOCK)된 오더는 담당자를 변경할 수 없습니다'

/** 배정 결과 적용 — 대표 담당자(슬롯 1)만 DB 함수로 기록한다(미러·감사 포함) */
async function applyAssignments(
  orders: OrderForAssign[],
  pick: (order: OrderForAssign) => { id: string; name: string } | null,
  reasonFor: (order: OrderForAssign) => string,
): Promise<Omit<AssignResult, 'mode' | 'halfDayNotices'>> {
  const details: AssignResult['details'] = []
  const failures: AssignResult['failures'] = []
  let assigned = 0
  for (const o of orders) {
    // [최종 반영 직전] 포장일 없는 오더(수동 오더 포장일 N/A 등)는 어떤 경로의 결과로도 배정하지 않는다 —
    // 그룹 대표 결과 전파·Codex 응답·강제배정 규칙이 사전 제외를 우회하지 못하게 여기서 한 번 더 막는다.
    const hit = o.packaging_date ? pick(o) : null
    // [규칙1] 향정신성 의약품(자이렌정·아디펙스정)은 강지윤·김정호 배정 불가
    if (hit?.id && isPsychotropic(o.product_name) && PSYCHOTROPIC_EXCLUDED_NAMES.includes(hit.name as never)) {
      const note = withAutoUnassignedNote(o.note, '향정신성 의약품 제외 대상(배정 불가)')
      const { error } = await supabaseAdmin.from('pct_orders').update({ note }).eq('id', o.id)
      if (error) throw error
      details.push({ orderId: o.id, testerId: null, testerName: null, note: '향정신성 의약품 제외 대상(배정 불가)' })
      continue
    }
    if (hit?.id) {
      // 대표 담당자(슬롯 1) + 미러 + 감사를 한 트랜잭션으로. 대상 로드 시점 이후 다른 관리자가
      // LOCK 을 걸었으면 함수가 오더 행을 잠근 뒤 거절한다 → 건너뜀으로 기록한다.
      let result
      try {
        result = await setOrderPrimaryAssignee(o.id, hit.id, null, 'AI 자동배정')
      } catch (e) {
        if (e instanceof Error && e.message.includes(LOCKED_ASSIGN_REJECT)) {
          details.push({ orderId: o.id, testerId: null, testerName: null, note: '확정(LOCK) 상태로 변경되어 건너뜀' })
          continue
        }
        // 업무 규칙 거절은 이 오더만 실패로 모으고 다음 오더로 넘어간다 — 앞 오더들은 이미 배정됐는데
        // 배치 전체를 500 으로 끝내면 관리자는 전부 실패한 줄 안다. 설치·DB 오류는 모든 오더에 같으므로 멈춘다.
        if (e instanceof AssignmentRejectedError) {
          details.push({ orderId: o.id, testerId: null, testerName: null, note: `배정 실패: ${e.message}` })
          failures.push({ orderId: o.id, productName: o.product_name, batchNo: o.batch_no, reason: e.message })
          continue
        }
        throw e
      }
      // 미배정 사유 메모 정리는 배정이 성공한 뒤에만(담당자 컬럼과 무관한 note 만 쓴다)
      const cleanedNote = withoutAutoUnassignedNote(o.note)
      if (cleanedNote !== (o.note ?? null)) {
        const { error } = await supabaseAdmin.from('pct_orders').update({ note: cleanedNote }).eq('id', o.id)
        if (error) console.error('[pctAssign] 자동배정 미배정 사유 메모 정리 실패 — 배정은 반영됨:', o.id, error)
      }
      assigned++
      details.push({ orderId: o.id, testerId: hit.id, testerName: hit.name, note: '배정됨' })
      if (result.changed) {
        await logReassignment({
          orderId: o.id,
          beforeUser: result.beforeTesterId,
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
  return { assigned, unassigned: orders.length - assigned, details, failures }
}

// ─── Codex CLI 배분 ───────────────────────────────────────────────────────────
interface CodexAssignResponse {
  assignments: Array<{ orderId: string; testerId: string | null }>
}

async function autoAssignCodex(
  orders: OrderForAssign[],
  excludedTesterIds: Set<string>,
): Promise<{ mode: 'codex'; pick: PickFn; reasonByKey: Map<string, string>; halfDayNotices: EngineHalfDayNotice[] }> {
  const [allTesters, capabilities, matrix, itemsByCode, workload, equipRes] = await Promise.all([
    listTesters({ activeOnly: true }), listCapabilities(), listCapabilityMatrix(), productItemsByCode(), currentWorkload(),
    selectAll(supabaseAdmin, 'test_item_equipment', 'test_item, required_equipment, is_universal'),
  ])
  // 비활성(퇴사·휴직 등) 시험자와 휴가/출장 중인 시험자는 배정 후보에서 제외
  const testers = allTesters.filter(t => t.isActive && !excludedTesterIds.has(t.id))

  // 시험자별 보유 역량명 (Y/O 만) — LLM 프롬프트 컨텍스트용
  const capNameById = new Map<string, string>()
  for (const c of capabilities) capNameById.set(c.id, c.name ?? c.code ?? c.id)
  const capsByTester = new Map<string, string[]>()
  // 시험자별 보유 역량 **id** 집합 — 결과 검증용(엔진의 can() 과 동일 기준)
  const capIdsByTester = new Map<string, Set<string>>()
  for (const m of matrix) {
    if (m.proficiencyLevel === 'Y' || m.proficiencyLevel === 'O') {
      const arr = capsByTester.get(m.testerId) ?? []
      const nm = capNameById.get(m.capabilityId)
      if (nm) arr.push(nm)
      capsByTester.set(m.testerId, arr)

      const ids = capIdsByTester.get(m.testerId) ?? new Set<string>()
      ids.add(m.capabilityId)
      capIdsByTester.set(m.testerId, ids)
    }
  }

  // 시험항목 → 필요 capability id 목록 (엔진의 reqOf 와 같은 해석기를 재사용한다).
  // 매핑이 없거나 is_universal 인 항목은 제약 없음으로 본다(엔진과 동일한 보수적 처리).
  const resolveCaps = buildCapResolver(
    capabilities.map(c => ({ id: c.id, code: c.code ?? '', name: c.name ?? '' })),
  )
  const equipByItem = new Map<string, { required: string; universal: boolean }>()
  for (const e of equipRes.data ?? []) {
    equipByItem.set(e.test_item as string, {
      required: (e.required_equipment as string) ?? '',
      universal: !!e.is_universal,
    })
  }
  const capIdsForItem = (testItem: string): string[] => {
    const e = equipByItem.get(testItem)
    if (!e || e.universal) return []
    return resolveCaps(e.required)
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
    packagingDate: o.packaging_date,
    dueDate: o.due_date,
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
    // [검증] 포장일 없는 오더는 LLM 이 담당자를 지목해도 받지 않는다(규칙엔진과 같은 기준 — 자동배정 대상 아님).
    if (!o.packaging_date) return null
    const tid = byOrder.get(o.id)
    if (!tid || !testerById.has(tid)) return null

    // [검증] 프롬프트의 "역량을 갖춘 시험자만 배정한다"는 강제력이 없다.
    // 예전에는 LLM 이 역량 미보유 시험자를 지목해도 그대로 DB 에 반영됐다.
    // 규칙엔진과 **동일한 기준**(capability id 집합 포함관계)으로 사후 검증한다.
    const requiredCaps = new Set<string>()
    for (const item of itemsByCode.get(o.product_code) ?? []) {
      for (const capId of capIdsForItem(item)) requiredCaps.add(capId)
    }
    const have = capIdsByTester.get(tid) ?? new Set<string>()
    const missing = [...requiredCaps].filter(c => !have.has(c))
    if (missing.length > 0) {
      console.warn(
        '[pctAssign] LLM 이 역량 미보유 시험자를 지목해 폐기하고 규칙엔진 결과로 대체합니다 — ' +
        `오더 ${o.product_code}/${o.batch_no}, 시험자 ${testerById.get(tid)}`,
      )
      return null
    }
    return { id: tid, name: testerById.get(tid)! }
  }
  // [규칙2] 개별 중금속 금요일 순환 강제배정을 LLM 결과 위에 덧씌운다.
  const pick = withForcedRules(basePick, {
    itemsByCode,
    testers: testers.map(t => ({ id: t.id, name: t.name })),
    weekIndex: isoWeekIndex(kstNow()),
  })
  // Codex 경로는 엔진을 거치지 않아 반차 판정이 없다 — autoAssign 이 오더 구간 기준으로 채운다.
  return { mode: 'codex', pick, reasonByKey: new Map(), halfDayNotices: [] as EngineHalfDayNotice[] }
}

// ─── 규칙엔진 배분 (폴백) ──────────────────────────────────────────────────────
async function autoAssignRule(
  orders: OrderForAssign[],
  absences: Array<{ testerId: string; from: string; to: string; type: string }>,
  excludedTesterIds: Set<string>,
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
      orderId:  o.id,
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

  // 공휴일 — PRD "주말+공휴일 스킵". 전달하지 않으면 엔진이 빈 Set 으로 폴백해
  // 설·추석 같은 연휴를 근무일로 계산한다(2026-08-23 점검에서 누락 발견).
  // public_holidays 조회 실패 시에는 빈 Set 으로 두되 경고를 남긴다 — 조용히 넘기면
  // "공휴일에 배정된 일정"이 정상 결과처럼 보고된다.
  const holidays = await getHolidaySet().catch(err => {
    console.error('[pctAssign] 공휴일 조회 실패 — 주말만 비근무일로 계산합니다:', err)
    return new Set<string>()
  })
  if (holidays.size === 0) {
    console.warn('[pctAssign] 공휴일 데이터가 비어 있습니다. /api/holidays/import 로 해당 연도를 적재하세요.')
  }

  const engine = generatePctSchedule({
    rows, testers, capabilities,
    matrix: matrix.map(m => ({ testerId: m.testerId, capabilityId: m.capabilityId, level: m.proficiencyLevel })),
    productItems, equipment, workload, year: kstYear(), initialLoad,
    absences,
    holidays,
  })

  const testerByKey = new Map<string, { id: string; name: string }>()
  for (const a of engine.assignments) testerByKey.set(engineResultKey(a), { id: a.testerId, name: a.testerName })
  const reasonByKey = new Map<string, string>()
  for (const item of engine.unassigned) reasonByKey.set(engineResultKey(item), item.reason)

  // [규칙1] 향정신성 오더는 **사후 거부가 아니라 사전 필터**로 처리한다.
  //
  // 예전에는 엔진이 강지윤/김정호를 뽑으면 applyAssignments 가 그냥 미배정 처리하고
  // 대체 시험자를 다시 찾지 않아, 배정 가능한 다른 사람이 있어도 오더가 비어 있었다.
  // (사전 필터용 filterPsychotropicCandidates 는 만들어져 있었지만 호출되지 않고 있었다)
  // 향정신성 오더만 제외 대상을 뺀 후보로 엔진을 한 번 더 돌려 대체자를 찾는다.
  const psychoOrders = orders.filter(o => isPsychotropic(o.product_name))
  const psychoByKey = new Map<string, { id: string; name: string }>()
  if (psychoOrders.length > 0) {
    const allowed = filterPsychotropicCandidates(
      psychoOrders[0].product_name,
      testers.map(t => ({ id: t.id, name: t.name })),
    ).candidates
    const allowedIds = new Set(allowed.map(t => t.id))
    const psychoEngine = generatePctSchedule({
      rows: rows.filter(r => isPsychotropic(r.품목명)),
      testers: testers.filter(t => allowedIds.has(t.id)),
      capabilities,
      matrix: matrix.map(m => ({ testerId: m.testerId, capabilityId: m.capabilityId, level: m.proficiencyLevel })),
      productItems, equipment, workload, year: kstYear(), initialLoad,
      absences, holidays,
    })
    for (const a of psychoEngine.assignments) {
      psychoByKey.set(engineResultKey(a), { id: a.testerId, name: a.testerName })
    }
    for (const item of psychoEngine.unassigned) {
      reasonByKey.set(engineResultKey(item), item.reason)
    }
  }

  // [규칙2] 개별 중금속 주차 순환 강제배정을 엔진 결과 위에 덧씌운다.
  //
  // 강제배정 후보에서 연차·출장자를 제외한다. `testers` 는 엔진이 날짜 단위로 부재를
  // 판정하도록 일부러 거르지 않은 목록이라, 그대로 넘기면 강제배정만 부재 판정을
  // 건너뛰어 "휴가 중인 사람에게 중금속 시험 배정"이 발생한다.
  // (LLM 경로는 이미 excludedTesterIds 로 걸러 넘기고 있었다 — 두 경로가 어긋나 있었다)
  const forcedCandidates = testers
    .filter(t => !excludedTesterIds.has(t.id))
    .map(t => ({ id: t.id, name: t.name }))
  const pick = withForcedRules(
    (o) => {
      const key = orderKey(o)
      // 향정신성 오더는 제외 대상을 뺀 후보로 재계산한 결과를 우선한다.
      if (isPsychotropic(o.product_name)) return psychoByKey.get(key) ?? null
      return testerByKey.get(key) ?? null
    },
    { itemsByCode, testers: forcedCandidates, weekIndex: isoWeekIndex(kstNow()) },
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
    return { mode: 'rule', assigned: 0, unassigned: 0, details: [], halfDayNotices: [], failures: [] }
  }

  // AI 경로도 동시분석 실행 단위를 영속화한다. 이 호출은 기존 그룹과 LOCK 그룹을
  // 건드리지 않고, 아직 그룹이 없는 오더에 대해서만 자동 그룹을 추가한다.
  try {
    await ensureAutoGroups()
  } catch (err) {
    // 그룹 표시용 보정 실패가 실제 AI/규칙 배정을 막지 않도록 한다.
    console.warn('[pctAssign] 동시분석 그룹 보정 실패 — 배정은 계속 진행:', err)
  }

  // [동시분석] 동일 품목군(기준설정 마스터)/유사 품목명을 한 그룹으로 묶고 대표만 배정 대상으로 삼는다.
  // 엔진/LLM 에는 reps 만 태워 공수를 그룹당 1회 계산하고, 배정 결과를 멤버 전체에 전파한다.
  // [후보 구성] 포장일 없는 오더는 그룹 구성·엔진·LLM 입력에서 뺀다 — 포장일 있는 대표와 같은 그룹이 되면
  // 대표 결과를 전파받아 배정되기 때문이다. 결과 목록에는 applyAssignments 가 사유와 함께 남긴다.
  const familyByCode = await loadFamilyByCode().catch(() => new Map<string, string>())
  const { reps, memberToRep } = groupOrders(orders.filter(o => !!o.packaging_date), familyByCode)

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
  // 대상이 모두 포장일 없는 오더면 엔진·LLM 을 부르지 않는다(전부 사유와 함께 미배정으로 남는다)
  if (reps.length === 0) {
    resolved = { mode: 'rule', pick: () => null, reasonByKey: new Map(), halfDayNotices: [] }
  }
  if (!resolved && codexAssignEnabled()) {
    try {
      resolved = await autoAssignCodex(reps, excludedTesterIds)
    } catch (err) {
      console.error('[pctAssign] Codex 배분 실패 — 규칙엔진 폴백:', err)
    }
  }
  if (!resolved) resolved = await autoAssignRule(reps, absences, excludedTesterIds)

  // [동시분석] 각 멤버는 자신이 속한 그룹 대표의 배정 결과를 따른다(한 시험자가 동시분석).
  const groupPick: PickFn = (o) => resolved!.pick(memberToRep.get(o.id) ?? o)
  const reasonFor = (o: OrderForAssign) => {
    // 포장일 없는 오더는 후보에서 빠졌다 — 어느 경로(규칙엔진·Codex)든 같은 사유로 알린다
    if (!o.packaging_date) return NO_PACKAGING_DATE_REASON
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
      const rep = repByKey.get(engineResultKey(n))
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

/**
 * 수동 단일 배정·배정 해제(testerId=null) — 대표 담당자(슬롯 1)만 바꾼다.
 *
 * 검사·슬롯 1·미러·구 컬럼·감사는 DB 함수 set_order_primary_assignee(0049)가 한 트랜잭션으로 한다:
 *   · LOCK 오더 거절 · 비활성 시험자 거절
 *   · 병렬 담당자가 남은 오더의 대표 해제 거절 · 이미 이 오더의 병렬 담당자인 사람을 대표로 넣기 거절
 *   · 이미 작업을 시작한 대표의 교체·해제 거절
 * 이 서비스는 커밋 뒤 재배정 이력·휴가 겹침 알림만 한다. 담당자가 실제로 바뀐 경우에만.
 */
export async function assignManually(
  orderId: string,
  testerId: string | null,
  opts: { changedBy?: string | null; reason?: string | null } = {},
): Promise<void> {
  // 비활성 시험자에게는 수동으로도 배정할 수 없다(계정 비활성 = 업무 제외). 최종 판정은 DB 함수.
  await assertTesterAssignable(testerId)

  const result = await setOrderPrimaryAssignee(
    orderId,
    testerId,
    opts.changedBy ?? null,
    opts.reason?.trim() || (testerId ? '수동 배정' : '수동 배정 해제'),
  )
  if (!result.changed) return

  // 알림 문구용 오더 정보(커밋 뒤 읽기). select('*') — 0042(planned_start_date) 미적용 환경에서도 깨지지 않게
  const { data: order } = await supabaseAdmin
    .from('pct_orders')
    .select('*')
    .eq('id', orderId)
    .maybeSingle()

  // 담당자가 실제로 바뀐 경우에만 이력 기록 (분석용: 누가/왜/어느 품목에서 변경되는가)
  await logReassignment({
    orderId,
    beforeUser: result.beforeTesterId,
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
      packagingDate: (order?.packaging_date as string) ?? null,
      dueDate: (order?.due_date as string) ?? null,
      plannedStartDate: (order?.planned_start_date as string) ?? null,
    },
    productName: (order?.product_name as string) ?? '',
    batchNo: (order?.batch_no as string) ?? '',
    via: '수동 배정',
  })
}
