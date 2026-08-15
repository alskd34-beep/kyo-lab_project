'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronUp, ImagePlus, Pencil, Save, Trash2, Upload, UserPlus, X } from 'lucide-react'
import { Skeleton } from '@frontend/components/ui/skeleton'
import { useAuth } from '@frontend/lib/auth-context'
import { TesterAvatar, invalidateTesterProfileCache } from '@frontend/lib/tester-profiles'
import { useConfirmMessage } from '@frontend/components/common/confirm-message'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@frontend/components/ui/dialog'
import { Button } from '@frontend/components/ui/button'
import { Input } from '@frontend/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@frontend/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@frontend/components/ui/table'

interface UserRow {
  id:          string
  username:    string
  displayName: string | null
  avatarUrl:   string | null
  role:        'admin' | 'tester'
  isActive:    boolean
  lastLoginAt: string | null
  createdAt:   string
  customerNo:  number | null
  testerId:    string | null
  testerName:  string | null
}

type SortField = 'displayName' | 'username' | 'role' | 'customerNo' | 'lastLoginAt'

/** 내부 고객번호 표기 — 5자리 zero-pad (미부여 시 '-') */
function fmtCustomerNo(n: number | null): string {
  return n == null ? '-' : String(n).padStart(5, '0')
}

function SortIcon({
  field,
  sortField,
  sortDir,
}: {
  field: SortField
  sortField: SortField
  sortDir: 'asc' | 'desc'
}) {
  if (sortField !== field) return <ChevronDown size={11} className="ml-1 inline opacity-30" />
  return sortDir === 'asc'
    ? <ChevronUp size={11} className="ml-1 inline text-primary" />
    : <ChevronDown size={11} className="ml-1 inline text-primary" />
}

const MAX_AVATAR_SIZE = 1024 * 1024

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
  const { requestConfirm } = useConfirmMessage()
  const [users, setUsers] = useState<UserRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [editingUser, setEditingUser] = useState<UserRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>('customerNo')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      let va: string, vb: string
      if (sortField === 'customerNo') {
        va = String(a.customerNo ?? 0).padStart(10, '0')
        vb = String(b.customerNo ?? 0).padStart(10, '0')
      } else if (sortField === 'lastLoginAt') {
        va = a.lastLoginAt ?? ''
        vb = b.lastLoginAt ?? ''
      } else {
        va = String(a[sortField] ?? '')
        vb = String(b[sortField] ?? '')
      }
      return sortDir === 'asc' ? va.localeCompare(vb, 'ko') : vb.localeCompare(va, 'ko')
    })
  }, [users, sortField, sortDir])

  function toggleSort(field: SortField) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const usersRes = await fetch('/api/users', { cache: 'no-store', credentials: 'include' })

    if (usersRes.ok) {
      setUsers((await usersRes.json()).users)
    } else {
      setError((await usersRes.json().catch(() => ({}))).error ?? '조회 실패')
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
    const target = users.find(user => user.id === id)
    const confirmed = await requestConfirm({
      title: '사용자를 삭제할까요?',
      description: `${target?.displayName ?? target?.username ?? '선택한 사용자'}의 계정 정보가 삭제되며 되돌릴 수 없습니다.`,
      confirmLabel: '사용자 삭제',
      variant: 'danger',
    })
    if (!confirmed) return

    const r = await fetch(`/api/users/${id}`, { method: 'DELETE', credentials: 'include' })
    if (r.ok) {
      invalidateTesterProfileCache()
      void load()
    } else {
      setError((await r.json().catch(() => ({}))).error ?? '삭제 실패')
    }
  }

  const handleSaved = async (savedUser: UserRow) => {
    setEditingUser(null)
    invalidateTesterProfileCache()
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
        <Table className="w-full min-w-[640px] text-sm">
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="cursor-pointer select-none px-3 text-left text-muted-foreground" onClick={() => toggleSort('customerNo')}>고객번호<SortIcon field="customerNo" sortField={sortField} sortDir={sortDir} /></TableHead>
              <TableHead className="cursor-pointer select-none px-3 text-left text-muted-foreground" onClick={() => toggleSort('displayName')}>사용자<SortIcon field="displayName" sortField={sortField} sortDir={sortDir} /></TableHead>
              <TableHead className="cursor-pointer select-none px-3 text-left text-muted-foreground" onClick={() => toggleSort('username')}>사번(아이디)<SortIcon field="username" sortField={sortField} sortDir={sortDir} /></TableHead>
              <TableHead className="cursor-pointer select-none px-3 text-left text-muted-foreground" onClick={() => toggleSort('role')}>역할<SortIcon field="role" sortField={sortField} sortDir={sortDir} /></TableHead>
              <TableHead className="px-3 text-left text-muted-foreground">상태</TableHead>
              <TableHead className="cursor-pointer select-none px-3 text-left text-muted-foreground" onClick={() => toggleSort('lastLoginAt')}>마지막 로그인<SortIcon field="lastLoginAt" sortField={sortField} sortDir={sortDir} /></TableHead>
              <TableHead className="px-3 text-muted-foreground"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-14" /></TableCell>
                    <TableCell className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <Skeleton className="size-8 rounded-xl" />
                        <Skeleton className="h-4 w-24" />
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-5 w-14 rounded-full" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-5 w-12 rounded-full" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-32" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  </TableRow>
                ))
              : sortedUsers.map(u => (
              <TableRow key={u.id} className="border-t border-slate-100">
                <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground tabular-nums">
                  {fmtCustomerNo(u.customerNo)}
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <UserAvatar user={u} />
                    <span className="font-medium text-foreground">{u.displayName ?? '-'}</span>
                  </div>
                </TableCell>
                <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">{u.username}</TableCell>
                <TableCell className="px-3 py-2.5">
                  <RoleBadge role={u.role} />
                </TableCell>
                <TableCell className="px-3 py-2.5">
                  <StatusBadge isActive={u.isActive} />
                </TableCell>
                <TableCell className="px-3 py-2.5 font-mono text-xs text-muted-foreground">
                  {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('ko-KR') : '-'}
                </TableCell>
                <TableCell className="px-3 py-2.5 text-right">
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="space-y-2 md:hidden">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-lg border border-slate-200 bg-white p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-14 rounded-full" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))
          : users.map(u => (
          <div key={u.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <UserAvatar user={u} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{u.displayName ?? '-'}</p>
                  <p className="truncate font-mono text-xs text-slate-500">{u.username}</p>
                  <p className="font-mono text-[10px] text-slate-400">#{fmtCustomerNo(u.customerNo)}</p>
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
        key={editingUser?.id ?? 'none'}
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
    <TesterAvatar
      testerId={user.testerId}
      name={user.displayName ?? user.testerName ?? user.username}
      avatarUrl={user.avatarUrl}
      size="md"
      className="rounded-xl"
    />
  )
}

function RoleBadge({ role }: { role: UserRow['role'] }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
      role === 'admin' ? 'bg-violet-50 text-violet-700' : 'bg-blue-50 text-blue-700'
    }`}>
      {role === 'admin' ? '관리자' : '시험자'}
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
  const [role, setR] = useState<'admin' | 'tester'>('tester')
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
    invalidateTesterProfileCache()
    onCreated()
  }

  return (
    <form onSubmit={submit} className="mb-4 grid grid-cols-1 gap-2 rounded-lg border border-blue-200 bg-blue-50/40 p-3 text-xs sm:grid-cols-2 md:grid-cols-5">
      <input className="rounded border border-slate-200 bg-white px-2 py-1.5" placeholder="아이디" value={username} onChange={e => setU(e.target.value)} />
      <input className="rounded border border-slate-200 bg-white px-2 py-1.5" placeholder="비밀번호" type="password" value={password} onChange={e => setP(e.target.value)} />
      <input className="rounded border border-slate-200 bg-white px-2 py-1.5" placeholder="이름" value={displayName} onChange={e => setD(e.target.value)} />
      <Select value={role} onValueChange={v => setR(v as 'admin' | 'tester')}>
        <SelectTrigger className="h-9 w-full px-3">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="tester">시험자</SelectItem>
          <SelectItem value="admin">관리자</SelectItem>
        </SelectContent>
      </Select>
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
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatarUrl ?? null)
  const [role, setRole] = useState<'admin' | 'tester'>(user?.role === 'admin' ? 'admin' : 'tester')
  const [isActive, setIsActive] = useState(user?.isActive ?? true)
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

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

    const body: Record<string, unknown> = {
      displayName,
      role,
      isActive,
    }
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
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>사용자 수정</DialogTitle>
          <DialogDescription>
            {user.username} 계정 정보를 수정합니다.
            {user.customerNo != null && (
              <span className="ml-2 font-mono text-[11px] text-muted-foreground">고객번호 {fmtCustomerNo(user.customerNo)}</span>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="grid gap-5 md:grid-cols-[140px_1fr]">
          <div className="flex flex-col items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-4">
            <TesterAvatar
              testerId={user.testerId}
              name={displayName || user.testerName || user.username}
              avatarUrl={avatarUrl}
              size="lg"
            />
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
              <Select value={role} onValueChange={v => setRole(v as 'admin' | 'tester')}>
                <SelectTrigger className="mt-1 h-9 w-full px-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="tester">시험자</SelectItem>
                  <SelectItem value="admin">관리자</SelectItem>
                </SelectContent>
              </Select>
              {role === 'tester' && (
                <p className="mt-1 text-[10px] text-slate-400">시험자 역할 저장 시 시험자 목록에 자동 등록됩니다.</p>
              )}
            </label>
            <label className="block text-xs font-medium text-slate-600">
              상태
              <Select value={isActive ? '1' : '0'} onValueChange={v => setIsActive(v === '1')}>
                <SelectTrigger className="mt-1 h-9 w-full px-3">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="1">활성</SelectItem>
                  <SelectItem value="0">비활성</SelectItem>
                </SelectContent>
              </Select>
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
            {err && <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>}
          </div>
        </DialogBody>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            취소
          </Button>
          <Button
            type="button"
            onClick={save}
            disabled={busy}
          >
            <Save />
            저장
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
