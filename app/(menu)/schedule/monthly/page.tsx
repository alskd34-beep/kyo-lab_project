'use client'

import { useState, useEffect, useMemo } from 'react'
import {
  loadPctMonthlySnapshot,
  clearPctMonthlySnapshot,
  type PctMonthlyAssignment,
} from '@frontend/lib/pct-schedule-bridge'
import { Card, CardContent, CardHeader, CardTitle } from '@frontend/components/ui/card'
import { Button } from '@frontend/components/ui/button'
import {
  Calendar,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  Users,
  AlertTriangle,
  LayoutGrid,
  CalendarRange,
  UserSquare,
} from 'lucide-react'
import MondayBoard, { type BoardGroup, type ColumnDef } from '@frontend/components/board/MondayBoard'

// ─── Types ────────────────────────────────────────────────────────────────────
interface ScheduleRow {
  id: number | string  // PCT 출처일 때는 string key
  tester_id: number | string
  batch_id: number | string
  product_code?: string  // PCT 출처 표시용
  product_name: string
  test_items: string[]
  scheduled_date: string
  workdays: number
  avg_hours?: number   // PCT 출처: 평균공수(시간)
  is_urgent: boolean
  is_duo: boolean
  duo_partner_id: number | string | null
  status: string
  note: string | null
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
const TXT_PRIMARY   = 'text-slate-900 dark:text-slate-50'
const TXT_SECONDARY = 'text-slate-700 dark:text-slate-200'
const TXT_TERTIARY  = 'text-slate-600 dark:text-slate-300'
const TXT_MUTED     = 'text-slate-500 dark:text-slate-400'
const BORDER        = 'border-slate-200 dark:border-slate-700'
const CARD_BG       = 'bg-white dark:bg-slate-900'
const BOARD_COLORS  = ['bg-blue-500', 'bg-emerald-500', 'bg-violet-500', 'bg-amber-500', 'bg-rose-500', 'bg-teal-500', 'bg-fuchsia-500']

// ─── Utils ────────────────────────────────────────────────────────────────────
function thisMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
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

// 셀 색상: PCT 출처는 보라 톤, DB는 긴급/듀오/일반 톤
function cellStyle(row: ScheduleRow): { bg: string; border: string; label: string } {
  if (row.source === 'pct') {
    if (row.is_urgent) return {
      bg: 'bg-rose-200 dark:bg-rose-900/60 hover:bg-rose-300',
      border: 'border-rose-400 dark:border-rose-700 border-dashed',
      label: 'PCT·긴급',
    }
    return {
      bg: 'bg-violet-200 dark:bg-violet-900/60 hover:bg-violet-300',
      border: 'border-violet-400 dark:border-violet-700 border-dashed',
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
    bg: 'bg-emerald-100 dark:bg-emerald-900/40 hover:bg-emerald-200',
    border: 'border-emerald-300 dark:border-emerald-800',
    label: '예정',
  }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function MonthlySchedulePage() {
  const [month, setMonth] = useState<string>(thisMonth())
  const [data, setData]   = useState<MonthlyResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 뷰 전환: 월간 그리드 / 주간 보드 / 개인별 보드
  const [view, setView] = useState<'monthly' | 'weekly' | 'personal'>('monthly')

  // PCT 스냅샷 (localStorage에서 로드)
  const [pctSnapshot, setPctSnapshot] = useState<PctMonthlyAssignment[]>([])
  const [pctGeneratedAt, setPctGeneratedAt] = useState<string | null>(null)

  useEffect(() => {
    const snap = loadPctMonthlySnapshot()
    setPctSnapshot(snap?.assignments ?? [])
    setPctGeneratedAt(snap?.generatedAt ?? null)
  }, [month])

  useEffect(() => {
    let aborted = false
    setLoading(true)
    setError(null)
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
    return pctSnapshot
      .filter(a => a.scheduledDate.startsWith(month))
      .map(a => ({
        id:             `pct-${a.key}`,
        tester_id:      `pct-${a.testerName}`,
        batch_id:       `pct-${a.productCode}-${a.batchNo}`,
        product_code:   a.productCode,
        product_name:   a.productName,
        test_items:     a.testItems,
        scheduled_date: a.scheduledDate,
        workdays:       a.workdays,
        avg_hours:      a.avgHours,
        is_urgent:      a.isUrgent,
        is_duo:         false,
        duo_partner_id: null,
        status:         'pct',
        note:           `[PCT] ${a.batchNo} · ${a.testItems.join(', ')}\n${a.note || ''}`.trim(),
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

  // DB + PCT 합친 전체 스케줄
  const allSchedules: ScheduleRow[] = useMemo(() => {
    const dbRows: ScheduleRow[] = (data?.schedules ?? []).map(r => ({ ...r, source: 'db' as const }))
    return [...dbRows, ...pctSchedulesMerged]
  }, [data, pctSchedulesMerged])

  // 시험자별 + 날짜별 셀에 들어갈 row들 인덱스
  // key = `${tester_id}::${YYYY-MM-DD}`
  const cellMap = useMemo(() => {
    const m = new Map<string, ScheduleRow[]>()
    for (const row of allSchedules) {
      const start = new Date(row.scheduled_date + 'T00:00:00Z')
      const wd = Math.max(1, row.workdays || 1)
      for (let i = 0; i < wd; i++) {
        const d = new Date(start)
        d.setUTCDate(start.getUTCDate() + i)
        const ds = d.toISOString().slice(0, 10)
        if (!ds.startsWith(month)) continue
        const k = `${row.tester_id}::${ds}`
        if (!m.has(k)) m.set(k, [])
        m.get(k)!.push(row)
      }
    }
    return m
  }, [allSchedules, month])

  // 데이터가 있는 시험자만 표시 (DB + PCT 모두 포함)
  const visibleTesters = useMemo(() => {
    const usedIds = new Set(allSchedules.map(s => s.tester_id))
    return mergedTesters
      .filter(t => usedIds.has(t.id))
      .sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [allSchedules, mergedTesters])

  // 요약 통계 (DB + PCT)
  const stats = useMemo(() => {
    const pctCount = pctSchedulesMerged.length
    return {
      total:   allSchedules.length,
      urgent:  allSchedules.filter(s => s.is_urgent).length,
      duo:     allSchedules.filter(s => s.is_duo).length,
      testers: visibleTesters.length,
      pct:     pctCount,
    }
  }, [allSchedules, pctSchedulesMerged, visibleTesters])

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
    제조번호: typeof r.batch_id === 'string' ? r.batch_id.replace(/^pct-/, '') : r.batch_id,
    담당자:   testerNameById.get(r.tester_id) ?? String(r.tester_id),
    공수:     r.avg_hours != null && r.avg_hours > 0 ? r.avg_hours.toFixed(1) : (r.workdays ? `${r.workdays}일` : '—'),
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
    { key: '공수',     label: '공수(h)',  kind: 'number', width: 75  },
    { key: '긴급',     label: '긴급',     kind: 'chip',   width: 70, chipColor: { '일반': 'slate', '긴급': 'red' } },
    { key: '출처',     label: '출처',     kind: 'chip',   width: 70, chipColor: { 'QC': 'blue', 'PCT': 'violet' } },
    { key: '시험항목', label: '시험항목', kind: 'text',   width: 160 },
  ]
  // 개인별 보드는 그룹 자체가 담당자이므로 담당자 컬럼 제외
  const personalColumns: ColumnDef[] = weeklyColumns.filter(c => c.key !== '담당자')

  function handleClearPct() {
    clearPctMonthlySnapshot()
    setPctSnapshot([])
    setPctGeneratedAt(null)
  }

  return (
    <div className="p-6">
      <div className="mx-auto max-w-[1800px] space-y-5">

        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-600 shadow-md shadow-violet-600/30">
            <Calendar size={20} className="text-white" />
          </div>
          <div>
            <h1 className={`text-xl font-bold ${TXT_PRIMARY}`}>월간 QC 시험 스케줄</h1>
            <p className={`text-xs ${TXT_MUTED}`}>
              생성된 주간 스케줄과 PCT 생산관리에서 전송된 배정이 시험자×날짜 그리드로 통합 표시됩니다.
            </p>
          </div>
        </div>

        {/* PCT 데이터 알림 */}
        {pctSnapshot.length > 0 && (
          <Card className="border-violet-200 dark:border-violet-800 bg-violet-50/70 dark:bg-violet-950/30">
            <CardContent className="flex flex-wrap items-center justify-between gap-3 py-3 text-xs">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-white">
                  <Calendar size={14} />
                </div>
                <span className={`font-semibold ${TXT_PRIMARY}`}>PCT 생산관리 배정 표시 중</span>
                <span className={TXT_TERTIARY}>
                  총 <b className={`text-base ${TXT_PRIMARY}`}>{pctSnapshot.length}</b>건 · 이번 달 <b className={`text-base ${TXT_PRIMARY}`}>{pctSchedulesMerged.length}</b>건
                </span>
                {pctGeneratedAt && (
                  <span className={`text-[10px] ${TXT_MUTED}`}>
                    생성: {new Date(pctGeneratedAt).toLocaleString('ko-KR')}
                  </span>
                )}
              </div>
              <Button
                onClick={handleClearPct}
                variant="outline"
                size="sm"
                className="gap-1.5 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300 hover:bg-violet-100 dark:hover:bg-violet-900/40"
              >
                PCT 데이터 지우기
              </Button>
            </CardContent>
          </Card>
        )}

        {/* 월 네비게이션 */}
        <Card className={`${BORDER} ${CARD_BG}`}>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMonth(shiftMonth(month, -1))}
                className="gap-1.5"
              >
                <ChevronLeft size={14} />
                이전 달
              </Button>
              <div className={`min-w-[120px] text-center text-lg font-bold ${TXT_PRIMARY}`}>
                {month.replace('-', '년 ')}월
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMonth(shiftMonth(month, 1))}
                className="gap-1.5"
              >
                다음 달
                <ChevronRight size={14} />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setMonth(thisMonth())}
              >
                이번 달
              </Button>
            </div>
            <input
              type="month"
              value={month}
              onChange={e => setMonth(e.target.value)}
              className={`h-9 rounded-lg border ${BORDER} bg-white dark:bg-slate-800 px-3 text-sm tabular-nums outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100 dark:focus:ring-violet-900/40 ${TXT_PRIMARY} [color-scheme:light] dark:[color-scheme:dark]`}
            />
          </CardContent>
        </Card>

        {/* 에러 */}
        {error && (
          <Card className="border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
            <CardContent className="flex items-start gap-2 py-3">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* 로딩 */}
        {loading && (
          <Card className={`${BORDER} ${CARD_BG}`}>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-12">
              <Loader2 size={28} className="animate-spin text-violet-500" />
              <p className={`text-sm font-medium ${TXT_SECONDARY}`}>월간 스케줄 불러오는 중...</p>
            </CardContent>
          </Card>
        )}

        {/* 결과 */}
        {!loading && data && (
          <>
            {/* 요약 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card className="border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/40">
                <CardContent className="flex items-center gap-3 py-4">
                  <Calendar size={20} className="text-violet-600 dark:text-violet-400" />
                  <div>
                    <p className={`text-[11px] font-medium ${TXT_MUTED}`}>총 배정</p>
                    <p className={`text-xl font-bold tabular-nums ${TXT_PRIMARY}`}>{stats.total}건</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40">
                <CardContent className="flex items-center gap-3 py-4">
                  <Users size={20} className="text-blue-600 dark:text-blue-400" />
                  <div>
                    <p className={`text-[11px] font-medium ${TXT_MUTED}`}>활동 시험자</p>
                    <p className={`text-xl font-bold tabular-nums ${TXT_PRIMARY}`}>{stats.testers}명</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
                <CardContent className="flex items-center gap-3 py-4">
                  <AlertTriangle size={20} className="text-red-600 dark:text-red-400" />
                  <div>
                    <p className={`text-[11px] font-medium ${TXT_MUTED}`}>긴급</p>
                    <p className="text-xl font-bold tabular-nums text-red-700 dark:text-red-300">{stats.urgent}건</p>
                  </div>
                </CardContent>
              </Card>
              <Card className="border-sky-200 bg-sky-50 dark:border-sky-900 dark:bg-sky-950/40">
                <CardContent className="flex items-center gap-3 py-4">
                  <Users size={20} className="text-sky-600 dark:text-sky-400" />
                  <div>
                    <p className={`text-[11px] font-medium ${TXT_MUTED}`}>듀오</p>
                    <p className="text-xl font-bold tabular-nums text-sky-700 dark:text-sky-300">{stats.duo}건</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* 뷰 전환 탭 */}
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-1.5">
              {([
                { key: 'monthly',  label: '월간 그리드', icon: LayoutGrid,    hint: '시험자 × 날짜' },
                { key: 'weekly',   label: '주간 보드',   icon: CalendarRange, hint: '주차별' },
                { key: 'personal', label: '개인별 할당', icon: UserSquare,    hint: '시험자별' },
              ] as const).map(t => {
                const active = view === t.key
                const Icon = t.icon
                return (
                  <button
                    key={t.key}
                    onClick={() => setView(t.key)}
                    className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-colors ${
                      active
                        ? 'bg-violet-600 text-white shadow-sm'
                        : `${TXT_TERTIARY} hover:bg-slate-100 dark:hover:bg-slate-800`
                    }`}
                  >
                    <Icon size={15} />
                    {t.label}
                    <span className={`hidden text-[10px] font-normal sm:inline ${active ? 'text-violet-100' : TXT_MUTED}`}>
                      {t.hint}
                    </span>
                  </button>
                )
              })}
            </div>

            {/* ── 월간 그리드 뷰 ── */}
            {view === 'monthly' && (<>
            {/* 간트 그리드 */}
            <Card className={`${BORDER} ${CARD_BG} overflow-hidden`}>
              <CardHeader>
                <CardTitle className={`flex items-center gap-2 text-base ${TXT_PRIMARY}`}>
                  <Calendar size={16} className="text-violet-600 dark:text-violet-400" />
                  월간 그리드
                  <span className={`text-xs font-normal ${TXT_MUTED}`}>(시험자 × 날짜)</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-0 pb-0">
                {visibleTesters.length === 0 ? (
                  <p className={`px-6 py-10 text-center text-sm ${TXT_MUTED}`}>
                    이 달에 배정된 스케줄이 없습니다.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-slate-100 dark:bg-slate-800/60">
                          <th
                            className={`sticky left-0 z-10 border-b ${BORDER} bg-slate-100 dark:bg-slate-800/60 px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wide ${TXT_TERTIARY}`}
                            style={{ minWidth: 120 }}
                          >
                            시험자
                          </th>
                          {days.map(d => {
                            const dow = dayOfWeek(d)
                            const isWeekend = dow === 0 || dow === 6
                            return (
                              <th
                                key={d}
                                className={`border-b border-l ${BORDER} px-1 py-2 text-center text-[10px] font-semibold ${
                                  isWeekend ? 'text-red-500 dark:text-red-400' : TXT_TERTIARY
                                }`}
                                style={{ minWidth: 38 }}
                              >
                                <div>{Number(d.slice(-2))}</div>
                                <div className="text-[9px] font-normal opacity-70">{DOW_KOR[dow]}</div>
                              </th>
                            )
                          })}
                        </tr>
                      </thead>
                      <tbody>
                        {visibleTesters.map(t => (
                          <tr key={t.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                            <td
                              className={`sticky left-0 z-10 border-b ${BORDER} bg-white dark:bg-slate-900 px-3 py-2 text-sm font-semibold ${TXT_PRIMARY}`}
                            >
                              <div className="flex items-center gap-1.5">
                                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-[10px] font-bold text-white">
                                  {t.name.slice(0, 1)}
                                </div>
                                {t.name}
                              </div>
                            </td>
                            {days.map(d => {
                              const k = `${t.id}::${d}`
                              const rows = cellMap.get(k) ?? []
                              const isWeekend = (() => {
                                const dow = dayOfWeek(d)
                                return dow === 0 || dow === 6
                              })()
                              return (
                                <td
                                  key={k}
                                  className={`border-b border-l ${BORDER} p-0.5 align-top ${
                                    isWeekend ? 'bg-slate-50/60 dark:bg-slate-800/30' : ''
                                  }`}
                                  style={{ minWidth: 38 }}
                                >
                                  <div className="flex flex-col gap-0.5">
                                    {rows.map(r => {
                                      const style = cellStyle(r)
                                      return (
                                        <div
                                          key={`${r.id}-${d}`}
                                          title={`${r.product_name} (배치 ${r.batch_id})\n시험항목: ${r.test_items?.join(', ') ?? '-'}\n공수: ${r.avg_hours != null && r.avg_hours > 0 ? `${r.avg_hours.toFixed(1)}h (${r.workdays}일)` : `${r.workdays}일`}\n${r.note ?? ''}`}
                                          className={`truncate rounded-sm border px-1 py-0.5 text-[9px] font-medium cursor-help transition-colors ${style.bg} ${style.border} ${TXT_PRIMARY}`}
                                        >
                                          {r.product_name.slice(0, 6)}
                                        </div>
                                      )
                                    })}
                                  </div>
                                </td>
                              )
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* 범례 */}
            <Card className={`${BORDER} bg-slate-100/70 dark:bg-slate-800/40`}>
              <CardContent className="flex flex-wrap items-center gap-4 py-3 text-xs">
                <span className={`font-semibold ${TXT_MUTED}`}>범례:</span>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-sm border border-emerald-300 bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/40" />
                  <span className={TXT_TERTIARY}>일반</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-sm border border-red-300 bg-red-200 dark:border-red-800 dark:bg-red-900/60" />
                  <span className={TXT_TERTIARY}>긴급</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-sm border border-blue-300 bg-blue-200 dark:border-blue-800 dark:bg-blue-900/60" />
                  <span className={TXT_TERTIARY}>듀오</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-sm border border-dashed border-violet-400 bg-violet-200 dark:border-violet-700 dark:bg-violet-900/60" />
                  <span className={TXT_TERTIARY}>PCT 생산관리 출처</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="inline-block h-3 w-3 rounded-sm bg-slate-200 dark:bg-slate-700" />
                  <span className={TXT_TERTIARY}>주말</span>
                </div>
                <span className={`ml-auto text-[10px] italic ${TXT_MUTED}`}>
                  셀에 마우스를 올리면 상세 정보가 표시됩니다.
                </span>
              </CardContent>
            </Card>
            </>)}

            {/* ── 주간 보드 뷰 (Monday 스타일, 주차별 그룹) ── */}
            {view === 'weekly' && (
              <Card className={`${BORDER} ${CARD_BG}`}>
                <CardHeader>
                  <CardTitle className={`flex items-center gap-2 text-base ${TXT_PRIMARY}`}>
                    <CalendarRange size={16} className="text-violet-600 dark:text-violet-400" />
                    주간 보드
                    <span className={`text-xs font-normal ${TXT_MUTED}`}>(포장/예정일 기준 주차)</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 sm:p-4">
                  <MondayBoard
                    groups={weeklyGroups}
                    columns={weeklyColumns}
                    showToggleAll
                    emptyMessage="이 달에 배정된 스케줄이 없습니다."
                  />
                </CardContent>
              </Card>
            )}

            {/* ── 개인별 할당 뷰 (Monday 스타일, 시험자별 그룹) ── */}
            {view === 'personal' && (
              <Card className={`${BORDER} ${CARD_BG}`}>
                <CardHeader>
                  <CardTitle className={`flex items-center gap-2 text-base ${TXT_PRIMARY}`}>
                    <UserSquare size={16} className="text-violet-600 dark:text-violet-400" />
                    개인별 할당
                    <span className={`text-xs font-normal ${TXT_MUTED}`}>(시험자별 배정 목록)</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-3 sm:p-4">
                  <MondayBoard
                    groups={personalGroups}
                    columns={personalColumns}
                    showToggleAll
                    emptyMessage="이 달에 배정된 스케줄이 없습니다."
                  />
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}
