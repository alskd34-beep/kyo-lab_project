/**
 * [BACKEND] Letsur Staix(OpenAI 호환 게이트웨이) 연동
 *
 * .env.local 의 환경변수를 사용해 OpenAI 호환 /chat/completions 엔드포인트를
 * 호출하고 최종 텍스트(자연어/마크다운)를 반환한다. (CLI·서브프로세스 불필요)
 *
 *   - LETSUR_BASE_URL : 게이트웨이 베이스 URL (예: https://gateway.letsur.ai/v1)
 *   - LETSUR_API_KEY  : sk- 형식 API 키
 *   - LETSUR_MODEL    : 사용할 모델 (운영 기준: gpt-5-mini)
 *   - LETSUR_REASONING_EFFORT : minimal|low|medium|high|off (기본 low)
 *   - LETSUR_TIMEOUT_MS       : 응답 타임아웃 ms (기본 180000)
 *
 * 환경변수 미설정/네트워크 오류/타임아웃 시 throw → 호출부(app/api/chat)에서 503 처리.
 */

/** gpt-5 계열 추론 강도. 'off' 는 파라미터를 아예 보내지 않는다. */
export type LetsurReasoningEffort = 'minimal' | 'low' | 'medium' | 'high'

const REASONING_EFFORTS: readonly string[] = ['minimal', 'low', 'medium', 'high']

/**
 * 기본 타임아웃 180초.
 * gpt-5-mini 는 추론 모델이라 최대 3만자(≈2만 토큰 이상)의 QC 데이터 컨텍스트가 실리면
 * 90초로는 부족할 수 있다. 답변은 완성된 뒤에야 사용자에게 전달되므로(createCliStream)
 * 타임아웃이 곧 빈 말풍선이 된다.
 */
const DEFAULT_TIMEOUT_MS = 180_000

interface RunLetsurOptions {
  /** 요청 취소 신호 (req.signal 등) */
  signal?: AbortSignal
  /** 타임아웃 (기본 180초, LETSUR_TIMEOUT_MS 로 덮어쓸 수 있다) */
  timeoutMs?: number
  /** 별도 시스템 프롬프트. 없으면 prompt 전체를 user 메시지로 전송한다. */
  system?: string
  /** 추론 강도. null 이면 파라미터를 보내지 않는다. 미지정 시 환경변수 값을 쓴다. */
  reasoningEffort?: LetsurReasoningEffort | null
}

interface LetsurConfig {
  baseUrl: string
  apiKey: string
  model: string
}

/** 환경변수에서 설정을 읽어온다. 누락 시 throw (호출부에서 503 매핑). */
function letsurConfig(): LetsurConfig {
  const baseUrl = process.env.LETSUR_BASE_URL?.trim()
  const apiKey  = process.env.LETSUR_API_KEY?.trim()
  const model   = process.env.LETSUR_MODEL?.trim()
  if (!baseUrl || !apiKey || !model) {
    throw new Error(
      'Letsur 환경변수(LETSUR_BASE_URL / LETSUR_API_KEY / LETSUR_MODEL)가 설정되지 않았습니다.',
    )
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey, model }
}

/**
 * 기본 추론 강도. QC 데이터 조회 답변은 깊은 추론이 필요 없고 지연이 곧 체감 품질이라
 * 'low' 를 기본값으로 둔다. 추론을 지원하지 않는 모델로 바꿀 때는 'off' 로 끈다.
 */
function envReasoningEffort(): LetsurReasoningEffort | null {
  const raw = process.env.LETSUR_REASONING_EFFORT?.trim().toLowerCase()
  if (!raw) return 'low'
  if (raw === 'off' || raw === 'none') return null
  if (REASONING_EFFORTS.includes(raw)) return raw as LetsurReasoningEffort
  console.warn(`[letsur] 알 수 없는 LETSUR_REASONING_EFFORT='${raw}' — 'low' 로 진행합니다.`)
  return 'low'
}

function envTimeoutMs(): number {
  const raw = Number(process.env.LETSUR_TIMEOUT_MS?.trim())
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS
}

/** 게이트웨이가 reasoning_effort 자체를 모르는 경우인지 판단한다. */
function isUnsupportedReasoningError(status: number, detail: string): boolean {
  if (status !== 400 && status !== 422) return false
  return /reasoning[_-]?effort/i.test(detail)
    || /unsupported|unknown|unrecognized|extra_forbidden/i.test(detail)
}

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[]
}

/**
 * Letsur 게이트웨이에 단발 프롬프트를 보내 최종 텍스트를 받는다.
 */
export async function runLetsurText(prompt: string, options: RunLetsurOptions = {}): Promise<string> {
  const { baseUrl, apiKey, model } = letsurConfig()
  const timeoutMs = options.timeoutMs ?? envTimeoutMs()
  const effort = options.reasoningEffort === undefined ? envReasoningEffort() : options.reasoningEffort

  const messages = options.system
    ? [{ role: 'system', content: options.system }, { role: 'user', content: prompt }]
    : [{ role: 'user', content: prompt }]

  // 타임아웃 + 외부 취소 신호를 하나의 컨트롤러로 합친다.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Letsur 게이트웨이 타임아웃')), timeoutMs)
  const onAbort = () => controller.abort(options.signal?.reason)
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer)
      throw new Error('요청이 취소되었습니다.')
    }
    options.signal.addEventListener('abort', onAbort, { once: true })
  }

  const post = async (effort: LetsurReasoningEffort | null) => {
    const body: Record<string, unknown> = { model, messages, stream: false }
    if (effort) body.reasoning_effort = effort
    return fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  }

  try {
    let res = await post(effort)

    // 추론을 지원하지 않는 모델/게이트웨이면 파라미터 없이 한 번만 재시도한다.
    if (!res.ok && effort) {
      const detail = await res.text().catch(() => '')
      if (isUnsupportedReasoningError(res.status, detail)) {
        console.warn(`[letsur] ${model} 이(가) reasoning_effort 를 받지 않아 파라미터 없이 재시도합니다.`)
        res = await post(null)
      } else {
        throw new Error(`Letsur 게이트웨이 오류 ${res.status}: ${detail.slice(0, 500)}`)
      }
    }

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`Letsur 게이트웨이 오류 ${res.status}: ${detail.slice(0, 500)}`)
    }

    const data = (await res.json()) as ChatCompletionResponse
    const text = data.choices?.[0]?.message?.content?.trim() ?? ''
    if (!text) throw new Error('Letsur 게이트웨이 응답이 비어 있습니다.')
    return text
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}
