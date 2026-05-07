/**
 * [BACKEND] Chat 서비스 - OpenAI Chat Completions API 연동
 *
 * 모델: gpt-4o-mini 고정
 * 스트림: SSE 출력 포맷은 기존 Dify 호환 형식으로 래핑하여
 *         프런트엔드 파서를 그대로 재사용합니다.
 *           data: {"event":"message","answer":"...","conversation_id":"..."}\n\n
 *           data: [DONE]\n\n
 */

import { randomUUID } from 'crypto'
import { supabase } from '@backend/lib/supabase'

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'
const OPENAI_MODEL   = 'gpt-4o-mini'
const SYSTEM_PROMPT  = `당신은 광동제약 KD QC(품질관리) 어시스턴트입니다.
사용자 질문에 대해 답할 때, [DB 컨텍스트] 블록이 제공된다면 반드시 그 안의 사실만을 근거로 답하세요.
DB 컨텍스트에 없는 사실을 지어내지 말고, 정보가 부족하면 "DB에 해당 정보가 없습니다." 라고 답합니다.
답변은 한국어로 정확하고 간결하게, 필요한 경우 표·리스트로 구조화하세요.`
const HISTORY_LIMIT  = 10
const ACTIVE_STATUSES = ['pending', 'in_progress', 'on_hold']

interface ChatRequest {
  message: string
  /** 기존 호환성을 위해 이름은 conversationId(=dify_conv_id로 매핑) 유지 */
  conversationId?: string
}

interface ChatMsg {
  role: 'system' | 'user' | 'assistant'
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

/** 메시지에서 언급된 품목/시험자를 찾아 DB 사실 컨텍스트 블록을 생성합니다. */
async function buildDbContext(message: string): Promise<string> {
  const sections: string[] = []

  try {
    // 1) 후보 매칭: 모든 품목/시험자 이름을 메모리로 가져와 substring 매칭
    const [{ data: prodAll }, { data: testAll }] = await Promise.all([
      supabase.from('products').select('id, product_code, name, name_alt, package_spec, product_type').eq('is_active', true),
      supabase.from('testers').select('id, name, employee_no').eq('is_active', true),
    ])

    const products = (prodAll ?? []) as ProductLite[]
    const testers  = (testAll ?? []) as TesterLite[]

    const matchedProducts = matchProducts(message, products)
    const matchedTesters  = matchTesters(message, testers)

    // 2) 품목 컨텍스트
    for (const p of matchedProducts.slice(0, 3)) {
      const block = await buildProductBlock(p)
      if (block) sections.push(block)
    }

    // 3) 시험자 컨텍스트
    for (const t of matchedTesters.slice(0, 3)) {
      const block = await buildTesterBlock(t)
      if (block) sections.push(block)
    }
  } catch (err) {
    console.error('[chat] buildDbContext 실패', err)
  }

  if (sections.length === 0) return ''
  return `[DB 컨텍스트]\n${sections.join('\n\n')}`
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
  // 현재 할당된 업무
  const { data: assigns } = await supabase
    .from('batch_test_assignments')
    .select('id, batch_id, test_item_id, status, scheduled_start_at, scheduled_end_at, actual_start_at, primary_tester_id, secondary_tester_id, estimated_hours')
    .or(`primary_tester_id.eq.${t.id},secondary_tester_id.eq.${t.id}`)
    .in('status', ACTIVE_STATUSES)
    .order('scheduled_start_at', { ascending: true })
    .limit(20)

  const rows = assigns ?? []
  if (rows.length === 0) {
    return `### 시험자: ${t.name} (사번 ${t.employee_no})\n- 현재 할당된(진행중·대기·보류) 업무 없음`
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

  const lines: string[] = []
  lines.push(`### 시험자: ${t.name} (사번 ${t.employee_no})`)
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

// ─── 대화 이력 ────────────────────────────────────────────────────────────────

/** 동일 conversationId(dify_conv_id) 의 직전 대화를 OpenAI message 포맷으로 가져옵니다. */
async function loadHistory(difyConvId: string): Promise<ChatMsg[]> {
  try {
    const conv = await supabase
      .from('chat_conversations')
      .select('id')
      .eq('dify_conv_id', difyConvId)
      .maybeSingle()

    const cid = conv.data?.id as string | undefined
    if (!cid) return []

    const msgs = await supabase
      .from('chat_messages')
      .select('role, content, created_at')
      .eq('conversation_id', cid)
      .order('created_at', { ascending: true })
      .limit(HISTORY_LIMIT)

    return (msgs.data ?? []).map(m => ({
      role:    m.role === 'bot' ? 'assistant' : 'user',
      content: m.content as string,
    }))
  } catch {
    return []
  }
}

/** OpenAI 스트림(JSON delta) → Dify 호환 SSE 변환 */
function transformStream(
  upstream: ReadableStream<Uint8Array>,
  conversationId: string,
): ReadableStream<Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ''

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      // 첫 이벤트: conversation_id 통지
      controller.enqueue(encoder.encode(
        `data: ${JSON.stringify({ event: 'message', answer: '', conversation_id: conversationId })}\n\n`,
      ))

      const reader = upstream.getReader()
      try {
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed.startsWith('data:')) continue
            const data = trimmed.slice(5).trim()
            if (!data || data === '[DONE]') continue

            try {
              const parsed = JSON.parse(data) as {
                choices?: { delta?: { content?: string } }[]
              }
              const delta = parsed.choices?.[0]?.delta?.content
              if (delta) {
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ event: 'message', answer: delta, conversation_id: conversationId })}\n\n`,
                ))
              }
            } catch {
              // JSON 파싱 실패 라인은 무시
            }
          }
        }

        controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      } catch (err) {
        controller.error(err)
        return
      } finally {
        controller.close()
      }
    },
  })
}

/**
 * OpenAI(gpt-4o-mini) 에 채팅 메시지를 전송하고 SSE 스트림을 반환합니다.
 */
export async function sendChatMessage({ message, conversationId }: ChatRequest): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY 환경변수가 설정되지 않았습니다. .env.local을 확인해주세요.')
  }

  const convId = conversationId && conversationId.trim() ? conversationId : randomUUID()
  const [history, dbContext] = await Promise.all([
    conversationId ? loadHistory(conversationId) : Promise.resolve([] as ChatMsg[]),
    buildDbContext(message),
  ])

  const systemContent = dbContext
    ? `${SYSTEM_PROMPT}\n\n${dbContext}`
    : SYSTEM_PROMPT

  const messages: ChatMsg[] = [
    { role: 'system', content: systemContent },
    ...history,
    { role: 'user', content: message },
  ]

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model:    OPENAI_MODEL,
      messages,
      stream:   true,
    }),
  })

  if (!res.ok || !res.body) {
    const errText = await res.text().catch(() => '')
    throw new Error(`OpenAI API 호출 실패: ${res.status} ${errText}`)
  }

  const transformed = transformStream(res.body, convId)
  return new Response(transformed)
}
