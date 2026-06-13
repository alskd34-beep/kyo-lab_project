'use client'

import { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'

export type UserRole = 'admin' | 'user'

export interface AuthUser {
  id:          string
  username:    string
  displayName: string | null
  avatarUrl:   string | null
  role:        UserRole
}

interface AuthCtx {
  user:    AuthUser | null
  loading: boolean
  login:   (username: string, password: string) => Promise<{ ok: true } | { ok: false; error: string }>
  logout:  () => Promise<void>
  refresh: () => Promise<boolean>
}

const Ctx = createContext<AuthCtx | null>(null)

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user,    setUser]    = useState<AuthUser | null>(null)
  const [loading, setLoading] = useState(true)
  const refreshTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const router = useRouter()

  const fetchMe = useCallback(async (): Promise<AuthUser | null> => {
    const r = await fetch('/api/auth/me', { cache: 'no-store' })
    if (r.ok) {
      const { user } = await r.json()
      return user as AuthUser
    }
    return null
  }, [])

  const refresh = useCallback(async (): Promise<boolean> => {
    const r = await fetch('/api/auth/refresh', { method: 'POST' })
    if (!r.ok) return false
    const { user } = await r.json()
    setUser(user)
    return true
  }, [])

  // 부팅 시 자동 로그인 시도: access → 실패 시 refresh
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      let me = await fetchMe()
      if (!me) {
        const refreshed = await refresh()
        if (refreshed) me = await fetchMe()
      }
      if (!cancelled) {
        setUser(me)
        setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [fetchMe, refresh])

  // 13분마다 자동 갱신 (access TTL 15분 대비 여유)
  useEffect(() => {
    if (!user) return
    refreshTimer.current = setInterval(() => { void refresh() }, 13 * 60 * 1000)
    return () => { if (refreshTimer.current) clearInterval(refreshTimer.current) }
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
