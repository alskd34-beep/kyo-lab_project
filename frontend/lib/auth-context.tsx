'use client'

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

export type UserRole = 'admin' | 'tester'

export interface AuthUser {
  id:          string
  username:    string
  displayName: string | null
  avatarUrl:   string | null
  role:        UserRole
  customerNo:  number | null
}

interface AuthCtx {
  user:    AuthUser | null
  loading: boolean
  login:   (username: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>
  logout:  () => Promise<void>
  refresh: () => Promise<boolean>
}

const Ctx = createContext<AuthCtx | null>(null)
const AUTO_LOGIN_COOKIE = 'kd_auto_login'
const LS_AUTO_LOGIN = 'kd-auto-login'
/** login/page.tsx 의 마커 Max-Age 와 같은 값 — refresh 쿠키 수명과 맞춘다 */
const REFRESH_TTL_SEC = 60 * 60 * 24 * 7

function clearAutoLoginCookie() {
  if (typeof document === 'undefined') return
  document.cookie = `${AUTO_LOGIN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
}

/**
 * 자동 로그인 마커를 오늘 다시 7일간 연장한다.
 *
 * 마커는 로그인 페이지에서 딱 한 번 발급돼 갱신되지 않는 반면, refresh 쿠키는
 * 회전(13분 주기·부팅 복구)할 때마다 Max-Age 가 리셋돼 사실상 무한히 살아있다.
 * 둘의 수명이 어긋나면 로그인 7일 뒤부터 마커만 만료되어 미들웨어가
 * `hasAutoLogin && hasRefresh` 검사에서 /login 으로 보내버린다 — 세션은 멀쩡히
 * 살아 있는데 "자동 로그인이 풀린" 것처럼 보이는 원인(2026-08-25).
 *
 * 사용자 설정(localStorage)이 켜져 있을 때만 갱신한다. 꺼져 있으면 마커를
 * 새로 심지 않는다(미들웨어 통과 조건이므로 설정 없이 늘리면 안 된다).
 */
function renewAutoLoginMarker() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  try {
    if (localStorage.getItem(LS_AUTO_LOGIN) !== '1') return
    document.cookie = `${AUTO_LOGIN_COOKIE}=1; Path=/; Max-Age=${REFRESH_TTL_SEC}; SameSite=Lax`
  } catch {}
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,    setUser]    = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const inflightRefresh = useRef<Promise<boolean> | null>(null)
  const router = useRouter()

  const fetchMe = useCallback(async (): Promise<AuthUser | null> => {
    const r = await fetch('/api/auth/me', { cache: 'no-store' })
    if (r.ok) {
      const { user } = await r.json()
      return user as AuthUser
    }
    return null
  }, [])

  /**
   * 세션 복구 실패 처리.
   *
   * **자동 로그인 마커는 지우지 않는다.** 예전에는 여기서 지웠는데, 그 근거였던
   * "마커만 남으면 페이지는 통과하고 API만 401인 죽은 세션이 된다"는 이제 성립하지
   * 않는다 — 미들웨어가 마커와 refresh 쿠키를 **둘 다** 요구하고(`hasAutoLogin &&
   * hasRefresh`), 서버의 `clearSessionCookies()` 가 refresh 를 이미 지운다.
   *
   * 반면 지웠을 때의 손해는 컸다. 자동 로그인은 자격증명이 아니라 **사용자 설정**인데,
   * 회전된 refresh 토큰이 한 번 중복 제출되는 것만으로(탭 2개, 서버 재시작 직후 동시
   * 갱신 등) 401 이 나고 설정이 영구히 꺼졌다. localStorage 의 체크박스는 켜진 채라
   * 사용자에게는 "체크했는데 왜 매번 로그인하지?" 로만 보였다.
   * 설정은 사용자가 직접 끄거나 로그아웃할 때만 지운다(백엔드 `auth-cookies.ts` 와 같은 방침).
   */
  const expireSession = useCallback(() => {
    setUser(null)
    if (typeof window === 'undefined') return
    const { pathname, search } = window.location
    if (pathname === '/login') return
    router.replace(`/login?next=${encodeURIComponent(pathname + search)}`)
  }, [router])

  const refresh = useCallback(async (): Promise<boolean> => {
    // focus·visibilitychange가 함께 발생하면 refresh 토큰이 동시에 두 번 회전되어
    // 한쪽이 폐기된다. 진행 중인 요청이 있으면 그 결과를 공유한다.
    if (inflightRefresh.current) return inflightRefresh.current

    const run = async (): Promise<boolean> => {
      let r: Response
      try {
        r = await fetch('/api/auth/refresh', { method: 'POST' })
      } catch {
        return false            // 네트워크 오류 — 세션 만료로 단정하지 않는다
      }
      if (r.status === 401) {   // 토큰 폐기·만료 등 복구 불가
        expireSession()
        return false
      }
      if (!r.ok) return false
      const { user } = await r.json()
      setUser(user)
      // 세션이 연장됐으니 자동 로그인 마커도 함께 연장한다 (수명 어긋남 방지)
      renewAutoLoginMarker()
      return true
    }

    const p = run().finally(() => { inflightRefresh.current = null })
    inflightRefresh.current = p
    return p
  }, [expireSession])

  // 부팅 시 자동 로그인 시도: access → 실패 시 refresh
  useEffect(() => {
    let cancelled = false

    const restore = async (): Promise<AuthUser | null> => {
      let me = await fetchMe()
      if (!me) {
        const refreshed = await refresh()
        if (refreshed) me = await fetchMe()
      }
      return me
    }

    ;(async () => {
      let me = await restore()
      // 서버 재시작 직후의 첫 요청은 컴파일 지연·재시작 경합으로 실패할 수 있다.
      // 일시적 실패(네트워크 오류·5xx)는 세션 만료가 아니므로 복구 불가(401 → /login
      // 리다이렉트)가 아닌 경우 한 번만 더 시도한다.
      if (!me && typeof window !== 'undefined' && window.location.pathname !== '/login') {
        await new Promise(r => setTimeout(r, 700))
        if (!cancelled) me = await restore()
      }
      // 복구 불가(401)인 경우는 refresh 내부에서 로그인 화면으로 보낸다.
      if (cancelled) return
      setUser(me)
      setLoading(false)
      // refresh 를 거치지 않고 access 로 바로 복구된 경우에도 마커를 연장한다
      if (me) renewAutoLoginMarker()
    })()
    return () => { cancelled = true }
  }, [fetchMe, refresh])

  /**
   * 전역 401 처리.
   *
   * 화면마다 401 을 따로 처리하다 보니 대부분의 페이지가 세션 만료 시 원인 불명의
   * 실패로만 보였다(2026-08-22 점검 4-12번). fetch 를 한 번만 감싸 `/api/*` 응답이
   * 401 이면 자동으로 refresh 를 1회 시도하고, 그래도 실패하면 로그인 화면으로 보낸다.
   *
   * - `/api/auth/*` 는 401 이 정상 흐름이라 제외한다.
   * - 요청 본문이 스트림이면 재전송할 수 없으므로 재시도하지 않는다.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const original = window.fetch
    const g = window as unknown as { __kdFetchPatched?: boolean }
    if (g.__kdFetchPatched) return
    g.__kdFetchPatched = true

    const isGuardedApi = (input: RequestInfo | URL): boolean => {
      const raw = typeof input === 'string' ? input
        : input instanceof URL ? input.pathname
        : (input as Request).url
      try {
        const path = raw.startsWith('http') ? new URL(raw).pathname : raw
        return path.startsWith('/api/') && !path.startsWith('/api/auth/')
      } catch {
        return false
      }
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const res = await original(input, init)
      if (res.status !== 401 || !isGuardedApi(input)) return res

      const retriable = !(init?.body instanceof ReadableStream)
      const recovered = await refresh()
      if (recovered && retriable) return original(input, init)
      if (!recovered) expireSession()
      return res
    }

    return () => {
      window.fetch = original
      g.__kdFetchPatched = false
    }
  }, [refresh, expireSession])

  // 13분마다 자동 갱신 (access TTL 15분 대비 여유)
  useEffect(() => {
    if (!user) return
    refreshTimer.current = setInterval(() => { void refresh() }, 13 * 60 * 1000)
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current) }
  }, [user, refresh])

  // 절전/탭 비활성으로 타이머가 멈췄다가 돌아온 경우 즉시 세션을 갱신합니다.
  useEffect(() => {
    if (!user) return

    const refreshOnResume = () => {
      if (document.visibilityState === 'visible') void refresh()
    }

    window.addEventListener('focus', refreshOnResume)
    document.addEventListener('visibilitychange', refreshOnResume)
    return () => {
      window.removeEventListener('focus', refreshOnResume)
      document.removeEventListener('visibilitychange', refreshOnResume)
    }
  }, [user, refresh])

  const login = useCallback(async (username: string, password: string) => {
    const r = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password }),
    })
    if (!r.ok) {
      const { error } = await r.json().catch(() => ({ error: '로그인 실패' }))
      return { ok: false as const, error: error ?? '로그인 실패' }
    }
    const { user } = await r.json()
    setUser(user)
    return { ok: true as const }
  }, [])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => {})
    clearAutoLoginCookie()
    setUser(null)
    router.push('/login')
  }, [router])

  return (
    <Ctx.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth(): AuthCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useAuth must be used within AuthProvider')
  return c
}
