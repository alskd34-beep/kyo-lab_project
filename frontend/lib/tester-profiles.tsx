'use client'

import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { cn } from '@frontend/lib/utils'

export interface TesterProfile {
  id: string
  name: string
  employeeNo: string | null
  avatarUrl: string | null
  profileEmoji: string
}

interface TesterApiRow {
  id: string
  name: string
  employeeNo?: string | null
  employee_no?: string | null
  avatarUrl?: string | null
}

const CACHE_KEY = 'kd_tester_profile_cache_v1'
const PROFILE_EMOJIS = [
  '🧑‍🔬', '👩‍🔬', '👨‍🔬', '🧑‍⚕️', '👩‍⚕️', '👨‍⚕️',
  '🙂', '😄', '😊', '😎', '🤓', '🧐', '🙋', '🙆',
]

let profiles = new Map<string, TesterProfile>()
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

function setProfiles(next: Map<string, TesterProfile>) {
  profiles = next
  currentSnapshot = Array.from(next.values())
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function readPersistedCache() {
  if (loaded || typeof window === 'undefined') return
  loaded = true
  try {
    const raw = window.localStorage.getItem(CACHE_KEY)
    if (!raw) return
    const rows = JSON.parse(raw) as TesterProfile[]
    setProfiles(new Map(rows.map(row => [row.id, row])))
  } catch {
    setProfiles(new Map())
  }
}

function writePersistedCache() {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(CACHE_KEY, JSON.stringify(snapshot()))
}

function normalizeRows(rows: TesterApiRow[]): Map<string, TesterProfile> {
  return new Map(rows.map(row => {
    const employeeNo = row.employeeNo ?? row.employee_no ?? null
    const seed = row.id || employeeNo || row.name
    return [row.id, {
      id: row.id,
      name: row.name,
      employeeNo,
      avatarUrl: row.avatarUrl ?? null,
      profileEmoji: profileEmoji(seed),
    }]
  }))
}

export function primeTesterProfileCache(rows: TesterApiRow[]) {
  setProfiles(normalizeRows(rows))
  loaded = true
  writePersistedCache()
  emit()
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
  if (typeof window !== 'undefined') window.localStorage.removeItem(CACHE_KEY)
  emit()
}

export function useTesterProfiles() {
  const rows = useSyncExternalStore(subscribe, snapshot, snapshot)

  useEffect(() => {
    readPersistedCache()
    emit()
    void refreshTesterProfileCache().catch(() => undefined)
  }, [])

  const getProfile = useCallback((id?: string | null, name?: string | null): TesterProfile | null => {
    if (id && profiles.has(id)) return profiles.get(id) ?? null
    if (name) return snapshot().find(profile => profile.name === name) ?? null
    return null
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
    sm: 'size-7 rounded-lg text-[16px]',
    md: 'size-8 rounded-lg text-[18px]',
    lg: 'size-24 rounded-2xl text-5xl',
  }[size]

  if (resolvedUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={resolvedUrl} alt="" className={cn('shrink-0 object-cover ring-1 ring-border', sizeClass, className)} />
    )
  }

  return (
    <span className={cn('inline-flex shrink-0 items-center justify-center bg-muted ring-1 ring-border', sizeClass, className)} aria-hidden>
      {emoji}
    </span>
  )
}

export function TesterOptionLabel({ testerId, name }: { testerId: string; name: string }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <TesterAvatar testerId={testerId} name={name} size="xs" />
      <span className="truncate">{name}</span>
    </span>
  )
}
