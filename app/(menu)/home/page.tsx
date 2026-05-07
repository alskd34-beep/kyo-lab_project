'use client'

import { useState, useEffect } from 'react'
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

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HomePage() {
  const [upcoming, setUpcoming]   = useState<BatchSummary[]>(DEMO_UPCOMING)
  const [stats, setStats]         = useState<DashboardStats>(DEMO_STATS)
  const [usingDemo, setUsingDemo] = useState(true)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)

    Promise.all([
      fetch('/api/dashboard').then(async r => {
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<DashboardStats>
      }),
      fetch('/api/batches?limit=10').then(async r => {
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<{ rows: BatchSummary[] }>
      }),
    ])
      .then(([statsData, batchData]) => {
        if (cancelled) return
        setStats(statsData)
        setUpcoming(batchData.rows.length > 0 ? batchData.rows : DEMO_UPCOMING)
        setUsingDemo(false)
      })
      .catch(() => {
        if (cancelled) return
        setUsingDemo(true)
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })

    return () => { cancelled = true }
  }, [])

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
    <div className="flex flex-col gap-4 p-5 min-h-0">

      {/* ── KPI 카드 행 ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-6 gap-2.5">
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

      {/* ── 중단: 기한임박 배치 + 상태 요약 ──────────────────────────── */}
      <div className="flex gap-4 min-h-0">

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
          <div className="overflow-auto">
            <table className="w-full text-sm">
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
          <div className="flex items-center gap-4">
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
