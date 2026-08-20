'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@frontend/lib/auth-context'
import { FlaskConical, Lock, User as UserIcon, Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@frontend/components/ui/button'
import { Card } from '@frontend/components/ui/card'
import { Input } from '@frontend/components/ui/input'

const LS_SAVED_ID    = 'kd-saved-id'
const LS_AUTO_LOGIN  = 'kd-auto-login'
const AUTO_LOGIN_COOKIE = 'kd_auto_login'
const REFRESH_TTL_SEC = 60 * 60 * 24 * 7

function writeAutoLoginCookie(enabled: boolean) {
  document.cookie = enabled
    ? `${AUTO_LOGIN_COOKIE}=1; Path=/; Max-Age=${REFRESH_TTL_SEC}; SameSite=Lax`
    : `${AUTO_LOGIN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
}

function readLoginPrefs() {
  if (typeof window === 'undefined') {
    return {
      username: 'kyo-admin',
      rememberId: false,
      autoLogin: false,
    }
  }

  try {
    const savedId = localStorage.getItem(LS_SAVED_ID)
    return {
      username: savedId || 'kyo-admin',
      rememberId: Boolean(savedId),
      autoLogin: localStorage.getItem(LS_AUTO_LOGIN) === '1',
    }
  } catch {
    return {
      username: 'kyo-admin',
      rememberId: false,
      autoLogin: false,
    }
  }
}

function LoginForm() {
  const router       = useRouter()
  const params       = useSearchParams()
  const { user, loading, login } = useAuth()

  // TODO: 개발 편의용 기본값. 운영 배포 전 빈 문자열로 되돌릴 것.
  const initialPrefs = readLoginPrefs()
  const [username,   setUsername]   = useState(initialPrefs.username)
  const [password,   setPassword]   = useState('kyo-admin')
  const [rememberId, setRememberId] = useState(initialPrefs.rememberId)
  const [autoLogin,  setAutoLogin]  = useState(initialPrefs.autoLogin)
  const [showPw,     setShowPw]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [busy,       setBusy]       = useState(false)

  const next = params.get('next') || '/home'

  // 자동로그인 체크되어있고 토큰이 유효해 user가 복원되면 홈으로 이동
  useEffect(() => {
    if (loading) return
    if (user && autoLogin) {
      try { writeAutoLoginCookie(true) } catch {}
      router.replace(next)
    }
  }, [user, loading, autoLogin, router, next])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    const r = await login(username.trim(), password)
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }

    // Persist preferences
    try {
      if (rememberId) localStorage.setItem(LS_SAVED_ID, username.trim())
      else            localStorage.removeItem(LS_SAVED_ID)
      if (autoLogin)  localStorage.setItem(LS_AUTO_LOGIN, '1')
      else            localStorage.removeItem(LS_AUTO_LOGIN)
      writeAutoLoginCookie(autoLogin)
    } catch {}

    router.replace(next)
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-sm gap-0 p-6 shadow-sm">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex size-11 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <FlaskConical size={20} />
          </div>
          <p className="text-[11px] font-medium tracking-widest text-muted-foreground uppercase">광동제약</p>
          <h1 className="text-base font-semibold text-foreground">QC 시험 관리 시스템</h1>
        </div>

        <form onSubmit={submit} className="grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">아이디</span>
            <div className="relative">
              <UserIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                className="pl-9"
                placeholder="kyo-admin"
              />
            </div>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">비밀번호</span>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                className="pr-9 pl-9"
                placeholder="••••••••"
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={() => setShowPw(s => !s)}
                title={showPw ? '비밀번호 숨기기' : '비밀번호 보기'}
                className="absolute top-1/2 right-1.5 -translate-y-1/2 text-muted-foreground"
              >
                {showPw ? <EyeOff /> : <Eye />}
              </Button>
            </div>
          </label>

          <div className="flex items-center gap-4 pt-1">
            <label className="flex cursor-pointer items-center gap-1.5 select-none">
              <input
                type="checkbox"
                checked={rememberId}
                onChange={e => setRememberId(e.target.checked)}
                className="cb-custom"
              />
              <span className="text-xs text-muted-foreground">아이디 저장</span>
            </label>
            <label className="flex cursor-pointer items-center gap-1.5 select-none">
              <input
                type="checkbox"
                checked={autoLogin}
                onChange={e => setAutoLogin(e.target.checked)}
                className="cb-custom"
              />
              <span className="text-xs text-muted-foreground">자동 로그인</span>
            </label>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          )}

          <Button type="submit" disabled={busy || !username || !password} className="w-full">
            {busy && <Loader2 className="animate-spin" />}
            {busy ? '로그인 중…' : '로그인'}
          </Button>
        </form>

        <p className="mt-5 text-center text-[11px] text-muted-foreground">
          기본 관리자 계정: <span className="font-mono">kyo-admin / kyo-admin</span>
        </p>
      </Card>
    </div>
  )
}

// useSearchParams()는 CSR 바일아웃 → 정적 프리렌더를 위해 Suspense 경계로 감싼다
export default function LoginPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[100dvh] items-center justify-center bg-muted/40 p-4" />}>
      <LoginForm />
    </Suspense>
  )
}
