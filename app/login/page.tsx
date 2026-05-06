'use client'

import { useState, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useAuth } from '@frontend/lib/auth-context'
import { FlaskConical, Lock, User as UserIcon, Eye, EyeOff } from 'lucide-react'

const LS_SAVED_ID    = 'kd-saved-id'
const LS_AUTO_LOGIN  = 'kd-auto-login'

export default function LoginPage() {
  const router       = useRouter()
  const params       = useSearchParams()
  const { user, loading, login } = useAuth()

  // TODO: 개발 편의용 기본값. 운영 배포 전 빈 문자열로 되돌릴 것.
  const [username,   setUsername]   = useState('kyo-admin')
  const [password,   setPassword]   = useState('kyo-admin')
  const [rememberId, setRememberId] = useState(false)
  const [autoLogin,  setAutoLogin]  = useState(false)
  const [showPw,     setShowPw]     = useState(false)
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [busy,       setBusy]       = useState(false)

  const next = params.get('next') || '/home'

  // Load saved preferences from localStorage on mount
  useEffect(() => {
    try {
      const savedId = localStorage.getItem(LS_SAVED_ID)
      const auto    = localStorage.getItem(LS_AUTO_LOGIN) === '1'
      if (savedId) {
        setUsername(savedId)
        setRememberId(true)
      }
      setAutoLogin(auto)
    } catch {}
    setPrefsLoaded(true)
  }, [])

  // 자동로그인 체크되어있고 토큰이 유효해 user가 복원되면 홈으로 이동
  useEffect(() => {
    if (loading || !prefsLoaded) return
    if (user && autoLogin) router.replace(next)
  }, [user, loading, autoLogin, prefsLoaded, router, next])

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
    } catch {}

    router.replace(next)
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-50 to-slate-100 p-4">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-xl">
        <div className="mb-6 flex flex-col items-center gap-2">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-violet-600 text-white">
            <FlaskConical size={22} />
          </div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">광동제약</p>
          <h1 className="text-base font-semibold text-slate-800">QC 시험 관리 시스템</h1>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">아이디</span>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition">
              <UserIcon size={14} className="text-slate-400" />
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                autoComplete="username"
                autoFocus
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                placeholder="kyo-admin"
              />
            </div>
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">비밀번호</span>
            <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition">
              <Lock size={14} className="text-slate-400" />
              <input
                type={showPw ? 'text' : 'password'}
                value={password}
                onChange={e => setPassword(e.target.value)}
                autoComplete="current-password"
                className="w-full bg-transparent text-sm outline-none placeholder:text-slate-400"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPw(s => !s)}
                title={showPw ? '비밀번호 숨기기' : '비밀번호 보기'}
                className="shrink-0 rounded p-0.5 text-slate-400 hover:text-slate-600 transition-colors"
              >
                {showPw ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>
          </label>

          <div className="flex items-center gap-4 pt-1">
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rememberId}
                onChange={e => setRememberId(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-400"
              />
              <span className="text-xs text-slate-600">아이디 저장</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={autoLogin}
                onChange={e => setAutoLogin(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-400"
              />
              <span className="text-xs text-slate-600">자동 로그인</span>
            </label>
          </div>

          {error && (
            <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
          )}

          <button
            type="submit"
            disabled={busy || !username || !password}
            className="w-full rounded-lg bg-gradient-to-br from-blue-600 to-violet-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition hover:opacity-95 active:scale-[0.99] disabled:opacity-50"
          >
            {busy ? '로그인 중…' : '로그인'}
          </button>
        </form>

        <p className="mt-5 text-center text-[11px] text-slate-400">
          기본 관리자 계정: <span className="font-mono">kyo-admin / kyo-admin</span>
        </p>
      </div>
    </div>
  )
}
