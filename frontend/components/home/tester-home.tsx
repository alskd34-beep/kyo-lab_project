'use client'

/* 시험자 홈 — 개인 맞춤형 대시보드.
 * 읽는 순서를 화면 순서로 삼는다 — ①내 상태 ②오늘 손댈 작업 ③팀 휴가(날짜 조정).
 * 관리자 홈(팀 전체 지표)은 app/(menu)/home/page.tsx 의 AdminHome 이 그대로 맡는다.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, ChevronRight } from 'lucide-react'

import { useAuth } from '@frontend/lib/auth-context'
import { cn } from '@frontend/lib/utils'
import { Badge } from '@frontend/components/ui/badge'
import { Button } from '@frontend/components/ui/button'
import { Card } from '@frontend/components/ui/card'
import { Skeleton } from '@frontend/components/ui/skeleton'
import { ACTIVE_JOB_STATUSES, CLOSED_STAGE, stageStyle } from '@shared/qc-status'
import { isHardLeave, leaveTypeLabel } from '@shared/leave'
import { displayBatchNo } from '@shared/order-na'

// ─── API 응답 ─────────────────────────────────────────────────────────────────
interface JobApiRow {
  id: string
  orderId: string
  qcNo: string
  productName: string
  batchNo: string
  status: string
  isUrgent: boolean
  dueDate: string | null
}
interface PendingOrderApiRow {
  id: string
  productName: string
  batchNo: string
  dueDate: string | null
  isUrgent: boolean
}
interface WorkspaceApiResponse {
  testerLinked: boolean
  pendingOrders: PendingOrderApiRow[]
  jobs: JobApiRow[]
}
interface LeaveApiRow {
  id: string
  userId: string
  userName: string | null
  startDate: string
  endDate: string
  type: string
}

/** 내 작업 1건 — 착수분(job)과 시작 전(pending)을 같은 모양으로 합쳐 다룬다. */
interface MyTask {
  key: string
  productName: string
  batchNo: string
  /** 아직 시작하지 않은 오더는 '대기' */
  status: string
  dueDate: string | null
  dDay: number | null
  isUrgent: boolean
  started: boolean
}

// ─── 날짜 유틸 ────────────────────────────────────────────────────────────────
function isoOf(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + days)
  return isoOf(d)
}

function calcDday(dateStr: string | null): number | null {
  if (!dateStr) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const due = new Date(`${dateStr}T00:00:00`)
  return Math.round((due.getTime() - today.getTime()) / 86400000)
}

function dDayColor(dDay: number | null): string {
  if (dDay === null) return 'text-muted-foreground'
  if (dDay <= 0) return 'font-semibold text-destructive'
  if (dDay <= 3) return 'font-medium text-destructive'
  if (dDay <= 7) return 'font-medium text-amber-700 dark:text-amber-300'
  /* 여유 있는 건은 색을 빼고 중립으로 둔다. 초록으로 칠하면 화면 대부분이
     초록이 되어 정작 급한 빨강·앰버가 묻히고, 브랜드 색에서도 벗어난다. */
  return 'text-muted-foreground'
}

function dDayLabel(dDay: number | null): string {
  if (dDay === null) return '-'
  if (dDay < 0) return `D+${Math.abs(dDay)}`
  if (dDay === 0) return 'D-Day'
  return `D-${dDay}`
}

/** 팀 휴가를 내다볼 기간(오늘 포함 4주). 한 달치면 날짜를 옮길 여지가 보인다. */
const LEAVE_WINDOW_DAYS = 28
const WEEKDAY_LABEL = ['일', '월', '화', '수', '목', '금', '토']

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, credentials: 'include' })
  if (!res.ok) throw new Error(await res.text())
  return res.json() as Promise<T>
}

/** 긴급 먼저, 그 다음 기한이 임박한 순. 기한 없는 건은 맨 뒤. */
function byUrgencyThenDue(a: MyTask, b: MyTask): number {
  if (a.isUrgent !== b.isUrgent) return a.isUrgent ? -1 : 1
  return (a.dDay ?? Infinity) - (b.dDay ?? Infinity)
}

function buildMyTasks(data: WorkspaceApiResponse): MyTask[] {
  const started: MyTask[] = data.jobs
    .filter(j => j.status !== CLOSED_STAGE)
    .map(j => ({
      key: `job:${j.id}`,
      productName: j.productName,
      batchNo: displayBatchNo(j.batchNo),
      status: j.status,
      dueDate: j.dueDate,
      dDay: calcDday(j.dueDate),
      isUrgent: j.isUrgent,
      started: true,
    }))
  const waiting: MyTask[] = data.pendingOrders.map(o => ({
    key: `order:${o.id}`,
    productName: o.productName,
    batchNo: displayBatchNo(o.batchNo),
    status: '대기',
    dueDate: o.dueDate,
    dDay: calcDday(o.dueDate),
    isUrgent: o.isUrgent,
    started: false,
  }))
  return [...started.sort(byUrgencyThenDue), ...waiting.sort(byUrgencyThenDue)]
}

/** 한 사람의 휴가 구간을 날짜 집합으로 편다(양끝 포함). 창 밖 날짜는 버린다. */
function expandLeave(row: LeaveApiRow, days: readonly string[]): Set<string> {
  const out = new Set<string>()
  for (const day of days) {
    if (row.startDate <= day && day <= row.endDate) out.add(day)
  }
  return out
}

interface LeavePerson {
  userId: string
  name: string
  /** 날짜 → 휴가 종류 (같은 날 두 건이면 하드 휴가를 우선) */
  byDay: Map<string, string>
  isMe: boolean
}

export function TesterHome() {
  const { user } = useAuth()
  const myName = user?.displayName ?? user?.username ?? '나'

  const [workspace, setWorkspace] = useState<WorkspaceApiResponse | null>(null)
  const [leaves, setLeaves] = useState<LeaveApiRow[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null)

  /** 오늘부터 4주치 날짜. 렌더마다 새로 만들면 아래 계산이 전부 다시 돌아 한 번만 만든다. */
  const days = useMemo(() => {
    const today = isoOf(new Date())
    return Array.from({ length: LEAVE_WINDOW_DAYS }, (_, i) => addDays(today, i))
  }, [])

  const load = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) return
    setIsLoading(true)
    const from = days[0]
    const to = days[days.length - 1]
    try {
      const [workResult, leaveResult] = await Promise.allSettled([
        fetchJson<WorkspaceApiResponse>('/api/qc-jobs', signal),
        fetchJson<{ rows: LeaveApiRow[] }>(
          `/api/operator-schedule?from=${from}&to=${to}&scope=team`, signal,
        ),
      ])
      if (signal?.aborted) return

      setWorkspace(workResult.status === 'fulfilled' ? workResult.value : null)
      setLeaves(leaveResult.status === 'fulfilled' ? leaveResult.value.rows : [])
      setLoadError(workResult.status === 'rejected' ? '내 작업을 불러오지 못했습니다.' : null)
      if (workResult.status === 'fulfilled') {
        setRefreshedAt(new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }))
      }
    } catch {
      if (signal?.aborted) return
      setWorkspace(null)
      setLeaves([])
      setLoadError('홈 데이터를 불러오지 못했습니다.')
    } finally {
      if (!signal?.aborted) setIsLoading(false)
    }
  }, [days])

  useEffect(() => {
    const controller = new AbortController()
    const refreshOnVisible = () => {
      if (!document.hidden) void load(controller.signal)
    }
    void load(controller.signal)
    const timer = window.setInterval(() => { void load(controller.signal) }, 60_000)
    window.addEventListener('focus', refreshOnVisible)
    document.addEventListener('visibilitychange', refreshOnVisible)
    return () => {
      controller.abort()
      window.clearInterval(timer)
      window.removeEventListener('focus', refreshOnVisible)
      document.removeEventListener('visibilitychange', refreshOnVisible)
    }
  }, [load])

  const tasks = useMemo(
    () => (workspace ? buildMyTasks(workspace) : []),
    [workspace],
  )

  const summary = useMemo(() => {
    let active = 0, waiting = 0, dueSoon = 0, overdue = 0
    for (const t of tasks) {
      if (t.started && ACTIVE_JOB_STATUSES.has(t.status)) active += 1
      if (!t.started) waiting += 1
      if (t.dDay === null) continue
      if (t.dDay < 0) overdue += 1
      else if (t.dDay <= 7) dueSoon += 1
    }
    return { active, waiting, dueSoon, overdue }
  }, [tasks])

  // ── 팀 휴가 ────────────────────────────────────────────────────────────────
  const people = useMemo<LeavePerson[]>(() => {
    const map = new Map<string, LeavePerson>()
    for (const row of leaves) {
      let person = map.get(row.userId)
      if (!person) {
        person = {
          userId: row.userId,
          name: row.userName ?? '이름 없음',
          byDay: new Map(),
          isMe: row.userId === user?.id,
        }
        map.set(row.userId, person)
      }
      for (const day of expandLeave(row, days)) {
        // 같은 날 반차와 연차가 겹쳐 들어오면 하드 휴가(연차·출장)를 남긴다.
        const prev = person.byDay.get(day)
        if (!prev || (!isHardLeave(prev) && isHardLeave(row.type))) person.byDay.set(day, row.type)
      }
    }
    // 내 줄을 맨 위로 — 남과 비교하려면 기준이 먼저 보여야 한다.
    return [...map.values()]
      .filter(p => p.byDay.size > 0)
      .sort((a, b) => Number(b.isMe) - Number(a.isMe) || a.name.localeCompare(b.name, 'ko'))
  }, [leaves, days, user?.id])

  /** 날짜별로 자리를 비우는 인원 수(연차·출장만). 2명 이상이면 조정이 필요한 날이다. */
  const awayCountByDay = useMemo(() => {
    const counts = new Map<string, number>()
    for (const person of people) {
      for (const [day, type] of person.byDay) {
        if (!isHardLeave(type)) continue
        counts.set(day, (counts.get(day) ?? 0) + 1)
      }
    }
    return counts
  }, [people])

  /** 내 휴가와 같은 날 비우는 팀원 — "겹치지 않게 조절"의 실제 대상. */
  const myOverlaps = useMemo(() => {
    const me = people.find(p => p.isMe)
    if (!me) return []
    const out: Array<{ name: string; days: string[] }> = []
    for (const other of people) {
      if (other.isMe) continue
      const shared: string[] = []
      for (const [day, type] of me.byDay) {
        if (!isHardLeave(type)) continue
        const otherType = other.byDay.get(day)
        if (otherType && isHardLeave(otherType)) shared.push(day)
      }
      if (shared.length > 0) out.push({ name: other.name, days: shared.sort() })
    }
    return out
  }, [people])

  const tiles = [
    { label: '진행 중', value: summary.active, hint: '내가 착수한 작업', tone: 'text-foreground' },
    { label: '시작 전', value: summary.waiting, hint: '배정만 된 오더', tone: 'text-foreground' },
    { label: 'D-7 임박', value: summary.dueSoon, hint: '7일 안에 끝내야 함', tone: summary.dueSoon > 0 ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground' },
    { label: '기한 초과', value: summary.overdue, hint: '완료예정일이 지남', tone: summary.overdue > 0 ? 'text-destructive' : 'text-muted-foreground' },
  ]

  const notLinked = workspace !== null && !workspace.testerLinked

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:gap-5 md:p-6">
      {/* ── 페이지 머리 ─────────────────────────────────────────────────── */}
      <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h1 className="text-lg font-semibold text-foreground">{myName}님의 오늘</h1>
        {isLoading && !refreshedAt ? (
          <Skeleton className="h-3 w-44" />
        ) : (
          <p className={cn(
            'text-xs leading-normal tabular-nums',
            loadError ? 'font-medium text-destructive' : 'text-muted-foreground',
          )}>
            {loadError ?? `${refreshedAt} 기준 · 1분마다 자동 갱신`}
          </p>
        )}
      </header>

      {notLinked && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <p className="font-semibold">시험자 계정과 연결되지 않았습니다.</p>
          <p className="mt-0.5">배정된 작업을 보려면 관리자에게 시험자 연결을 요청하세요.</p>
        </div>
      )}

      {/* ── 내 작업 요약 ────────────────────────────────────────────────── */}
      <Card className="gap-0 py-0">
        <div className="grid grid-cols-2 gap-5 px-4 py-4 md:grid-cols-4 md:px-5">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-9 w-16" />
                  <Skeleton className="h-3 w-24" />
                </div>
              ))
            : tiles.map(tile => (
                <div key={tile.label} className="flex min-w-0 flex-col">
                  <span className="text-xs font-medium text-muted-foreground">{tile.label}</span>
                  <span className={cn('mt-0.5 text-4xl font-semibold tabular-nums', tile.tone)}>
                    {tile.value}
                    <span className="ml-1 text-sm font-medium text-muted-foreground">건</span>
                  </span>
                  <span className="mt-1 text-xs leading-normal text-muted-foreground">{tile.hint}</span>
                </div>
              ))}
        </div>
      </Card>

      {/* ── 내가 손댈 작업 ──────────────────────────────────────────────── */}
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">내가 손댈 작업</h2>
          <Link
            href="/my-tasks"
            className="inline-flex items-center gap-0.5 text-xs leading-normal font-medium text-primary hover:underline"
          >
            할 일 전체 보기
            <ChevronRight className="size-3.5" />
          </Link>
        </div>

        <div className="divide-y">
          {isLoading
            ? Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2 px-4 py-3">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              ))
            : tasks.length === 0
              ? (
                  <p className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {loadError ? '목록을 불러오지 못했습니다.' : '배정된 작업이 없습니다.'}
                  </p>
                )
              : tasks.slice(0, 8).map(task => {
                  const statusCfg = stageStyle(task.status)
                  return (
                    <div key={task.key} className="px-4 py-3">
                      <div className="flex min-w-0 items-start justify-between gap-3">
                        <p className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
                          {task.productName}
                          {task.isUrgent && (
                            <span className="ml-1.5 rounded-md bg-destructive/10 px-1 text-xs font-semibold text-destructive">
                              긴급
                            </span>
                          )}
                        </p>
                        <span className={cn('shrink-0 text-sm tabular-nums', dDayColor(task.dDay))}>
                          {dDayLabel(task.dDay)}
                        </span>
                      </div>
                      <div className="mt-1 flex min-w-0 items-center gap-2 text-xs leading-normal text-muted-foreground">
                        <span className="inline-flex shrink-0 items-center gap-1.5">
                          <span className={cn('size-1.5 rounded-full', statusCfg.dot)} />
                          {task.status}
                        </span>
                        <span className="min-w-0 truncate">제조번호 {task.batchNo}</span>
                        <span className="ml-auto shrink-0 tabular-nums">{task.dueDate ?? '-'}</span>
                      </div>
                    </div>
                  )
                })}
        </div>

        {!isLoading && tasks.length > 8 && (
          <p className="border-t px-4 py-2 text-xs leading-normal text-muted-foreground">
            외 {tasks.length - 8}건 — 「할 일」에서 모두 봅니다.
          </p>
        )}
      </Card>

      {/* ── 팀 휴가 스케줄 ──────────────────────────────────────────────── */}
      <TeamLeaveBoard
        days={days}
        people={people}
        awayCountByDay={awayCountByDay}
        myOverlaps={myOverlaps}
        isLoading={isLoading}
      />
    </div>
  )
}

// ─── 팀 휴가 보드 ─────────────────────────────────────────────────────────────
/**
 * 4주치 날짜를 가로로 깔고 사람마다 한 줄을 준다.
 * 같은 날 두 명 이상이 자리를 비우면 그 칸을 붉게 칠해, 날짜를 옮길 지점을 화면이 먼저 말한다.
 */
function TeamLeaveBoard({
  days, people, awayCountByDay, myOverlaps, isLoading,
}: {
  days: readonly string[]
  people: readonly LeavePerson[]
  awayCountByDay: ReadonlyMap<string, number>
  myOverlaps: ReadonlyArray<{ name: string; days: string[] }>
  isLoading: boolean
}) {
  const conflictDays = days.filter(d => (awayCountByDay.get(d) ?? 0) >= 2)

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b pb-2">
        <h2 className="text-sm font-semibold text-foreground">팀 휴가 스케줄</h2>
        <div className="flex items-center gap-3">
          <p className="text-xs leading-normal text-muted-foreground">앞으로 4주</p>
          <Button size="xs" variant="outline" asChild>
            <Link href="/schedule/vacation">
              <CalendarDays />휴가 신청·조정
            </Link>
          </Button>
        </div>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : people.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          앞으로 4주 동안 등록된 팀 휴가가 없습니다.
        </p>
      ) : (
        <>
          {conflictDays.length > 0 && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-normal text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <p className="font-semibold">
                같은 날 2명 이상이 자리를 비우는 날이 {conflictDays.length}일 있습니다.
              </p>
              <p className="mt-0.5 tabular-nums">
                {conflictDays.slice(0, 8).map(d => d.slice(5)).join(' · ')}
                {conflictDays.length > 8 && ` 외 ${conflictDays.length - 8}일`}
              </p>
              {myOverlaps.length > 0 && (
                <p className="mt-1">
                  내 휴가와 겹치는 팀원 —{' '}
                  {myOverlaps.map(o => `${o.name}(${o.days.length}일)`).join(', ')}
                </p>
              )}
            </div>
          )}

          {/* 28칸이라 좁은 화면에서는 가로로 민다 — 본문이 통째로 밀리지 않게 여기서만 스크롤한다. */}
          <div className="overflow-x-auto rounded-md border">
            <div className="min-w-[46rem]">
              {/* 날짜 머리 */}
              <div className="flex items-stretch border-b bg-muted/40">
                <div className="w-24 shrink-0 px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  팀원
                </div>
                <div className="flex flex-1">
                  {days.map(day => {
                    const dow = new Date(`${day}T00:00:00`).getDay()
                    const isWeekend = dow === 0 || dow === 6
                    const away = awayCountByDay.get(day) ?? 0
                    return (
                      <div
                        key={day}
                        className={cn(
                          'flex flex-1 flex-col items-center py-1 text-xs leading-none tabular-nums',
                          isWeekend ? 'text-muted-foreground/60' : 'text-muted-foreground',
                          away >= 2 && 'bg-destructive/10 font-semibold text-destructive',
                        )}
                        title={`${day} · 자리비움 ${away}명`}
                      >
                        <span>{WEEKDAY_LABEL[dow]}</span>
                        <span className="mt-0.5">{Number(day.slice(8))}</span>
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* 사람별 줄 */}
              <div className="divide-y">
                {people.map(person => (
                  <div key={person.userId} className="flex items-stretch">
                    <div
                      className={cn(
                        'flex w-24 shrink-0 items-center gap-1 px-3 py-1.5 text-xs leading-normal',
                        person.isMe ? 'font-semibold text-foreground' : 'text-muted-foreground',
                      )}
                    >
                      <span className="min-w-0 truncate">{person.name}</span>
                      {person.isMe && <Badge variant="outline" className="shrink-0 px-1">나</Badge>}
                    </div>
                    <div className="flex flex-1 items-center py-1.5">
                      {days.map(day => {
                        const type = person.byDay.get(day)
                        const away = awayCountByDay.get(day) ?? 0
                        const hard = type ? isHardLeave(type) : false
                        return (
                          <div key={day} className="flex flex-1 justify-center px-px">
                            <span
                              className={cn(
                                'h-4 w-full rounded-md',
                                !type && 'bg-transparent',
                                type && hard && (away >= 2 ? 'bg-destructive' : 'bg-blue-600'),
                                type && !hard && (away >= 2 ? 'bg-destructive/40' : 'bg-blue-300'),
                              )}
                              title={type ? `${person.name} · ${day} · ${leaveTypeLabel(type)}` : undefined}
                            />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-normal text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-md bg-blue-600" />연차·출장
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-md bg-blue-300" />반차
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="size-2.5 rounded-md bg-destructive" />2명 이상 겹치는 날
            </span>
            <span>겹치는 날은 날짜를 옮겨 서로 자리를 비우지 않게 합니다.</span>
          </div>
        </>
      )}
    </section>
  )
}
