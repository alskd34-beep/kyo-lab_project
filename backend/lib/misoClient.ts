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
  /** 타임아웃 (기본 120초 — 이미지/비전 응답 여유) */
  timeoutMs?: number
  /** Dify 'user' 식별자 (요청 추적용) */
  user?: string
  /** 첨부 이미지 file id 목록 (uploadMisoFile 로 업로드한 결과). MISO 앱은 image 타입만 허용. */
  imageFileIds?: string[]
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
  const timeoutMs = options.timeoutMs ?? 120_000

  // 첨부 이미지: 이 MISO 앱은 표준 top-level files 가 아니라 커스텀 파일 입력변수(기본 '이미지')로 받는다.
  // (콘솔의 "입력 변수 > 이미지"와 동일.) 변수명이 다르면 MISO_IMAGE_INPUT_VAR 로 덮어쓴다.
  const imageVar = process.env.MISO_IMAGE_INPUT_VAR?.trim() || '이미지'
  const imageObjs = (options.imageFileIds ?? [])
    .filter(Boolean)
    .map(id => ({ type: 'image', transfer_method: 'local_file', upload_file_id: id }))
  const inputs: Record<string, unknown> = {}
  if (imageObjs.length > 0) {
    inputs[imageVar] = imageObjs.length === 1 ? imageObjs[0] : imageObjs
  }

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
      // ⚠️ conversation_id 를 빈 문자열('')로 보내면 MISO 가 이를 무효 대화로 처리해
      //    sys.query 바인딩이 깨진다(앱이 "질문이 전달되지 않았다"고 응답). 새 대화는 필드 자체를 생략한다.
      body: JSON.stringify({
        inputs,
        query: prompt,
        response_mode: 'blocking',
        user: options.user?.trim() || 'kd-qc',
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

interface MisoUploadResult {
  id: string
  name: string
  mimeType: string
}

/**
 * 이미지 파일을 MISO 에 업로드하고 file id 를 반환한다(이후 runMisoText 의 imageFileIds 로 사용).
 * MISO 앱은 image 타입만 허용하므로 호출부(업로드 라우트)에서 이미지 MIME 을 사전 검증한다.
 */
export async function uploadMisoFile(file: Blob, filename: string, user: string): Promise<MisoUploadResult> {
  const { baseUrl, apiKey } = misoConfig()
  const fd = new FormData()
  fd.append('file', file, filename)
  fd.append('user', user?.trim() || 'kd-qc')

  const res = await fetch(`${baseUrl}/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: fd,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`MISO 파일 업로드 오류 ${res.status}: ${detail.slice(0, 300)}`)
  }
  const data = (await res.json()) as { id?: string; name?: string; mime_type?: string }
  if (!data.id) throw new Error('MISO 파일 업로드 응답에 id 가 없습니다.')
  return { id: data.id, name: data.name ?? filename, mimeType: data.mime_type ?? 'image/*' }
}
