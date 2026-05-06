'use client'

import { useEffect, useState } from 'react'
import { useAuth } from '@frontend/lib/auth-context'
import { UserPlus, Trash2, Save, X } from 'lucide-react'

interface UserRow {
  id:          string
  username:    string
  displayName: string | null
  role:        'admin' | 'user'
  isActive:    boolean
  lastLoginAt: string | null
  createdAt:   string
}

export default function UsersAdminPage() {
  const { user: me } = useAuth()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing]   = useState<string | null>(null)
  const [error, setError]       = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const r = await fetch('/api/users', { cache: 'no-store' })
    if (r.ok) setUsers((await r.json()).users)
    else setError((await r.json().catch(() => ({}))).error ?? '조회 실패')
    setLoading(false)
  }

  useEffect(() => { void load() }, [])

  if (me && me.role !== 'admin') {
    return (
      <div className="p-8">
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          관리자만 접근할 수 있습니다.
        </p>
      </div>
    )
  }

  const remove = async (id: string) => {
    if (!confirm('정말 삭제하시겠습니까?')) return
    const r = await fetch(`/api/users/${id}`, { method: 'DELETE' })
    if (r.ok) load()
    else setError((await r.json().catch(() => ({}))).error ?? '삭제 실패')
  }

  return (
    <div className="p-8">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">사용자 관리</h1>
          <p className="text-xs text-slate-500">총 {users.length}명</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
        >
          <UserPlus size={13} />
          사용자 추가
        </button>
      </div>

      {error && (
        <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{error}</p>
      )}

      {creating && (
        <CreateForm
          onCancel={() => setCreating(false)}
          onCreated={() => { setCreating(false); load() }}
        />
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">아이디</th>
              <th className="px-3 py-2 text-left">이름</th>
              <th className="px-3 py-2 text-left">역할</th>
              <th className="px-3 py-2 text-left">상태</th>
              <th className="px-3 py-2 text-left">마지막 로그인</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">로딩 중…</td></tr>
            ) : users.map(u => (
              editing === u.id ? (
                <EditRow
                  key={u.id}
                  user={u}
                  onCancel={() => setEditing(null)}
                  onSaved={() => { setEditing(null); load() }}
                />
              ) : (
                <tr key={u.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{u.username}</td>
                  <td className="px-3 py-2">{u.displayName ?? '-'}</td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                      u.role === 'admin' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600'
                    }`}>{u.role}</span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] ${
                      u.isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
                    }`}>{u.isActive ? '활성' : '비활성'}</span>
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('ko-KR') : '-'}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button onClick={() => setEditing(u.id)} className="mr-2 text-xs text-blue-600 hover:underline">수정</button>
                    {u.id !== me?.id && (
                      <button onClick={() => remove(u.id)} className="text-xs text-red-600 hover:underline">삭제</button>
                    )}
                  </td>
                </tr>
              )
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─── Create form ────────────────────────────────────────────────────────────
function CreateForm({ onCancel, onCreated }: { onCancel: () => void; onCreated: () => void }) {
  const [username, setU] = useState('')
  const [password, setP] = useState('')
  const [displayName, setD] = useState('')
  const [role, setR] = useState<'admin' | 'user'>('user')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr(null)
    const r = await fetch('/api/users', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ username, password, displayName, role }),
    })
    setBusy(false)
    if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? '생성 실패'); return }
    onCreated()
  }

  return (
    <form onSubmit={submit} className="mb-4 grid grid-cols-5 gap-2 rounded-lg border border-blue-200 bg-blue-50/40 p-3 text-xs">
      <input className="rounded border border-slate-200 px-2 py-1.5 bg-white" placeholder="아이디" value={username} onChange={e => setU(e.target.value)} />
      <input className="rounded border border-slate-200 px-2 py-1.5 bg-white" placeholder="비밀번호" type="password" value={password} onChange={e => setP(e.target.value)} />
      <input className="rounded border border-slate-200 px-2 py-1.5 bg-white" placeholder="이름" value={displayName} onChange={e => setD(e.target.value)} />
      <select className="rounded border border-slate-200 px-2 py-1.5 bg-white" value={role} onChange={e => setR(e.target.value as 'admin' | 'user')}>
        <option value="user">user</option>
        <option value="admin">admin</option>
      </select>
      <div className="flex gap-1">
        <button type="submit" disabled={busy || !username || !password} className="flex-1 rounded bg-blue-600 px-2 py-1.5 text-white disabled:opacity-50">생성</button>
        <button type="button" onClick={onCancel} className="rounded border border-slate-200 bg-white px-2 py-1.5"><X size={12} /></button>
      </div>
      {err && <p className="col-span-5 text-red-600">{err}</p>}
    </form>
  )
}

// ─── Edit row ───────────────────────────────────────────────────────────────
function EditRow({ user, onCancel, onSaved }: { user: UserRow; onCancel: () => void; onSaved: () => void }) {
  const [displayName, setD] = useState(user.displayName ?? '')
  const [role, setR]        = useState(user.role)
  const [isActive, setA]    = useState(user.isActive)
  const [password, setP]    = useState('')
  const [busy, setBusy]     = useState(false)

  const save = async () => {
    setBusy(true)
    const body: Record<string, unknown> = { displayName, role, isActive }
    if (password) body.password = password
    await fetch(`/api/users/${user.id}`, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    })
    setBusy(false)
    onSaved()
  }

  return (
    <tr className="border-t border-slate-100 bg-blue-50/30">
      <td className="px-3 py-2 font-mono text-xs">{user.username}</td>
      <td className="px-3 py-2">
        <input className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs" value={displayName} onChange={e => setD(e.target.value)} />
      </td>
      <td className="px-3 py-2">
        <select className="rounded border border-slate-200 bg-white px-2 py-1 text-xs" value={role} onChange={e => setR(e.target.value as 'admin' | 'user')}>
          <option value="user">user</option>
          <option value="admin">admin</option>
        </select>
      </td>
      <td className="px-3 py-2">
        <select className="rounded border border-slate-200 bg-white px-2 py-1 text-xs" value={isActive ? '1' : '0'} onChange={e => setA(e.target.value === '1')}>
          <option value="1">활성</option>
          <option value="0">비활성</option>
        </select>
      </td>
      <td className="px-3 py-2">
        <input className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-xs" placeholder="새 비밀번호 (선택)" type="password" value={password} onChange={e => setP(e.target.value)} />
      </td>
      <td className="px-3 py-2 text-right whitespace-nowrap">
        <button onClick={save} disabled={busy} className="mr-2 inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-xs text-white disabled:opacity-50">
          <Save size={11} /> 저장
        </button>
        <button onClick={onCancel} className="inline-flex items-center gap-1 rounded border border-slate-200 bg-white px-2 py-1 text-xs">
          취소
        </button>
      </td>
    </tr>
  )
}
