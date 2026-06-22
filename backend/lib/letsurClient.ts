/**
 * [BACKEND] Letsur Staix(OpenAI 호환 게이트웨이) 연동
 *
 * .env.local 의 환경변수를 사용해 OpenAI 호환 /chat/completions 엔드포인트를
 * 호출하고 최종 텍스트(자연어/마크다운)를 반환한다. (CLI·서브프로세스 불필요)
 *
 *   - LETSUR_BASE_URL : 게이트웨이 베이스 URL (예: https://gateway.letsur.ai/v1)
 *   - LETSUR_API_KEY  : sk- 형식 API 키
 *   - LETSUR_MODEL    : 사용할 모델 (예: gpt-5-mini)
 *
 * 환경변수 미설정/네트워크 오류/타임아웃 시 throw → 호출부(app/api/chat)에서 503 처리.
 */

interface RunLetsurOptions {
  /** 요청 취소 신호 (req.signal 등) */
  signal?: AbortSignal
  /** 타임아웃 (기본 90초) */
  timeoutMs?: number
  /** 별도 시스템 프롬프트. 없으면 prompt 전체를 user 메시지로 전송한다. */
  system?: string
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

interface ChatCompletionResponse {
  choices?: { message?: { content?: string | null } }[]
}

/**
 * Letsur 게이트웨이에 단발 프롬프트를 보내 최종 텍스트를 받는다.
 */
export async function runLetsurText(prompt: string, options: RunLetsurOptions = {}): Promise<string> {
  const { baseUrl, apiKey, model } = letsurConfig()
  const timeoutMs = options.timeoutMs ?? 90_000

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

  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, messages, stream: false }),
      signal: controller.signal,
    })

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
