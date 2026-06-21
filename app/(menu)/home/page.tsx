'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent } from '@frontend/components/ui/card'
import { Avatar, AvatarFallback } from '@frontend/components/ui/avatar'
import type { BatchSummary, BatchStatus, DashboardStats } from '@shared/pqm'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Tester {
  name: string
  init: string
  color: string
  assignedToday: number
}

interface TableauSummary {
  configured: boolean
  generatedAt: string
  serverUrl: string | null
  siteContentUrl: string | null
  workbooks: Array<{
    id: string
    name: string
    projectName: string | null
    updatedAt: string | null
    webUrl: string | null
  }>
  views: Array<{
    id: string
    name: string
    workbookName: string | null
    projectName: string | null
    updatedAt: string | null
    webUrl: string | null
  }>
  missingEnv?: string[]
}

// ─── Demo Data ────────────────────────────────────────────────────────────────

const DEMO_UPCOMING: BatchSummary[] = [
  { id: 1, product_code: '21081', product_name: '(사향)광동우황청심원현탁액(신)', spec: '50ML', batch_no: '26002', dosage_form: '현탁제', packaging_date: '2026-04-10', record_review_deadline: '2026-04-24', qc_completion_deadline: '2026-04-24', is_urgent: false, status: 'completed', dDayRecord: -13, dDayQc: -13, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 2, product_code: '21350', product_name: '슬라임캡슐', spec: '120C', batch_no: '26001', dosage_form: '내용고형제', packaging_date: '2026-03-30', record_review_deadline: '2026-04-27', qc_completion_deadline: '2026-04-27', is_urgent: false, status: 'completed', dDayRecord: -10, dDayQc: -10, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 3, product_code: '23263', product_name: '베니톨정', spec: '500T', batch_no: '26023', dosage_form: '내용고형제', packaging_date: '2026-04-16', record_review_deadline: '2026-04-30', qc_completion_deadline: '2026-04-30', is_urgent: false, status: 'in_progress', dDayRecord: -7, dDayQc: -7, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 4, product_code: '23263', product_name: '베니톨정', spec: '500T', batch_no: '26024', dosage_form: '내용고형제', packaging_date: '2026-04-16', record_review_deadline: '2026-04-30', qc_completion_deadline: '2026-04-30', is_urgent: false, status: 'in_progress', dDayRecord: -7, dDayQc: -7, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 5, product_code: '21391', product_name: '알도셉트정5mg', spec: '30T', batch_no: '26001-A', dosage_form: '내용고형제', packaging_date: '2026-04-06', record_review_deadline: '2026-04-30', qc_completion_deadline: '2026-04-30', is_urgent: false, status: 'in_progress', dDayRecord: -7, dDayQc: -7, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 6, product_code: '21080', product_name: '(사향)광동우황청심원(신)', spec: '1환', batch_no: '26010', dosage_form: '환제', packaging_date: '2026-04-25', record_review_deadline: '2026-05-07', qc_completion_deadline: '2026-05-07', is_urgent: false, status: 'pending', dDayRecord: 0, dDayQc: 0, note: null, created_at: '', process_order: null, validation_type: '일반' },
  { id: 7, product_code: '27045', product_name: '(베트남수출용)광동우황청심원(영묘향)', spec: '1환', batch_no: '26011', dosage_form: '환제', packaging_date: '2026-04-28', record_review_deadline: '2026-05-10', qc_completion_deadline: '2026-05-10', is_urgent: false, status: 'pending', dDayRecord: 3, dDayQc: 3, note: null, created_at: '', process_order: null, validation_type: '일반' },
]

const DEMO_STATS: DashboardStats = {
  totalBatches: 129, pending: 97, inProgress: 15, completed: 17,
  dueSoon7: 23, dueSoon3: 8, overdueCount: 5,
}

const DEMO_TESTERS: Tester[] = [
  { name: '김태훈', init: '김', color: 'bg-blue-500',    assignedToday: 3 },
  { name: '박성호', init: '박', color: 'bg-violet-500',  assignedToday: 2 },
  { name: '권택균', init: '권', color: 'bg-emerald-500', assignedToday: 1 },
  { name: '장재훈', init: '장', color: 'bg-amber-500',   assignedToday: 4 },
  { name: '지건희', init: '지', color: 'bg-rose-500',    assignedToday: 2 },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<BatchStatus, { label: string; cls: string }> = {
  pending:     { label: '대기중', cls: 'bg-slate-100 text-slate-600' },
  in_progress: { label: '진행중', cls: 'bg-violet-50 text-violet-700' },
  completed:   { label: '완료',   cls: 'bg-emerald-50 text-emerald-700' },
  on_hold:     { label: '보류',   cls: 'bg-amber-50 text-amber-700' },
  cancelled:   { label: '취소',   cls: 'bg-red-50 text-red-600' },
}

function dDayColor(dDayQc: number | null): string {
  if (dDayQc === null || dDayQc < 0) return 'text-slate-400'
  if (dDayQc === 0) return 'text-red-600 font-bold'
  if (dDayQc <= 3)  return 'text-red-500 font-semibold'
  if (dDayQc <= 7)  return 'text-amber-600 font-semibold'
  return 'text-emerald-600'
}

function dDayLabel(dDayQc: number | null): string {
  if (dDayQc === null) return '-'
  if (dDayQc < 0)  return `D+${Math.abs(dDayQc)}`
  if (dDayQc === 0) return 'D-Day'
  return `D-${dDayQc}`
}

function formatDateTime(value: string | null): string {
  if (!value) return '-'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('ko-KR', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HomePage() {
  const [upcoming, setUpcoming]   = useState<BatchSummary[]>(DEMO_UPCOMING)
  const [stats, setStats]         = useState<DashboardStats>(DEMO_STATS)
  const [usingDemo, setUsingDemo] = useState(true)
  const [isLoading, setIsLoading] = useState(true)
  const [tableau, setTableau] = useState<TableauSummary | null>(null)
  const [tableauError, setTableauError] = useState<string | null>(null)
  const [isTableauLoading, setIsTableauLoading] = useState(true)

  const loadHomeData = useCallback(async (signal?: AbortSignal) => {
    if (signal?.aborted) return
    setIsLoading(true)
    setIsTableauLoading(true)

    const dashboardPromise = Promise.all([
      fetch('/api/dashboard', { signal }).then(async r => {
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<DashboardStats>
      }),
      fetch('/api/batches?limit=10', { signal }).then(async r => {
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<{ rows: BatchSummary[] }>
      }),
    ])

    const tableauPromise = fetch('/api/tableau/summary?limit=5', { signal }).then(async r => {
      const json = await r.json()
      if (!r.ok) throw new Error(json.error ?? 'Tableau 정보를 불러오지 못했습니다')
      return json as { row: TableauSummary }
    })

    // 두 요청을 모두 await(처리)해야 abort 시 tableauPromise 가 미처리 거부로
    // 남지 않는다. 중도 early-return 금지 — 상태 갱신만 abort 여부로 가드한다.
    try {
      const [statsData, batchData] = await dashboardPromise
      if (!signal?.aborted) {
        setStats(statsData)
        setUpcoming(batchData.rows.length > 0 ? batchData.rows : DEMO_UPCOMING)
        setUsingDemo(false)
      }
    } catch {
      if (!signal?.aborted) setUsingDemo(true)
    } finally {
      if (!signal?.aborted) setIsLoading(false)
    }

    try {
      const data = await tableauPromise
      if (!signal?.aborted) {
        setTableau(data.row)
        setTableauError(null)
      }
    } catch (err) {
      if (!signal?.aborted) {
        setTableau(null)
        setTableauError(err instanceof Error ? err.message : 'Tableau 연동 오류')
      }
    } finally {
      if (!signal?.aborted) setIsTableauLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    const refreshOnVisible = () => {
      if (!document.hidden) void loadHomeData(controller.signal)
    }

    void loadHomeData(controller.signal)

    const refreshTimer = window.setInterval(() => {
      void loadHomeData(controller.signal)
    }, 60_000)

    window.addEventListener('focus', refreshOnVisible)
    document.addEventListener('visibilitychange', refreshOnVisible)

    return () => {
      controller.abort()
      window.clearInterval(refreshTimer)
      window.removeEventListener('focus', refreshOnVisible)
      document.removeEventListener('visibilitychange', refreshOnVisible)
    }
  }, [loadHomeData])

  const KPI_CARDS = [
    { label: '전체 배치',  value: stats.totalBatches, unit: '건', sub: '총 생산배치 수',   accent: 'text-slate-800',   bg: 'bg-white',         border: 'border-slate-200' },
    { label: '대기중',     value: stats.pending,       unit: '건', sub: '시험 대기',        accent: 'text-slate-600',   bg: 'bg-slate-50/60',   border: 'border-slate-200' },
    { label: '진행중',     value: stats.inProgress,    unit: '건', sub: 'QC 시험 진행',     accent: 'text-violet-600',  bg: 'bg-violet-50/60',  border: 'border-violet-100' },
    { label: 'QC완료',    value: stats.completed,     unit: '건', sub: '이번달 완료',       accent: 'text-emerald-600', bg: 'bg-emerald-50/60', border: 'border-emerald-100' },
    { label: 'D-7 임박',  value: stats.dueSoon7,      unit: '건', sub: '기한 임박 배치',   accent: 'text-amber-600',   bg: 'bg-amber-50/60',   border: 'border-amber-100' },
    { label: '기한초과',   value: stats.overdueCount,  unit: '건', sub: 'QC완료예정일 초과', accent: 'text-red-600',     bg: 'bg-red-50/60',     border: 'border-red-100' },
  ]

  const statRows = [
    { label: '대기중', key: 'pending' as const,    color: 'bg-slate-400' },
    { label: '진행중', key: 'inProgress' as const, color: 'bg-violet-500' },
    { label: '완료',   key: 'completed' as const,  color: 'bg-emerald-500' },
  ]

  return (
    <div className="flex flex-col gap-4 p-3 md:p-5 min-h-0">

      {/* ── KPI 카드 행 ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
        {KPI_CARDS.map(kpi => (
          <Card
            key={kpi.label}
            className={`cursor-pointer transition-all hover:-translate-y-0.5 hover:shadow-md ${kpi.bg} border ${kpi.border} shadow-none rounded-xl py-0`}
          >
            <CardContent className="px-3.5 py-3">
              <p className="text-[10px] font-medium text-slate-500 mb-0.5">{kpi.label}</p>
              <div className="flex items-baseline gap-0.5">
                <span className={`text-[22px] font-bold tabular-nums leading-none ${kpi.accent}`}>{kpi.value}</span>
                <span className="text-xs font-medium text-slate-400 ml-0.5">{kpi.unit}</span>
              </div>
              <p className="mt-1 text-[10px] text-slate-400 leading-none">{kpi.sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* ── Tableau 요약 ─────────────────────────────────────────────────── */}
      <Card className="border border-slate-200 shadow-none rounded-xl bg-white py-0">
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800">Tableau 인사이트</span>
            <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
              tableau?.configured
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-amber-200 bg-amber-50 text-amber-700'
            }`}>
              {tableau?.configured ? '연동됨' : '설정 필요'}
            </span>
          </div>
          {isTableauLoading && <span className="text-[10px] text-slate-400">Tableau 로딩 중...</span>}
        </div>
        <CardContent className="px-4 py-3">
          {tableauError ? (
            <p className="text-xs text-red-600">{tableauError}</p>
          ) : tableau && !tableau.configured ? (
            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium text-slate-700">Tableau 환경변수를 확인해 주세요.</p>
              <p className="text-[11px] text-slate-500">
                누락: {(tableau.missingEnv ?? []).join(', ')}
              </p>
            </div>
          ) : tableau ? (
            <div className="grid gap-3 lg:grid-cols-[220px_1fr]">
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2">
                  <p className="text-[10px] font-medium text-slate-500">워크북</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-slate-800">{tableau.workbooks.length}</p>
                </div>
                <div className="rounded-lg border border-slate-100 bg-slate-50/70 px-3 py-2">
                  <p className="text-[10px] font-medium text-slate-500">뷰</p>
                  <p className="mt-1 text-xl font-bold tabular-nums text-violet-600">{tableau.views.length}</p>
                </div>
              </div>
              <div className="min-w-0">
                <div className="mb-2 flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700">최근 Tableau 뷰</p>
                  <p className="text-[10px] text-slate-400">갱신 {formatDateTime(tableau.generatedAt)}</p>
                </div>
                <div className="grid gap-2 md:grid-cols-2">
                  {tableau.views.slice(0, 4).map(view => (
                    <div key={view.id} className="rounded-lg border border-slate-100 px-3 py-2">
                      <p className="truncate text-xs font-semibold text-slate-800">{view.name}</p>
                      <p className="mt-0.5 truncate text-[11px] text-slate-500">
                        {view.workbookName ?? '워크북 미확인'} · {view.projectName ?? '프로젝트 미확인'}
                      </p>
                      <p className="mt-1 text-[10px] text-slate-400">수정 {formatDateTime(view.updatedAt)}</p>
                    </div>
                  ))}
                  {tableau.views.length === 0 && (
                    <p className="text-xs text-slate-500">표시할 Tableau 뷰가 없습니다.</p>
                  )}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-500">Tableau 정보를 준비 중입니다.</p>
          )}
        </CardContent>
      </Card>

      {/* ── 중단: 기한임박 배치 + 상태 요약 ──────────────────────────── */}
      <div className="flex flex-col lg:flex-row gap-4 min-h-0">

        {/* 기한 임박 배치 테이블 (60%) */}
        <Card className="flex-[3] border border-slate-200 shadow-none rounded-xl bg-white overflow-hidden py-0">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-800">기한 임박 배치</span>
              <span className="inline-flex items-center rounded-full bg-amber-50 border border-amber-200 px-2 py-0.5 text-[10px] font-semibold text-amber-700">
                D-7 이내
              </span>
            </div>
            {usingDemo && (
              <span className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-700 border border-amber-200">
                데모 모드
              </span>
            )}
            {isLoading && <span className="text-[10px] text-slate-400">로딩 중...</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-100">
                  <th className="px-4 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">품목명</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">제조번호</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">QC완료예정일</th>
                  <th className="px-3 py-2 text-center text-[11px] font-semibold text-slate-500 uppercase tracking-wide">D-Day</th>
                  <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500 uppercase tracking-wide">상태</th>
                </tr>
              </thead>
              <tbody>
                {upcoming.slice(0, 10).map(row => {
                  const statusCfg = STATUS_CONFIG[row.status]
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors cursor-pointer"
                    >
                      <td className="px-4 py-2.5">
                        <span className="font-medium text-slate-800 text-xs">{row.product_name}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs text-slate-500">{row.batch_no}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs text-slate-600">{row.qc_completion_deadline}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`text-xs tabular-nums ${dDayColor(row.dDayQc)}`}>
                          {dDayLabel(row.dDayQc)}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusCfg.cls}`}>
                          {statusCfg.label}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>

        {/* 상태 요약 (40%) */}
        <Card className="flex-[2] border border-slate-200 shadow-none rounded-xl bg-white py-0">
          <div className="border-b border-slate-100 px-4 py-3">
            <span className="text-sm font-semibold text-slate-800">배치 상태 현황</span>
          </div>
          <CardContent className="px-4 py-4">
            <div className="mb-4 flex items-center gap-2">
              <span className="text-3xl font-bold text-slate-800 tabular-nums">{stats.totalBatches}</span>
              <span className="text-sm text-slate-500">건 총 배치</span>
            </div>
            <div className="flex flex-col gap-3">
              {statRows.map(row => {
                const count = stats[row.key]
                const pct = stats.totalBatches > 0 ? Math.round((count / stats.totalBatches) * 100) : 0
                return (
                  <div key={row.key}>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-medium text-slate-600">{row.label}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-slate-800 tabular-nums">{count}건</span>
                        <span className="text-[10px] text-slate-400 tabular-nums w-7 text-right">{pct}%</span>
                      </div>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${row.color}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── 오늘의 시험 일정 ──────────────────────────────────────────── */}
      <Card className="border border-slate-200 shadow-none rounded-xl bg-white py-0">
        <div className="border-b border-slate-100 px-4 py-3">
          <span className="text-sm font-semibold text-slate-800">오늘의 시험 배정 현황</span>
        </div>
        <CardContent className="px-4 py-3">
          <div className="flex flex-wrap items-center gap-4">
            {DEMO_TESTERS.map(tester => (
              <div
                key={tester.name}
                className="flex items-center gap-2.5 rounded-xl border border-slate-100 bg-slate-50/60 px-3.5 py-2.5 hover:bg-slate-100/60 transition-colors cursor-pointer"
              >
                <Avatar className="h-8 w-8 shrink-0">
                  <AvatarFallback className={`text-xs font-bold text-white ${tester.color}`}>
                    {tester.init}
                  </AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-xs font-semibold text-slate-800">{tester.name}</p>
                  <p className="text-[10px] text-slate-500">
                    오늘 <span className="font-bold text-slate-700">{tester.assignedToday}</span>건 배정
                  </p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

    </div>
  )
}
