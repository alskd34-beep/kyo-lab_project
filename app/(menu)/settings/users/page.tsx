'use client'

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import { ImagePlus, Save, Trash2, Upload, UserPlus } from 'lucide-react'
import { Skeleton } from '@frontend/components/ui/skeleton'
import { Tag } from '@frontend/components/ui/tag'
import { useAuth } from '@frontend/lib/auth-context'
import { TesterAvatar, invalidateTesterProfileCache, primePeopleCacheFromUsers, upsertPersonProfile } from '@frontend/lib/tester-profiles'
import { useConfirmMessage } from '@frontend/components/common/confirm-message'
import { ManagementDrawer } from '@frontend/components/common/management-drawer'
import { Button } from '@frontend/components/ui/button'
import { Card } from '@frontend/components/ui/card'
import { CellStack } from '@frontend/components/ui/table-cell-stack'
import { SortColumnHeader, sortCol, type SortColumnDef, type SortDir } from '@frontend/components/ui/table-sort'
import { StatusFilterTabs, type StatusFilterValue } from '@frontend/components/ui/status-filter-tabs'
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

const USER_SORT_COLUMNS: SortColumnDef<SortField>[] = [
  {
    key: 'user',
    label: '사용자',
    fields: [
      { id: 'displayName', label: '사용자명' },
      { id: 'username', label: '사번' },
    ],
  },
  sortCol('role', '역할'),
  sortCol('lastLoginAt', '마지막 로그인'),
]

/** 내부 고객번호 표기 — 5자리 zero-pad (미부여 시 '-') */
function fmtCustomerNo(n: number | null): string {
  return n == null ? '-' : String(n).padStart(5, '0')
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
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [statusFilter, setStatusFilter] = useState<StatusFilterValue>('all')

  const sortedUsers = useMemo(() => {
    return [...users].sort((a, b) => {
      // 활성 사용자를 항상 위로. 어떤 컬럼으로 정렬하든 비활성은 아래로 밀린다.
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1

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

  const filteredUsers = useMemo(() => {
    if (statusFilter === 'all') return sortedUsers
    return sortedUsers.filter(u => u.isActive === (statusFilter === 'active'))
  }, [sortedUsers, statusFilter])

  const userStatusCounts = useMemo(() => {
    const active = users.filter(u => u.isActive).length
    return { all: users.length, active, inactive: users.length - active }
  }, [users])

  const pickSort = useCallback((field: SortField, dir: SortDir) => {
    setSortField(field)
    setSortDir(dir)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)

    const usersRes = await fetch('/api/users', { cache: 'no-store', credentials: 'include' })

    if (usersRes.ok) {
      const next = (await usersRes.json()).users as UserRow[]
      setUsers(next)
      primePeopleCacheFromUsers(next)
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
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
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
      setUsers(prev => prev.filter(user => user.id !== id))
      setEditingUser(current => current?.id === id ? null : current)
    } else {
      setError((await r.json().catch(() => ({}))).error ?? '삭제 실패')
    }
  }

  const handleSaved = async (savedUser: UserRow) => {
    setEditingUser(null)
    upsertPersonProfile({
      id: savedUser.testerId || `user:${savedUser.id}`,
      name: savedUser.displayName ?? savedUser.testerName ?? savedUser.username,
      employeeNo: savedUser.username,
      userId: savedUser.id,
      avatarUrl: savedUser.avatarUrl,
    })
    await load()
    if (savedUser.id === me?.id) await refresh()
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-3 overflow-hidden p-4 md:p-6">
      <div className="flex shrink-0 flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-slate-800">사용자 관리</h1>
          <p className="text-xs text-slate-500">총 {users.length}명</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusFilterTabs
            value={statusFilter}
            onChange={setStatusFilter}
            counts={userStatusCounts}
          />
          <button
            onClick={() => setCreating(true)}
            className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 md:flex-none"
          >
            <UserPlus size={13} />
            사용자 추가
          </button>
        </div>
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

      <Card className="hidden min-h-0 flex-1 flex-col overflow-hidden py-0 md:flex">
        {/* 마지막 칸이 관리 액션이 아닌 로그인 데이터이므로 액션 열 고정을 끈다. */}
        <Table className="w-full text-sm" pinLastColumn={false}>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="px-3 py-2">
                <SortColumnHeader
                  col={USER_SORT_COLUMNS[0]}
                  sortField={sortField}
                  sortDir={sortDir}
                  onPick={pickSort}
                />
              </TableHead>
              <TableHead className="px-3 py-2">
                <SortColumnHeader
                  col={USER_SORT_COLUMNS[1]}
                  sortField={sortField}
                  sortDir={sortDir}
                  onPick={pickSort}
                />
              </TableHead>
              <TableHead className="px-3 text-muted-foreground">상태</TableHead>
              <TableHead className="px-3 py-2">
                <SortColumnHeader
                  col={USER_SORT_COLUMNS[2]}
                  sortField={sortField}
                  sortDir={sortDir}
                  onPick={pickSort}
                />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i}>
                    <TableCell className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <Skeleton className="size-8 shrink-0 rounded-md" />
                        <Skeleton className="h-8 w-28" />
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2"><Skeleton className="h-5 w-14 rounded-md" /></TableCell>
                    <TableCell className="px-3 py-2"><Skeleton className="h-5 w-12 rounded-md" /></TableCell>
                    <TableCell className="px-3 py-2"><Skeleton className="h-4 w-28" /></TableCell>
                  </TableRow>
                ))
              : filteredUsers.map(u => (
              <TableRow
                key={u.id}
                className="cursor-pointer border-t border-slate-100 hover:bg-muted/40"
                onClick={() => setEditingUser(u)}
              >
                <TableCell className="px-3 py-2">
                  {/* 아바타는 CellStack 바깥이 아니라 primary 안에 둔다.
                      CellStack 루트는 @container(container-type:inline-size)라 고유 폭이 0이다.
                      flex 형제로 두면 폭이 0으로 접혀 이름이 통째로 잘린다. */}
                  <CellStack
                    primary={
                      <span className="flex min-w-0 items-center gap-2">
                        <UserAvatar user={u} />
                        <span className="truncate">{u.displayName ?? '-'}</span>
                      </span>
                    }
                    secondary={u.username}
                    primaryClass="font-medium text-foreground"
                    title={[u.displayName ?? '-', u.username].join(' / ')}
                  />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <RoleBadge role={u.role} />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <StatusBadge isActive={u.isActive} />
                </TableCell>
                <TableCell className="px-3 py-2">
                  <div className="truncate font-mono text-xs text-muted-foreground" title={u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('ko-KR') : '-'}>
                    {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('ko-KR') : '-'}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <div className="min-h-0 flex-1 space-y-2 overflow-y-auto md:hidden">
        {loading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-md border border-slate-200 bg-white p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-5 w-14 rounded-md" />
                </div>
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))
          : users.map(u => (
          <div
            key={u.id}
            className="cursor-pointer rounded-md border border-slate-200 bg-white p-3 transition-colors hover:bg-muted/30"
            onClick={() => setEditingUser(u)}
          >
            <div className="flex items-start gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <UserAvatar user={u} />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{u.displayName ?? '-'}</p>
                  <p className="truncate font-mono text-xs text-slate-500">{u.username}</p>
                  <p className="font-mono text-[10px] text-slate-400">#{fmtCustomerNo(u.customerNo)}</p>
                </div>
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
        onDelete={remove}
        canDelete={editingUser?.id !== me?.id}
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
      className="rounded-md"
    />
  )
}

function RoleBadge({ role }: { role: UserRow['role'] }) {
  return (
    <Tag color={role === 'admin' ? 'indigo' : 'slate'}>
      {role === 'admin' ? '관리자' : '시험자'}
    </Tag>
  )
}

function StatusBadge({ isActive }: { isActive: boolean }) {
  return (
    <Tag color={isActive ? 'green' : 'mono'}>
      {isActive ? '활성' : '비활성'}
    </Tag>
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
    <ManagementDrawer
      open
      onOpenChange={(open) => { if (!open && !busy) onCancel() }}
      title="사용자 추가"
      description="새 사용자 계정과 역할을 등록합니다."
      footer={(
        <>
          <Button type="button" variant="outline" onClick={onCancel} disabled={busy}>취소</Button>
          <Button type="submit" form="create-user-form" disabled={busy || !username || !password}>
            {busy ? '생성 중...' : '생성'}
          </Button>
        </>
      )}
    >
      <form id="create-user-form" onSubmit={submit} className="grid gap-4 text-sm">
        <label className="grid gap-1.5 text-xs font-medium text-foreground">
          아이디
          <input className="h-9 rounded-md border border-input bg-background px-3 text-sm" placeholder="아이디" value={username} onChange={e => setU(e.target.value)} />
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-foreground">
          비밀번호
          <input className="h-9 rounded-md border border-input bg-background px-3 text-sm" placeholder="비밀번호" type="password" value={password} onChange={e => setP(e.target.value)} />
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-foreground">
          이름
          <input className="h-9 rounded-md border border-input bg-background px-3 text-sm" placeholder="이름" value={displayName} onChange={e => setD(e.target.value)} />
        </label>
        <label className="grid gap-1.5 text-xs font-medium text-foreground">
          역할
          <Select value={role} onValueChange={v => setR(v as 'admin' | 'tester')}>
            <SelectTrigger className="h-9 w-full px-3"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="tester">시험자</SelectItem>
              <SelectItem value="admin">관리자</SelectItem>
            </SelectContent>
          </Select>
        </label>
        {err && <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{err}</p>}
      </form>
    </ManagementDrawer>
  )
}

function EditUserDialog({
  user,
  open,
  onOpenChange,
  onSaved,
  onDelete,
  canDelete,
}: {
  user: UserRow | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onSaved: (user: UserRow) => void | Promise<void>
  onDelete: (id: string) => Promise<void>
  canDelete: boolean
}) {
  const [displayName, setDisplayName] = useState(user?.displayName ?? '')
  const [avatarUrl, setAvatarUrl] = useState<string | null>(user?.avatarUrl ?? null)
  const [role, setRole] = useState<'admin' | 'tester'>(user?.role === 'admin' ? 'admin' : 'tester')
  const [isActive, setIsActive] = useState(user?.isActive ?? true)
  const [password, setPassword] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [deleting, setDeleting] = useState(false)

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

  const removeUser = async () => {
    setDeleting(true)
    try {
      await onDelete(user.id)
    } finally {
      setDeleting(false)
    }
  }

  return (
    <ManagementDrawer
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title="사용자 수정"
      description={(
        <>
          {user.username} 계정 정보를 수정합니다.
          {user.customerNo != null && (
            <span className="ml-2 font-mono text-[11px] text-muted-foreground">고객번호 {fmtCustomerNo(user.customerNo)}</span>
          )}
        </>
      )}
      footer={(
        <div className="flex w-full items-center justify-between gap-2">
          {canDelete ? (
            <Button type="button" variant="destructive" onClick={() => void removeUser()} disabled={busy || deleting}>
              <Trash2 />
              삭제
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={deleting}>취소</Button>
            <Button type="button" onClick={save} disabled={busy || deleting}>
              <Save />
              저장
            </Button>
          </div>
        </div>
      )}
    >
        <div className="grid gap-5 md:grid-cols-[120px_1fr]">
          <div className="flex flex-col items-center gap-3 rounded-md border border-slate-200 bg-slate-50 p-4">
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
        </div>
    </ManagementDrawer>
  )
}
