/**
 * [BACKEND] MISO(holdings.miso.gs) 챗봇 연동 — Dify 호환 외부 API
 *
 * 시험자(tester) 로그인 시 챗봇 백엔드로 사용한다. (관리자는 Letsur — letsurClient.ts)
 *   - MISO_API_URL : 외부 API 베이스 (예: https://api.holdings.miso.gs/ext/v1)
 *   - MISO_API_KEY : app- 형식 API 키
 *
 * MISO /chat 엔드포인트를 blocking 모드로 호출해 최종 answer 텍스트를 반환한다.
 * (Dify 계열이나 경로가 /chat-messages 가 아닌 /chat 이며 inputs 필드가 필수다.)
 * 대화 맥락/이력은 호출부(chat.ts)에서 prompt 에 이미 포함하므로 conversation_id 는 쓰지 않는다.
 * 환경변수 미설정/오류/타임아웃 시 throw → 호출부(app/api/chat)에서 503/500 처리.
 */

interface RunMisoOptions {
  /** 요청 취소 신호 (req.signal 등) */
  signal?: AbortSignal
  /** 타임아웃 (기본 90초) */
  timeoutMs?: number
  /** Dify 'user' 식별자 (요청 추적용) */
  user?: string
}

interface MisoConfig {
  baseUrl: string
  apiKey: string
}

/** 환경변수에서 설정을 읽어온다. 누락 시 throw (호출부에서 503 매핑). */
function misoConfig(): MisoConfig {
  const baseUrl = process.env.MISO_API_URL?.trim()
  const apiKey  = process.env.MISO_API_KEY?.trim()
  if (!baseUrl || !apiKey) {
    throw new Error('MISO 환경변수(MISO_API_URL / MISO_API_KEY)가 설정되지 않았습니다.')
  }
  return { baseUrl: baseUrl.replace(/\/+$/, ''), apiKey }
}

interface MisoChatResponse {
  answer?: string | null
}

/**
 * MISO 챗봇에 단발 프롬프트를 보내 최종 텍스트(answer)를 받는다.
 */
export async function runMisoText(prompt: string, options: RunMisoOptions = {}): Promise<string> {
  const { baseUrl, apiKey } = misoConfig()
  const timeoutMs = options.timeoutMs ?? 90_000

  // 타임아웃 + 외부 취소 신호를 하나의 컨트롤러로 합친다.
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('MISO API 타임아웃')), timeoutMs)
  const onAbort = () => controller.abort(options.signal?.reason)
  if (options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer)
      throw new Error('요청이 취소되었습니다.')
    }
    options.signal.addEventListener('abort', onAbort, { once: true })
  }

  try {
    const res = await fetch(`${baseUrl}/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        inputs: {},
        query: prompt,
        response_mode: 'blocking',
        user: options.user?.trim() || 'kd-qc',
        conversation_id: '',
      }),
      signal: controller.signal,
    })

    if (!res.ok) {
      const detail = await res.text().catch(() => '')
      throw new Error(`MISO API 오류 ${res.status}: ${detail.slice(0, 500)}`)
    }

    const data = (await res.json()) as MisoChatResponse
    const text = (data.answer ?? '').trim()
    if (!text) throw new Error('MISO API 응답이 비어 있습니다.')
    return text
  } finally {
    clearTimeout(timer)
    options.signal?.removeEventListener('abort', onAbort)
  }
}
