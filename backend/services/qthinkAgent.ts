/**
 * [BACKEND] QCink 에이전트 오케스트레이션
 *
 * 의도 분석 결과를 코드로 검증한 뒤 허용된 Supabase 조회 도구만 실행한다.
 * 모델이 생성한 SQL이나 임의 테이블/컬럼은 실행하지 않는다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import {
  QCINK_NAME,
  buildQthinkIntentPrompt,
  type QthinkDomain,
  type QthinkIntent,
} from '@backend/lib/qthinkPrompts'

export interface QthinkScope {
  isAdmin: boolean
  testerId: string | null
  userId: string
}

export interface QthinkHistoryMessage {
  role: 'user' | 'assistant'
  content: string
}

export type QthinkModelRunner = (prompt: string) => Promise<string>

const ALLOWED_DOMAINS = new Set<QthinkDomain>([
  'overview',
  'products',
  'testers',
  'test_items',
  'orders',
  'jobs',
  'equipment',
])
const ALLOWED_OPERATIONS = new Set<QthinkIntent['operation']>([
  'summary',
  'count',
  'list',
  'detail',
  'comparison',
])
const DATA_TERMS = /QC|품질|품목|제품|시험자|시험항목|시험 항목|오더|배치|일정|스케줄|완료예정|긴급|담당|작업|장비|검교정|예약|진행중|대기|지연|검토중/i
const HISTORY_REFERENCES = /그거|그것|그 품목|그 제품|그 시험자|그 사람|그 장비|앞에서|아까|위에서|이전 답변|그럼|그러면|작년은|지난달은/
const QUESTION_CUES = /[?？]\s*$|어느|어떤|무엇|어디|언제|누구|말씀해\s*주세요|알려\s*주실래요|알려\s*드릴까요/

function kstToday(): string {
  return new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)
}

function normalizeFixedIntent(message: string): string {
  return message.trim().toLowerCase().replace(/[!?.~。！？]+$/g, '').trim()
}

/** 반복되는 단순 질문은 모델을 호출하지 않고 즉시 응답한다. */
export function matchQthinkFixedIntent(message: string): string | null {
  const normalized = normalizeFixedIntent(message)

  if (/^(안녕|안녕하세요|반가워|반갑습니다|하이|hello|hi)(\s*(qcink|큐띵크|큐씽크))?$/.test(normalized)) {
    return `안녕하세요. ${QCINK_NAME}입니다. QC 업무나 일반적인 질문 모두 도와드릴게요.`
  }
  if (/^(고마워|고맙습니다|감사|감사합니다|thanks|thank you)$/.test(normalized)) {
    return '도움이 되었다니 다행입니다. 이어서 필요한 내용을 말씀해 주세요.'
  }
  if (/^(너는 누구|누구야|이름이 뭐야|네 이름은|qcink가 뭐야|큐띵크가 뭐야|큐씽크가 뭐야)$/.test(normalized)) {
    return `저는 ${QCINK_NAME}입니다. 광동제약 QC 데이터 조회와 실무 질문, 일반적인 분석·정리를 돕는 AI 에이전트입니다.`
  }
  if (/^(도움말|뭘 할 수 있어|무엇을 할 수 있어|사용법|기능 알려줘)$/.test(normalized)) {
    return '품목·시험자·시험항목·PCT 오더·QC 작업·장비 현황을 조회하고, 일정 확인과 비교·요약을 도와드릴 수 있습니다. 일반적인 질문이나 문서 정리도 가능합니다.'
  }
  return null
}

export function selectRelevantHistory(
  message: string,
  history: QthinkHistoryMessage[],
): QthinkHistoryMessage[] {
  if (history.length === 0) return []
  const lastAssistant = [...history].reverse().find(item => item.role === 'assistant')
  const isAnswerToAgentQuestion = !!lastAssistant && QUESTION_CUES.test(lastAssistant.content.trim())
  const isShortFollowUp = message.trim().length <= 30 && !/[?？]\s*$/.test(message.trim())
  if (!HISTORY_REFERENCES.test(message) && !isAnswerToAgentQuestion && !isShortFollowUp) return []
  return history.slice(-6)
}

function extractJsonObject(text: string): unknown {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) throw new Error('의도 분석 JSON을 찾지 못했습니다.')
  return JSON.parse(text.slice(start, end + 1))
}

function safeText(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') return null
  const cleaned = value
    .replace(/[\u0000-\u001f%_*,;()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return cleaned ? cleaned.slice(0, maxLength) : null
}

function safeDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const parsed = new Date(`${value}T00:00:00Z`)
  return Number.isNaN(parsed.getTime()) ? null : value
}

function domainsFromQuestion(question: string): QthinkDomain[] {
  const domains: QthinkDomain[] = []
  if (/전체|현황|요약|몇\s*(개|명|건)|개수|수량/.test(question)) domains.push('overview')
  if (/품목|제품|품목코드|규격/.test(question)) domains.push('products')
  if (/시험자|담당자|작업자|사번|역량/.test(question)) domains.push('testers')
  if (/시험항목|시험 항목|분석항목|예상\s*공수/.test(question)) domains.push('test_items')
  if (/오더|배치|일정|스케줄|완료예정|긴급|배정/.test(question)) domains.push('orders')
  if (/QC\s*작업|QC\s*번호|작업상태|클리어|진행상태/.test(question)) domains.push('jobs')
  if (/장비|검교정|예약/.test(question)) domains.push('equipment')
  return Array.from(new Set(domains)).slice(0, 3)
}

function fallbackIntent(question: string): QthinkIntent {
  let domains = domainsFromQuestion(question)
  if (domains.length > 1) domains = domains.filter(domain => domain !== 'overview')
  const responseType = domains.length > 0 || DATA_TERMS.test(question) ? 'data' : 'chat'
  return {
    responseType,
    domains: domains.length > 0 ? domains : responseType === 'data' ? ['overview'] : [],
    operation: /몇\s*(개|명|건)|개수|수량/.test(question) ? 'count' : 'summary',
    keywords: [],
    status: null,
    urgent: /긴급/.test(question) ? true : null,
    dateFrom: null,
    dateTo: null,
    chatAnswer: null,
  }
}

function validateIntent(raw: unknown, question: string): QthinkIntent {
  if (!raw || typeof raw !== 'object') return fallbackIntent(question)
  const value = raw as Record<string, unknown>
  const responseType = value.responseType === 'data' ? 'data' : value.responseType === 'chat' ? 'chat' : null
  if (!responseType) return fallbackIntent(question)

  const rawDomains = Array.isArray(value.domains) ? value.domains : []
  let domains = Array.from(new Set(
    rawDomains.filter((item): item is QthinkDomain => typeof item === 'string' && ALLOWED_DOMAINS.has(item as QthinkDomain)),
  )).slice(0, 3)
  if (domains.length > 1) domains = domains.filter(domain => domain !== 'overview')
  const fallback = fallbackIntent(question)
  const operation = typeof value.operation === 'string' && ALLOWED_OPERATIONS.has(value.operation as QthinkIntent['operation'])
    ? value.operation as QthinkIntent['operation']
    : fallback.operation
  const keywords = (Array.isArray(value.keywords) ? value.keywords : [])
    .map(item => safeText(item, 40))
    .filter((item): item is string => !!item)
    .slice(0, 3)

  return {
    responseType,
    domains: responseType === 'data' ? (domains.length > 0 ? domains : fallback.domains) : [],
    operation,
    keywords,
    status: safeText(value.status, 30)?.replace(/\s+/g, '') ?? null,
    urgent: typeof value.urgent === 'boolean' ? value.urgent : null,
    dateFrom: safeDate(value.dateFrom),
    dateTo: safeDate(value.dateTo),
    chatAnswer: responseType === 'chat' ? safeText(value.chatAnswer, 2_000) : null,
  }
}

export async function analyzeQthinkIntent(params: {
  question: string
  history: QthinkHistoryMessage[]
  runModel: QthinkModelRunner
}): Promise<QthinkIntent> {
  const deterministic = fallbackIntent(params.question)
  if (
    deterministic.responseType === 'data'
    && (deterministic.operation === 'count' || /^(전체|QC)\s*현황(\s*(알려줘|보여줘))?[!?.~]?$/.test(params.question.trim()))
  ) {
    return deterministic
  }

  const prompt = buildQthinkIntentPrompt({
    question: params.question,
    today: kstToday(),
    history: selectRelevantHistory(params.question, params.history),
  })
  try {
    const output = await params.runModel(prompt)
    return validateIntent(extractJsonObject(output), params.question)
  } catch (error) {
    console.warn('[qthink] 의도 분석 실패, 코드 라우터로 폴백합니다.', error)
    return fallbackIntent(params.question)
  }
}

function primaryKeyword(intent: QthinkIntent): string | null {
  return intent.keywords[0] ?? null
}

async function overviewContext(scope: QthinkScope): Promise<string> {
  if (!scope.isAdmin && !scope.testerId) {
    return '### QC 전체 현황\n- 계정에 연결된 시험자가 없어 조회할 수 없습니다.'
  }
  const testerCountQuery = supabaseAdmin
    .from('testers')
    .select('*', { count: 'exact', head: true })
    .eq('is_active', true)
  if (!scope.isAdmin && scope.testerId) testerCountQuery.eq('id', scope.testerId)

  const orderCountQuery = supabaseAdmin
    .from('pct_orders')
    .select('*', { count: 'exact', head: true })
    .neq('status', '삭제')
  if (!scope.isAdmin && scope.testerId) orderCountQuery.eq('assignee_tester_id', scope.testerId)

  const jobCountQuery = supabaseAdmin.from('qc_jobs').select('*', { count: 'exact', head: true })
  if (!scope.isAdmin && scope.testerId) jobCountQuery.eq('assignee_tester_id', scope.testerId)

  const [products, testers, testItems, orders, jobs, equipment] = await Promise.all([
    supabaseAdmin.from('products').select('*', { count: 'exact', head: true }).eq('is_active', true),
    testerCountQuery,
    supabaseAdmin.from('test_items').select('*', { count: 'exact', head: true }).eq('is_active', true),
    orderCountQuery,
    jobCountQuery,
    supabaseAdmin.from('equipment_master').select('*', { count: 'exact', head: true }),
  ])
  const failed = [products, testers, testItems, orders, jobs, equipment].find(result => result.error)
  if (failed?.error) throw failed.error

  return [
    '### QC 전체 현황',
    `- 활성 품목: ${products.count ?? 0}개`,
    `- ${scope.isAdmin ? '활성 시험자' : '조회 가능한 시험자'}: ${testers.count ?? 0}명`,
    `- 활성 시험항목: ${testItems.count ?? 0}개`,
    `- ${scope.isAdmin ? '전체' : '본인 배정'} PCT 오더: ${orders.count ?? 0}건`,
    `- ${scope.isAdmin ? '전체' : '본인'} QC 작업: ${jobs.count ?? 0}건`,
    `- 등록 장비: ${equipment.count ?? 0}대`,
  ].join('\n')
}

async function productsContext(intent: QthinkIntent): Promise<string> {
  const keyword = primaryKeyword(intent)
  let query = supabaseAdmin
    .from('products')
    .select('product_code, name, name_alt, product_type, package_spec, difficulty', { count: 'exact' })
    .eq('is_active', true)
  if (keyword) query = query.ilike('name', `%${keyword}%`)
  const { data, count, error } = await query.order('name').limit(30)
  if (error) throw error

  const rows = data ?? []
  const lines = [`### 품목 마스터${keyword ? ` — 검색어 "${keyword}"` : ''}: ${count ?? rows.length}건`]
  if (intent.operation === 'count') return lines.join('\n')
  if (rows.length === 0) lines.push('- 조회된 품목이 없습니다.')
  for (const row of rows) {
    lines.push(`- ${row.name} | 품목코드 ${row.product_code} | 규격 ${row.package_spec ?? '-'} | 유형 ${row.product_type ?? '-'} | 난이도 ${row.difficulty ?? '-'}`)
  }
  return lines.join('\n')
}

async function testersContext(intent: QthinkIntent, scope: QthinkScope): Promise<string> {
  if (!scope.isAdmin && !scope.testerId) return '### 시험자\n- 계정에 연결된 시험자 정보가 없습니다.'
  const keyword = primaryKeyword(intent)
  let query = supabaseAdmin
    .from('testers')
    .select('id, employee_no, name, can_solo, can_duo', { count: 'exact' })
    .eq('is_active', true)
  if (!scope.isAdmin && scope.testerId) query = query.eq('id', scope.testerId)
  if (keyword) query = query.ilike('name', `%${keyword}%`)
  const { data, count, error } = await query.order('name').limit(30)
  if (error) throw error

  const rows = data ?? []
  const lines = [`### ${scope.isAdmin ? '시험자' : '본인 시험자'}${keyword ? ` — 검색어 "${keyword}"` : ''}: ${count ?? rows.length}명`]
  if (intent.operation === 'count') return lines.join('\n')
  if (rows.length === 0) lines.push('- 조회된 시험자가 없습니다.')
  for (const row of rows) {
    const qualifications = [row.can_solo ? '단독시험 가능' : null, row.can_duo ? '2인시험 가능' : null].filter(Boolean).join(', ') || '등록 자격 없음'
    lines.push(`- ${row.name} | 사번 ${row.employee_no} | ${qualifications}`)
  }
  return lines.join('\n')
}

async function testItemsContext(intent: QthinkIntent): Promise<string> {
  const keyword = primaryKeyword(intent)
  let query = supabaseAdmin
    .from('test_items')
    .select('name, estimated_hours, requires_duo', { count: 'exact' })
    .eq('is_active', true)
  if (keyword) query = query.ilike('name', `%${keyword}%`)
  const { data, count, error } = await query.order('name').limit(30)
  if (error) throw error

  const rows = data ?? []
  const lines = [`### 시험항목${keyword ? ` — 검색어 "${keyword}"` : ''}: ${count ?? rows.length}개`]
  if (intent.operation === 'count') return lines.join('\n')
  if (rows.length === 0) lines.push('- 조회된 시험항목이 없습니다.')
  for (const row of rows) {
    lines.push(`- ${row.name} | 예상 ${row.estimated_hours ?? '-'}시간 | ${row.requires_duo ? '2인시험 필요' : '단독시험 가능'}`)
  }
  return lines.join('\n')
}

async function testerNames(ids: Array<string | null>): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => !!id)))
  if (unique.length === 0) return new Map()
  const { data } = await supabaseAdmin.from('testers').select('id, name').in('id', unique)
  return new Map((data ?? []).map(row => [row.id as string, row.name as string]))
}

async function ordersContext(intent: QthinkIntent, scope: QthinkScope): Promise<string> {
  if (!scope.isAdmin && !scope.testerId) return '### PCT 오더\n- 계정에 연결된 시험자가 없어 조회할 수 없습니다.'
  const keyword = primaryKeyword(intent)
  let query = supabaseAdmin
    .from('pct_orders')
    .select('product_code, product_name, batch_no, packaging_date, due_date, is_urgent, method, status, assignee_tester_id', { count: 'exact' })
    .neq('status', '삭제')
  if (!scope.isAdmin && scope.testerId) query = query.eq('assignee_tester_id', scope.testerId)
  if (keyword) query = query.ilike('product_name', `%${keyword}%`)
  if (intent.status) query = query.eq('status', intent.status)
  if (intent.urgent !== null) query = query.eq('is_urgent', intent.urgent)
  if (intent.dateFrom) query = query.gte('due_date', intent.dateFrom)
  if (intent.dateTo) query = query.lte('due_date', intent.dateTo)
  const { data, count, error } = await query.order('due_date', { ascending: true }).limit(30)
  if (error) throw error

  const rows = data ?? []
  const names = await testerNames(rows.map(row => row.assignee_tester_id as string | null))
  const lines = [`### ${scope.isAdmin ? 'PCT 오더' : '본인 배정 PCT 오더'}: ${count ?? rows.length}건`]
  if (intent.operation === 'count') return lines.join('\n')
  if (rows.length === 0) lines.push('- 조건에 맞는 오더가 없습니다.')
  for (const row of rows) {
    const tester = row.assignee_tester_id ? names.get(row.assignee_tester_id as string) ?? '미지정' : '미배정'
    lines.push(`- ${row.product_name}(${row.product_code}) | 배치 ${row.batch_no} | 포장 ${row.packaging_date ?? '-'} | 완료예정 ${row.due_date ?? '-'} | 상태 ${row.status} | 담당 ${tester}${row.is_urgent ? ' | 긴급' : ''}`)
  }
  return lines.join('\n')
}

async function jobsContext(intent: QthinkIntent, scope: QthinkScope): Promise<string> {
  if (!scope.isAdmin && !scope.testerId) return '### QC 작업\n- 계정에 연결된 시험자가 없어 조회할 수 없습니다.'
  const keyword = primaryKeyword(intent)
  let query = supabaseAdmin
    .from('qc_jobs')
    .select('order_id, qc_no, assignee_tester_id, work_start_date, work_end_date, status', { count: 'exact' })
  if (!scope.isAdmin && scope.testerId) query = query.eq('assignee_tester_id', scope.testerId)
  if (keyword) query = query.ilike('qc_no', `%${keyword}%`)
  if (intent.status) query = query.eq('status', intent.status)
  const { data, count, error } = await query.order('created_at', { ascending: false }).limit(30)
  if (error) throw error

  const rows = data ?? []
  const orderIds = rows.map(row => row.order_id as string)
  const { data: orders } = orderIds.length > 0
    ? await supabaseAdmin.from('pct_orders').select('id, product_name, batch_no').in('id', orderIds)
    : { data: [] as { id: string; product_name: string; batch_no: string }[] }
  const orderMap = new Map((orders ?? []).map(row => [row.id as string, row]))
  const names = await testerNames(rows.map(row => row.assignee_tester_id as string | null))
  const lines = [`### ${scope.isAdmin ? 'QC 작업' : '본인 QC 작업'}: ${count ?? rows.length}건`]
  if (intent.operation === 'count') return lines.join('\n')
  if (rows.length === 0) lines.push('- 조건에 맞는 QC 작업이 없습니다.')
  for (const row of rows) {
    const order = orderMap.get(row.order_id as string)
    const tester = row.assignee_tester_id ? names.get(row.assignee_tester_id as string) ?? '미지정' : '미배정'
    lines.push(`- QC ${row.qc_no} | ${order?.product_name ?? '품목 미확인'} | 배치 ${order?.batch_no ?? '-'} | 상태 ${row.status} | 담당 ${tester} | 작업 ${row.work_start_date ?? '-'}~${row.work_end_date ?? '-'}`)
  }
  return lines.join('\n')
}

async function equipmentContext(intent: QthinkIntent, scope: QthinkScope): Promise<string> {
  const keyword = primaryKeyword(intent)
  let equipmentQuery = supabaseAdmin
    .from('equipment_master')
    .select('code, name, category, status, calibration_date, calibration_due_date, location', { count: 'exact' })
  if (keyword) equipmentQuery = equipmentQuery.ilike('name', `%${keyword}%`)
  if (intent.status) equipmentQuery = equipmentQuery.eq('status', intent.status)

  let reservationQuery = supabaseAdmin
    .from('equipment_reservation')
    .select('equipment_id, start_date, end_date, status, wait_order', { count: 'exact' })
  if (!scope.isAdmin) reservationQuery = reservationQuery.eq('user_id', scope.userId)
  if (intent.dateFrom) reservationQuery = reservationQuery.gte('end_date', intent.dateFrom)
  if (intent.dateTo) reservationQuery = reservationQuery.lte('start_date', intent.dateTo)

  const [equipmentResult, reservationResult] = await Promise.all([
    equipmentQuery.order('name').limit(30),
    reservationQuery.order('start_date').limit(30),
  ])
  if (equipmentResult.error) throw equipmentResult.error
  if (reservationResult.error) throw reservationResult.error

  const equipment = equipmentResult.data ?? []
  const reservations = reservationResult.data ?? []
  if (intent.operation === 'count') {
    return [
      `### 장비 마스터: ${equipmentResult.count ?? equipment.length}대`,
      `### ${scope.isAdmin ? '장비 예약' : '본인 장비 예약'}: ${reservationResult.count ?? reservations.length}건`,
    ].join('\n')
  }
  const lines = [
    `### 장비 마스터: ${equipmentResult.count ?? equipment.length}대`,
    ...equipment.map(row => `- ${row.name}(${row.code}) | 상태 ${row.status} | 위치 ${row.location ?? '-'} | 차기 검교정 ${row.calibration_due_date ?? '-'}`),
    `### ${scope.isAdmin ? '장비 예약' : '본인 장비 예약'}: ${reservationResult.count ?? reservations.length}건`,
    ...reservations.map(row => `- 장비 ${row.equipment_id} | ${row.start_date}~${row.end_date} | 상태 ${row.status}${row.wait_order ? ` | 대기 ${row.wait_order}번` : ''}`),
  ]
  if (equipment.length === 0) lines.splice(1, 0, '- 조회된 장비가 없습니다.')
  if (reservations.length === 0) lines.push('- 조회된 예약이 없습니다.')
  return lines.join('\n')
}

async function safeTool(label: string, run: () => Promise<string>): Promise<string> {
  try {
    return await run()
  } catch (error) {
    console.error(`[qthink] ${label} 조회 실패`, error)
    return `### ${label}\n- 현재 데이터를 조회할 수 없습니다.`
  }
}

/** 검증된 의도에 해당하는 읽기 전용 도구만 실행한다. */
export async function buildQthinkDataContext(
  intent: QthinkIntent,
  scope: QthinkScope,
): Promise<string> {
  const domains = intent.domains.length > 0 ? intent.domains : ['overview'] as QthinkDomain[]
  const sections = await Promise.all(domains.map(domain => {
    switch (domain) {
      case 'overview': return safeTool('QC 전체 현황', () => overviewContext(scope))
      case 'products': return safeTool('품목 마스터', () => productsContext(intent))
      case 'testers': return safeTool('시험자', () => testersContext(intent, scope))
      case 'test_items': return safeTool('시험항목', () => testItemsContext(intent))
      case 'orders': return safeTool('PCT 오더', () => ordersContext(intent, scope))
      case 'jobs': return safeTool('QC 작업', () => jobsContext(intent, scope))
      case 'equipment': return safeTool('장비', () => equipmentContext(intent, scope))
    }
  }))
  return sections.join('\n\n').slice(0, 30_000)
}
