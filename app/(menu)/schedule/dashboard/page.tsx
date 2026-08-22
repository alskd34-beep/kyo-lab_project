"use client"

import { useCallback, useEffect, useState } from "react"
import {
  RefreshCw, Loader2, LayoutDashboard, ClipboardList, PlayCircle,
  CheckCircle2, AlertTriangle, UserMinus, Pill, Sparkles, Repeat,
  CalendarDays, Layers,
} from "lucide-react"
import { Skeleton } from "@frontend/components/ui/skeleton"

// ─── Types ──────────────────────────────────────────────────────────────────
interface QcDashboard {
  counts: { total: number; inProgress: number; completed: number; delayed: number; unassigned: number }
  psychotropic: number
  newProducts: number
  reassignTotal: number
  byTesterDays: { testerId: string; name: string; days: number }[]
  byTesterDifficulty: { testerId: string; name: string; high: number; medium: number; low: number }[]
}

interface KpiDef {
  key: string
  label: string
  value: number
  icon: React.ComponentType<{ size?: number; className?: string }>
  tone: string  // icon/badge color classes
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function QcDashboardPage() {
  const [data, setData] = useState<QcDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const res = await fetch("/api/qc-dashboard", { credentials: "include" })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error ?? "불러오기 실패")
      setData(body as QcDashboard)
    } catch (e) {
      setErr(e instanceof Error ? e.message : "불러오지 못했습니다.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const kpis: KpiDef[] = data ? [
    { key: "total",        label: "전체 오더",   value: data.counts.total,      icon: ClipboardList, tone: "text-slate-600 bg-slate-100" },
    { key: "inProgress",   label: "진행중",      value: data.counts.inProgress, icon: PlayCircle,    tone: "text-blue-700 bg-blue-50" },
    { key: "completed",    label: "완료",        value: data.counts.completed,  icon: CheckCircle2,  tone: "text-emerald-700 bg-emerald-50" },
    { key: "delayed",      label: "지연",        value: data.counts.delayed,    icon: AlertTriangle, tone: "text-red-700 bg-red-50" },
    { key: "unassigned",   label: "미배정",      value: data.counts.unassigned, icon: UserMinus,     tone: "text-amber-700 bg-amber-50" },
    { key: "psychotropic", label: "향정신성",    value: data.psychotropic,      icon: Pill,          tone: "text-rose-700 bg-rose-50" },
    { key: "newProducts",  label: "신규 품목",   value: data.newProducts,       icon: Sparkles,      tone: "text-blue-700 bg-blue-50" },
    { key: "reassign",     label: "재배정",      value: data.reassignTotal,     icon: Repeat,        tone: "text-teal-700 bg-teal-50" },
  ] : []

  const maxDays = data && data.byTesterDays.length > 0
    ? Math.max(...data.byTesterDays.map(d => d.days), 1)
    : 1

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 md:p-5">
      {/* 헤더 */}
      <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm md:flex-row md:items-center md:justify-between md:py-4">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-md bg-blue-600 text-white">
            <LayoutDashboard size={18} />
          </span>
          <div>
            <h1 className="text-base font-bold text-slate-900 sm:text-lg">QC 관리자 대시보드</h1>
            <p className="mt-0.5 text-xs font-medium text-slate-600">오더 현황과 시험자별 업무 부하를 한눈에 확인합니다.</p>
          </div>
        </div>
        <button
          onClick={() => void load()} disabled={loading}
          className="inline-flex h-9 items-center gap-1.5 self-start rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
          새로고침
        </button>
      </div>

      {err && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{err}</div>
      )}

      {loading && !data ? (
        <>
          {/* KPI skeleton */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
                <Skeleton className="h-10 w-10 shrink-0 rounded-md" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-6 w-12" />
                </div>
              </div>
            ))}
          </div>
          {/* 차트 skeleton */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <section key={i} className="rounded-md border border-slate-200 bg-white shadow-sm">
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                  <Skeleton className="h-4 w-4" />
                  <Skeleton className="h-4 w-32" />
                </div>
                <div className="flex flex-col gap-3 px-4 py-4">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <div key={j} className="flex items-center gap-3">
                      <Skeleton className="h-4 w-20 shrink-0" />
                      <Skeleton className="h-2.5 flex-1 rounded-md" />
                      <Skeleton className="h-4 w-14 shrink-0" />
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      ) : !data ? null : (
        <>
          {/* KPI 카드 그리드 */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {kpis.map(k => {
              const Icon = k.icon
              return (
                <div key={k.key} className="flex items-center gap-3 rounded-md border border-slate-200 bg-white px-4 py-3.5 shadow-sm">
                  <span className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md ${k.tone}`}>
                    <Icon size={18} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-slate-500">{k.label}</p>
                    <p className="text-xl font-bold text-slate-900">{k.value.toLocaleString()}</p>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* 시험자별 보유 DAY */}
            <section className="rounded-md border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                <CalendarDays size={16} className="text-blue-600" />
                <h2 className="text-sm font-bold text-slate-900">시험자별 보유 DAY</h2>
                <span className="ml-auto text-[11px] font-medium text-slate-400">미완료 배정 공수 합 · 근사치</span>
              </div>
              <div className="flex flex-col gap-2.5 px-4 py-4">
                {data.byTesterDays.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">배정된 미완료 오더가 없습니다.</p>
                ) : data.byTesterDays.map(t => (
                  <div key={t.testerId} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 truncate text-sm font-medium text-slate-700">{t.name}</span>
                    <div className="h-2.5 flex-1 overflow-hidden rounded-md bg-slate-100">
                      <div
                        className="h-full rounded-md bg-blue-600"
                        style={{ width: `${Math.max((t.days / maxDays) * 100, 4)}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-sm font-semibold text-slate-800">{t.days} day</span>
                  </div>
                ))}
              </div>
            </section>

            {/* 시험자별 난이도 분포 */}
            <section className="rounded-md border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                <Layers size={16} className="text-blue-600" />
                <h2 className="text-sm font-bold text-slate-900">시험자별 난이도 분포</h2>
                <span className="ml-auto text-[11px] font-medium text-slate-400">미완료 배정 기준</span>
              </div>
              <div className="flex flex-col gap-2 px-4 py-4">
                <div className="flex items-center gap-3 px-1 text-[11px] font-semibold text-slate-400">
                  <span className="w-20 shrink-0">시험자</span>
                  <span className="flex-1" />
                  <span className="w-10 text-center text-red-600">HIGH</span>
                  <span className="w-10 text-center text-amber-600">MED</span>
                  <span className="w-10 text-center text-emerald-600">LOW</span>
                </div>
                {data.byTesterDifficulty.length === 0 ? (
                  <p className="py-6 text-center text-sm text-slate-400">배정된 미완료 오더가 없습니다.</p>
                ) : data.byTesterDifficulty.map(t => {
                  const sum = t.high + t.medium + t.low
                  return (
                    <div key={t.testerId} className="flex items-center gap-3">
                      <span className="w-20 shrink-0 truncate text-sm font-medium text-slate-700">{t.name}</span>
                      <div className="flex h-2.5 flex-1 overflow-hidden rounded-md bg-slate-100">
                        {sum > 0 && (
                          <>
                            <div className="h-full bg-red-500" style={{ width: `${(t.high / sum) * 100}%` }} />
                            <div className="h-full bg-amber-400" style={{ width: `${(t.medium / sum) * 100}%` }} />
                            <div className="h-full bg-emerald-500" style={{ width: `${(t.low / sum) * 100}%` }} />
                          </>
                        )}
                      </div>
                      <span className="w-10 text-center text-sm font-semibold text-red-600">{t.high}</span>
                      <span className="w-10 text-center text-sm font-semibold text-amber-600">{t.medium}</span>
                      <span className="w-10 text-center text-sm font-semibold text-emerald-600">{t.low}</span>
                    </div>
                  )
                })}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}
