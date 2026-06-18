'use client'

import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { ImagePlus, Pencil, Save, Trash2, Upload, UserPlus, X } from 'lucide-react'
import { useAuth } from '@frontend/lib/auth-context'
import { Avatar, AvatarFallback, AvatarImage } from '@frontend/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@frontend/components/ui/dialog'

interface UserRow {
  id:          string
  username:    string
  displayName: string | null
  avatarUrl:   string | null
  role:        'admin' | 'user'
  isActive:    boolean
  lastLoginAt: string | null
  createdAt:   string
}

const MAX_AVATAR_SIZE = 1024 * 1024

function getInitial(user: Pick<UserRow, 'displayName' | 'username'>) {
  return (user.displayName ?? user.username ?? '?').charAt(0).toUpperCase()
}

function readImageAsDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    return Promise.reject(new Error('이미지 파일만 업로드할 수 있습니다.'))
  }

  if (file.size > MAX_AVATAR_SIZE) {
    return Promise.reject(new Error('사진은 1MB 이하 파일만 업로드할 수 있습니다.'))
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('사진을 읽지 못했습니다.'))
    reader.readAsDataURL(file)
  })
}

export default function UsersAdminPage() {
  const { user: me, refresh } = useAuth()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editingUser, setEditingUser] = useState<UserRow | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const r = await fetch('/api/users', { cache: 'no-store', credentials: 'include' })
    if (r.ok) {
      setUsers((await r.json()).users)
    } else {
      setError((await r.json().catch(() => ({}))).error ?? '조회 실패')
    }

    setLoading(false)
  }, [])

  useEffect(() => {
    queueMicrotask(() => { void load() })
  }, [load])

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
    const r = await fetch(`/api/users/${id}`, { method: 'DELETE', credentials: 'include' })
    if (r.ok) {
      void load()
    } else {
      setError((await r.json().catch(() => ({}))).error ?? '삭제 실패')
    }
  }

  const handleSaved = async (savedUser: UserRow) => {
    setEditingUser(null)
    await load()
    if (savedUser.id === me?.id) await refresh()
  }

  return (
    <div className="p-3 md:p-5">
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">사용자 관리</h1>
          <p className="text-xs text-slate-500">총 {users.length}명</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 md:w-auto"
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
          onCreated={() => { setCreating(false); void load() }}
        />
      )}

      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white md:block">
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-slate-50/80 text-[11px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-3 py-2 text-left">사용자</th>
              <th className="px-3 py-2 text-left">아이디</th>
              <th className="px-3 py-2 text-left">역할</th>
              <th className="px-3 py-2 text-left">상태</th>
              <th className="px-3 py-2 text-left">마지막 로그인</th>
              <th className="px-3 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-slate-400">로딩 중...</td></tr>
            ) : users.map(u => (
              <tr key={u.id} className="border-t border-slate-100">
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <UserAvatar user={u} />
                    <span>{u.displayName ?? '-'}</span>
                  </div>
                </td>
                <td className="px-3 py-2 font-mono text-xs">{u.username}</td>
                <td className="px-3 py-2">
                  <RoleBadge role={u.role} />
                </td>
                <td className="px-3 py-2">
                  <StatusBadge isActive={u.isActive} />
                </td>
                <td className="px-3 py-2 font-mono text-[11px] text-slate-500">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('ko-KR') : '-'}
                </td>
                <td className="px-3 py-2 text-right">
                  <button
                    onClick={() => setEditingUser(u)}
                    className="mr-2 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50"
                  >
                    <Pencil size={12} />
                    수정
                  </button>
                  {u.id !== me?.id && (
                    <button
                      onClick={() => remove(u.id)}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                    >
                      <Trash2 size={12} />
                      삭제
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 md:hidden">
        {loading ? (
          <p className="rounded-lg border border-slate-200 bg-white px-3 py-6 text-center text-xs text-slate-400">로딩 중...</p>
        ) : users.map(u => (
          <div key={u.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <UserAvatar user={u} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{u.displayName ?? '-'}</p>
                  <p className="truncate font-mono text-xs text-slate-500">{u.username}</p>
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  onClick={() => setEditingUser(u)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md text-blue-600 hover:bg-blue-50"
                  aria-label="사용자 수정"
                >
                  <Pencil size={14} />
                </button>
                {u.id !== me?.id && (
                  <button
                    onClick={() => remove(u.id)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-red-600 hover:bg-red-50"
                    aria-label="사용자 삭제"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <RoleBadge role={u.role} />
              <StatusBadge isActive={u.isActive} />
            </div>
            <p className="mt-2 text-[11px] text-slate-500">
              마지막 로그인: {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('ko-KR') : '-'}
            </p>
          </div>
        ))}
      </div>

      <EditUserDialog
        user={editingUser}
        open={editingUser !== null}
        onOpenChange={(open) => { if (!open) setEditingUser(null) }}
        onSaved={handleSaved}
      />
    </div>
  )
}

function UserAvatar({ user }: { user: UserRow }) {
  return (
    <Avatar className="h-8 w-8">
      {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
      <AvatarFallback className="bg-blue-600 text-xs font-bold text-white">
        {getInitial(user)}
      </AvatarFallback>
    </Avatar>
  )
}

function RoleBadge({ role }: { role: UserRow['role'] }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${
      role === 'admin' ? 'bg-violet-50 text-violet-700' : 'bg-slate-100 text-slate-600'
    }`}>
      {role}
    </span>
  )
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] ${
      isActive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'
    }`}>
      {isActive ? '활성' : '비활성'}
    </span>
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

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setErr(null)

    const r = await fetch('/api/users', {
      method:      'POST',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ username, password, displayName, role }),
    })

    setBusy(false)
    if (!r.ok) {
      setErr((await r.json().catch(() => ({}))).error ?? '생성 실패')
      return
    }
    onCreated()
  }

  return (
    <form onSubmit={submit} className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-blue-200 bg-blue-50/40 p-3 text-xs sm:grid-cols-2 md:grid-cols-5">
      <input className="rounded border border-slate-200 bg-white px-2 py-1.5" placeholder="아이디" value={username} onChange={e => setU(e.target.value)} />
      <input className="rounded border border-slate-200 bg-white px-2 py-1.5" placeholder="비밀번호" type="password" value={password} onChange={e => setP(e.target.value)} />
      <input className="rounded border border-slate-200 bg-white px-2 py-1.5" placeholder="이름" value={displayName} onChange={e => setD(e.target.value)} />
      <select className="rounded border border-slate-200 bg-white px-2 py-1.5" value={role} onChange={e => setR(e.target.value as 'admin' | 'user')}>
        <option value="user">user</option>
        <option value="admin">admin</option>
      </select>
      <div className="flex gap-1">
        <button type="submit" disabled={busy || !username || !password} className="flex-1 rounded bg-blue-600 px-2 py-1.5 text-white disabled:opacity-50">생성</button>
        <button type="button" onClick={onCancel} className="rounded border border-slate-200 bg-white px-2 py-1.5"><X size={12} /></button>
      </div>
      {err && <p className="text-red-600 sm:col-span-2 md:col-span-5">{err}</p>}
    </form>
  )
}

function EditUserDialog({
  user,
  open,
  onOpenChange,
  onSaved,
}: {
  user: UserRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (user: UserRow) => void | Promise<void>
}) {
  const [displayName, setDisplayName] = useState('')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null)
  const [role, setRole] = useState<'admin' | 'user'>('user')
  const [isActive, setIsActive] = useState(true)
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!user) return

    queueMicrotask(() => {
      setDisplayName(user.displayName ?? '')
      setAvatarUrl(user.avatarUrl)
      setRole(user.role)
      setIsActive(user.isActive)
      setPassword('')
      setErr(null)
      setBusy(false)
    })
  }, [user])

  if (!user) return null

  const handlePhotoChange = async (file: File | undefined) => {
    if (!file) return

    try {
      setErr(null)
      setAvatarUrl(await readImageAsDataUrl(file))
    } catch (e) {
      setErr(e instanceof Error ? e.message : '사진 업로드 실패')
    }
  }

  const save = async () => {
    setBusy(true)
    setErr(null)

    const body: Record<string, unknown> = { displayName, role, isActive }
    if (avatarUrl !== user.avatarUrl) body.avatarUrl = avatarUrl
    if (password) body.password = password

    const r = await fetch(`/api/users/${user.id}`, {
      method:      'PATCH',
      credentials: 'include',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify(body),
    })

    setBusy(false)
    if (!r.ok) {
      setErr((await r.json().catch(() => ({}))).error ?? '저장 실패')
      return
    }

    const data = await r.json() as { user: UserRow }
    await onSaved(data.user)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="mx-4 w-[calc(100%-2rem)] max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>사용자 수정</DialogTitle>
          <DialogDescription>{user.username} 계정 정보를 수정합니다.</DialogDescription>
        </DialogHeader>

        <div className="grid gap-5 md:grid-cols-[140px_1fr]">
          <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <Avatar className="h-24 w-24">
              {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
              <AvatarFallback className="bg-blue-600 text-2xl font-bold text-white">
                {getInitial(user)}
              </AvatarFallback>
            </Avatar>
            <label className="inline-flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-md bg-slate-800 px-3 py-2 text-xs font-medium text-white hover:bg-slate-700">
              <Upload size={13} />
              사진 업로드
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="sr-only"
                onChange={e => { void handlePhotoChange(e.target.files?.[0]); e.currentTarget.value = '' }}
              />
            </label>
            <button
              type="button"
              onClick={() => setAvatarUrl(null)}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600 hover:bg-slate-100"
            >
              <ImagePlus size={13} />
              사진 제거
            </button>
          </div>

          <div className="space-y-3">
            <label className="block text-xs font-medium text-slate-600">
              이름
              <input
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                value={displayName}
                onChange={e => setDisplayName(e.target.value)}
              />
            </label>
            <label className="block text-xs font-medium text-slate-600">
              역할
              <select
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                value={role}
                onChange={e => setRole(e.target.value as 'admin' | 'user')}
              >
                <option value="user">user</option>
                <option value="admin">admin</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              상태
              <select
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                value={isActive ? '1' : '0'}
                onChange={e => setIsActive(e.target.value === '1')}
              >
                <option value="1">활성</option>
                <option value="0">비활성</option>
              </select>
            </label>
            <label className="block text-xs font-medium text-slate-600">
              새 비밀번호
              <input
                className="mt-1 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                placeholder="변경할 때만 입력"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
            </label>
            {err && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-600">{err}</p>}
          </div>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-md border border-slate-200 bg-white px-3 py-2 text-xs text-slate-700 hover:bg-slate-50"
          >
            취소
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            <Save size={13} />
            저장
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
