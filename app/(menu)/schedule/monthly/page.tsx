'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  loadPctMonthlySnapshot,
  fetchPctMonthlyFromServer,
  clearPctMonthlySnapshot,
  clearPctMonthlyOnServer,
  type PctMonthlyAssignment,
} from '@frontend/lib/pct-schedule-bridge'
import { Card } from '@frontend/components/ui/card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@frontend/components/ui/table'
import { Button } from '@frontend/components/ui/button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@frontend/components/ui/dialog'
import { Skeleton } from '@frontend/components/ui/skeleton'
import { TesterAvatar } from '@frontend/lib/tester-profiles'
import { cn } from '@frontend/lib/utils'
import {
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  LayoutGrid,
  CalendarRange,
  UserSquare,
  Gauge,
  Plus,
} from 'lucide-react'
import { useAuth } from '@frontend/lib/auth-context'
import { formatMinutes } from '@frontend/lib/workload-format'
import type { SideWorkCategory, SideWorkLog } from '@shared/side-work'
import {
  SideWorkDialog,
  type SideWorkDialogTarget,
} from '@frontend/components/schedule/side-work-dialog'
import { MobileFilterPanel } from '@frontend/components/common/mobile-filter-panel'
import MondayBoard, { type BoardGroup, type ColumnDef } from '@frontend/components/board/MondayBoard'

// ─── Types ────────────────────────────────────────────────────────────────────
interface ScheduleRow {
  id: number | string  // PCT 출처일 때는 string key
  tester_id: number | string
  batch_id: number | string
  batch_no?: string | number  // 제조번호(실제 시트 값) 표시용. PCT 출처에서 set; DB 출처는 batch_id로 폴백
  product_code?: string  // PCT 출처 표시용
  product_name: string
  test_items: string[]
  scheduled_date: string
  workdays: number
  /** @deprecated 공수 정본은 DAY(`workdays`). 시간 값은 과거 데이터에만 남아 있다. */
  avg_hours?: number
  dates?: string[]     // PCT 출처: 명시적 배정 근무일(주말 제외). 있으면 이 날짜들에 배치
  is_urgent: boolean
  is_duo: boolean
  duo_partner_id: number | string | null
  status: string
  note: string | null
  locked?: boolean   // 관리자 확정(LOCK). DB 출처에만 있다
  has_job?: boolean  // QC 작업이 시작돼 실제 착수일을 아는 행인지. DB 출처에만 있다
  source?: 'db' | 'pct'  // 데이터 출처
}

interface Tester {
  id: number | string
  name: string
  employee_no: string
}

interface MonthlyResponse {
  month: string
  monthStart: string
  monthEnd: string
  schedules: ScheduleRow[]
  testers: Tester[]
}

// ─── 공통 톤 ──────────────────────────────────────────────────────────────────
// slate 리터럴 + dark: 분기를 화면마다 다시 쓰면 앱 전체 톤과 어긋난다.
// 공통 시맨틱 토큰(foreground / muted-foreground / border / card)에 맞춘다.
const TXT_PRIMARY   = 'text-foreground'
const TXT_MUTED     = 'text-muted-foreground'
const BORDER        = 'border-border'
const CARD_BG       = 'bg-card'
// 보드 그룹 색 — 옆 그룹과 가르는 용도일 뿐 뜻이 없다. 무지개를 돌지 않고
// 브랜드 파랑의 농도만 바꾼다(주차 그룹이라 농도가 곧 순서로 읽힌다).
const BOARD_COLORS  = ['bg-blue-700', 'bg-blue-600', 'bg-blue-500', 'bg-blue-400', 'bg-blue-300', 'bg-blue-200']

// ─── Utils ────────────────────────────────────────────────────────────────────
function thisMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** KST 기준 오늘 (YYYY-MM-DD). 이 시스템의 '오늘'은 한국 근무일 기준이다 */
function todayISO(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function shiftMonth(monthYM: string, delta: number): string {
  const [y, m] = monthYM.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

function getDaysInMonth(monthYM: string): string[] {
  const [y, m] = monthYM.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return Array.from({ length: last }, (_, i) => `${monthYM}-${String(i + 1).padStart(2, '0')}`)
}

function dayOfWeek(dateStr: string): number {
  return new Date(dateStr + 'T00:00:00Z').getUTCDay()
}

const DOW_KOR = ['일', '월', '화', '수', '목', '금', '토']

// 셀 색상 — 여기 색은 장식이 아니라 뜻이다(출처·긴급·듀오). PCT 출처는 점선 테두리 + 앰버 톤.
// 긴급은 출처와 무관하게 빨강 하나로 둔다 — PCT 여부는 점선 테두리가 이미 말하고 있어
// rose(다른 빨강)를 하나 더 두면 같은 뜻에 색이 둘이 된다.
// 아무 표시도 없는 '예정'은 이 화면의 기본값이라 색을 빼고 중립 톤으로 물러앉힌다.
function cellStyle(row: ScheduleRow): { bg: string; border: string; label: string } {
  if (row.source === 'pct') {
    if (row.is_urgent) return {
      bg: 'bg-red-200 dark:bg-red-900/60 hover:bg-red-300',
      border: 'border-red-400 dark:border-red-700 border-dashed',
      label: 'PCT·긴급',
    }
    return {
      bg: 'bg-amber-200 dark:bg-amber-900/60 hover:bg-amber-300',
      border: 'border-amber-400 dark:border-amber-700 border-dashed',
      label: 'PCT',
    }
  }
  if (row.is_urgent) return {
    bg: 'bg-red-200 dark:bg-red-900/60 hover:bg-red-300',
    border: 'border-red-300 dark:border-red-800',
    label: '긴급',
  }
  if (row.is_duo) return {
    bg: 'bg-blue-200 dark:bg-blue-900/60 hover:bg-blue-300',
    border: 'border-blue-300 dark:border-blue-800',
    label: '듀오',
  }
  return {
    bg: 'bg-card hover:bg-muted',
    border: 'border-border',
    label: '예정',
  }
}

// 상세 다이얼로그의 구분 칩은 셀과 같은 색을 쓰되 hover 변주는 뺀다 — 누를 수 없는 표시라서.
function staticBg(bg: string): string {
  return bg.split(' ').filter(c => !c.startsWith('hover:')).join(' ')
}

// 공수 표기 — 정본은 DAY(`workdays`). avg_hours(시간)는 레거시라 값이 있을 때만 괄호로 덧붙인다.
function workloadText(r: ScheduleRow): string {
  return r.avg_hours != null && r.avg_hours > 0
    ? `${r.avg_hours.toFixed(1)}h (${r.workdays}일)`
    : `${r.workdays}일`
}

/** 탭한 셀 하나 — 시험자·날짜와 그 자리에 놓인 배정 한 건. */
interface CellDetail { row: ScheduleRow; testerName: string; date: string }

// ─── Component ────────────────────────────────────────────────────────────────
export default function MonthlySchedulePage() {
  const [month, setMonth] = useState<string>(thisMonth())
  const [data, setData]   = useState<MonthlyResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 뷰 전환: 월간 그리드 / 주간 보드 / 개인별 보드
  const [view, setView] = useState<'monthly' | 'weekly' | 'personal'>('monthly')
  // 셀 상세 — 시험항목·공수·비고가 title 툴팁에만 있어서 터치에서는 닿을 수 없었다.
  // 셀을 누르면 여기에 담기고 아래 다이얼로그가 그 값을 화면에 내놓는다.
  const [cellDetail, setCellDetail] = useState<CellDetail | null>(null)

  // ── 부업무(시험 외 업무) ───────────────────────────────────────────────────
  // 이 화면의 빈 칸은 지금까지 '노는 날'로 읽혔다. 실제로는 문서·교육·장비점검이
  // 그 자리를 채우고 있었고 어디에도 기록되지 않았다. 자기 칸을 눌러 남긴다.
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const myTesterId = user?.testerId ?? null
  const [sideLogs, setSideLogs] = useState<SideWorkLog[]>([])
  const [sideCategories, setSideCategories] = useState<SideWorkCategory[]>([])
  // 0041 마이그레이션 전에는 조회가 실패한다. 그렇다고 스케줄 화면을 통째로 막지 않는다 —
  // 한 줄 안내만 띄우고 나머지는 그대로 보여준다.
  const [sideError, setSideError] = useState<string | null>(null)
  const [sideTarget, setSideTarget] = useState<SideWorkDialogTarget | null>(null)

  // PCT 스냅샷 (localStorage에서 로드)
  const [pctSnapshot, setPctSnapshot] = useState<PctMonthlyAssignment[]>([])
  const [pctGeneratedAt, setPctGeneratedAt] = useState<string | null>(null)

  useEffect(() => {
    // 서버(DB) 영속본을 우선 조회하고, 없으면 localStorage 폴백.
    // (AI 스케줄 결과가 기기/브라우저 무관하게 월간에 반영됨)
    let aborted = false
    void (async () => {
      const snap = (await fetchPctMonthlyFromServer()) ?? loadPctMonthlySnapshot()
      if (aborted) return
      setPctSnapshot(snap?.assignments ?? [])
      setPctGeneratedAt(snap?.generatedAt ?? null)
    })()
    return () => { aborted = true }
  }, [month])

  useEffect(() => {
    let aborted = false
    /* eslint-disable react-hooks/set-state-in-effect -- 데이터 페치 시작: 로딩/에러 상태 초기화 */
    setLoading(true)
    setError(null)
    /* eslint-enable react-hooks/set-state-in-effect */
    fetch(`/api/schedules/monthly?month=${month}`, { credentials: 'include' })
      .then(async res => {
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? '월간 스케줄 조회 실패')
        if (!aborted) setData(json)
      })
      .catch(e => !aborted && setError(e instanceof Error ? e.message : '알 수 없는 오류'))
      .finally(() => !aborted && setLoading(false))
    return () => { aborted = true }
  }, [month])

  // PCT 항목을 ScheduleRow 형태로 변환 (해당 월만)
  const pctSchedules: ScheduleRow[] = useMemo(() => {
    const inMonth = (a: PctMonthlyAssignment) =>
      a.dates && a.dates.length ? a.dates.some(d => d.startsWith(month)) : a.scheduledDate.startsWith(month)
    return pctSnapshot
      .filter(inMonth)
      .map(a => ({
        id:             `pct-${a.key}`,
        tester_id:      `pct-${a.testerName}`,
        batch_id:       `pct-${a.productCode}-${a.batchNo}`,
        batch_no:       a.batchNo,
        product_code:   a.productCode,
        // 개별항목 분산 배정은 [개별] 품목명 - 시험항목명 으로 구분 표기
        product_name:   a.assignmentType === 'INDIVIDUAL_ITEM' && a.testItemName
                          ? `[개별] ${a.productName} - ${a.testItemName}`
                          : a.productName,
        test_items:     a.testItems,
        scheduled_date: a.scheduledDate,
        dates:          a.dates,
        workdays:       a.workdays,
        avg_hours:      a.avgHours,
        is_urgent:      a.isUrgent,
        is_duo:         !!a.isDuo,
        duo_partner_id: a.duoPartner ?? null,
        status:         'pct',
        note:           [
          `[PCT] ${a.batchNo}`,
          a.method ? `방법: ${a.method}` : '',
          `시험항목: ${a.testItems.join(', ')}`,
          a.isDuo && a.duoPartner ? `듀오: ${a.testerName}+${a.duoPartner}` : '',
          a.stabilityLinks?.length
            ? `🧪 안정성 동시: ${a.stabilityLinks.map(s => `${s.productName || s.productCode}${s.testType ? `(${s.testType})` : ''}`).join(', ')}`
            : '',
          a.note || '',
        ].filter(Boolean).join('\n'),
        source:         'pct',
      }))
  }, [pctSnapshot, month])

  // PCT에서 등장한 시험자 이름을 DB testers와 매칭. DB에 같은 이름 있으면 그 id 사용,
  // 없으면 가상 id ('pct-{name}')로 신규 행 추가.
  const mergedTesters: Tester[] = useMemo(() => {
    const dbTesters = data?.testers ?? []
    const dbByName = new Map(dbTesters.map(t => [t.name, t]))
    const out: Tester[] = [...dbTesters]
    const pctNames = new Set(pctSnapshot.map(a => a.testerName))
    for (const name of pctNames) {
      if (!dbByName.has(name)) {
        out.push({ id: `pct-${name}`, name, employee_no: '—' })
      }
    }
    return out
  }, [data, pctSnapshot])

  // PCT 항목의 tester_id를 DB 매칭으로 보정 (이름이 같으면 DB의 numeric id 사용)
  const pctSchedulesMerged: ScheduleRow[] = useMemo(() => {
    const dbByName = new Map((data?.testers ?? []).map(t => [t.name, t.id]))
    return pctSchedules.map(s => {
      const name = String(s.tester_id).replace(/^pct-/, '')
      const dbId = dbByName.get(name)
      return dbId != null ? { ...s, tester_id: dbId } : s
    })
  }, [pctSchedules, data])

  const days = useMemo(() => getDaysInMonth(month), [month])

  // ── 부업무 조회 ────────────────────────────────────────────────────────────
  const loadSideWork = useCallback(async () => {
    if (days.length === 0) return
    try {
      const res = await fetch(
        `/api/side-work?from=${days[0]}&to=${days[days.length - 1]}`,
        { credentials: 'include' },
      )
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? '부업무 조회 실패')
      setSideLogs(json.rows as SideWorkLog[])
      setSideError(null)
    } catch (e) {
      setSideLogs([])
      setSideError(e instanceof Error ? e.message : '부업무를 불러오지 못했습니다.')
    }
  }, [days])

  useEffect(() => { void loadSideWork() }, [loadSideWork])

  // 분류는 달을 바꿔도 변하지 않는다 — 한 번만 읽는다.
  useEffect(() => {
    let aborted = false
    void (async () => {
      try {
        const res = await fetch('/api/side-work/categories', { credentials: 'include' })
        const json = await res.json()
        if (!res.ok || aborted) return
        setSideCategories(json.rows as SideWorkCategory[])
      } catch { /* 분류가 없으면 기록 폼이 스스로 막는다 */ }
    })()
    return () => { aborted = true }
  }, [])

  /** `${testerId}::${YYYY-MM-DD}` → 그 칸의 부업무 기록 */
  const sideByCell = useMemo(() => {
    const m = new Map<string, SideWorkLog[]>()
    for (const log of sideLogs) {
      const k = `${log.testerId}::${log.workDate}`
      const list = m.get(k) ?? []
      list.push(log)
      m.set(k, list)
    }
    return m
  }, [sideLogs])

  /** DB 에 실재하는 시험자 id — PCT 스냅샷에만 있는 가상 행(`pct-이름`)과 가른다 */
  const dbTesterIds = useMemo(
    () => new Set((data?.testers ?? []).map(t => String(t.id))),
    [data],
  )

  /**
   * 이 칸을 고칠 수 있는가 — 본인 칸이거나 관리자. 서버도 같은 규칙으로 막는다.
   * PCT 스냅샷에만 있는 가상 행은 붙일 시험자 레코드가 없어 관리자도 기록하지 못한다
   * (넣어 봐야 FK 위반으로 튕긴다 — 버튼을 먼저 감추는 쪽이 정직하다).
   */
  const canEditCell = useCallback(
    (testerId: number | string) => {
      const id = String(testerId)
      if (!dbTesterIds.has(id)) return false
      return isAdmin || (myTesterId != null && id === myTesterId)
    },
    [dbTesterIds, isAdmin, myTesterId],
  )

  // DB + PCT 합친 전체 스케줄.
  // DB(pct_orders 정본)와 PCT 스냅샷은 같은 배정을 각자 담을 수 있다 — 스냅샷은 AI 스케줄
  // 화면에서 [스케줄 생성]을 누른 시점의 사본이기 때문이다. 같은 품목·제조번호·담당자면
  // 한 배정이므로 정본 쪽만 남긴다. 안 그러면 같은 일이 셀에 두 번 쌓인다.
  const allSchedules: ScheduleRow[] = useMemo(() => {
    const dbRows: ScheduleRow[] = (data?.schedules ?? []).map(r => ({ ...r, source: 'db' as const }))
    const dbKeys = new Set(dbRows.map(r => `${r.product_code ?? ''}::${r.batch_no ?? ''}::${r.tester_id}`))
    const pctOnly = pctSchedulesMerged.filter(
      r => !dbKeys.has(`${r.product_code ?? ''}::${r.batch_no ?? ''}::${r.tester_id}`),
    )
    return [...dbRows, ...pctOnly]
  }, [data, pctSchedulesMerged])

  // 시험자별 + 날짜별 셀에 들어갈 row들 인덱스
  // key = `${tester_id}::${YYYY-MM-DD}`
  const cellMap = useMemo(() => {
    const m = new Map<string, ScheduleRow[]>()
    for (const row of allSchedules) {
      // PCT: 명시적 근무일(dates)이 있으면 그 날짜들에만 배치(주말 제외 반영)
      // DB: scheduled_date부터 workdays만큼 달력 연속 배치(기존 동작)
      let dayList: string[]
      if (row.dates && row.dates.length) {
        dayList = row.dates
      } else {
        const start = new Date(row.scheduled_date + 'T00:00:00Z')
        const wd = Math.max(1, row.workdays || 1)
        dayList = Array.from({ length: wd }, (_, i) => {
          const d = new Date(start); d.setUTCDate(start.getUTCDate() + i)
          return d.toISOString().slice(0, 10)
        })
      }
      for (const ds of dayList) {
        if (!ds.startsWith(month)) continue
        const k = `${row.tester_id}::${ds}`
        if (!m.has(k)) m.set(k, [])
        m.get(k)!.push(row)
      }
    }
    return m
  }, [allSchedules, month])

  // 데이터가 있는 시험자만 표시 (DB + PCT 모두 포함)
  // 배정이 하나도 없어도 (1) 부업무를 남긴 사람과 (2) 로그인한 본인은 행을 낸다.
  // 본인 행이 없으면 기록할 칸 자체가 없어 "자기 칸을 눌러 남긴다"가 성립하지 않고,
  // 배정이 비는 달일수록 오히려 부업무가 많다.
  const visibleTesters = useMemo(() => {
    const usedIds = new Set<number | string>(allSchedules.map(s => s.tester_id))
    for (const log of sideLogs) usedIds.add(log.testerId)
    if (myTesterId) usedIds.add(myTesterId)
    return mergedTesters
      .filter(t => usedIds.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [allSchedules, mergedTesters, sideLogs, myTesterId])

  // 요약 통계 (DB + PCT)
  const stats = useMemo(() => {
    const pctCount = pctSchedulesMerged.length
    const mine = myTesterId ? sideLogs.filter(l => l.testerId === myTesterId) : []
    return {
      total:   allSchedules.length,
      urgent:  allSchedules.filter(s => s.is_urgent).length,
      duo:     allSchedules.filter(s => s.is_duo).length,
      testers: visibleTesters.length,
      pct:     pctCount,
      // 부업무는 건수와 시간을 함께 본다 — 건수만 보면 30분짜리와 종일짜리가 같아진다.
      sideCount:   sideLogs.length,
      sideMinutes: sideLogs.reduce((sum, l) => sum + l.minutes, 0),
      mySideCount:   mine.length,
      mySideMinutes: mine.reduce((sum, l) => sum + l.minutes, 0),
    }
  }, [allSchedules, pctSchedulesMerged, visibleTesters, sideLogs, myTesterId])

  // ─── Monday 스타일 보드 데이터 (주간 / 개인별 탭) ─────────────────────────────
  const testerNameById = useMemo(() => {
    const m = new Map<string | number, string>()
    for (const t of mergedTesters) m.set(t.id, t.name)
    return m
  }, [mergedTesters])

  const toBoardData = useMemo(() => (r: ScheduleRow): Record<string, unknown> => ({
    날짜:     r.scheduled_date,
    품목명:   r.product_name,
    코드:     r.product_code ?? '',
    제조번호: r.batch_no ?? (typeof r.batch_id === 'string' ? r.batch_id.replace(/^pct-/, '') : r.batch_id),
    담당자:   testerNameById.get(r.tester_id) ?? String(r.tester_id),
    // 공수 정본은 DAY 다(PRD 원칙4). avg_hours(시간)는 레거시라 값이 있을 때만 괄호로 덧붙인다.
    공수:     r.workdays ? `${r.workdays}일` : (r.avg_hours != null && r.avg_hours > 0 ? `${r.avg_hours.toFixed(1)}h` : '—'),
    긴급:     r.is_urgent ? '긴급' : '일반',
    출처:     r.source === 'pct' ? 'PCT' : 'QC',
    시험항목: (r.test_items ?? []).join(', '),
  }), [testerNameById])

  // 주간(포장/예정일 기준 ISO 주) 그룹
  const weeklyGroups: BoardGroup[] = useMemo(() => {
    const buckets = new Map<string, { label: string; rows: ScheduleRow[] }>()
    for (const r of allSchedules) {
      const d = new Date(r.scheduled_date + 'T00:00:00Z')
      if (isNaN(d.getTime())) continue
      const dow = (d.getUTCDay() + 6) % 7
      const monday = new Date(d); monday.setUTCDate(d.getUTCDate() - dow)
      const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6)
      const key = monday.toISOString().slice(0, 10)
      const fmt = (x: Date) => `${x.getUTCMonth() + 1}/${x.getUTCDate()}`
      if (!buckets.has(key)) buckets.set(key, { label: `${fmt(monday)} ~ ${fmt(sunday)}`, rows: [] })
      buckets.get(key)!.rows.push(r)
    }
    return Array.from(buckets.keys()).sort().map((k, i) => ({
      id:    k,
      label: buckets.get(k)!.label,
      color: BOARD_COLORS[i % BOARD_COLORS.length],
      rows:  buckets.get(k)!.rows
        .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
        .map(r => ({ id: String(r.id), data: toBoardData(r) })),
    }))
  }, [allSchedules, toBoardData])

  // 개인별(담당 시험자) 그룹
  const personalGroups: BoardGroup[] = useMemo(() => {
    const buckets = new Map<string, ScheduleRow[]>()
    for (const r of allSchedules) {
      const name = testerNameById.get(r.tester_id) ?? String(r.tester_id)
      if (!buckets.has(name)) buckets.set(name, [])
      buckets.get(name)!.push(r)
    }
    return Array.from(buckets.keys())
      .sort((a, b) => a.localeCompare(b, 'ko'))
      .map((name, i) => ({
        id:    name,
        label: name,
        color: BOARD_COLORS[i % BOARD_COLORS.length],
        rows:  buckets.get(name)!
          .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))
          .map(r => ({ id: String(r.id), data: toBoardData(r) })),
      }))
  }, [allSchedules, testerNameById, toBoardData])

  const weeklyColumns: ColumnDef[] = [
    { key: '날짜',     label: '날짜',     kind: 'date',   width: 110 },
    { key: '품목명',   label: '품목명',   kind: 'text',   width: 200 },
    { key: '코드',     label: '코드',     kind: 'mono',   width: 80  },
    { key: '제조번호', label: '제조번호', kind: 'mono',   width: 90  },
    { key: '담당자',   label: '담당자',   kind: 'person', width: 110 },
    { key: '공수',     label: '공수(일)', kind: 'text',   width: 75  },
    { key: '긴급',     label: '긴급',     kind: 'chip',   width: 70, chipColor: { '일반': 'slate', '긴급': 'red' } },
    // PCT 칩은 월간 그리드의 PCT 셀(앰버)과 같은 색으로 맞춘다 — 같은 뜻은 같은 색
    { key: '출처',     label: '출처',     kind: 'chip',   width: 70, chipColor: { 'QC': 'blue', 'PCT': 'amber' } },
    { key: '시험항목', label: '시험항목', kind: 'text',   width: 160 },
  ]
  // 개인별 보드는 그룹 자체가 담당자이므로 담당자 컬럼 제외
  const personalColumns: ColumnDef[] = weeklyColumns.filter(c => c.key !== '담당자')

  function handleClearPct() {
    clearPctMonthlySnapshot()
    void clearPctMonthlyOnServer() // 서버(DB) 영속본도 함께 삭제
    setPctSnapshot([])
    setPctGeneratedAt(null)
  }

  return (
    /* 이 화면은 세로로 길다(시험자 × 날짜 + 범례). 바깥 레이아웃이 overflow-hidden 이라
       스크롤 컨테이너를 여기서 만들지 않으면 아래쪽 내용에 아예 닿을 수 없다. */
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto p-4 md:p-6">
      <div className="min-w-0 shrink-0 space-y-4 md:space-y-5">

        {/* ── 페이지 머리 ──────────────────────────────────────────────────
            아이콘 칩과 "…통합 표시됩니다" 부제를 걷어내고,
            지금 보고 있는 것이 언제·얼마인지라는 사실만 남긴다. */}
        <header className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h1 className={`text-lg font-semibold ${TXT_PRIMARY}`}>월간 QC 시험 스케줄</h1>
          {/* 조회에 실패하면 아래 에러 줄이 사정을 말한다 — 여기서 스켈레톤을 붙잡고 있지 않는다 */}
          {loading ? (
            <Skeleton className="h-3 w-52" />
          ) : data ? (
            <p className={`text-xs leading-normal break-keep tabular-nums ${TXT_MUTED}`}>
              {month.replace('-', '년 ')}월 기준
              <span className="px-1 text-border">·</span>
              배정 {stats.total}건
              <span className="px-1 text-border">·</span>
              시험자 {stats.testers}명
            </p>
          ) : null}
        </header>

        {/* PCT 데이터 알림 — 알림 한 줄에 카드를 또 씌우지 않는다 */}
        {pctSnapshot.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 rounded-md border border-blue-200 bg-blue-50/70 px-3 py-2.5 dark:border-blue-900 dark:bg-blue-950/30">
            <p className="min-w-0 text-xs leading-normal break-keep text-blue-900 dark:text-blue-100">
              <span className="font-semibold">PCT 생산관리 배정 표시 중</span>
              <span className="px-1 text-blue-300 dark:text-blue-800">·</span>
              <span className="tabular-nums">전체 {pctSnapshot.length}건 · 이번 달 {pctSchedulesMerged.length}건</span>
              {pctGeneratedAt && (
                <>
                  <span className="px-1 text-blue-300 dark:text-blue-800">·</span>
                  <span className="tabular-nums">생성 {new Date(pctGeneratedAt).toLocaleString('ko-KR')}</span>
                </>
              )}
            </p>
            <Button onClick={handleClearPct} variant="outline" size="sm">
              PCT 데이터 지우기
            </Button>
          </div>
        )}

        {/* 월 이동 — 조회조건 한 줄에 카드를 씌우지 않는다(테두리 겹 줄이기).
            375px 에서는 버튼 넷과 월 선택 입력이 세 줄로 접혀 131px 을 먹었다.
            모바일에서는 통째로 접고 지금 보고 있는 달만 막대에 남긴다 —
            달을 바꾸는 일은 화면에 들어와서 늘 하는 일이 아니다.
            sm(640px) 이상에서는 접기 자체가 없다. */}
        <MobileFilterPanel label="월 이동" icon={CalendarRange} summary={`${month.replace('-', '년 ')}월`}>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => setMonth(shiftMonth(month, -1))} className="gap-1.5">
            <ChevronLeft size={14} />
            이전 달
          </Button>
          {/* 320px 에서도 이전/다음 버튼과 한 줄에 들어가야 해서 모바일은 최소폭을 낮춘다 */}
          <div className={`min-w-0 flex-1 text-center text-base font-semibold tabular-nums sm:min-w-28 sm:flex-none ${TXT_PRIMARY}`}>
            {month.replace('-', '년 ')}월
          </div>
          <Button variant="outline" size="sm" onClick={() => setMonth(shiftMonth(month, 1))} className="gap-1.5">
            다음 달
            <ChevronRight size={14} />
          </Button>
          <Button variant="outline" size="sm" onClick={() => setMonth(thisMonth())}>
            이번 달
          </Button>
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            aria-label="월 선택"
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground tabular-nums shadow-xs transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none sm:ml-auto sm:w-auto [color-scheme:light] dark:[color-scheme:dark]"
          />
        </div>
        </MobileFilterPanel>

        {/* 에러 */}
        {error && (
          <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-sm break-keep text-destructive">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}

        {/* 부업무만 실패한 경우 — 스케줄 자체는 멀쩡하므로 화면을 막지 않고 한 줄로 알린다 */}
        {sideError && (
          <p className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2.5 text-xs leading-normal break-keep text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
            <AlertCircle size={14} className="mt-0.5 shrink-0" />
            {sideError}
          </p>
        )}

        {/* 로딩 — 실제로 나올 모양(시험자 한 줄 + 날짜 칸)과 같은 뼈대를 보여준다 */}
        {loading && (
          <Card className={`gap-0 overflow-hidden py-0 ${BORDER} ${CARD_BG}`}>
            <div className="flex flex-col gap-2 p-4">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Skeleton className="h-6 w-28 shrink-0" />
                  <Skeleton className="h-6 flex-1" />
                </div>
              ))}
            </div>
          </Card>
        )}

        {/* 결과 */}
        {!loading && data && (
          <>
            {/* ── 요약 ────────────────────────────────────────────────────
                파스텔 카드 네 장을 나란히 세우면 무엇이 급한지 화면이 말해 주지 못한다.
                한 장으로 합쳐 실선으로만 나누고, 강조는 숫자 크기와 잉크 색으로 한다. */}
            {/* 네 칸이 2열 2줄로 178px — 그 아래 뷰 탭까지 합쳐 정작 봐야 할 그리드를
                y=534, 첫 화면 밖으로 밀어냈다. 모바일에서는 접고 조치가 필요한
                숫자(긴급)까지만 막대에 남긴다 — 배정·시험자 수는 위 머리말 줄이 이미 말한다. */}
            <MobileFilterPanel
              label="요약"
              icon={Gauge}
              summary={`총 배정 ${stats.total}건 · 긴급 ${stats.urgent}건 · 부업무 ${stats.sideCount}건`}
            >
            <Card className="gap-0 overflow-hidden py-0">
              <dl className="grid grid-cols-2 gap-px bg-border sm:grid-cols-5">
                {[
                  { label: '총 배정',     value: `${stats.total}건`,   tone: TXT_PRIMARY },
                  { label: '활동 시험자', value: `${stats.testers}명`, tone: TXT_PRIMARY },
                  { label: '긴급',        value: `${stats.urgent}건`,  tone: stats.urgent > 0 ? 'text-destructive' : TXT_MUTED },
                  { label: '듀오',        value: `${stats.duo}건`,     tone: TXT_PRIMARY },
                  // 시험 밖에서 사라진 시간이 얼마인지 — 이 화면에서 처음으로 답할 수 있게 된 값이다
                  { label: '부업무',      value: `${stats.sideCount}건`, tone: TXT_PRIMARY,
                    sub: stats.sideMinutes > 0 ? formatMinutes(stats.sideMinutes) : null },
                ].map(s => (
                  /* 모바일은 라벨·숫자를 한 줄로 눕힌다. 격자 칸은 서로 높이를 맞추므로
                     (stretch) sm:justify-start 가 없으면 숫자가 칸 바닥에 붙는다. */
                  <div
                    key={s.label}
                    className="flex min-h-8 min-w-0 items-center justify-between gap-1 bg-card px-2 py-1 sm:min-h-0 sm:flex-col sm:items-stretch sm:justify-start sm:gap-0 sm:px-4 sm:py-3.5"
                  >
                    <dt className={`min-w-0 truncate text-xs font-medium ${TXT_MUTED}`}>{s.label}</dt>
                    <dd className={`shrink-0 text-sm font-semibold tabular-nums sm:mt-0.5 sm:text-2xl ${s.tone}`}>
                      {s.value}
                      {/* 건수 옆의 시간 — 30분짜리와 종일짜리를 건수만으로는 가를 수 없다 */}
                      {'sub' in s && s.sub && (
                        <span className={`ml-1 text-xs font-normal ${TXT_MUTED}`}>{s.sub}</span>
                      )}
                    </dd>
                  </div>
                ))}
              </dl>
            </Card>
            </MobileFilterPanel>

            {/* 뷰 전환 — 오더 화면과 같은 세그먼트 컨트롤로 맞춘다.
                탭 옆 힌트("시험자 × 날짜")는 바로 아래 표 머리에서 한 번 더 말하므로 뺀다. */}
            {/* 탭 3개(각 130px 남짓)는 320~414px 폭에서 한 줄에 못 들어간다.
                글자를 줄이는 대신 줄을 바꾼다 — 좁으면 두 줄, sm 부터 한 줄. */}
            <div className="flex w-full flex-wrap items-center gap-0.5 rounded-md bg-muted p-0.5 text-muted-foreground sm:inline-flex sm:h-9 sm:w-fit sm:flex-nowrap">
              {([
                { key: 'monthly',  label: '월간 그리드', icon: LayoutGrid },
                { key: 'weekly',   label: '주간 보드',   icon: CalendarRange },
                { key: 'personal', label: '개인별 할당', icon: UserSquare },
              ] as const).map(t => {
                const active = view === t.key
                const Icon = t.icon
                return (
                  <button
                    key={t.key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setView(t.key)}
                    className={cn(
                      'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-colors',
                      'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                      active ? 'bg-card text-foreground shadow-sm' : 'hover:text-foreground',
                    )}
                  >
                    <Icon size={15} className="shrink-0" />
                    {t.label}
                  </button>
                )
              })}
            </div>

            {/* ── 월간 그리드 뷰 ── */}
            {view === 'monthly' && (<>
            {/* 간트 그리드 — 머리말은 탭 이름을 되풀이하는 대신 이 표의 크기를 적는다 */}
            <Card className={`gap-0 overflow-hidden py-0 ${BORDER} ${CARD_BG}`}>
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b px-4 py-3">
                <h2 className={`text-sm font-semibold ${TXT_PRIMARY}`}>월간 그리드</h2>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                  <p className={`text-xs leading-normal break-keep tabular-nums ${TXT_MUTED}`}>
                    시험자 {visibleTesters.length}명 × {days.length}일
                    {myTesterId && stats.mySideCount > 0 && (
                      <>
                        <span className="px-1 text-border">·</span>
                        내 부업무 {stats.mySideCount}건 {formatMinutes(stats.mySideMinutes)}
                      </>
                    )}
                  </p>
                  {/* 칸을 눌러 기록하는 길이 기본이지만, 그 길은 처음 보는 사람에게 보이지 않는다.
                      오늘 자리로 바로 데려가는 버튼 하나를 같이 둔다. */}
                  {myTesterId && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => {
                        const me = mergedTesters.find(t => String(t.id) === myTesterId)
                        setSideTarget({
                          date: todayISO(),
                          testerId: myTesterId,
                          testerName: me?.name ?? (user?.displayName ?? '나'),
                          canEdit: true,
                        })
                      }}
                    >
                      <Plus size={14} />
                      오늘 부업무 기록
                    </Button>
                  )}
                </div>
              </div>
              <div className="min-w-0">
                {visibleTesters.length === 0 ? (
                  <p className={`px-4 py-10 text-center text-sm break-keep ${TXT_MUTED}`}>
                    이 달에 배정된 스케줄이 없습니다.
                  </p>
                ) : (
                  /* 시험자 × 날짜(최대 31칸)는 의미상 열을 줄일 수 없는 표라
                     모바일 카드 목록으로 접지 않고 터치 가로 스크롤을 쓴다.
                     스크롤은 이 컨테이너 안에서만 일어나고 페이지는 밀리지 않는다
                     (Table 이 data-slot="table-container" 로 min-w-0 w-full 스크롤 박스를 만든다). */
                  <div className="min-w-0 overflow-x-auto">
                    <Table layout="wide" className="w-full min-w-[640px] border-collapse text-xs">
                      <TableHeader>
                        {/* 한글에는 대문자가 없다 — uppercase·tracking-wide 제거 */}
                        <TableRow className="bg-muted hover:bg-muted">
                          <TableHead
                            className={`sticky left-0 z-10 border-b ${BORDER} bg-muted px-3 py-2 text-left text-xs leading-normal font-semibold ${TXT_MUTED}`}
                            style={{ minWidth: 120 }}
                          >
                            시험자
                          </TableHead>
                          {days.map(d => {
                            const dow = dayOfWeek(d)
                            const isWeekend = dow === 0 || dow === 6
                            return (
                              <TableHead
                                key={d}
                                className={`border-b border-l ${BORDER} px-1 py-2 text-center text-xs leading-normal font-semibold ${
                                  isWeekend ? 'text-red-700 dark:text-red-400' : TXT_MUTED
                                }`}
                                style={{ minWidth: 38 }}
                              >
                                <div className="tabular-nums">{Number(d.slice(-2))}</div>
                                <div className="text-xs leading-normal font-normal opacity-70">{DOW_KOR[dow]}</div>
                              </TableHead>
                            )
                          })}
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {visibleTesters.map(t => {
                          // 내 행을 먼저 찾을 수 있어야 "자기 칸을 눌러 기록한다"가 성립한다.
                          const isMe = myTesterId != null && String(t.id) === myTesterId
                          return (
                          <TableRow key={t.id} className={cn('hover:bg-muted/40', isMe && 'bg-primary/5')}>
                            <TableCell
                              className={`sticky left-0 z-10 border-b ${BORDER} ${CARD_BG} px-3 py-2 text-sm font-medium ${TXT_PRIMARY}`}
                            >
                              <div className="flex min-w-0 items-center gap-1.5">
                                <TesterAvatar testerId={String(t.id)} name={t.name} size="xs" />
                                <span className="min-w-0 truncate">{t.name}</span>
                                {isMe && (
                                  <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs leading-normal font-semibold text-primary">
                                    나
                                  </span>
                                )}
                              </div>
                            </TableCell>
                            {days.map(d => {
                              const k = `${t.id}::${d}`
                              const rows = cellMap.get(k) ?? []
                              const side = sideByCell.get(k) ?? []
                              const editable = canEditCell(t.id)
                              const openSide = () => setSideTarget({
                                date: d, testerId: String(t.id), testerName: t.name, canEdit: editable,
                              })
                              const isWeekend = (() => {
                                const dow = dayOfWeek(d)
                                return dow === 0 || dow === 6
                              })()
                              return (
                                <TableCell
                                  key={k}
                                  className={`group/cell border-b border-l ${BORDER} p-0.5 align-top ${
                                    isWeekend ? 'bg-muted/50' : ''
                                  }`}
                                  style={{ minWidth: 38 }}
                                >
                                  <div className="flex flex-col gap-0.5">
                                    {rows.map(r => {
                                      const style = cellStyle(r)
                                      return (
                                        /* 칸에는 품목명 앞 6자밖에 안 들어간다 — 나머지는 눌러서 본다.
                                           마우스는 title 툴팁 그대로, 터치·키보드는 이 버튼으로 상세에 닿는다.
                                           min-h-8: 모바일 터치 타깃(36px). sm 부터는 표 밀도를 지킨다. */
                                        <button
                                          key={`${r.id}-${d}`}
                                          type="button"
                                          onClick={() => setCellDetail({ row: r, testerName: t.name, date: d })}
                                          title={`${r.product_name} (배치 ${r.batch_no ?? r.batch_id})\n시험항목: ${r.test_items?.join(', ') ?? '-'}\n공수: ${workloadText(r)}\n${r.note ?? ''}`}
                                          aria-label={`${t.name} ${d} ${r.product_name} 배정 상세 보기`}
                                          className={`flex min-h-8 w-full min-w-0 items-center rounded-md border px-1 py-0.5 text-xs leading-normal font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:min-h-0 ${style.bg} ${style.border} ${TXT_PRIMARY}`}
                                        >
                                          <span className="min-w-0 truncate">{r.product_name.slice(0, 6)}</span>
                                        </button>
                                      )
                                    })}

                                    {/* 부업무 — 시험 배정과 색으로 갈라 둔다. 이 칸의 일이
                                        '시험'인지 아닌지가 이 화면에서 가장 먼저 읽혀야 한다. */}
                                    {side.map(log => (
                                      <button
                                        key={log.id}
                                        type="button"
                                        onClick={openSide}
                                        title={`[부업무] ${log.categoryName}\n${log.title}\n소요: ${formatMinutes(log.minutes)}${log.note ? `\n${log.note}` : ''}`}
                                        aria-label={`${t.name} ${d} 부업무 ${log.title} ${editable ? '수정' : '보기'}`}
                                        className="flex min-h-8 w-full min-w-0 items-center rounded-md border border-teal-300 bg-teal-100 px-1 py-0.5 text-xs leading-normal font-medium text-teal-900 transition-colors hover:bg-teal-200 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:min-h-0 dark:border-teal-800 dark:bg-teal-900/60 dark:text-teal-100"
                                      >
                                        <span className="min-w-0 truncate">{log.title.slice(0, 6)}</span>
                                      </button>
                                    ))}

                                    {/* 기록 버튼 — 평소에는 물러서 있다가 그 칸에 손이 오면 나온다.
                                        30칸마다 [+] 가 늘 떠 있으면 정작 봐야 할 배정을 가린다.
                                        빈 칸일 때는 칸 전체가 터치 타깃이 된다(모바일 36px). */}
                                    {editable && (
                                      <button
                                        type="button"
                                        onClick={openSide}
                                        title="부업무 기록"
                                        aria-label={`${t.name} ${d} 부업무 기록 추가`}
                                        className={cn(
                                          'flex w-full items-center justify-center rounded-md border border-dashed border-transparent text-muted-foreground transition-colors',
                                          'hover:border-border hover:bg-muted focus-visible:border-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                                          rows.length + side.length === 0
                                            ? 'min-h-8 sm:min-h-6'
                                            : 'h-4 opacity-0 group-hover/cell:opacity-100 focus-visible:opacity-100',
                                        )}
                                      >
                                        <Plus size={11} className="opacity-40" />
                                      </button>
                                    )}
                                  </div>
                                </TableCell>
                              )
                            })}
                          </TableRow>
                          )
                        })}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </div>
            </Card>

            {/* 범례 — 표 아래 한 줄이면 충분하다. 카드로 감싸면 표와 같은 무게가 되어 읽는 순서가 흐려진다 */}
            <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-xs leading-normal ${TXT_MUTED}`}>
              <span className="font-medium">범례</span>
              {[
                { swatch: 'border-border bg-card', label: '일반' },
                { swatch: 'border-red-300 bg-red-200 dark:border-red-800 dark:bg-red-900/60', label: '긴급' },
                { swatch: 'border-blue-300 bg-blue-200 dark:border-blue-800 dark:bg-blue-900/60', label: '듀오' },
                { swatch: 'border-dashed border-amber-400 bg-amber-200 dark:border-amber-700 dark:bg-amber-900/60', label: 'PCT 생산관리 출처' },
                { swatch: 'border-teal-300 bg-teal-100 dark:border-teal-800 dark:bg-teal-900/60', label: '부업무(시험 외)' },
                { swatch: 'border-transparent bg-muted', label: '주말' },
              ].map(l => (
                <span key={l.label} className="flex items-center gap-1.5">
                  <span className={`inline-block size-3 shrink-0 rounded-md border ${l.swatch}`} />
                  {l.label}
                </span>
              ))}
              {/* hover 로만 열리던 안내였다 — 터치에서도 같은 정보에 닿으므로 문장을 사실에 맞춘다 */}
              <span className="ml-auto break-keep">
                셀을 누르면 시험항목·공수·비고를 볼 수 있습니다.
                {(isAdmin || myTesterId) && ' 내 행의 빈 칸을 누르면 부업무를 기록합니다.'}
              </span>
            </div>
            </>)}

            {/* ── 주간 보드 뷰 (Monday 스타일, 주차별 그룹) ── */}
            {view === 'weekly' && (
              <Card className={`gap-0 overflow-hidden py-0 ${BORDER} ${CARD_BG}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
                  <h2 className={`text-sm font-semibold ${TXT_PRIMARY}`}>주간 보드</h2>
                  <p className={`text-xs leading-normal break-keep tabular-nums ${TXT_MUTED}`}>
                    포장/예정일 기준 {weeklyGroups.length}주차 · {allSchedules.length}건
                  </p>
                </div>
                {/* min-w-0: 보드가 자기 안에서 가로 스크롤하도록 두고, 페이지 폭은 밀지 않는다 */}
                <div className="min-w-0 p-3 sm:p-4">
                  <MondayBoard
                    groups={weeklyGroups}
                    columns={weeklyColumns}
                    showToggleAll
                    emptyMessage="이 달에 배정된 스케줄이 없습니다."
                  />
                </div>
              </Card>
            )}

            {/* ── 개인별 할당 뷰 (Monday 스타일, 시험자별 그룹) ── */}
            {view === 'personal' && (
              <Card className={`gap-0 overflow-hidden py-0 ${BORDER} ${CARD_BG}`}>
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
                  <h2 className={`text-sm font-semibold ${TXT_PRIMARY}`}>개인별 할당</h2>
                  <p className={`text-xs leading-normal break-keep tabular-nums ${TXT_MUTED}`}>
                    시험자 {personalGroups.length}명 · {allSchedules.length}건
                  </p>
                </div>
                {/* min-w-0: 보드가 자기 안에서 가로 스크롤하도록 두고, 페이지 폭은 밀지 않는다 */}
                <div className="min-w-0 p-3 sm:p-4">
                  <MondayBoard
                    groups={personalGroups}
                    columns={personalColumns}
                    showToggleAll
                    emptyMessage="이 달에 배정된 스케줄이 없습니다."
                  />
                </div>
              </Card>
            )}
          </>
        )}

        {/* ── 셀 상세 ────────────────────────────────────────────────────────
            그리드 칸은 품목명 6자가 한계라 나머지는 title 툴팁에만 있었다.
            터치에는 hover 가 없으므로 같은 값을 눌러서 여는 다이얼로그로 내놓는다. */}
        {cellDetail && (
          <CellDetailDialog detail={cellDetail} onClose={() => setCellDetail(null)} />
        )}

        {/* ── 부업무 기록 ────────────────────────────────────────────────────
            누른 칸의 시험자·날짜가 그대로 넘어가므로 다이얼로그는 '무엇을 했는지'만 묻는다. */}
        {sideTarget && (
          <SideWorkDialog
            target={sideTarget}
            logs={sideByCell.get(`${sideTarget.testerId}::${sideTarget.date}`) ?? []}
            categories={sideCategories}
            onClose={() => setSideTarget(null)}
            onChanged={() => void loadSideWork()}
          />
        )}
      </div>
    </div>
  )
}

// ─── 셀 상세 다이얼로그 ────────────────────────────────────────────────────────
// 칸에 못 담은 값(시험항목·공수·비고)을 그대로 보여 준다. 새 정보를 만들지 않는다.
function CellDetailDialog({ detail, onClose }: { detail: CellDetail; onClose: () => void }) {
  const { row, testerName, date } = detail
  const style = cellStyle(row)
  const items = row.test_items ?? []
  const batchNo = row.batch_no ?? (typeof row.batch_id === 'string' ? row.batch_id.replace(/^pct-/, '') : row.batch_id)

  const fields: { label: string; value: React.ReactNode }[] = [
    {
      label: '구분',
      value: (
        <span className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-xs leading-normal font-medium ${staticBg(style.bg)} ${style.border} ${TXT_PRIMARY}`}>
          {style.label}
        </span>
      ),
    },
    { label: '제조번호', value: <span className="tabular-nums">{batchNo}</span> },
    ...(row.product_code ? [{ label: '품목코드', value: <span className="tabular-nums">{row.product_code}</span> }] : []),
    { label: '시험항목', value: items.length > 0 ? items.join(', ') : '—' },
    { label: '공수', value: <span className="tabular-nums">{workloadText(row)}</span> },
    // 아래 둘은 정본(pct_orders)에서 온 행만 아는 값이다. PCT 스냅샷 행에는 없다.
    ...(row.source === 'db' ? [
      // 상태는 작업이 섰으면 작업 단계(진행중·검토전…), 아직이면 오더 상태(대기)다.
      { label: '상태', value: <>{row.status}{row.locked ? ' · 확정' : ''}</> },
      // 이 날짜가 실제인지 예측인지는 달력에서 가장 알고 싶은 것이다 — 숨기지 않는다.
      { label: '일정 근거', value: row.has_job ? '실제 착수일 기준' : '포장일·납기 기준 예정' },
    ] : []),
    // note 는 줄바꿈으로 여러 사실을 담고 있다 — 한 줄로 뭉개지 않는다
    { label: '비고', value: row.note ? <span className="whitespace-pre-line">{row.note}</span> : '—' },
  ]

  return (
    <Dialog open onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent>
        <DialogHeader>
          {/* break-keep 만으로는 띄어쓰기 없는 긴 품목명이 320px 다이얼로그를 넘는다 —
              break-words 를 함께 걸어 '못 들어갈 때만' 끊기게 한다 */}
          <DialogTitle className="min-w-0 break-words break-keep">{row.product_name}</DialogTitle>
          <DialogDescription className="text-xs leading-normal break-keep">
            <span className="tabular-nums">{date}</span> ({DOW_KOR[dayOfWeek(date)]})
            <span className="px-1 text-border">·</span>
            시험자 {testerName}
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {/* 라벨은 좁은 폭에서 값 위로 올라간다 — 320px 에서 값에 줄 폭을 다 준다 */}
          <dl className="divide-y">
            {fields.map(f => (
              <div key={f.label} className="flex flex-col gap-0.5 py-2 first:pt-0 last:pb-0 sm:flex-row sm:gap-3">
                <dt className={`text-xs leading-normal sm:w-20 sm:shrink-0 ${TXT_MUTED}`}>{f.label}</dt>
                <dd className={`min-w-0 text-sm break-keep sm:flex-1 ${TXT_PRIMARY}`}>{f.value}</dd>
              </div>
            ))}
          </dl>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
