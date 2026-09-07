"use client"

/**
 * 운영 결과 리포트 — 시험업무 vs 부업무.
 *
 * 이 화면이 답하는 질문은 넷이다.
 *   1. 시험자가 시험 외 부업무를 얼마나 하는가        → KPI '부업무' 건수·시간
 *   2. 그게 얼마나 걸리는가                          → 분류별 소요 표·막대
 *   3. 시험업무와 부업무의 차이는 어느 정도인가       → 시험자별 나란한 막대 + 부업무 비중
 *   4. 시험은 무엇을 얼마나 진행했는가                → 시험항목별 건수·소요
 *
 * 단위는 **분**으로 통일한다(차트 축만 시간으로 환산). 공수(DAY)는 계획의 단위라
 * 여기 섞지 않는다 — 계획과 실적을 한 축에 놓으면 둘 다 못 읽는다.
 * 데이터: GET /api/insights/operation-report?from&to (admin)
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts"
import { ClipboardList, FlaskConical, Loader2, Percent, RefreshCw, Timer, Wrench } from "lucide-react"
import type { OperationReport } from "@shared/side-work"
import { cn } from "@frontend/lib/utils"
import { formatMinutes, minutesToHours } from "@frontend/lib/workload-format"
import { Button } from "@frontend/components/ui/button"
import { DateRangeField } from "@frontend/components/ui/date-range-field"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { TesterAvatar } from "@frontend/lib/tester-profiles"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import { KpiCard, SectionCard } from "@frontend/components/workload/workload-ui"

/**
 * 두 계열의 색 — 여기서 색은 장식이 아니라 뜻이다.
 * 시험업무는 브랜드 파랑(이 시스템의 본업), 부업무는 청록(본업이 아닌 것).
 * 둘을 같은 색조 농도로 나누면 막대에서 어느 쪽이 시험인지 매번 범례를 봐야 한다.
 */
const TEST_HEX = "#2563eb" // blue-600
const SIDE_HEX = "#0d9488" // teal-600

const TOP_N = 12

/** 비중이 높을수록 눈에 걸리게 — 색이 곧 경보다. 40% 넘게 부업무면 배정을 다시 봐야 한다. */
function ratioClass(ratio: number | null): string {
  if (ratio == null) return "text-muted-foreground"
  if (ratio >= 40) return "text-red-700 dark:text-red-400"
  if (ratio >= 25) return "text-amber-700 dark:text-amber-400"
  return "text-foreground"
}

const fmtPct = (v: number | null) => (v == null ? "—" : `${v}%`)

export default function OperationReportPage() {
  const [from, setFrom] = useState("")
  const [to, setTo] = useState("")
  const [data, setData] = useState<OperationReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 기본 조회기간 — 최근 90일(운영평가 화면과 같은 기준이라 두 화면을 나란히 읽을 수 있다)
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
      const r = await fetch(`/api/insights/operation-report?from=${from}&to=${to}`, { credentials: "include" })
      const json = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(json.error ?? "조회에 실패했습니다.")
        setData(null)
        return
      }
      setData(json as OperationReport)
    } catch {
      setError("조회에 실패했습니다.")
    } finally {
      setLoading(false)
    }
  }, [from, to])

  useEffect(() => { void load() }, [load])

  const totals = data?.totals
  const totalMinutes = (totals?.testMinutes ?? 0) + (totals?.sideMinutes ?? 0)
  const hasData = totalMinutes > 0

  // ── 차트 데이터 ────────────────────────────────────────────────────────────
  // 축은 '시간'으로 환산한다. 분 단위 막대는 4자리 숫자가 되어 눈금이 읽히지 않는다.
  const testerChart = useMemo(() => (data?.byTester ?? []).slice(0, TOP_N).map(r => ({
    name: r.name,
    시험업무: minutesToHours(r.testMinutes),
    부업무:   minutesToHours(r.sideMinutes),
  })), [data])

  const categoryChart = useMemo(() => (data?.byCategory ?? []).slice(0, TOP_N).map(c => ({
    name: c.categoryName,
    시간: minutesToHours(c.minutes),
  })), [data])

  // 아무 기록도 없는 날은 뺀다 — 90일 중 근무일만 남아야 막대 사이가 벌어지지 않는다.
  const dailyChart = useMemo(() => (data?.daily ?? [])
    .filter(d => d.testMinutes > 0 || d.sideMinutes > 0)
    .map(d => ({
      label: `${Number(d.date.slice(5, 7))}/${Number(d.date.slice(8, 10))}`,
      시험업무: minutesToHours(d.testMinutes),
      부업무:   minutesToHours(d.sideMinutes),
    })), [data])

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      {/* 헤더 — 부제는 화면 이름을 되풀이하지 않고 집계 기준을 적는다 */}
      <header className="flex min-w-0 shrink-0 flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-foreground">운영 결과 리포트</h1>
          <p className="mt-0.5 text-xs leading-normal break-keep text-muted-foreground">
            시험업무(시험항목 실소요) vs 부업무(직접 기록) 실적 비교
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
        <div className="flex w-full min-w-0 flex-wrap items-end gap-2 md:w-auto md:shrink-0 md:flex-nowrap">
          <div className="w-full min-w-0 sm:w-auto sm:flex-1 md:flex-none">
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
        <div className="shrink-0 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm font-medium break-keep text-destructive">
          {error}
        </div>
      )}

      {loading && !data ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20" />)}
        </div>
      ) : !data ? null : (
        <>
          {/* ── KPI ──────────────────────────────────────────────────────── */}
          <div className="grid shrink-0 grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <KpiCard
              label="시험업무"
              value={formatMinutes(totals?.testMinutes, "0분")}
              hint={`시험항목 ${totals?.testItems ?? 0}건`}
              icon={<FlaskConical size={15} />}
              accent="text-primary"
            />
            <KpiCard
              label="부업무"
              value={formatMinutes(totals?.sideMinutes, "0분")}
              hint={`기록 ${totals?.sideCount ?? 0}건`}
              icon={<Wrench size={15} />}
              accent="text-teal-600 dark:text-teal-400"
            />
            <KpiCard
              label="부업무 비중"
              value={fmtPct(totals?.sideRatio ?? null)}
              hint="전체 기록 시간 중"
              icon={<Percent size={15} />}
              accent={totals?.sideRatio != null && totals.sideRatio >= 25 ? "text-amber-600" : undefined}
            />
            <KpiCard
              label="완료 작업"
              value={`${totals?.completedJobs ?? 0}건`}
              hint="승인완료 기준"
              icon={<ClipboardList size={15} />}
            />
            <KpiCard
              label="집계 인원"
              value={`${totals?.testers ?? 0}명`}
              hint="기록이 있는 시험자"
              icon={<Timer size={15} />}
            />
          </div>

          {!hasData ? (
            <SectionCard className="shrink-0" title="집계 결과" hint="이 기간에 쌓인 실적이 없습니다.">
              <p className="py-10 text-center text-sm break-keep text-muted-foreground">
                조회 기간에 완료된 시험항목도, 기록된 부업무도 없습니다.
                <br />
                부업무는 <span className="font-medium text-foreground">스케줄 &gt; 월간 스케줄</span>에서
                시험자가 자기 칸을 눌러 남깁니다.
              </p>
            </SectionCard>
          ) : (
            <>
              {/* ── 시험자별 비교 ──────────────────────────────────────────
                  같은 축 위에 두 막대를 나란히 세운다. 쌓아 올리면(stacked)
                  총량은 보이지만 "둘의 차이"가 안 보이는데, 여기서 알고 싶은 것이 그 차이다. */}
              <SectionCard
                className="shrink-0"
                title="시험자별 시험업무 vs 부업무"
                hint={`상위 ${Math.min(TOP_N, data.byTester.length)}명 · 단위 시간`}
              >
                <div className="h-72 min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={testerChart} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="name" tick={{ fontSize: 12 }} interval={0} angle={-20} textAnchor="end" height={52} />
                      <YAxis tick={{ fontSize: 12 }} unit="h" />
                      <Tooltip
                        formatter={(v, n) => [`${v}시간`, n]}
                        contentStyle={{ fontSize: 12, borderRadius: 6 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="시험업무" fill={TEST_HEX} radius={[3, 3, 0, 0]} maxBarSize={44} />
                      <Bar dataKey="부업무"   fill={SIDE_HEX} radius={[3, 3, 0, 0]} maxBarSize={44} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              {/* ── 일자별 추이 ─────────────────────────────────────────────
                  부업무가 고르게 깔리는지, 특정 주에 몰리는지가 대응을 가른다 —
                  몰린다면 그 주의 시험 배정을 줄이는 것이 답이고, 고르게 깔린다면
                  1인당 가용 공수 자체를 낮춰 잡아야 한다. 쌓아 올려 그날의 총량도 함께 읽는다. */}
              <SectionCard className="shrink-0" title="일자별 추이" hint="완료 시각(시험) · 기록 날짜(부업무) 기준 · 단위 시간">
                <div className="h-56 min-w-0">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={dailyChart} margin={{ top: 4, right: 8, bottom: 4, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="label" tick={{ fontSize: 12 }} minTickGap={24} />
                      <YAxis tick={{ fontSize: 12 }} unit="h" />
                      <Tooltip
                        formatter={(v, n) => [`${v}시간`, n]}
                        contentStyle={{ fontSize: 12, borderRadius: 6 }}
                      />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="시험업무" stackId="d" fill={TEST_HEX} maxBarSize={32} />
                      <Bar dataKey="부업무"   stackId="d" fill={SIDE_HEX} maxBarSize={32} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </SectionCard>

              {/* ── 시험자별 표 ────────────────────────────────────────── */}
              <SectionCard
                className="shrink-0"
                title="시험자별 상세"
                hint="가동률은 (시험+부업무) ÷ 기간 근무시간. 100%를 넘으면 초과근무이거나 기록이 겹친 것이다"
              >
                {/* 모바일 — 핵심 3값만. 나머지는 데스크톱 표에서 본다 */}
                <div className="divide-y md:hidden">
                  {data.byTester.map(r => (
                    <div key={r.testerId} className="py-3 first:pt-0 last:pb-0">
                      <div className="flex min-w-0 items-center justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <TesterAvatar testerId={r.testerId} name={r.name} size="xs" />
                          <span className="min-w-0 truncate text-sm font-medium text-foreground">{r.name}</span>
                        </div>
                        <span className={cn("shrink-0 text-sm font-semibold tabular-nums", ratioClass(r.sideRatio))}>
                          부업무 {fmtPct(r.sideRatio)}
                        </span>
                      </div>
                      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 text-xs tabular-nums text-muted-foreground">
                        <span>시험 {formatMinutes(r.testMinutes, "0분")}</span>
                        <span className="text-border">·</span>
                        <span>부업무 {formatMinutes(r.sideMinutes, "0분")}</span>
                        <span className="text-border">·</span>
                        <span>항목 {r.testItems}건</span>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="hidden min-w-0 overflow-x-auto md:block">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="px-3 text-muted-foreground">시험자</TableHead>
                        <TableHead className="px-3 text-right text-muted-foreground">완료 작업</TableHead>
                        <TableHead className="px-3 text-right text-muted-foreground">시험항목</TableHead>
                        <TableHead className="px-3 text-right text-muted-foreground">시험업무</TableHead>
                        <TableHead className="px-3 text-right text-muted-foreground">부업무</TableHead>
                        <TableHead className="px-3 text-right text-muted-foreground">부업무 건수</TableHead>
                        <TableHead className="px-3 text-right text-muted-foreground">부업무 비중</TableHead>
                        <TableHead className="px-3 text-right text-muted-foreground">가동률</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.byTester.map(r => (
                        <TableRow key={r.testerId}>
                          <TableCell className="px-3">
                            <div className="flex min-w-0 items-center gap-1.5">
                              <TesterAvatar testerId={r.testerId} name={r.name} size="xs" />
                              <span className="min-w-0 truncate font-medium">{r.name}</span>
                            </div>
                          </TableCell>
                          <TableCell className="px-3 text-right tabular-nums">{r.completedJobs}</TableCell>
                          <TableCell className="px-3 text-right tabular-nums">{r.testItems}</TableCell>
                          <TableCell className="px-3 text-right tabular-nums">{formatMinutes(r.testMinutes, "0분")}</TableCell>
                          <TableCell className="px-3 text-right tabular-nums">{formatMinutes(r.sideMinutes, "0분")}</TableCell>
                          <TableCell className="px-3 text-right tabular-nums">{r.sideCount}</TableCell>
                          <TableCell className={cn("px-3 text-right font-semibold tabular-nums", ratioClass(r.sideRatio))}>
                            {fmtPct(r.sideRatio)}
                          </TableCell>
                          <TableCell className="px-3 text-right tabular-nums">{fmtPct(r.coverage)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </SectionCard>

              {/* ── 부업무 분류별 ──────────────────────────────────────── */}
              <SectionCard
                className="shrink-0"
                title="부업무 분류별 소요"
                hint={
                  data.byCategory.length === 0
                    ? "기록된 부업무가 없습니다"
                    : `${data.byCategory.length}개 분류 · 합계 ${formatMinutes(totals?.sideMinutes, "0분")}`
                }
              >
                {data.byCategory.length === 0 ? (
                  <p className="py-8 text-center text-sm break-keep text-muted-foreground">
                    이 기간에 기록된 부업무가 없습니다.
                  </p>
                ) : (
                  <div className="grid min-w-0 gap-4 lg:grid-cols-2">
                    <div className="h-64 min-w-0">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={categoryChart} layout="vertical" margin={{ top: 4, right: 12, bottom: 4, left: 8 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                          <XAxis type="number" tick={{ fontSize: 12 }} unit="h" />
                          <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={110} />
                          <Tooltip
                            formatter={v => [`${v}시간`, "소요"]}
                            contentStyle={{ fontSize: 12, borderRadius: 6 }}
                          />
                          <Bar dataKey="시간" fill={SIDE_HEX} radius={[0, 3, 3, 0]} maxBarSize={28} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>

                    <div className="min-w-0 overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="px-3 text-muted-foreground">분류</TableHead>
                            <TableHead className="px-3 text-right text-muted-foreground">건수</TableHead>
                            <TableHead className="px-3 text-right text-muted-foreground">소요</TableHead>
                            <TableHead className="px-3 text-right text-muted-foreground">비중</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {data.byCategory.map(c => (
                            <TableRow key={c.categoryId}>
                              <TableCell className="px-3 font-medium break-keep">{c.categoryName}</TableCell>
                              <TableCell className="px-3 text-right tabular-nums">{c.count}</TableCell>
                              <TableCell className="px-3 text-right tabular-nums">{formatMinutes(c.minutes, "0분")}</TableCell>
                              <TableCell className="px-3 text-right tabular-nums">{c.ratio}%</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}
              </SectionCard>

              {/* ── 시험 진행 항목 ─────────────────────────────────────────
                  운영 결과에는 "시험을 무엇을 얼마나 쳤는가"가 함께 있어야 한다.
                  시간만으로는 오래 걸리는 항목 하나가 여러 건을 이겨 버린다. */}
              <SectionCard
                className="shrink-0"
                title="시험 진행 항목"
                hint={`완료된 시험항목 ${totals?.testItems ?? 0}건 · 소요 많은 순`}
              >
                {data.byTestItem.length === 0 ? (
                  <p className="py-8 text-center text-sm break-keep text-muted-foreground">
                    이 기간에 완료된 시험항목이 없습니다.
                  </p>
                ) : (
                  <div className="min-w-0 overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="px-3 text-muted-foreground">시험항목</TableHead>
                          <TableHead className="px-3 text-right text-muted-foreground">진행 건수</TableHead>
                          <TableHead className="px-3 text-right text-muted-foreground">총 소요</TableHead>
                          <TableHead className="px-3 text-right text-muted-foreground">평균 소요</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.byTestItem.slice(0, 30).map(i => (
                          <TableRow key={i.testItemName}>
                            <TableCell className="px-3 font-medium break-keep">{i.testItemName}</TableCell>
                            <TableCell className="px-3 text-right tabular-nums">{i.count}</TableCell>
                            <TableCell className="px-3 text-right tabular-nums">{formatMinutes(i.minutes, "0분")}</TableCell>
                            <TableCell className="px-3 text-right tabular-nums">{formatMinutes(i.avgMinutes, "0분")}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    {data.byTestItem.length > 30 && (
                      <p className="mt-2 px-3 text-xs break-keep text-muted-foreground">
                        소요 상위 30개만 표시합니다 (전체 {data.byTestItem.length}개).
                      </p>
                    )}
                  </div>
                )}
              </SectionCard>
            </>
          )}
        </>
      )}
    </div>
  )
}
