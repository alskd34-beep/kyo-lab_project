"use client"

/**
 * 시험자 운영평가 — 완료 작업 실적 기반 KPI 대시보드.
 * 공수 준수율 / 평균 소요일 / 항목 평균 소요시간 / 처리량·난이도 가중 / 가동률.
 * 데이터: GET /api/insights/tester-evaluation?from&to (admin)
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell,
} from "recharts"
import { Loader2, Gauge, CalendarDays, CheckCircle2, Timer, RefreshCw } from "lucide-react"
import { DateRangeField } from "@frontend/components/ui/date-range-field"
import { SortColumnHeader, sortCol, type SortDir } from "@frontend/components/ui/table-sort"
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@frontend/components/ui/table"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { TesterAvatar } from "@frontend/lib/tester-profiles"

interface TesterRow {
  testerId: string; name: string; completed: number
  adherenceRate: number | null; avgActualDays: number | null
  weightedThroughput: number; utilization: number | null
}
interface ItemRow { testItemName: string; count: number; avgMinutes: number }
interface EvalData {
  period: { from: string; to: string; workingDays: number }
  totals: { completedJobs: number; adherenceRate: number | null; avgActualDays: number | null; avgItemMinutes: number | null }
  byTester: TesterRow[]
  byItem: ItemRow[]
}

// 준수율 색상 (90↑ 녹색 / 70↑ 황색 / 그 외 적색)
const rateColor = (r: number | null) =>
  r == null ? "#cbd5e1" : r >= 90 ? "#10b981" : r >= 70 ? "#f59e0b" : "#ef4444"
const fmtPct = (v: number | null) => (v == null ? "—" : `${v}%`)
const fmtDay = (v: number | null) => (v == null ? "—" : `${v}일`)
const fmtMin = (v: number | null) => (v == null ? "—" : `${v}분`)

type SortField = keyof Pick<TesterRow, "name" | "completed" | "adherenceRate" | "avgActualDays" | "weightedThroughput" | "utilization">

const SORT_COLUMNS: { col: ReturnType<typeof sortCol<SortField>>; numeric: boolean }[] = [
  { col: sortCol("name", "시험자"), numeric: false },
  { col: sortCol("completed", "완료건"), numeric: true },
  { col: sortCol("adherenceRate", "공수 준수율"), numeric: true },
  { col: sortCol("avgActualDays", "평균 소요일"), numeric: true },
  { col: sortCol("weightedThroughput", "가중 처리량"), numeric: true },
  { col: sortCol("utilization", "가동률"), numeric: true },
]

export default function TesterEvaluationPage() {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [data, setData] = useState<EvalData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [sortField, setSortField] = useState<SortField>("name")
  const [sortDir, setSortDir] = useState<SortDir>("asc")

  const pickSort = (field: SortField, dir: SortDir) => {
    setSortField(field)
    setSortDir(dir)
  }

  const sortedData = useMemo(() => {
    if (!data) return []
    return [...data.byTester].sort((a, b) => {
      const av = a[sortField]; const bv = b[sortField]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      const cmp = typeof av === "string" && typeof bv === "string"
        ? av.localeCompare(bv, "ko")
        : (av as number) - (bv as number)
      return sortDir === "asc" ? cmp : -cmp
    })
  }, [data, sortField, sortDir])

  // 마운트 시 기본 기간(최근 90일)
  useEffect(() => {
    const t = new Date()
    const f = new Date()
    f.setDate(f.getDate() - 90)
    setTo(t.toISOString().slice(0, 10))
    setFrom(f.toISOString().slice(0, 10))
  }, [])

  const load = useCallback(async () => {
    if (!from || !to) return
    setLoading(true)
    setError(null)
    try {
      const r = await fetch(`/api/insights/tester-evaluation?from=${from}&to=${to}`, { credentials: "include" })
      if (!r.ok) {
        setError((await r.json().catch(() => ({}))).error ?? "조회 실패")
        setData(null)
        return
      }
      setData(await r.json())
    } catch {
      setError("조회 실패")
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { void load() }, [load])

  const totals = data?.totals
  const hasData = !!data && data.totals.completedJobs > 0

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3 md:p-5">
      {/* 헤더 */}
      <div className="flex flex-col gap-3 rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm md:flex-row md:items-end md:justify-between md:py-4">
        <div>
          <h1 className="text-base font-bold text-slate-900 sm:text-lg">운영평가</h1>
          <p className="mt-1 text-xs font-medium text-slate-600">
            완료된 작업의 실적으로 공수 준수율·소요일·처리량·가동률을 집계합니다.
            {data && <span className="ml-2 text-slate-400">기간 근무일 {data.period.workingDays}일</span>}
          </p>
        </div>
        <div className="flex items-end gap-2">
          <DateRangeField
            label="기간 (종료일 기준)"
            startDate={from}
            endDate={to}
            onChange={(s, e) => { setFrom(s); setTo(e) }}
          />
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-100 disabled:opacity-50"
          >
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            새로고침
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</div>
      )}

      {loading ? (
        <>
          {/* KPI 카드 skeleton */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-7 w-7 rounded-md" />
                  <Skeleton className="h-3.5 w-20" />
                </div>
                <Skeleton className="mt-2 h-8 w-16" />
              </div>
            ))}
          </div>

          {/* 차트 skeleton */}
          <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
            <Skeleton className="h-4 w-48 mb-3" />
            <Skeleton className="h-40 w-full" />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
                <Skeleton className="h-4 w-40 mb-3" />
                <Skeleton className="h-40 w-full" />
              </div>
            ))}
          </div>

          {/* 테이블 skeleton */}
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm gap-0 py-0">
            <div className="border-b border-slate-100 px-4 py-3">
              <Skeleton className="h-4 w-24" />
            </div>
            <Table className="text-sm">
              <colgroup>
                <col className="w-[22%]" />
                <col className="w-[13%]" />
                <col className="w-[17%]" />
                <col className="w-[16%]" />
                <col className="w-[16%]" />
                <col className="w-[16%]" />
              </colgroup>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="px-3 text-muted-foreground">시험자</TableHead>
                  <TableHead className="px-3 text-right text-muted-foreground">완료건</TableHead>
                  <TableHead className="px-3 text-right text-muted-foreground">공수 준수율</TableHead>
                  <TableHead className="px-3 text-right text-muted-foreground">평균 소요일</TableHead>
                  <TableHead className="px-3 text-right text-muted-foreground">가중 처리량</TableHead>
                  <TableHead className="px-3 text-right text-muted-foreground">가동률</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Array.from({ length: 6 }).map((_, i) => (
                  <TableRow key={i} className="border-b border-slate-100 last:border-0">
                    <TableCell className="px-3 py-2.5"><Skeleton className="h-4 w-20" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="ml-auto h-4 w-8" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="ml-auto h-4 w-12" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="ml-auto h-4 w-10" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="ml-auto h-4 w-10" /></TableCell>
                    <TableCell className="px-3 py-2.5"><Skeleton className="ml-auto h-4 w-12" /></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : !hasData ? (
        <div className="rounded-md border border-slate-200 bg-white px-3 py-16 text-center shadow-sm">
          <p className="text-sm font-medium text-slate-500">완료된 작업이 없어 표시할 실적이 없습니다.</p>
          <p className="mt-1 text-xs text-slate-400">시험자가 작업을 시작·완료하면 이 기간의 운영평가가 집계됩니다.</p>
        </div>
      ) : (
        <>
          {/* KPI 카드 */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard icon={<CheckCircle2 size={16} />} label="전체 공수 준수율" value={fmtPct(totals!.adherenceRate)} tint="emerald" />
            <KpiCard icon={<CalendarDays size={16} />} label="평균 소요일" value={fmtDay(totals!.avgActualDays)} tint="blue" />
            <KpiCard icon={<Gauge size={16} />} label="총 완료 작업" value={`${totals!.completedJobs}건`} tint="violet" />
            <KpiCard icon={<Timer size={16} />} label="평균 항목 소요시간" value={fmtMin(totals!.avgItemMinutes)} tint="amber" />
          </div>

          {/* 시험자별 공수 준수율 */}
          <ChartCard title="시험자별 공수 준수율 (%)" hint="지정 공수 이내에 끝낸 비율 · 90↑ 녹색 / 70↑ 황색 / 그 외 적색">
            <ResponsiveContainer width="100%" height={Math.max(160, data!.byTester.length * 38)}>
              <BarChart data={data!.byTester} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 11, fill: "#64748b" }} />
                <YAxis type="category" dataKey="name" width={84} tick={{ fontSize: 11, fill: "#334155" }} />
                <Tooltip formatter={(v) => [`${v}%`, "준수율"]} cursor={{ fill: "#f8fafc" }} />
                <Bar dataKey="adherenceRate" radius={[0, 4, 4, 0]} barSize={18}>
                  {data!.byTester.map((t) => <Cell key={t.testerId} fill={rateColor(t.adherenceRate)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid gap-4 lg:grid-cols-2">
            {/* 처리량 · 난이도 가중 */}
            <ChartCard title="시험자별 처리량 / 난이도 가중" hint="완료 건수와 난이도 가중(High3·Med2·Low1) 처리량">
              <ResponsiveContainer width="100%" height={Math.max(160, data!.byTester.length * 38)}>
                <BarChart data={data!.byTester} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={84} tick={{ fontSize: 11, fill: "#334155" }} />
                  <Tooltip cursor={{ fill: "#f8fafc" }} />
                  <Bar dataKey="completed" name="완료건" fill="#3b82f6" radius={[0, 3, 3, 0]} barSize={9} />
                  <Bar dataKey="weightedThroughput" name="가중처리량" fill="#a78bfa" radius={[0, 3, 3, 0]} barSize={9} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* 항목별 평균 소요시간 */}
            <ChartCard title="시험항목별 평균 소요시간 (분)" hint={data!.byItem.length === 0 ? "항목 소요시간 데이터 없음" : "qc_job_items.elapsed_minutes 평균"}>
              {data!.byItem.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">데이터 없음</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(160, data!.byItem.length * 34)}>
                  <BarChart data={data!.byItem.slice(0, 15)} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                    <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#64748b" }} />
                    <YAxis type="category" dataKey="testItemName" width={110} tick={{ fontSize: 10, fill: "#334155" }} />
                    <Tooltip formatter={(v, _n, p) => [`${v}분 (${(p?.payload as ItemRow)?.count}건)`, "평균"]} cursor={{ fill: "#f8fafc" }} />
                    <Bar dataKey="avgMinutes" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {/* 시험자별 상세 표 */}
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm gap-0 py-0">
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-sm font-bold text-slate-800">시험자별 상세</h2>
            </div>
            <Table className="text-sm">
              <colgroup>
                <col className="w-[22%]" />
                <col className="w-[13%]" />
                <col className="w-[17%]" />
                <col className="w-[16%]" />
                <col className="w-[16%]" />
                <col className="w-[16%]" />
              </colgroup>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  {SORT_COLUMNS.map(({ col, numeric }) => (
                    <TableHead
                      key={col.key}
                      className={numeric ? "px-3 text-right text-muted-foreground" : "px-3 text-muted-foreground"}
                    >
                      <div className={numeric ? "flex justify-end" : undefined}>
                        <SortColumnHeader
                          col={col}
                          sortField={sortField}
                          sortDir={sortDir}
                          onPick={pickSort}
                        />
                      </div>
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedData.map((t) => (
                  <TableRow key={t.testerId} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                    <TableCell className="px-3 py-2.5 font-medium text-foreground">
                      <div className="flex min-w-0 items-center gap-2">
                        <TesterAvatar testerId={t.testerId} name={t.name} size="sm" />
                        <span className="block truncate" title={t.name}>{t.name}</span>
                      </div>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-right tabular-nums">{t.completed}</TableCell>
                    <TableCell className="px-3 py-2.5 text-right tabular-nums">
                      <span className="font-semibold" style={{ color: rateColor(t.adherenceRate) }}>{fmtPct(t.adherenceRate)}</span>
                    </TableCell>
                    <TableCell className="px-3 py-2.5 text-right tabular-nums">{fmtDay(t.avgActualDays)}</TableCell>
                    <TableCell className="px-3 py-2.5 text-right tabular-nums">{t.weightedThroughput}</TableCell>
                    <TableCell className="px-3 py-2.5 text-right tabular-nums">{fmtPct(t.utilization)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </div>
  )
}

function KpiCard({ icon, label, value, tint }: { icon: React.ReactNode; label: string; value: string; tint: "emerald" | "blue" | "violet" | "amber" }) {
  const tints: Record<string, string> = {
    emerald: "bg-emerald-50 text-emerald-600",
    blue:    "bg-blue-50 text-blue-600",
    violet:  "bg-violet-50 text-violet-600",
    amber:   "bg-amber-50 text-amber-600",
  }
  return (
    <div className="rounded-md border border-slate-200 bg-white px-4 py-3 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`inline-flex h-7 w-7 items-center justify-center rounded-md ${tints[tint]}`}>{icon}</span>
        <span className="text-xs font-medium text-slate-500">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  )
}

function ChartCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-sm font-bold text-slate-800">{title}</h2>
      {hint && <p className="mt-0.5 mb-3 text-[11px] text-slate-400">{hint}</p>}
      {children}
    </div>
  )
}
