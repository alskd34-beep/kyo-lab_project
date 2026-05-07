'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@frontend/components/ui/card'
import { Avatar, AvatarFallback } from '@frontend/components/ui/avatar'
import type { BatchStatus } from '@shared/pqm'

// ─── Types ────────────────────────────────────────────────────────────────────

interface KpiItem {
  label: string
  value: string
  unit: string
  sub: string
  accent: string
  bg: string
  border: string
}

interface UpcomingBatch {
  id: number
  productName: string
  batchNo: string
  qcDate: string
  dDay: number
  status: BatchStatus
}

interface DashboardStats {
  total: number
  planned: number
  inProgress: number
  completed: number
  onHold: number
}

interface Tester {
  name: string
  init: string
  color: string
  assignedToday: number
}

// ─── Demo Data ────────────────────────────────────────────────────────────────

const DEMO_UPCOMING: UpcomingBatch[] = [
  { id: 1, productName: '(사향)광동우황청심원현탁액(신)', batchNo: '26002', qcDate: '2026.04.24', dDay: -13, status: 'COMPLETED' },
  { id: 2, productName: '슬라임캡슐', batchNo: '26001', qcDate: '2026.04.27', dDay: -10, status: 'COMPLETED' },
  { id: 3, productName: '베니톨정', batchNo: '26023', qcDate: '2026.04.30', dDay: -7, status: 'IN_PROGRESS' },
  { id: 4, productName: '베니톨정', batchNo: '26024', qcDate: '2026.04.30', dDay: -7, status: 'IN_PROGRESS' },
  { id: 5, productName: '알도셉트정5mg', batchNo: '26001', qcDate: '2026.04.30', dDay: -7, status: 'IN_PROGRESS' },
  { id: 6, productName: '개풍경옥고', batchNo: '26005', qcDate: '2026.05.07', dDay: 0, status: 'PLANNED' },
  { id: 7, productName: '광동우황청심원', batchNo: '26010', qcDate: '2026.05.10', dDay: 3, status: 'PLANNED' },
]

const DEMO_STATS: DashboardStats = { total: 75, planned: 28, inProgress: 22, completed: 21, onHold: 4 }

const DEMO_KPI: KpiItem[] = [
  { label: '이번달 배치', value: '75', unit: '건', sub: '총 생산배치 수', accent: 'text-slate-800', bg: 'bg-white', border: 'border-slate-200' },
  { label: '진행중', value: '22', unit: '건', sub: 'QC 시험 진행', accent: 'text-violet-600', bg: 'bg-violet-50/60', border: 'border-violet-100' },
  { label: 'QC완료', value: '21', unit: '건', sub: '이번달 완료', accent: 'text-emerald-600', bg: 'bg-emerald-50/60', border: 'border-emerald-100' },
  { label: 'D-7 임박', value: '12', unit: '건', sub: '기한 임박 배치', accent: 'text-amber-600', bg: 'bg-amber-50/60', border: 'border-amber-100' },
  { label: '오늘 마감', value: '3', unit: '건', sub: 'QC완료예정일', accent: 'text-red-600', bg: 'bg-red-50/60', border: 'border-red-100' },
  { label: 'OOS건수', value: '2', unit: '건', sub: '기준일탈', accent: 'text-red-600', bg: 'bg-red-50/60', border: 'border-red-100' },
  { label: '평균처리일', value: '4.2', unit: '일', sub: '배치당 처리일', accent: 'text-blue-600', bg: 'bg-blue-50/60', border: 'border-blue-100' },
]

const DEMO_TESTERS: Tester[] = [
  { name: '김태훈', init: '김', color: 'bg-blue-500', assignedToday: 3 },
  { name: '박성호', init: '박', color: 'bg-violet-500', assignedToday: 2 },
  { name: '권택균', init: '권', color: 'bg-emerald-500', assignedToday: 1 },
  { name: '장재훈', init: '장', color: 'bg-amber-500', assignedToday: 4 },
  { name: '지건희', init: '지', color: 'bg-rose-500', assignedToday: 2 },
]

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<BatchStatus, { label: string; cls: string }> = {
  PLANNED:    { label: '예정', cls: 'bg-slate-100 text-slate-600' },
  IN_PROGRESS: { label: '진행중', cls: 'bg-violet-50 text-violet-700' },
  COMPLETED:  { label: '완료', cls: 'bg-emerald-50 text-emerald-700' },
  ON_HOLD:    { label: '보류', cls: 'bg-amber-50 text-amber-700' },
  CANCELLED:  { label: '취소', cls: 'bg-red-50 text-red-600' },
}

function dDayColor(dDay: number): string {
  if (dDay < 0) return 'text-slate-400'
  if (dDay === 0) return 'text-red-600 font-bold'
  if (dDay <= 3) return 'text-red-500 font-semibold'
  if (dDay <= 7) return 'text-amber-600 font-semibold'
  return 'text-emerald-600'
}

function dDayLabel(dDay: number): string {
  if (dDay < 0) return `D+${Math.abs(dDay)}`
  if (dDay === 0) return 'D-Day'
  return `D-${dDay}`
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HomePage() {
  const [kpis, setKpis]           = useState<KpiItem[]>(DEMO_KPI)
  const [upcoming, setUpcoming]   = useState<UpcomingBatch[]>(DEMO_UPCOMING)
  const [stats, setStats]         = useState<DashboardStats>(DEMO_STATS)
  const [usingDemo, setUsingDemo] = useState(true)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false
    setIsLoading(true)
    fetch('/api/dashboard')
      .then(async r => {
        if (!r.ok) throw new Error(await r.text())
        return r.json() as Promise<{ upcomingBatches: UpcomingBatch[]; stats: DashboardStats; kpis: KpiItem[] }>
      })
      .then(data => {
        if (cancelled) return
        setUpcoming(data.upcomingBatches ?? DEMO_UPCOMING)
        setStats(data.stats ?? DEMO_STATS)
        setKpis(data.kpis ?? DEMO_KPI)
        setUsingDemo(false)
      })
      .catch(() => {
        if (cancelled) return
        setUsingDemo(true)
      })
      .finally(() => { if (!cancelled) setIsLoading(false) })
    return () => { cancelled = true }
  }, [])

  const statRows = [
    { label: '예정', key: 'planned' as const, color: 'bg-slate-400' },
    { label: '진행중', key: 'inProgress' as const, color: 'bg-violet-500' },
    { label: '완료', key: 'completed' as const, color: 'bg-emerald-500' },
    { label: '보류', key: 'onHold' as const, color: 'bg-amber-500' },
  ]

  return (
    <div className="flex flex-col gap-4 p-5 min-h-0">

      {/* ── KPI 카드 행 ──────────────────────────────────────────────────── */}
      <div className="grid grid-cols-7 gap-2.5">
        {kpis.map(kpi => (
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
                        <span className="font-medium text-slate-800 text-xs">{row.productName}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs text-slate-500">{row.batchNo}</span>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="font-mono text-xs text-slate-600">{row.qcDate}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <span className={`text-xs tabular-nums ${dDayColor(row.dDay)}`}>
                          {dDayLabel(row.dDay)}
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
              <span className="text-3xl font-bold text-slate-800 tabular-nums">{stats.total}</span>
              <span className="text-sm text-slate-500">건 이번달 총 배치</span>
            </div>
            <div className="flex flex-col gap-3">
              {statRows.map(row => {
                const count = stats[row.key]
                const pct = stats.total > 0 ? Math.round((count / stats.total) * 100) : 0
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
