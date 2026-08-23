/**
 * [BACKEND] Chat 서비스 - 역할별 챗봇 라우팅
 *
 * 관리자(admin)는 Letsur Staix(OpenAI 호환 게이트웨이), 시험자(tester)는 MISO(Dify 호환)를
 * 호출해 답변을 생성하고, 프런트엔드는 동일한 Dify 호환 SSE 포맷을 그대로 재사용합니다.
 *           data: {"event":"message","answer":"...","conversation_id":"..."}\n\n
 *           data: [DONE]\n\n
 */

import { randomUUID } from 'crypto'
import { DELETED_STATUS } from '@shared/qc-status'
import { supabaseAdmin, supabaseAdmin as supabase } from '@backend/lib/supabase'
import { runLetsurText } from '@backend/lib/letsurClient'
import { runMisoText } from '@backend/lib/misoClient'
import { codexAssistantModel, runCodexText, type CodexCliError } from '@backend/lib/codexCli'
import { buildQthinkAnswerPrompt } from '@backend/lib/qthinkPrompts'
import {
  analyzeQthinkIntent,
  buildQthinkDataContext,
  matchQthinkFixedIntent,
  selectRelevantHistory,
  type QthinkModelRunner,
  type QthinkScope,
} from '@backend/services/qthinkAgent'

const HISTORY_LIMIT  = 10
const ACTIVE_STATUSES = ['pending', 'in_progress', 'on_hold']

type Role = 'admin' | 'tester'

/** 요청자 신원 (권한 스코프 산정용) */
export interface ChatViewer {
  userSub: string
  role: Role
}

/** 조회 권한 범위: 관리자=전체, 그 외=본인 배정(tester_id)만 */
type Scope = QthinkScope

interface ChatRequest {
  message: string
  /** 기존 호환성을 위해 이름은 conversationId(=dify_conv_id로 매핑) 유지 */
  conversationId?: string
  viewer: ChatViewer
  signal?: AbortSignal
  /** 첨부 이미지 file id 목록 (시험자/MISO 전용) */
  imageFileIds?: string[]
  /** 브라우저가 보유한 최근 대화. DB 저장 지연 시 문맥 폴백으로 사용한다. */
  recentHistory?: ChatMsg[]
}

interface ChatMsg {
  role: 'user' | 'assistant'
  content: string
}

// ─── DB 컨텍스트 빌더 ─────────────────────────────────────────────────────────

interface ProductLite {
  id: string
  product_code: string
  name: string
  name_alt: string | null
  package_spec: string | null
  product_type: string | null
}

interface TesterLite {
  id: string
  name: string
  employee_no: string
}

/** 메시지에서 언급된 품목/시험자 + 날짜 의도를 찾아 DB 사실 컨텍스트 블록을 생성합니다. (권한 스코프 적용) */
async function buildDbContext(message: string, scope: Scope): Promise<string> {
  const sections: string[] = []

  try {
    // 1) 후보 매칭: 모든 품목/시험자 이름을 메모리로 가져와 substring 매칭
    const [{ data: prodAll }, { data: testAll }] = await Promise.all([
      supabase.from('products').select('id, product_code, name, name_alt, package_spec, product_type').eq('is_active', true),
      supabase.from('testers').select('id, name, employee_no').eq('is_active', true),
    ])

    const products = (prodAll ?? []) as ProductLite[]
    const testers  = (testAll ?? []) as TesterLite[]

    const matchedProducts = matchProducts(message, products).slice(0, 3)
    let matchedTesters    = matchTesters(message, testers)
    // 비관리자는 본인 시험자 정보만 (타인 일정·업무 노출 차단)
    if (!scope.isAdmin) matchedTesters = matchedTesters.filter(t => t.id === scope.testerId)
    matchedTesters = matchedTesters.slice(0, 3)

    // 0) 날짜 의도(오늘/내일/이번 주/특정일) → 일정 블록
    const range = detectDateRange(message)
    if (range) {
      const block = await buildScheduleBlock(range, scope)
      if (block) sections.push(block)
    }

    // 1) 긴급 의도("긴급/시급/급한") → 긴급 오더 블록 (날짜 의도 있으면 기간 한정)
    if (/긴급|시급|급한|급하게/.test(message)) {
      const block = await buildUrgentBlock(scope, range)
      if (block) sections.push(block)
    }

    // 2) 품목 컨텍스트 (마스터·시험항목 + PCT 오더·시험 전 확인사항)
    for (const p of matchedProducts) {
      const base = await buildProductBlock(p)
      if (base) sections.push(base)
      const pct = await buildProductPctBlock(p, scope)
      if (pct) sections.push(pct)
    }

    // 3) 시험자 컨텍스트 (기존 역량·할당 + PCT 오더)
    for (const t of matchedTesters) {
      const base = await buildTesterBlock(t)
      if (base) sections.push(base)
      const pct = await buildTesterOrdersBlock(t, scope)
      if (pct) sections.push(pct)
    }
  } catch (err) {
    console.error('[chat] buildDbContext 실패', err)
  }

  if (sections.length === 0) return ''
  const header = scope.isAdmin
    ? '[DB 컨텍스트]'
    : '[DB 컨텍스트] (아래는 요청자 본인에게 배정된 범위로 제한된 정보입니다.)'
  return `${header}\n${sections.join('\n\n')}`
}

function matchProducts(message: string, products: ProductLite[]): ProductLite[] {
  const out: ProductLite[] = []
  for (const p of products) {
    const candidates = [p.name, p.name_alt, p.product_code].filter(Boolean) as string[]
    if (candidates.some(c => c.length >= 2 && message.includes(c))) {
      out.push(p)
    }
  }
  return out
}

function matchTesters(message: string, testers: TesterLite[]): TesterLite[] {
  return testers.filter(t => t.name.length >= 2 && message.includes(t.name))
}

async function buildProductBlock(p: ProductLite): Promise<string> {
  // 시험항목
  const { data: links } = await supabase
    .from('product_test_items')
    .select('test_item_id, sequence_order, is_mandatory')
    .eq('product_id', p.id)
    .order('sequence_order', { ascending: true })

  const itemIds = (links ?? []).map(l => l.test_item_id as string)
  let itemNames: string[] = []
  if (itemIds.length > 0) {
    const { data: items } = await supabase
      .from('test_items')
      .select('id, name')
      .in('id', itemIds)
    const byId = new Map<string, string>((items ?? []).map(i => [i.id as string, i.name as string]))
    itemNames = (links ?? []).map(l => byId.get(l.test_item_id as string) ?? '').filter(Boolean)
  }

  // 진행중 배치
  const { data: batches } = await supabase
    .from('production_batches')
    .select('batch_no, spec, status, packaging_planned_date, qc_planned_completion_date')
    .eq('product_id', p.id)
    .in('status', ACTIVE_STATUSES)
    .order('packaging_planned_date', { ascending: true })
    .limit(5)

  const lines: string[] = []
  lines.push(`### 품목: ${p.name}${p.name_alt && p.name_alt !== p.name ? ` (${p.name_alt})` : ''}`)
  lines.push(`- 품목코드: ${p.product_code}`)
  if (p.package_spec) lines.push(`- 포장규격: ${p.package_spec}`)
  if (p.product_type) lines.push(`- 구분: ${p.product_type}`)
  lines.push(`- 등록 시험항목 ${itemNames.length}개${itemNames.length > 0 ? ': ' + itemNames.slice(0, 12).join(' / ') + (itemNames.length > 12 ? ' …' : '') : ''}`)
  if (batches && batches.length > 0) {
    lines.push(`- 진행/예정 배치 ${batches.length}건:`)
    for (const b of batches) {
      lines.push(`  · 배치 ${b.batch_no} | 규격 ${b.spec ?? '-'} | 상태 ${b.status} | 포장예정 ${b.packaging_planned_date ?? '-'} | QC완료예정 ${b.qc_planned_completion_date ?? '-'}`)
    }
  } else {
    lines.push(`- 진행/예정 배치 없음`)
  }
  return lines.join('\n')
}

async function buildTesterBlock(t: TesterLite): Promise<string> {
  // 기본 정보 (단독/2인 가능 여부)
  const { data: testerMeta } = await supabase
    .from('testers')
    .select('can_solo, can_duo, is_active')
    .eq('id', t.id)
    .maybeSingle()

  // 역량 매트릭스
  const { data: caps } = await supabase
    .from('tester_capability_matrix')
    .select('capability_id, proficiency_level')
    .eq('tester_id', t.id)

  const capRows = caps ?? []
  const capIds  = capRows.map(c => c.capability_id as string)
  const { data: capMeta } = capIds.length
    ? await supabase.from('test_capabilities').select('id, name, code').in('id', capIds)
    : { data: [] as { id: string; name: string; code: string }[] }
  const capNameById = new Map<string, string>(
    (capMeta ?? []).map(c => [c.id as string, c.name as string]),
  )
  const grouped: Record<string, string[]> = { O: [], Y: [], N: [], X: [] }
  for (const r of capRows) {
    const lv = (r.proficiency_level as string) ?? 'X'
    const name = capNameById.get(r.capability_id as string)
    if (!name) continue
    if (grouped[lv]) grouped[lv].push(name)
  }

  // 현재 할당된 업무
  const { data: assigns } = await supabase
    .from('batch_test_assignments')
    .select('id, batch_id, test_item_id, status, scheduled_start_at, scheduled_end_at, actual_start_at, primary_tester_id, secondary_tester_id, estimated_hours')
    .or(`primary_tester_id.eq.${t.id},secondary_tester_id.eq.${t.id}`)
    .in('status', ACTIVE_STATUSES)
    .order('scheduled_start_at', { ascending: true })
    .limit(20)

  const rows = assigns ?? []
  const headerLines: string[] = []
  headerLines.push(`### 시험자: ${t.name} (사번 ${t.employee_no})`)
  if (testerMeta) {
    const flags: string[] = []
    if (testerMeta.can_solo) flags.push('단독시험 가능')
    if (testerMeta.can_duo)  flags.push('2인시험 가능')
    if (!testerMeta.is_active) flags.push('비활성')
    if (flags.length) headerLines.push(`- 자격: ${flags.join(', ')}`)
  }
  // 역량 요약 (범례: O=우수, Y=가능, N=불가, X=미평가)
  const capSummary: string[] = []
  if (grouped.O.length) capSummary.push(`  · 우수(O) ${grouped.O.length}종: ${grouped.O.join(', ')}`)
  if (grouped.Y.length) capSummary.push(`  · 가능(Y) ${grouped.Y.length}종: ${grouped.Y.join(', ')}`)
  if (grouped.N.length) capSummary.push(`  · 불가(N) ${grouped.N.length}종: ${grouped.N.join(', ')}`)
  if (grouped.X.length) capSummary.push(`  · 미평가(X) ${grouped.X.length}종`)
  if (capSummary.length) {
    headerLines.push(`- 역량 매트릭스 (총 ${capRows.length}종):`)
    headerLines.push(...capSummary)
  } else {
    headerLines.push(`- 역량 매트릭스: 등록된 항목 없음`)
  }

  if (rows.length === 0) {
    headerLines.push(`- 현재 할당된(진행중·대기·보류) 업무 없음`)
    return headerLines.join('\n')
  }

  // 배치/시험항목 보강
  const batchIds = Array.from(new Set(rows.map(r => r.batch_id as string)))
  const itemIds  = Array.from(new Set(rows.map(r => r.test_item_id as string)))

  const [batchRes, itemRes] = await Promise.all([
    supabase.from('production_batches').select('id, batch_no, spec, product_id').in('id', batchIds),
    supabase.from('test_items').select('id, name').in('id', itemIds),
  ])

  const batchById = new Map<string, { batch_no: string; spec: string | null; product_id: string }>(
    (batchRes.data ?? []).map(b => [b.id as string, { batch_no: b.batch_no as string, spec: b.spec as string | null, product_id: b.product_id as string }]),
  )
  const itemById = new Map<string, string>(
    (itemRes.data ?? []).map(i => [i.id as string, i.name as string]),
  )

  const productIds = Array.from(new Set([...batchById.values()].map(b => b.product_id)))
  const { data: prodRows } = productIds.length
    ? await supabase.from('products').select('id, name, product_code').in('id', productIds)
    : { data: [] as { id: string; name: string; product_code: string }[] }
  const prodById = new Map<string, { name: string; product_code: string }>(
    (prodRows ?? []).map(p => [p.id as string, { name: p.name as string, product_code: p.product_code as string }]),
  )

  const lines: string[] = [...headerLines]
  lines.push(`- 현재 할당된 업무 ${rows.length}건:`)
  for (const r of rows) {
    const b = batchById.get(r.batch_id as string)
    const prod = b ? prodById.get(b.product_id) : undefined
    const itemName = itemById.get(r.test_item_id as string) ?? '?'
    const role = r.primary_tester_id === t.id ? '주' : '부'
    lines.push(
      `  · [${role}] ${prod?.name ?? '?'}(${prod?.product_code ?? '-'}) 배치 ${b?.batch_no ?? '-'} | 시험: ${itemName} | 상태 ${r.status}` +
      (r.scheduled_start_at ? ` | 예정 ${String(r.scheduled_start_at).slice(0, 16).replace('T', ' ')}` : '') +
      (r.estimated_hours ? ` | 예상 ${r.estimated_hours}h` : ''),
    )
  }
  return lines.join('\n')
}

// ─── PCT 오더/작업·시험 전 확인사항·일정 (권한 스코프 적용) ──────────────────────

interface OrderRow {
  id: string
  product_code: string
  product_name: string
  batch_no: string
  due_date: string | null
  method: string | null
  status: string
  is_urgent: boolean
  assignee_tester_id: string | null
}
interface JobInfo {
  qcNo: string
  status: string
  items: { name: string; status: string }[]
}

/** 요청자 신원 → 조회 권한 범위 산정 (관리자=전체, 그 외=본인 tester_id) */
async function resolveScope(viewer: ChatViewer): Promise<Scope> {
  if (viewer.role === 'admin') return { isAdmin: true, testerId: null, userId: viewer.userSub }
  let testerId: string | null = null
  try {
    const { data } = await supabaseAdmin
      .from('users').select('tester_id').eq('id', viewer.userSub).maybeSingle()
    testerId = (data?.tester_id as string) ?? null
  } catch { /* 무시 — 폴백: 본인 연결 없음 */ }
  return { isAdmin: false, testerId, userId: viewer.userSub }
}

/** KST 기준 오늘(YYYY-MM-DD) */
function kstToday(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
}
function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** 메시지의 날짜 의도를 [from,to] 구간으로 해석 (없으면 null) */
function detectDateRange(message: string): { label: string; from: string; to: string } | null {
  const today = kstToday()
  if (/오늘|금일/.test(message)) return { label: `오늘(${today})`, from: today, to: today }
  if (/내일|익일/.test(message)) { const t = addDays(today, 1); return { label: `내일(${t})`, from: t, to: t } }
  if (/이번\s*주|금주|주간/.test(message)) {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay() // 0=일
    const from = addDays(today, dow === 0 ? -6 : 1 - dow)   // 월요일 시작
    const to = addDays(from, 6)
    return { label: `이번 주(${from}~${to})`, from, to }
  }
  const m = message.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/)
  if (m) {
    const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`
    return { label: iso, from: iso, to: iso }
  }
  const m2 = message.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/)
  if (m2) {
    const iso = `${today.slice(0, 4)}-${m2[1].padStart(2, '0')}-${m2[2].padStart(2, '0')}`
    return { label: iso, from: iso, to: iso }
  }
  return null
}

/** 권한 스코프를 적용한 pct_orders 조회 (비관리자는 본인 tester_id로 강제) */
async function fetchScopedOrders(
  opts: { productCode?: string; testerId?: string; dueFrom?: string; dueTo?: string; urgent?: boolean },
  scope: Scope,
): Promise<OrderRow[]> {
  let restrictTester: string | null = null
  if (!scope.isAdmin) {
    if (!scope.testerId) return [] // 계정에 시험자 미연결 → 조회 불가
    restrictTester = scope.testerId
  } else if (opts.testerId) {
    restrictTester = opts.testerId
  }

  let q = supabaseAdmin
    .from('pct_orders')
    .select('id, product_code, product_name, batch_no, due_date, method, status, is_urgent, assignee_tester_id')
    .neq('status', DELETED_STATUS)
  if (opts.productCode) q = q.eq('product_code', opts.productCode)
  if (opts.dueFrom) q = q.gte('due_date', opts.dueFrom)
  if (opts.dueTo) q = q.lte('due_date', opts.dueTo)
  if (opts.urgent) q = q.eq('is_urgent', true)
  if (restrictTester) q = q.eq('assignee_tester_id', restrictTester)

  const { data } = await q.order('due_date', { ascending: true }).limit(20)
  return (data ?? []) as OrderRow[]
}

/** tester_id → 이름 매핑 */
async function testerNameMap(ids: (string | null)[]): Promise<Map<string, string>> {
  const uniq = Array.from(new Set(ids.filter((x): x is string => !!x)))
  if (uniq.length === 0) return new Map()
  const { data } = await supabaseAdmin.from('testers').select('id, name').in('id', uniq)
  return new Map((data ?? []).map(t => [t.id as string, t.name as string]))
}

/** 오더별 QC 작업·시험항목 진행상태 */
async function jobItemsForOrders(orderIds: string[]): Promise<Map<string, JobInfo>> {
  const map = new Map<string, JobInfo>()
  if (orderIds.length === 0) return map
  const { data: jobs } = await supabaseAdmin
    .from('qc_jobs').select('id, order_id, qc_no, status').in('order_id', orderIds)
  if (!jobs || jobs.length === 0) return map
  const jobIds = jobs.map(j => j.id as string)
  const { data: items } = await supabaseAdmin
    .from('qc_job_items')
    .select('qc_job_id, test_item_name, status, sequence_order')
    .in('qc_job_id', jobIds)
    .order('sequence_order', { ascending: true })
  const itemsByJob = new Map<string, { name: string; status: string }[]>()
  for (const it of items ?? []) {
    const arr = itemsByJob.get(it.qc_job_id as string) ?? []
    arr.push({ name: it.test_item_name as string, status: it.status as string })
    itemsByJob.set(it.qc_job_id as string, arr)
  }
  for (const j of jobs) {
    map.set(j.order_id as string, {
      qcNo: j.qc_no as string,
      status: j.status as string,
      items: itemsByJob.get(j.id as string) ?? [],
    })
  }
  return map
}

const ITEM_STATUS_KO: Record<string, string> = { cleared: '완료', pending: '대기', in_progress: '진행중' }
function itemStatusKo(s: string): string { return ITEM_STATUS_KO[s] ?? s }

function formatOrderLine(o: OrderRow, names: Map<string, string>, jobs: Map<string, JobInfo>): string {
  const tester = o.assignee_tester_id ? (names.get(o.assignee_tester_id) ?? '미지정') : '미배정'
  const ji = jobs.get(o.id)
  const items = ji && ji.items.length
    ? ` | 시험항목: ${ji.items.map(it => `${it.name}(${itemStatusKo(it.status)})`).join(', ')}`
    : ''
  return `- 품목 ${o.product_name}(${o.product_code}) | 배치 ${o.batch_no} | 완료예정 ${o.due_date ?? '-'}`
    + ` | 시험방법 ${o.method ?? '-'} | 담당 ${tester} | 상태 ${o.status}${o.is_urgent ? ' | 긴급' : ''}`
    + (ji ? ` | QC ${ji.qcNo}` : '')
    + items
}

/** 시험 전 확인사항(특이사항) — 테이블 미적용(0019 미실행) 시 graceful 폴백 */
async function fetchPretestNotes(
  productId: string,
): Promise<{ content: string; remark: string | null; issue_lot: string | null; created_by_name: string | null }[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('product_pretest_notes')
      .select('content, remark, issue_lot, created_by_name, created_at')
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
      .limit(10)
    if (error) return []
    return (data ?? []) as { content: string; remark: string | null; issue_lot: string | null; created_by_name: string | null }[]
  } catch { return [] }
}

/** 일정(완료예정 기준) 블록 */
async function buildScheduleBlock(range: { label: string; from: string; to: string }, scope: Scope): Promise<string> {
  const orders = await fetchScopedOrders({ dueFrom: range.from, dueTo: range.to }, scope)
  const head = `### 일정 — ${range.label}${scope.isAdmin ? '' : ' (본인 배정)'} : 완료예정 기준 ${orders.length}건`
  if (orders.length === 0) return `${head}\n- 해당 기간 오더 없음`
  const [names, jobs] = await Promise.all([
    testerNameMap(orders.map(o => o.assignee_tester_id)),
    jobItemsForOrders(orders.map(o => o.id)),
  ])
  return [head, ...orders.map(o => formatOrderLine(o, names, jobs))].join('\n')
}

/** 긴급(is_urgent) 오더 블록. 날짜 의도가 있으면 해당 기간으로 한정한다. */
async function buildUrgentBlock(scope: Scope, range: { label: string; from: string; to: string } | null): Promise<string> {
  const orders = await fetchScopedOrders(
    { urgent: true, dueFrom: range?.from, dueTo: range?.to },
    scope,
  )
  const period = range ? ` — ${range.label}` : ''
  const head = `### 긴급 오더${period}${scope.isAdmin ? '' : ' (본인 배정)'} : ${orders.length}건`
  if (orders.length === 0) return `${head}\n- 긴급으로 지정된 오더 없음`
  const [names, jobs] = await Promise.all([
    testerNameMap(orders.map(o => o.assignee_tester_id)),
    jobItemsForOrders(orders.map(o => o.id)),
  ])
  return [head, ...orders.map(o => formatOrderLine(o, names, jobs))].join('\n')
}

/** 품목 PCT 오더 + 시험 전 확인사항(특이사항) 블록 */
async function buildProductPctBlock(p: ProductLite, scope: Scope): Promise<string> {
  const orders = await fetchScopedOrders({ productCode: p.product_code }, scope)
  // 비관리자가 이 품목에 배정이 없으면 특이사항·담당 정보를 노출하지 않는다.
  const showNotes = scope.isAdmin || orders.length > 0
  const lines: string[] = []

  if (orders.length > 0) {
    const [names, jobs] = await Promise.all([
      testerNameMap(orders.map(o => o.assignee_tester_id)),
      jobItemsForOrders(orders.map(o => o.id)),
    ])
    lines.push(`### QC 오더 — ${p.name}${scope.isAdmin ? '' : ' (본인 배정)'} (${orders.length}건)`)
    for (const o of orders) lines.push(formatOrderLine(o, names, jobs))
  }

  if (showNotes) {
    const notes = await fetchPretestNotes(p.id)
    if (notes.length > 0) {
      lines.push(`### 시험 전 확인사항(특이사항) — ${p.name} (${notes.length}건)`)
      for (const n of notes) {
        lines.push(`- ${n.content}`
          + (n.remark ? ` | 특이사항: ${n.remark}` : '')
          + (n.issue_lot ? ` | 이슈로트 ${n.issue_lot}` : '')
          + (n.created_by_name ? ` | 작성 ${n.created_by_name}` : ''))
      }
    }
  }

  return lines.join('\n')
}

/** 시험자 PCT 오더 블록 */
async function buildTesterOrdersBlock(t: TesterLite, scope: Scope): Promise<string> {
  const orders = await fetchScopedOrders({ testerId: t.id }, scope)
  if (orders.length === 0) return ''
  const [names, jobs] = await Promise.all([
    testerNameMap(orders.map(o => o.assignee_tester_id)),
    jobItemsForOrders(orders.map(o => o.id)),
  ])
  return [`### ${t.name} 시험자 QC 오더 (${orders.length}건)`, ...orders.map(o => formatOrderLine(o, names, jobs))].join('\n')
}

// ─── 대화 이력 ────────────────────────────────────────────────────────────────

/** 동일 conversationId(dify_conv_id) 의 직전 대화를 assistant/user 포맷으로 가져옵니다. */
async function loadHistory(difyConvId: string, userKey: string): Promise<ChatMsg[]> {
  try {
    const conv = await supabase
      .from('chat_conversations')
      .select('id')
      .eq('dify_conv_id', difyConvId)
      .eq('user_key', userKey)
      .maybeSingle()

    const cid = conv.data?.id as string | undefined
    if (!cid) return []

    const msgs = await supabase
      .from('chat_messages')
      .select('role, content, created_at')
      .eq('conversation_id', cid)
      .order('created_at', { ascending: false })
      .limit(HISTORY_LIMIT)

    return (msgs.data ?? []).reverse().map(m => ({
      role:    m.role === 'bot' ? 'assistant' : 'user',
      content: m.content as string,
    }))
  } catch {
    return []
  }
}

function chunkText(text: string, size = 120): string[] {
  const normalized = text.replace(/\r\n/g, '\n').trim()
  if (!normalized) return []
  const chunks: string[] = []
  for (let i = 0; i < normalized.length; i += size) {
    chunks.push(normalized.slice(i, i + size))
  }
  return chunks
}

function createCliStream(
  conversationId: string,
  producer: () => Promise<string>,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ event: 'message', answer: '', conversation_id: conversationId })}\n\n`,
      ))

      try {
        const answer = await producer()
        const chunks = chunkText(answer)
        for (const chunk of chunks) {
          controller.enqueue(encoder.encode(
            `data: ${JSON.stringify({ event: 'message', answer: chunk, conversation_id: conversationId })}\n\n`,
          ))
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      } catch (err) {
        // 스트림은 이미 200으로 시작됐으므로, 오류를 답변 메시지로 표시해 무응답(빈 말풍선)을 방지한다.
        console.error('[qthink] 응답 생성 실패', err)
        const reason = err instanceof Error && err.name === 'AbortError'
          ? '요청이 취소되었습니다.'
          : '응답을 생성하지 못했습니다. 잠시 후 다시 시도해 주세요.'
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ event: 'message', answer: `QCink 응답 오류: ${reason}`, conversation_id: conversationId })}\n\n`,
        ))
        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
        controller.close()
      }
    },
  })
}

/** 개발기간에는 CLI 기반 어시스턴트를 우선 사용한다. */
function shouldUseCliAssistantForAdmin(): boolean {
  const flag = process.env.CHAT_ADMIN_USE_CLI?.trim().toLowerCase()
  if (flag === '1' || flag === 'true' || flag === 'yes' || flag === 'on') return true
  if (flag === '0' || flag === 'false' || flag === 'no' || flag === 'off') return false
  return process.env.NODE_ENV !== 'production'
}

function isUnsupportedCodexModelError(error: unknown): boolean {
  const cliError = error as CodexCliError
  const message = error instanceof Error ? `${error.message}\n${cliError.stderr ?? ''}` : ''
  return message.includes('model is not supported when using Codex with a ChatGPT account')
}

async function runAdminCliAssistant(prompt: string, model: string | null, signal?: AbortSignal): Promise<string> {
  try {
    return await runCodexText(prompt, { signal, model })
  } catch (error) {
    // 계정에서 지원하지 않는 모델은 Codex CLI의 계정별 기본 모델로 한 번만 재시도한다.
    if (!isUnsupportedCodexModelError(error)) throw error
    console.warn(`[chat] Codex 모델 ${model ?? '(기본값)'}을 사용할 수 없어 CLI 기본 모델로 재시도합니다.`)
    return runCodexText(prompt, { signal, model: null })
  }
}

function createAdminModelRunner(signal?: AbortSignal): QthinkModelRunner {
  if (shouldUseCliAssistantForAdmin()) {
    const model = codexAssistantModel()
    return prompt => runAdminCliAssistant(prompt, model, signal)
  }
  return prompt => runLetsurText(prompt, { signal })
}

/**
 * 채팅 메시지를 역할별 QCink 백엔드(admin=에이전트, tester=MISO)로 전송합니다.
 */
export async function sendChatMessage({ message, conversationId, viewer, signal, imageFileIds, recentHistory }: ChatRequest): Promise<Response> {
  const convId = conversationId && conversationId.trim() ? conversationId : randomUUID()
  const fixedAnswer = matchQthinkFixedIntent(message)
  if (fixedAnswer) {
    return new Response(createCliStream(convId, async () => fixedAnswer))
  }

  // 시험자(admin 외): MISO 앱(자체 지식·시스템 프롬프트 보유)에 사용자 메시지를 그대로 전달.
  // QC DB 컨텍스트/시스템 프롬프트를 덧붙이지 않는다(앱 고유 도메인을 침범하지 않도록). 첨부 이미지(시험일지 등)도 함께 전달.
  if (viewer.role !== 'admin') {
    const stream = createCliStream(convId, () => runMisoText(message, { signal, user: viewer.userSub, imageFileIds }))
    return new Response(stream)
  }

  // 관리자: 의도 분석 → 허용 도구 조회 → 검증된 컨텍스트 기반 답변.
  const scope = await resolveScope(viewer)
  const storedHistory = conversationId ? await loadHistory(conversationId, viewer.userSub) : [] as ChatMsg[]
  const history = recentHistory && recentHistory.length > 0
    ? recentHistory.slice(-HISTORY_LIMIT)
    : storedHistory
  const relevantHistory = selectRelevantHistory(message, history)
  const runModel = createAdminModelRunner(signal)
  const intent = await analyzeQthinkIntent({ question: message, history, runModel })

  if (intent.responseType === 'chat' && intent.chatAnswer) {
    return new Response(createCliStream(convId, async () => intent.chatAnswer ?? ''))
  }

  const [legacyContext, agentContext] = intent.responseType === 'data'
    ? await Promise.all([
        buildDbContext(message, scope),
        buildQthinkDataContext(intent, scope),
      ])
    : ['', '']
  const dataContext = [agentContext, legacyContext].filter(Boolean).join('\n\n')
  const prompt = buildQthinkAnswerPrompt({
    question: message,
    today: kstToday(),
    role: viewer.role,
    history: relevantHistory,
    dataContext,
  })
  const stream = createCliStream(convId, () => runModel(prompt))

  return new Response(stream)
}
