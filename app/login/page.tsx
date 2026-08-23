'use client'

import { Suspense, useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@frontend/lib/auth-context'
import { FlaskConical, Lock, User as UserIcon, Eye, EyeOff, Loader2 } from 'lucide-react'
import { Button } from '@frontend/components/ui/button'
import { Card } from '@frontend/components/ui/card'
import { Input } from '@frontend/components/ui/input'

const HOME_PATH      = '/home'
const LS_SAVED_ID    = 'kd-saved-id'
const LS_AUTO_LOGIN  = 'kd-auto-login'
const AUTO_LOGIN_COOKIE = 'kd_auto_login'
const REFRESH_TTL_SEC = 60 * 60 * 24 * 7

function writeAutoLoginCookie(enabled: boolean) {
  document.cookie = enabled
    ? `${AUTO_LOGIN_COOKIE}=1; Path=/; Max-Age=${REFRESH_TTL_SEC}; SameSite=Lax`
    : `${AUTO_LOGIN_COOKIE}=; Path=/; Max-Age=0; SameSite=Lax`
}

interface LoginPrefs {
  username: string
  rememberId: boolean
  autoLogin: boolean
}

const EMPTY_PREFS: LoginPrefs = { username: '', rememberId: false, autoLogin: false }

/**
 * 저장된 로그인 환경설정을 읽는다.
 *
 * 반드시 마운트 후(effect)에만 호출한다. 렌더 중에 부르면 서버 렌더 결과(빈 값)와
 * 클라이언트 첫 렌더 결과(localStorage 값)가 달라져 hydration 불일치가 난다.
 */
function readLoginPrefs(): LoginPrefs {
  try {
    const savedId = localStorage.getItem(LS_SAVED_ID)
    return {
      username: savedId ?? '',
      rememberId: Boolean(savedId),
      autoLogin: localStorage.getItem(LS_AUTO_LOGIN) === '1',
    }
  } catch {
    return EMPTY_PREFS
  }
}

/**
 * 로그인 후 이동할 경로를 정리한다.
 *
 * `next` 는 미들웨어·세션만료 처리가 붙여 주는 값이라 화면이 아닌 경로가 섞여 들어온다.
 * 그대로 이동하면 홈 대신 엉뚱한 곳으로 가거나(루트), 로그인 화면으로 되돌아온다.
 * - `//evil.com`·`https://…` 같은 외부 주소는 오픈 리다이렉트가 되므로 버린다.
 * - 루트·로그인·API 경로는 홈으로 돌린다.
 */
function safeNext(raw: string | null): string {
  if (!raw) return HOME_PATH
  // 앞뒤 공백·제어문자가 섞이면 `/` 판정을 우회할 수 있어 먼저 다듬는다.
  const value = raw.trim()
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return HOME_PATH

  const path = value.split(/[?#]/)[0]
  if (path === '/') return HOME_PATH
  if (path === '/login' || path.startsWith('/login/')) return HOME_PATH
  if (path.startsWith('/api/')) return HOME_PATH
  return value
}

function LoginForm() {
  const router       = useRouter()
  const params       = useSearchParams()
  const { user, loading, login } = useAuth()

  // 초기값은 서버 렌더와 동일하게 빈 값으로 두고, 저장된 설정은 마운트 후에 채운다.
  const [username,   setUsername]   = useState('')
  const [password,   setPassword]   = useState('')
  const [rememberId, setRememberId] = useState(false)
  const [autoLogin,  setAutoLogin]  = useState(false)
  const [showPw,     setShowPw]     = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [busy,       setBusy]       = useState(false)

  const next = safeNext(params.get('next'))

  useEffect(() => {
    const prefs = readLoginPrefs()
    /* eslint-disable react-hooks/set-state-in-effect -- localStorage(외부 시스템)를 마운트 1회 읽어 동기화. 렌더 중에 읽으면 hydration 불일치가 난다. */
    if (prefs.username) setUsername(prefs.username)
    setRememberId(prefs.rememberId)
    setAutoLogin(prefs.autoLogin)
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [])

  // 자동로그인 체크되어있고 토큰이 유효해 user가 복원되면 홈으로 이동
  useEffect(() => {
    if (loading) return
    if (user && autoLogin) {
      try { writeAutoLoginCookie(true) } catch {}
      router.replace(next)
    }
  }, [user, loading, autoLogin, router, next])

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setError(null)

    // 브라우저 자동완성은 DOM 입력값만 채우고 React 상태를 갱신하지 못하는 경우가 있다.
    // 상태만 믿으면 값이 보이는데도 "빈 값" 으로 판단해 로그인이 조용히 막힌다.
    // await 전에 동기적으로 폼 값을 읽어 함께 본다.
    const fd = new FormData(e.currentTarget)
    const id = (username || String(fd.get('username') ?? '')).trim()
    const pw = password || String(fd.get('password') ?? '')

    if (!id || !pw) {
      setError('아이디와 비밀번호를 입력하세요.')
      return
    }

    setBusy(true)
    const r = await login(id, pw)
    setBusy(false)
    if (!r.ok) {
      setError(r.error)
      return
    }

    // Persist preferences
    try {
      if (rememberId) localStorage.setItem(LS_SAVED_ID, id)
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
          <p className="text-xs leading-normal font-medium tracking-widest text-muted-foreground uppercase">광동제약</p>
          <h1 className="text-base font-semibold text-foreground">QC 시험 관리 시스템</h1>
        </div>

        <form onSubmit={submit} className="grid gap-3">
          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">아이디</span>
            <div className="relative">
              <UserIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="login-username"
                name="username"
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                className="pl-9"
                placeholder="아이디를 입력하세요"
              />
            </div>
          </label>

          <label className="grid gap-1.5">
            <span className="text-xs font-medium text-foreground">비밀번호</span>
            <div className="relative">
              <Lock className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="login-password"
                name="password"
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

          <Button type="submit" disabled={busy} className="w-full">
            {busy && <Loader2 className="animate-spin" />}
            {busy ? '로그인 중…' : '로그인'}
          </Button>
        </form>
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
