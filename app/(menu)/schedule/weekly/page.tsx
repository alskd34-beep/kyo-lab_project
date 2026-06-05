'use client'

import { useState, useMemo } from 'react'
import { Button } from '@frontend/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@frontend/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@frontend/components/ui/table'
import {
  Calendar,
  Sparkles,
  Loader2,
  AlertCircle,
  AlertTriangle,
  Users,
  CheckCircle2,
  User,
  Send,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface ScheduleItem {
  tester_id: number
  tester_name: string
  batch_id: number
  product_name: string
  batch_no: string
  test_items: string[]
  scheduled_date: string
  workdays: number
  is_urgent: boolean
  is_duo: boolean
  duo_partner_id: number | null
  note: string
}

interface UnassignedItem {
  product_name: string
  batch_no: string
  reason: string
}

interface SchedulerResponse {
  success: boolean
  data: {
    schedule?: ScheduleItem[]
    unassigned?: UnassignedItem[]
    summary?: string
    raw?: string
  }
  meta?: {
    week_start: string
    week_end: string
    total_batches: number
    assigned: number
    unassigned: number
  }
}

// ─── 기본값: 이번 주 월요일 ~ 금요일 ─────────────────────────────────────────────
function getDefaultWeek() {
  const today = new Date()
  const day = today.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(today)
  monday.setDate(today.getDate() + diffToMonday)
  const friday = new Date(monday)
  friday.setDate(monday.getDate() + 4)
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return { start: fmt(monday), end: fmt(friday) }
}

const cardKey = (item: ScheduleItem, idx: number) =>
  `${item.tester_id}-${item.batch_id}-${idx}`

// ─── 공통 클래스 ──────────────────────────────────────────────────────────────
const TXT_PRIMARY   = 'text-slate-900 dark:text-slate-50'
const TXT_SECONDARY = 'text-slate-700 dark:text-slate-200'
const TXT_TERTIARY  = 'text-slate-600 dark:text-slate-300'
const TXT_MUTED     = 'text-slate-500 dark:text-slate-400'
const BORDER        = 'border-slate-200 dark:border-slate-700'
const CARD_BG       = 'bg-white dark:bg-slate-900'
const TH_CLS        = 'text-[11px] font-semibold uppercase tracking-wide text-slate-600 dark:text-slate-300'

// ─── Component ────────────────────────────────────────────────────────────────
export default function SchedulerPage() {
  const defaults = getDefaultWeek()
  const [weekStart, setWeekStart] = useState(defaults.start)
  const [weekEnd, setWeekEnd]     = useState(defaults.end)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState<string | null>(null)
  const [result, setResult]       = useState<SchedulerResponse | null>(null)

  // 카드별 체크된 시험항목: { cardKey: Set<test_item> }
  const [checked, setChecked] = useState<Record<string, Set<string>>>({})
  // 검토 요청된 카드 키 모음
  const [submitted, setSubmitted] = useState<Set<string>>(new Set())

  const generateSchedule = async () => {
    setError(null)
    setResult(null)
    setChecked({})
    setSubmitted(new Set())

    if (!weekStart || !weekEnd) {
      setError('주간 시작일과 종료일을 모두 입력해주세요.')
      return
    }
    if (weekStart > weekEnd) {
      setError('시작일이 종료일보다 늦을 수 없습니다.')
      return
    }

    setLoading(true)
    try {
      const res = await fetch('/api/qc-scheduler', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ week_start: weekStart, week_end: weekEnd }),
      })

      const json = await res.json()
      if (!res.ok) {
        throw new Error(json.error ?? '스케줄 생성에 실패했습니다.')
      }
      setResult(json)
    } catch (err) {
      setError(err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.')
    } finally {
      setLoading(false)
    }
  }

  const toggleCheck = (key: string, item: string) => {
    setChecked(prev => {
      const next = { ...prev }
      const set = new Set(next[key] ?? [])
      set.has(item) ? set.delete(item) : set.add(item)
      next[key] = set
      return next
    })
  }

  const submitForReview = (key: string) => {
    setSubmitted(prev => new Set(prev).add(key))
  }

  const schedule   = result?.data?.schedule ?? []
  const unassigned = result?.data?.unassigned ?? []
  const meta       = result?.meta

  // 시험자별로 그룹화
  const groupedByTester = useMemo(() => {
    const map = new Map<string, { name: string; tester_id: number; items: { item: ScheduleItem; key: string }[] }>()
    schedule.forEach((item, idx) => {
      const k = `${item.tester_id}`
      if (!map.has(k)) map.set(k, { name: item.tester_name, tester_id: item.tester_id, items: [] })
      map.get(k)!.items.push({ item, key: cardKey(item, idx) })
    })
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ko'))
  }, [schedule])

  // 검토 대기 카드 (모든 항목 체크 + 검토 요청 버튼 누른 것)
  const reviewQueue = useMemo(() => {
    const list: { item: ScheduleItem; key: string }[] = []
    schedule.forEach((item, idx) => {
      const k = cardKey(item, idx)
      if (submitted.has(k)) list.push({ item, key: k })
    })
    return list
  }, [schedule, submitted])

  return (
    <div className="p-6">
      <div className="mx-auto max-w-[1600px] space-y-5">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 shadow-md shadow-blue-600/30">
            <Sparkles size={20} className="text-white" />
          </div>
          <div>
            <h1 className={`text-xl font-bold ${TXT_PRIMARY}`}>주간 QC 시험 스케줄러</h1>
            <p className={`text-xs ${TXT_MUTED}`}>
              AI가 시험자 역량과 장비/공수/휴가를 고려해 최적의 배정안을 생성합니다.
            </p>
          </div>
        </div>

        {/* ── 입력 폼 ────────────────────────────────────────────────────── */}
        <Card className={`${BORDER} ${CARD_BG}`}>
          <CardHeader>
            <CardTitle className={`flex items-center gap-2 text-base ${TXT_PRIMARY}`}>
              <Calendar size={16} className={TXT_MUTED} />
              대상 기간 설정
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap items-end gap-3">
              <div className="flex flex-col gap-1.5">
                <label className={`text-xs font-medium ${TXT_TERTIARY}`}>시작일</label>
                <input
                  type="date"
                  value={weekStart}
                  onChange={e => setWeekStart(e.target.value)}
                  disabled={loading}
                  className={`h-9 rounded-lg border ${BORDER} bg-white dark:bg-slate-800 px-3 text-sm tabular-nums outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 disabled:bg-slate-50 dark:disabled:bg-slate-900 ${TXT_PRIMARY} [color-scheme:light] dark:[color-scheme:dark]`}
                />
              </div>

              <div className={`flex h-9 items-end pb-2 ${TXT_MUTED}`}>~</div>

              <div className="flex flex-col gap-1.5">
                <label className={`text-xs font-medium ${TXT_TERTIARY}`}>종료일</label>
                <input
                  type="date"
                  value={weekEnd}
                  onChange={e => setWeekEnd(e.target.value)}
                  disabled={loading}
                  className={`h-9 rounded-lg border ${BORDER} bg-white dark:bg-slate-800 px-3 text-sm tabular-nums outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/40 disabled:bg-slate-50 dark:disabled:bg-slate-900 ${TXT_PRIMARY} [color-scheme:light] dark:[color-scheme:dark]`}
                />
              </div>

              <Button
                onClick={generateSchedule}
                disabled={loading}
                className="h-9 gap-1.5 bg-blue-600 px-5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {loading ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    생성 중...
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    스케줄 생성
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ── 에러 ───────────────────────────────────────────────────────── */}
        {error && (
          <Card className="border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/40">
            <CardContent className="flex items-start gap-2 py-3">
              <AlertCircle size={16} className="mt-0.5 shrink-0 text-red-600 dark:text-red-400" />
              <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
            </CardContent>
          </Card>
        )}

        {/* ── 로딩 ───────────────────────────────────────────────────────── */}
        {loading && (
          <Card className={`${BORDER} ${CARD_BG}`}>
            <CardContent className="flex flex-col items-center justify-center gap-2 py-12">
              <Loader2 size={28} className="animate-spin text-blue-500" />
              <p className={`text-sm font-medium ${TXT_SECONDARY}`}>AI가 스케줄을 분석 중입니다...</p>
              <p className={`text-xs ${TXT_MUTED}`}>시험자 역량 · 장비 · 공수 · 휴가를 종합 검토합니다.</p>
            </CardContent>
          </Card>
        )}

        {/* ── 결과 ───────────────────────────────────────────────────────── */}
        {result && !loading && (
          <>
            {/* 요약 카드 */}
            {meta && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <Card className="border-blue-200 bg-blue-50 dark:border-blue-900 dark:bg-blue-950/40">
                  <CardContent className="flex items-center gap-3 py-4">
                    <CheckCircle2 size={22} className="text-blue-600 dark:text-blue-400" />
                    <div>
                      <p className={`text-[11px] font-medium ${TXT_MUTED}`}>총 처리 대상</p>
                      <p className={`text-xl font-bold tabular-nums ${TXT_PRIMARY}`}>{meta.total_batches}건</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-emerald-200 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/40">
                  <CardContent className="flex items-center gap-3 py-4">
                    <Users size={22} className="text-emerald-600 dark:text-emerald-400" />
                    <div>
                      <p className={`text-[11px] font-medium ${TXT_MUTED}`}>배정 완료</p>
                      <p className="text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300">{meta.assigned}건</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/40">
                  <CardContent className="flex items-center gap-3 py-4">
                    <AlertTriangle size={22} className="text-amber-600 dark:text-amber-400" />
                    <div>
                      <p className={`text-[11px] font-medium ${TXT_MUTED}`}>미배정</p>
                      <p className="text-xl font-bold tabular-nums text-amber-700 dark:text-amber-300">{meta.unassigned}건</p>
                    </div>
                  </CardContent>
                </Card>
                <Card className="border-violet-200 bg-violet-50 dark:border-violet-900 dark:bg-violet-950/40">
                  <CardContent className="flex items-center gap-3 py-4">
                    <Send size={22} className="text-violet-600 dark:text-violet-400" />
                    <div>
                      <p className={`text-[11px] font-medium ${TXT_MUTED}`}>검토 요청</p>
                      <p className="text-xl font-bold tabular-nums text-violet-700 dark:text-violet-300">{reviewQueue.length}건</p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )}

            {/* ── 칸반 보드 ────────────────────────────────────────────── */}
            {schedule.length > 0 && (
              <Card className={`${BORDER} ${CARD_BG} overflow-hidden`}>
                <CardHeader>
                  <CardTitle className={`flex items-center gap-2 text-base ${TXT_PRIMARY}`}>
                    <Users size={16} className="text-emerald-600 dark:text-emerald-400" />
                    시험자별 주간 칸반 보드
                    <span className={`text-xs font-normal ${TXT_MUTED}`}>
                      ({groupedByTester.length}명 · 총 {schedule.length}건)
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="flex gap-3 overflow-x-auto pb-2">
                    {groupedByTester.map(group => {
                      const totalItems   = group.items.reduce((s, c) => s + (c.item.test_items?.length ?? 0), 0)
                      const checkedItems = group.items.reduce(
                        (s, c) => s + (checked[c.key]?.size ?? 0),
                        0,
                      )
                      const progressPct = totalItems > 0 ? Math.round((checkedItems / totalItems) * 100) : 0

                      return (
                        <div
                          key={group.tester_id}
                          className={`flex w-72 shrink-0 flex-col gap-2 rounded-xl border ${BORDER} bg-slate-100/60 dark:bg-slate-800/40 p-3`}
                        >
                          {/* 컬럼 헤더 */}
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
                                {group.name.slice(0, 1)}
                              </div>
                              <div>
                                <p className={`text-sm font-semibold ${TXT_PRIMARY}`}>{group.name}</p>
                                <p className={`text-[10px] ${TXT_MUTED}`}>{group.items.length}건 배정</p>
                              </div>
                            </div>
                            <span className={`rounded-md bg-white dark:bg-slate-900 px-2 py-0.5 text-[10px] font-bold tabular-nums ${
                              progressPct === 100 ? 'text-emerald-600' : 'text-slate-500 dark:text-slate-400'
                            }`}>
                              {checkedItems}/{totalItems}
                            </span>
                          </div>

                          {/* 진행률 바 */}
                          <div className="h-1 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                            <div
                              className={`h-full transition-all ${
                                progressPct === 100 ? 'bg-emerald-500' : 'bg-blue-500'
                              }`}
                              style={{ width: `${progressPct}%` }}
                            />
                          </div>

                          {/* 카드 리스트 */}
                          <div className="flex flex-col gap-2">
                            {group.items.map(({ item, key }) => {
                              const checkedSet = checked[key] ?? new Set<string>()
                              const total      = item.test_items?.length ?? 0
                              const done       = checkedSet.size
                              const allDone    = total > 0 && done === total
                              const isSubmitted = submitted.has(key)

                              const cardBorder = isSubmitted
                                ? 'border-violet-400 dark:border-violet-600 ring-1 ring-violet-200 dark:ring-violet-900'
                                : allDone
                                  ? 'border-emerald-400 dark:border-emerald-600'
                                  : item.is_urgent
                                    ? 'border-red-300 dark:border-red-800'
                                    : item.is_duo
                                      ? 'border-blue-300 dark:border-blue-800'
                                      : BORDER

                              const cardBg = isSubmitted
                                ? 'bg-violet-50 dark:bg-violet-950/30'
                                : allDone
                                  ? 'bg-emerald-50 dark:bg-emerald-950/30'
                                  : item.is_urgent
                                    ? 'bg-red-50/70 dark:bg-red-950/20'
                                    : item.is_duo
                                      ? 'bg-blue-50/70 dark:bg-blue-950/20'
                                      : CARD_BG

                              return (
                                <div
                                  key={key}
                                  className={`rounded-lg border ${cardBorder} ${cardBg} p-3 transition-colors`}
                                >
                                  {/* 카드 헤더 */}
                                  <div className="mb-2 flex items-start justify-between gap-2">
                                    <div className="min-w-0 flex-1">
                                      <p className={`truncate text-sm font-semibold ${TXT_PRIMARY}`}>
                                        {item.product_name}
                                      </p>
                                      <p className={`font-mono text-[11px] ${TXT_MUTED}`}>
                                        {item.batch_no} · {item.scheduled_date} · {item.workdays}일
                                      </p>
                                    </div>
                                    <div className="flex shrink-0 flex-col items-end gap-1">
                                      {item.is_urgent && (
                                        <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-100 px-1.5 py-0.5 text-[9px] font-bold text-red-700 dark:border-red-800 dark:bg-red-900/50 dark:text-red-300">
                                          <AlertTriangle size={9} /> 긴급
                                        </span>
                                      )}
                                      {item.is_duo && (
                                        <span className="inline-flex items-center gap-1 rounded-full border border-blue-300 bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold text-blue-700 dark:border-blue-800 dark:bg-blue-900/50 dark:text-blue-300">
                                          <Users size={9} /> 듀오
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* 시험항목 체크리스트 */}
                                  <div className="space-y-1.5">
                                    {item.test_items?.map(t => {
                                      const isChecked = checkedSet.has(t)
                                      return (
                                        <label
                                          key={t}
                                          className="flex cursor-pointer items-start gap-2"
                                        >
                                          <input
                                            type="checkbox"
                                            checked={isChecked}
                                            onChange={() => toggleCheck(key, t)}
                                            disabled={isSubmitted}
                                            className="cb-custom mt-0.5"
                                          />
                                          <span
                                            className={`text-xs leading-snug ${
                                              isChecked
                                                ? `line-through ${TXT_MUTED}`
                                                : TXT_TERTIARY
                                            }`}
                                          >
                                            {t}
                                          </span>
                                        </label>
                                      )
                                    })}
                                  </div>

                                  {/* 진행 상태 + 검토 요청 버튼 */}
                                  <div className={`mt-3 flex items-center justify-between border-t pt-2 ${BORDER}`}>
                                    <span className={`text-[10px] font-medium tabular-nums ${
                                      isSubmitted
                                        ? 'text-violet-600 dark:text-violet-400'
                                        : allDone
                                          ? 'text-emerald-600 dark:text-emerald-400'
                                          : TXT_MUTED
                                    }`}>
                                      {isSubmitted
                                        ? '🔍 검토 대기 중'
                                        : allDone
                                          ? '✓ 모든 항목 완료'
                                          : `${done}/${total} 완료`}
                                    </span>
                                    {allDone && !isSubmitted && (
                                      <button
                                        onClick={() => submitForReview(key)}
                                        className="inline-flex items-center gap-1 rounded-md bg-violet-600 px-2 py-1 text-[10px] font-semibold text-white hover:bg-violet-700 transition-colors"
                                      >
                                        <Send size={9} />
                                        검토 요청
                                      </button>
                                    )}
                                  </div>

                                  {item.note && (
                                    <p className={`mt-2 text-[10px] italic ${TXT_MUTED}`}>
                                      {item.note}
                                    </p>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* ── 검토자 큐 ──────────────────────────────────────────── */}
            {reviewQueue.length > 0 && (
              <Card className="border-violet-300 dark:border-violet-800 bg-white dark:bg-slate-900 overflow-hidden">
                <CardHeader>
                  <CardTitle className={`flex items-center gap-2 text-base ${TXT_PRIMARY}`}>
                    <Send size={16} className="text-violet-600 dark:text-violet-400" />
                    검토자 큐
                    <span className={`text-xs font-normal ${TXT_MUTED}`}>
                      ({reviewQueue.length}건 검토 대기)
                    </span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-violet-50 dark:bg-violet-950/30 hover:bg-violet-50 dark:hover:bg-violet-950/30">
                        <TableHead className={TH_CLS}>시험자</TableHead>
                        <TableHead className={TH_CLS}>품목명</TableHead>
                        <TableHead className={TH_CLS}>제조번호</TableHead>
                        <TableHead className={TH_CLS}>완료 항목</TableHead>
                        <TableHead className={`${TH_CLS} text-center`}>긴급</TableHead>
                        <TableHead className={`${TH_CLS} text-center`}>액션</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {reviewQueue.map(({ item, key }) => (
                        <TableRow key={key} className="text-sm hover:bg-violet-50/50 dark:hover:bg-violet-950/20">
                          <TableCell className={`font-semibold ${TXT_PRIMARY}`}>
                            <div className="flex items-center gap-2">
                              <User size={12} className={TXT_MUTED} />
                              {item.tester_name}
                            </div>
                          </TableCell>
                          <TableCell className={TXT_SECONDARY}>{item.product_name}</TableCell>
                          <TableCell className={`font-mono text-xs ${TXT_TERTIARY}`}>{item.batch_no}</TableCell>
                          <TableCell className={`text-xs ${TXT_TERTIARY}`}>
                            {item.test_items?.join(', ')}
                          </TableCell>
                          <TableCell className="text-center">
                            {item.is_urgent && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-red-300 bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700 dark:border-red-800 dark:bg-red-900/50 dark:text-red-300">
                                긴급
                              </span>
                            )}
                          </TableCell>
                          <TableCell className="text-center">
                            <span className="inline-flex items-center gap-1 rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-semibold text-violet-700 dark:bg-violet-900/50 dark:text-violet-300">
                              <Loader2 size={10} className="animate-spin" />
                              검토 대기
                            </span>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* 미배정 테이블 */}
            {unassigned.length > 0 && (
              <Card className={`border-amber-300 dark:border-amber-900 ${CARD_BG} overflow-hidden`}>
                <CardHeader>
                  <CardTitle className={`flex items-center gap-2 text-base ${TXT_PRIMARY}`}>
                    <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400" />
                    배정 불가 항목
                    <span className={`text-xs font-normal ${TXT_MUTED}`}>({unassigned.length}건)</span>
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-0 pb-0">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-amber-100/70 dark:bg-amber-950/40 hover:bg-amber-100/70 dark:hover:bg-amber-950/40">
                        <TableHead className={TH_CLS}>품목명</TableHead>
                        <TableHead className={TH_CLS}>제조번호</TableHead>
                        <TableHead className={TH_CLS}>사유</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {unassigned.map((item, idx) => (
                        <TableRow
                          key={`${item.batch_no}-${idx}`}
                          className="text-sm hover:bg-amber-50 dark:hover:bg-amber-950/20"
                        >
                          <TableCell className={`font-semibold ${TXT_PRIMARY}`}>{item.product_name}</TableCell>
                          <TableCell className={`font-mono text-xs ${TXT_TERTIARY}`}>{item.batch_no}</TableCell>
                          <TableCell className="text-xs text-amber-700 dark:text-amber-300">{item.reason}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            )}

            {/* AI 요약 */}
            {result.data?.summary && (
              <Card className={`${BORDER} bg-slate-100/70 dark:bg-slate-800/40`}>
                <CardContent className="py-4">
                  <p className={`text-xs font-semibold uppercase tracking-wide mb-2 ${TXT_MUTED}`}>AI 요약</p>
                  <p className={`whitespace-pre-wrap text-sm leading-relaxed ${TXT_SECONDARY}`}>
                    {result.data.summary}
                  </p>
                </CardContent>
              </Card>
            )}

            {/* 파싱 실패 시 raw 출력 */}
            {result.data?.raw && (
              <Card className={`${BORDER} ${CARD_BG}`}>
                <CardHeader>
                  <CardTitle className={`text-base ${TXT_TERTIARY}`}>원본 응답 (JSON 파싱 실패)</CardTitle>
                </CardHeader>
                <CardContent>
                  <pre className="overflow-x-auto rounded-lg bg-slate-900 dark:bg-slate-950 p-3 text-xs text-slate-100 dark:text-slate-200 border border-slate-700">
                    {result.data.raw}
                  </pre>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  )
}
