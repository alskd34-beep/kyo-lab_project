/**
 * 공용 API 클라이언트
 *
 * 화면마다 `fetch('/api/...', { credentials: 'include' })` 를 직접 쓰면서
 * 401(세션 만료) 처리·에러 메시지 추출 방식이 제각각이었다. 이 모듈로 통일한다.
 *
 * - 401 은 `AuthProvider` 가 전역에서 처리한다(자동 refresh 1회 → 실패 시 로그인 화면).
 *   여기서는 사람이 읽을 수 있는 한국어 메시지를 담은 `ApiError` 로 바꿔 던진다.
 * - 서버 에러 응답 규약은 `{ error: string }` 이다(app/api/AGENTS.md).
 *
 * 사용:
 *   const { rows } = await api.get<{ rows: Order[] }>('/api/pct-orders')
 *   await api.post('/api/pct-orders/assign', { mode: 'auto' })
 */

export class ApiError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** 응답에서 에러 메시지를 뽑는다. 본문이 JSON 이 아니어도 안전하게 처리한다. */
async function extractError(res: Response): Promise<string> {
  if (res.status === 401) return '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.'
  if (res.status === 403) return '권한이 없습니다. 관리자에게 문의하세요.'
  try {
    const body = await res.json() as { error?: unknown }
    if (typeof body?.error === 'string' && body.error) return body.error
  } catch {
    /* JSON 아님 — 아래 기본 메시지 */
  }
  if (res.status === 404) return '요청한 데이터를 찾을 수 없습니다.'
  return '서버 오류가 발생했습니다.'
}

async function request<T>(
  url: string,
  init: RequestInit & { json?: unknown } = {},
): Promise<T> {
  const { json, headers, ...rest } = init
  const res = await fetch(url, {
    ...rest,
    credentials: 'include',
    headers: json === undefined
      ? headers
      : { 'Content-Type': 'application/json', ...(headers ?? {}) },
    body: json === undefined ? rest.body : JSON.stringify(json),
  })

  if (!res.ok) throw new ApiError(res.status, await extractError(res))
  if (res.status === 204) return undefined as T

  return await res.json() as T
}

export const api = {
  get:   <T>(url: string, init?: RequestInit) => request<T>(url, { ...init, method: 'GET' }),
  post:  <T>(url: string, json?: unknown, init?: RequestInit) => request<T>(url, { ...init, method: 'POST', json }),
  patch: <T>(url: string, json?: unknown, init?: RequestInit) => request<T>(url, { ...init, method: 'PATCH', json }),
  put:   <T>(url: string, json?: unknown, init?: RequestInit) => request<T>(url, { ...init, method: 'PUT', json }),
  del:   <T>(url: string, json?: unknown, init?: RequestInit) => request<T>(url, { ...init, method: 'DELETE', json }),
}

/** catch 블록에서 화면에 띄울 메시지를 뽑을 때 쓴다. */
export function errorMessage(err: unknown, fallback = '알 수 없는 오류가 발생했습니다.'): string {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error && err.message) return err.message
  return fallback
}
