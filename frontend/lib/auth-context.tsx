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

function clearAutoLoginCookie() {
  if (typeof document === 'undefined') return
  document.cookie = `${AUTO_LOGIN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
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
   * 세션 복구 실패 처리. 자동 로그인 마커만 남으면 미들웨어가 페이지는 통과시키고
   * API만 401을 내는 죽은 세션이 되므로, 마커를 지우고 로그인 화면으로 보낸다.
   */
  const expireSession = useCallback(() => {
    clearAutoLoginCookie()
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
      return true
    }

    const p = run().finally(() => { inflightRefresh.current = null })
    inflightRefresh.current = p
    return p
  }, [expireSession])

  // 부팅 시 자동 로그인 시도: access → 실패 시 refresh
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let me = await fetchMe()
      if (!me) {
        const refreshed = await refresh()
        if (refreshed) me = await fetchMe()
      }
      // 복구 불가(401)인 경우는 refresh 내부에서 로그인 화면으로 보낸다.
      if (cancelled) return
      setUser(me)
      setLoading(false)
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
