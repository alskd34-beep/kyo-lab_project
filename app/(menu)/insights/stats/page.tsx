"use client"

/**
 * 시험자 운영평가 — 완료 작업 실적 기반 KPI 대시보드.
 * 공수 준수율 / 평균 소요일 / 항목 평균 소요시간 / 처리량·난이도 가중 / 가동률.
 * 데이터: GET /api/insights/tester-evaluation?from&to (admin)
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Cell, Legend,
} from "recharts"
import { Loader2, Gauge, CalendarDays, CheckCircle2, Timer, RefreshCw } from "lucide-react"
import { Button } from "@frontend/components/ui/button"
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

// 준수율 색상 (90↑ 브랜드 파랑 / 70↑ 황색 / 그 외 적색 / 값 없음 회색)
// '양호'를 초록으로 두면 브랜드색 밖으로 나가면서 '완료'와도 뜻이 겹친다 — 정상은 파랑이다.
const rateColor = (r: number | null) =>
  r == null ? "#cbd5e1" : r >= 90 ? "#2563eb" : r >= 70 ? "#f59e0b" : "#ef4444"
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
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      {/* 헤더 — 머리말을 카드에 담지 않는다(아래로 카드가 다섯 개 더 이어진다).
          부제는 화면 이름을 되풀이하는 대신 집계 기준(근무일·기간)을 적는다. */}
      <header className="flex min-w-0 shrink-0 flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">운영평가</h1>
          <p className="mt-0.5 text-xs leading-normal break-keep text-muted-foreground">
            완료 작업 실적 기준
            {data && (
              <>
                <span className="px-1 text-border">·</span>
                <span className="tabular-nums">{data.period.from} ~ {data.period.to}</span>
                <span className="px-1 text-border">·</span>
                근무일 <span className="font-semibold tabular-nums text-foreground">{data.period.workingDays}</span>일
              </>
            )}
          </p>
        </div>
        {/* 모바일에서는 기간 입력이 한 줄을 차지하고 새로고침이 아래로 접힌다 */}
        <div className="flex w-full min-w-0 flex-wrap items-end gap-2 md:w-auto md:shrink-0 md:flex-nowrap">
          <div className="min-w-0 flex-1 md:flex-none">
            <DateRangeField
              label="조회기간"
              startDate={from}
              endDate={to}
              onChange={(s, e) => { setFrom(s); setTo(e) }}
            />
          </div>
          <Button variant="outline" className="h-9 shrink-0" onClick={() => void load()} disabled={loading}>
            {loading ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}
            새로고침
          </Button>
        </div>
      </header>

      {error && (
        <div className="shrink-0 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm font-medium break-keep text-destructive">{error}</div>
      )}

      {loading ? (
        <>
          {/* KPI 카드 skeleton */}
          <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="min-w-0 rounded-md border bg-card px-4 py-3">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-7 w-7 rounded-md" />
                  <Skeleton className="h-3.5 w-20" />
                </div>
                <Skeleton className="mt-2 h-8 w-16" />
              </div>
            ))}
          </div>

          {/* 차트 skeleton */}
          <div className="min-w-0 shrink-0 rounded-md border bg-card p-4">
            <Skeleton className="mb-3 h-4 w-48" />
            <Skeleton className="h-40 w-full" />
          </div>

          <div className="grid shrink-0 gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="min-w-0 rounded-md border bg-card p-4">
                <Skeleton className="mb-3 h-4 w-40" />
                <Skeleton className="h-40 w-full" />
              </div>
            ))}
          </div>

          {/* 테이블 skeleton */}
          <div className="min-w-0 shrink-0 overflow-hidden rounded-md border bg-card">
            <div className="border-b px-4 py-3">
              <Skeleton className="h-4 w-24" />
            </div>
            {/* 모바일 뼈대는 카드 목록 모양으로 — 실제 화면과 같은 자리에 놓는다 */}
            <div className="divide-y md:hidden">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex flex-col gap-2 px-4 py-3">
                  <div className="flex items-center justify-between">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-10" />
                  </div>
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ))}
            </div>
            <div className="hidden md:block">
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
                  <TableRow key={i} className="last:border-0">
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
          </div>
        </>
      ) : !hasData ? (
        /* 빈 상태에 테두리를 두르지 않는다 — 없는 것을 상자로 강조할 이유가 없다 */
        <div className="shrink-0 px-3 py-16 text-center">
          <p className="text-sm font-medium break-keep text-muted-foreground">완료된 작업이 없어 표시할 실적이 없습니다.</p>
          <p className="mt-1 text-xs leading-normal break-keep text-muted-foreground">시험자가 작업을 시작·완료하면 이 기간의 운영평가가 집계됩니다.</p>
        </div>
      ) : (
        <>
          {/* KPI 카드 */}
          <div className="grid shrink-0 grid-cols-2 gap-3 lg:grid-cols-4">
            <KpiCard icon={<CheckCircle2 size={16} />} label="전체 공수 준수율" value={fmtPct(totals!.adherenceRate)} />
            <KpiCard icon={<CalendarDays size={16} />} label="평균 소요일" value={fmtDay(totals!.avgActualDays)} />
            <KpiCard icon={<Gauge size={16} />} label="총 완료 작업" value={`${totals!.completedJobs}건`} />
            <KpiCard icon={<Timer size={16} />} label="평균 항목 소요시간" value={fmtMin(totals!.avgItemMinutes)} />
          </div>

          {/* 시험자별 공수 준수율 */}
          <ChartCard title="시험자별 공수 준수율 (%)" hint="지정 공수 이내에 끝낸 비율 · 90↑ 녹색 / 70↑ 황색 / 그 외 적색">
            <ResponsiveContainer width="100%" height={Math.max(160, data!.byTester.length * 38)}>
              <BarChart data={data!.byTester} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 15, fill: "#64748b" }} />
                <YAxis type="category" dataKey="name" width={84} tick={{ fontSize: 15, fill: "#334155" }} />
                <Tooltip formatter={(v) => [`${v}%`, "준수율"]} cursor={{ fill: "#f8fafc" }} />
                <Bar dataKey="adherenceRate" radius={[0, 4, 4, 0]} barSize={18}>
                  {data!.byTester.map((t) => <Cell key={t.testerId} fill={rateColor(t.adherenceRate)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="grid shrink-0 gap-4 lg:grid-cols-2">
            {/* 처리량 · 난이도 가중 */}
            <ChartCard title="시험자별 처리량 / 난이도 가중" hint="완료 건수와 난이도 가중(High3·Med2·Low1) 처리량">
              <ResponsiveContainer width="100%" height={Math.max(160, data!.byTester.length * 38)}>
                <BarChart data={data!.byTester} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
                  <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" tick={{ fontSize: 15, fill: "#64748b" }} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" width={84} tick={{ fontSize: 15, fill: "#334155" }} />
                  <Tooltip cursor={{ fill: "#f8fafc" }} />
                  {/* 어느 막대가 무엇인지 hover 없이도 읽히게 범례를 화면에 내놓는다 */}
                  <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
                  {/* 두 계열을 다른 색이 아니라 같은 파랑의 농도 차로 구분한다(보라는 브랜드 색이 아니다) */}
                  <Bar dataKey="completed" name="완료건" fill="#60a5fa" radius={[0, 3, 3, 0]} barSize={9} />
                  <Bar dataKey="weightedThroughput" name="가중처리량" fill="#1e40af" radius={[0, 3, 3, 0]} barSize={9} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>

            {/* 항목별 평균 소요시간 */}
            <ChartCard title="시험항목별 평균 소요시간 (분)" hint={data!.byItem.length === 0 ? "항목 소요시간 데이터 없음" : "qc_job_items.elapsed_minutes 평균"}>
              {data!.byItem.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">데이터 없음</p>
              ) : (
                <ResponsiveContainer width="100%" height={Math.max(160, data!.byItem.length * 34)}>
                  <BarChart data={data!.byItem.slice(0, 15)} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
                    <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                    <XAxis type="number" tick={{ fontSize: 15, fill: "#64748b" }} />
                    {/* 좁은 축에 긴 시험항목명이 들어오면 그림 밖으로 넘친다 — 잘라서 세운다 */}
                    <YAxis
                      type="category"
                      dataKey="testItemName"
                      width={110}
                      tick={{ fontSize: 15, fill: "#334155" }}
                      tickFormatter={(v: string) => (v.length > 7 ? `${v.slice(0, 7)}…` : v)}
                    />
                    <Tooltip formatter={(v, _n, p) => [`${v}분 (${(p?.payload as ItemRow)?.count}건)`, "평균"]} cursor={{ fill: "#f8fafc" }} />
                    <Bar dataKey="avgMinutes" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={16} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </ChartCard>
          </div>

          {/* 시험자별 상세 표 */}
          <div className="min-w-0 shrink-0 overflow-hidden rounded-md border bg-card">
            <div className="border-b px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">
                시험자별 상세
                <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{sortedData.length}명</span>
              </h2>
            </div>

            {/* ── 모바일: 표 대신 카드 목록 ──────────────────────────────────
                6칸짜리 표를 320px 에 우겨넣는 대신 이름·준수율을 위로 올리고
                나머지 수치는 잔글씨 한 줄로 내린다. */}
            <div className="divide-y md:hidden">
              {sortedData.map((t) => (
                <div key={t.testerId} className="px-4 py-3">
                  <div className="flex min-w-0 items-center justify-between gap-2">
                    <span className="flex min-w-0 flex-1 items-center gap-2">
                      <TesterAvatar testerId={t.testerId} name={t.name} size="sm" />
                      <span className="min-w-0 truncate text-sm font-medium text-foreground">{t.name}</span>
                    </span>
                    <span
                      className="shrink-0 text-sm font-semibold tabular-nums"
                      style={{ color: rateColor(t.adherenceRate) }}
                    >
                      {fmtPct(t.adherenceRate)}
                    </span>
                  </div>
                  <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-normal tabular-nums text-muted-foreground">
                    <span>완료 {t.completed}건</span>
                    <span className="text-border">·</span>
                    <span>평균 {fmtDay(t.avgActualDays)}</span>
                    <span className="text-border">·</span>
                    <span>가중 {t.weightedThroughput}</span>
                    <span className="ml-auto">가동률 {fmtPct(t.utilization)}</span>
                  </div>
                </div>
              ))}
            </div>

            {/* ── 데스크톱: 표 ───────────────────────────────────────────── */}
            <div className="hidden md:block">
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
                  <TableRow key={t.testerId} className="last:border-0 hover:bg-muted/40">
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
          </div>
        </>
      )}
    </div>
  )
}

/**
 * KPI 한 칸.
 * 지표마다 다른 색 아이콘 칩(초록·파랑·보라·앰버)을 두르던 것을 걷어냈다 —
 * 네 색이 아무 것도 구분하지 않아 색이 의미를 잃었고, 보라는 브랜드 색도 아니었다.
 * 위계는 숫자 크기가 만든다.
 */
function KpiCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border bg-card px-4 py-3">
      <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <span className="flex shrink-0 items-center">{icon}</span>
        <span className="min-w-0 truncate">{label}</span>
      </div>
      {/* 320px 2열 격자에서 "125분" 같은 값이 칸을 밀어내지 않게 모바일에서 한 단 줄인다 */}
      <p className="mt-1.5 min-w-0 truncate text-xl font-semibold tabular-nums text-foreground sm:text-2xl" title={value}>
        {value}
      </p>
    </div>
  )
}

function ChartCard({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 shrink-0 rounded-md border bg-card p-4">
      <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      {hint && <p className="mt-0.5 mb-3 text-xs leading-normal break-keep text-muted-foreground">{hint}</p>}
      {children}
    </div>
  )
}
