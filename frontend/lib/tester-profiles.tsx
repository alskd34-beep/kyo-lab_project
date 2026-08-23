'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import Image from 'next/image'
import { MonitorCog } from 'lucide-react'
import { cn } from '@frontend/lib/utils'

export interface TesterProfile {
  id: string
  name: string
  employeeNo: string | null
  userId: string | null
  avatarUrl: string | null
  profileEmoji: string
}

interface TesterApiRow {
  id: string
  name: string
  employeeNo?: string | null
  employee_no?: string | null
  userId?: string | null
  username?: string | null
  avatarUrl?: string | null
}

interface UserApiRow {
  id: string
  username?: string | null
  displayName?: string | null
  testerId?: string | null
  testerName?: string | null
  avatarUrl?: string | null
}

const CACHE_KEY = 'kd_people_profile_cache_v2'
const PROFILE_EMOJIS = [
  '🧑‍🔬', '👩‍🔬', '👨‍🔬', '🧑‍⚕️', '👩‍⚕️', '👨‍⚕️',
  '🙂', '😄', '😊', '😎', '🤓', '🧐', '🙋', '🙆',
]

let profiles = new Map<string, TesterProfile>()
let byUserId = new Map<string, string>()
let byEmployeeNo = new Map<string, string>()
let byName = new Map<string, string>()
let currentSnapshot: TesterProfile[] = []
let loaded = false
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function profileEmoji(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return PROFILE_EMOJIS[h % PROFILE_EMOJIS.length]
}

function emit() {
  for (const listener of listeners) listener()
}

function snapshot(): TesterProfile[] {
  return currentSnapshot
}

function rebuildIndexes() {
  byUserId = new Map()
  byEmployeeNo = new Map()
  byName = new Map()
  for (const p of profiles.values()) {
    if (p.userId) byUserId.set(p.userId, p.id)
    if (p.employeeNo) byEmployeeNo.set(p.employeeNo, p.id)
    if (p.name) byName.set(p.name.trim(), p.id)
  }
}

function setProfiles(next: Map<string, TesterProfile>) {
  profiles = next
  currentSnapshot = Array.from(next.values())
  rebuildIndexes()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function persistableSnapshot(): TesterProfile[] {
  return snapshot().map(row => ({
    ...row,
    avatarUrl: row.avatarUrl && row.avatarUrl.startsWith('data:') ? null : row.avatarUrl,
  }))
}

function readPersistedCache() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return
    const rows = JSON.parse(raw) as TesterProfile[]
    setProfiles(new Map(rows.map(row => [row.id, {
      ...row,
      userId: row.userId ?? null,
      profileEmoji: row.profileEmoji || profileEmoji(row.id || row.name),
    }])))
  } catch {
    setProfiles(new Map())
  }
}

function writePersistedCache() {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(persistableSnapshot()))
  } catch {
    try {
      window.localStorage.removeItem(CACHE_KEY)
    } catch {
      /* ignore */
    }
  }
}

function upsertMany(rows: TesterProfile[]) {
  const next = new Map(profiles)
  for (const row of rows) {
    const prev = next.get(row.id)
    next.set(row.id, {
      id: row.id,
      name: row.name || prev?.name || '',
      employeeNo: row.employeeNo ?? prev?.employeeNo ?? null,
      userId: row.userId ?? prev?.userId ?? null,
      avatarUrl: row.avatarUrl !== undefined ? row.avatarUrl : (prev?.avatarUrl ?? null),
      profileEmoji: prev?.profileEmoji ?? row.profileEmoji,
    })
  }
  setProfiles(next)
  writePersistedCache()
  emit()
}

function fromTesterRow(row: TesterApiRow): TesterProfile {
  const employeeNo = row.employeeNo ?? row.employee_no ?? row.username ?? null
  const seed = row.id || employeeNo || row.name
  return {
    id: row.id,
    name: row.name,
    employeeNo,
    userId: row.userId ?? null,
    avatarUrl: row.avatarUrl ?? null,
    profileEmoji: profileEmoji(seed),
  }
}

export function primeTesterProfileCache(rows: TesterApiRow[]) {
  loaded = true
  upsertMany(rows.map(fromTesterRow))
}

export function primePeopleCacheFromUsers(rows: UserApiRow[]) {
  loaded = true
  upsertMany(rows.map(row => {
    const id = row.testerId || `user:${row.id}`
    const name = row.displayName || row.testerName || row.username || ''
    return {
      id,
      name,
      employeeNo: row.username ?? null,
      userId: row.id,
      avatarUrl: row.avatarUrl ?? null,
      profileEmoji: profileEmoji(id || name),
    }
  }))
}

export function upsertPersonProfile(row: Partial<TesterProfile> & { id: string }) {
  loaded = true
  const prev = profiles.get(row.id)
  upsertMany([{
    id: row.id,
    name: row.name ?? prev?.name ?? '',
    employeeNo: row.employeeNo ?? prev?.employeeNo ?? null,
    userId: row.userId ?? prev?.userId ?? null,
    avatarUrl: row.avatarUrl !== undefined ? row.avatarUrl : (prev?.avatarUrl ?? null),
    profileEmoji: prev?.profileEmoji ?? profileEmoji(row.id),
  }])
}

export async function refreshTesterProfileCache(): Promise<void> {
  readPersistedCache()
  if (inflight) return inflight

  inflight = fetch('/api/testers', { credentials: 'include' })
    .then(async res => {
      if (!res.ok) throw new Error('시험자 프로필 조회 실패')
      const data = await res.json() as { rows?: TesterApiRow[] }
      primeTesterProfileCache(data.rows ?? [])
    })
    .finally(() => {
      inflight = null
    })

  return inflight
}

export function invalidateTesterProfileCache() {
  loaded = false
  inflight = null
  setProfiles(new Map())
  if (typeof window !== 'undefined') {
    try { window.localStorage.removeItem(CACHE_KEY) } catch { /* ignore */ }
  }
  emit()
}

function lookupId(id?: string | null, name?: string | null): string | null {
  if (id) {
    if (profiles.has(id)) return id
    const fromUser = byUserId.get(id)
    if (fromUser) return fromUser
    const fromEmp = byEmployeeNo.get(id)
    if (fromEmp) return fromEmp
  }
  if (name) {
    const trimmed = name.trim()
    const fromName = byName.get(trimmed)
    if (fromName) return fromName
    const fromEmp = byEmployeeNo.get(trimmed)
    if (fromEmp) return fromEmp
  }
  return null
}

export function useTesterProfiles() {
  const rows = useSyncExternalStore(subscribe, snapshot, snapshot)

  useEffect(() => {
    readPersistedCache()
    emit()
    void refreshTesterProfileCache().catch(() => undefined)
  }, [])

  const getProfile = useCallback((id?: string | null, name?: string | null): TesterProfile | null => {
    const key = lookupId(id, name)
    return key ? profiles.get(key) ?? null : null
  }, [])

  return { profiles: rows, getProfile, refresh: refreshTesterProfileCache, invalidate: invalidateTesterProfileCache }
}

export function TesterAvatar({
  testerId,
  name,
  avatarUrl,
  size = 'sm',
  className,
}: {
  testerId?: string | null
  name?: string | null
  avatarUrl?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}) {
  const { getProfile } = useTesterProfiles()
  const profile = getProfile(testerId, name)
  const resolvedUrl = avatarUrl ?? profile?.avatarUrl ?? null
  const label = name ?? profile?.name ?? '?'
  const emoji = profile?.profileEmoji ?? profileEmoji(testerId ?? label)
  const sizeClass = {
    xs: 'size-5 rounded-md text-[12px]',
    sm: 'size-7 rounded-md text-[16px]',
    md: 'size-8 rounded-md text-[18px]',
    lg: 'size-24 rounded-md text-5xl',
  }[size]
  const sizePx = { xs: 20, sm: 28, md: 32, lg: 96 }[size]

  if (resolvedUrl) {
    return (
      <span className={cn('inline-block shrink-0 overflow-hidden ring-1 ring-border', sizeClass, className)}>
        <Image
          src={resolvedUrl}
          alt={label}
          width={sizePx}
          height={sizePx}
          unoptimized
          className="size-full object-cover"
        />
      </span>
    )
  }

  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center bg-muted ring-1 ring-border', sizeClass, className)} aria-hidden>
      {emoji}
    </span>
  )
}

/**
 * 이력의 "작업자" 칸처럼 **사람일 수도, 시스템일 수도** 있는 행위자를 표시한다.
 *
 * 예전에는 이름만 TesterAvatar 에 넘겼다. 그러면 시험자 명부에 없는 이름
 * ('시스템', 관리자 계정 등)은 이름 해시로 뽑은 얼굴 이모지를 받아,
 * 자동 적재까지 사람이 한 것처럼 보였다.
 *
 * - 시스템(행위자 id 없음)  → 사람 얼굴이 아니라 컴퓨터 아이콘
 * - 사람(행위자 id 있음)    → 그 계정의 프로필 사진(없으면 기존 이모지)
 *   id 는 users.id 라 byUserId 색인으로 찾는다. 호출하는 화면이
 *   primePeopleCacheFromUsers 로 사용자 명부를 먼저 채워야 사진이 뜬다.
 */
export function ActorAvatar({
  actorId,
  name,
  size = 'xs',
  className,
}: {
  actorId?: string | null
  name?: string | null
  size?: 'xs' | 'sm' | 'md' | 'lg'
  className?: string
}) {
  if (!actorId) {
    const boxClass = {
      xs: 'size-5 rounded-md',
      sm: 'size-7 rounded-md',
      md: 'size-8 rounded-md',
      lg: 'size-24 rounded-md',
    }[size]
    const iconClass = { xs: 'size-3', sm: 'size-4', md: 'size-4', lg: 'size-12' }[size]
    return (
      <span
        className={cn(
          'inline-flex shrink-0 items-center justify-center bg-muted text-muted-foreground ring-1 ring-border',
          boxClass,
          className,
        )}
        title={name ?? '시스템'}
      >
        <MonitorCog className={iconClass} />
      </span>
    )
  }
  return <TesterAvatar testerId={actorId} name={name} size={size} className={className} />
}

export function TesterOptionLabel({ testerId, name }: { testerId: string; name: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <TesterAvatar testerId={testerId} name={name} size="xs" />
      <span className="truncate">{name}</span>
    </span>
  )
}
