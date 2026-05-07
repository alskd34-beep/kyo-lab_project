'use client'

import { useState } from 'react'
import { useAuth } from '@frontend/lib/auth-context'
import { Lock, Save } from 'lucide-react'

export default function SysSettingsPage() {
  const { user, logout } = useAuth()
  const [current, setCurrent] = useState('')
  const [next1,   setNext1]   = useState('')
  const [next2,   setNext2]   = useState('')
  const [busy,    setBusy]    = useState(false)
  const [msg,     setMsg]     = useState<{ type: 'ok' | 'err'; text: string } | null>(null)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setMsg(null)
    if (next1 !== next2) { setMsg({ type: 'err', text: '새 비밀번호가 일치하지 않습니다.' }); return }
    if (next1.length < 4) { setMsg({ type: 'err', text: '비밀번호는 4자 이상이어야 합니다.' }); return }

    setBusy(true)
    const r = await fetch('/api/auth/change-password', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ currentPassword: current, newPassword: next1 }),
    })
    setBusy(false)
    if (!r.ok) {
      const { error } = await r.json().catch(() => ({ error: '변경 실패' }))
      setMsg({ type: 'err', text: error ?? '변경 실패' })
      return
    }
    setMsg({ type: 'ok', text: '비밀번호가 변경되었습니다. 다시 로그인해주세요.' })
    setCurrent(''); setNext1(''); setNext2('')
    setTimeout(() => { void logout() }, 1500)
  }

  return (
    <div className="mx-auto w-full max-w-xl p-4 md:p-8">
      <h1 className="mb-1 text-lg font-semibold text-slate-800">시스템 설정</h1>
      <p className="mb-6 text-xs text-slate-500">로그인 사용자: {user?.username}</p>

      <section className="rounded-xl border border-slate-200 bg-white p-4 md:p-6">
        <div className="mb-4 flex items-center gap-2">
          <Lock size={16} className="text-slate-500" />
          <h2 className="text-sm font-semibold text-slate-800">비밀번호 변경</h2>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <Field label="현재 비밀번호" value={current} onChange={setCurrent} type="password" />
          <Field label="새 비밀번호"   value={next1}   onChange={setNext1}   type="password" />
          <Field label="새 비밀번호 확인" value={next2} onChange={setNext2} type="password" />

          {msg && (
            <p className={`rounded-md border px-3 py-2 text-xs ${
              msg.type === 'ok' ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-600'
            }`}>{msg.text}</p>
          )}

          <button
            type="submit"
            disabled={busy || !current || !next1 || !next2}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Save size={13} />
            {busy ? '변경 중…' : '비밀번호 변경'}
          </button>
        </form>
      </section>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-slate-600">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />
    </label>
  )
}
