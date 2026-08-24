"use client"

import { useCallback, useEffect, useState } from "react"
import { RefreshCw, Loader2 } from "lucide-react"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { cn } from "@frontend/lib/utils"

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
  /** 숫자에 입힐 잉크 색. 색이 곧 뜻인 칸(지연·미배정)에만 준다. */
  tone?: string
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

  /* 여덟 칸에 여덟 가지 아이콘 칩 색(slate·blue·red·amber·rose·teal)을 돌려 쓰던 자리다.
     색이 서로 다른 이유가 없어 뜻을 잃었다. 아이콘 칩을 걷어내고 숫자 크기로 읽히게 하고,
     색은 조치가 필요한 칸(지연·미배정)에만 남긴다. */
  const kpis: KpiDef[] = data ? [
    { key: "total",        label: "전체 오더", value: data.counts.total },
    { key: "inProgress",   label: "진행중",    value: data.counts.inProgress },
    { key: "completed",    label: "완료",      value: data.counts.completed },
    { key: "delayed",      label: "지연",      value: data.counts.delayed,    tone: data.counts.delayed > 0 ? "text-destructive" : undefined },
    { key: "unassigned",   label: "미배정",    value: data.counts.unassigned, tone: data.counts.unassigned > 0 ? "text-amber-700 dark:text-amber-400" : undefined },
    { key: "psychotropic", label: "향정신성",  value: data.psychotropic },
    { key: "newProducts",  label: "신규 품목", value: data.newProducts },
    { key: "reassign",     label: "재배정",    value: data.reassignTotal },
  ] : []

  const maxDays = data && data.byTesterDays.length > 0
    ? Math.max(...data.byTesterDays.map(d => d.days), 1)
    : 1

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:gap-5 md:p-6">
      {/* ── 페이지 머리 ────────────────────────────────────────────────────
          "…을 한눈에 확인합니다" 부제는 화면 이름을 되풀이할 뿐이라 지웠다.
          제목을 카드로 감싸던 것도 걷어내 아래 카드들과 층이 겹치지 않게 한다. */}
      <header className="flex min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <h1 className="text-lg font-semibold text-foreground">QC 관리자 대시보드</h1>
        <Button variant="outline" size="lg" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 className="animate-spin" /> : <RefreshCw />}
          새로고침
        </Button>
      </header>

      {err && (
        <p className="shrink-0 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs break-keep text-destructive">{err}</p>
      )}

      {loading && !data ? (
        <>
          {/* KPI skeleton — 여덟 칸을 카드 한 장 안에서 실선으로 나눈다 */}
          <Card className="shrink-0 gap-0 py-0">
            {/* gap-px + bg-border: divide-* 는 그리드가 줄바꿈되면 칸 위치와 선이 어긋난다 */}
            <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="flex min-w-0 flex-col gap-2 bg-card px-4 py-3.5">
                  <Skeleton className="h-3 w-16" />
                  <Skeleton className="h-7 w-12" />
                </div>
              ))}
            </div>
          </Card>
          {/* 차트 skeleton */}
          <div className="grid min-w-0 shrink-0 grid-cols-1 gap-4 lg:grid-cols-2">
            {Array.from({ length: 2 }).map((_, i) => (
              <Card key={i} className="gap-0 py-0">
                <div className="border-b px-4 py-3">
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
              </Card>
            ))}
          </div>
        </>
      ) : !data ? null : (
        <>
          {/* KPI — 여덟 장의 카드 대신 카드 한 장을 실선으로 나눈다(테두리 층은 하나만) */}
          <Card className="shrink-0 gap-0 py-0">
            <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
              {kpis.map(k => (
                <div key={k.key} className="flex min-w-0 flex-col bg-card px-4 py-3.5">
                  <span className="truncate text-xs font-medium text-muted-foreground">{k.label}</span>
                  <span className={cn("mt-0.5 text-2xl font-semibold tabular-nums", k.tone ?? "text-foreground")}>
                    {k.value.toLocaleString("ko-KR")}
                  </span>
                </div>
              ))}
            </div>
          </Card>

          <div className="grid min-w-0 shrink-0 grid-cols-1 gap-4 lg:grid-cols-2">
            {/* 시험자별 보유 DAY */}
            <Card className="min-w-0 gap-0 py-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">시험자별 보유 DAY</h2>
                <p className="text-xs leading-normal break-keep text-muted-foreground">미완료 배정 공수 합 · 근사치</p>
              </div>
              <div className="flex flex-col gap-2.5 px-4 py-4">
                {data.byTesterDays.length === 0 ? (
                  <p className="py-6 text-center text-sm break-keep text-muted-foreground">배정된 미완료 오더가 없습니다.</p>
                ) : data.byTesterDays.map(t => (
                  /* 이름 칸을 좁은 폭에서 한 단계 줄인다 — 320px 에서 w-20 이면 막대가 남지 않는다 */
                  <div key={t.testerId} className="flex min-w-0 items-center gap-2 sm:gap-3">
                    <span className="w-16 shrink-0 truncate text-sm font-medium text-foreground sm:w-20">{t.name}</span>
                    <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-md bg-muted">
                      <div
                        className="h-full rounded-md bg-primary"
                        style={{ width: `${Math.max((t.days / maxDays) * 100, 4)}%` }}
                      />
                    </div>
                    <span className="w-14 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
                      <span className="font-semibold text-foreground">{t.days}</span> day
                    </span>
                  </div>
                ))}
              </div>
            </Card>

            {/* 시험자별 난이도 분포 */}
            <Card className="min-w-0 gap-0 py-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b px-4 py-3">
                <h2 className="text-sm font-semibold text-foreground">시험자별 난이도 분포</h2>
                <p className="text-xs leading-normal break-keep text-muted-foreground">미완료 배정 기준</p>
              </div>
              <div className="flex flex-col gap-2 px-4 py-4">
                {/* 320px 에선 이름 + 막대 + 숫자 3칸이 한 줄에 들어가지 않는다.
                    글자를 줄여 우겨넣는 대신 막대를 뺀다 — 막대는 옆의 세 숫자를 다시 그린 것뿐이라
                    빠져도 잃는 정보가 없다(sm 이상에서만 보인다). */}
                <div className="flex min-w-0 items-center gap-2 px-1 text-xs leading-normal font-medium text-muted-foreground sm:gap-3">
                  <span className="min-w-0 flex-1 truncate sm:w-20 sm:flex-none">시험자</span>
                  <span className="hidden min-w-0 flex-1 sm:block" />
                  <span className="w-10 shrink-0 text-center text-red-600 dark:text-red-400">HIGH</span>
                  <span className="w-10 shrink-0 text-center text-amber-700 dark:text-amber-400">MED</span>
                  {/* 난이도는 한 줄 눈금이다 — LOW 는 '괜찮다(초록)'가 아니라 눈금의 아래쪽이라 브랜드 파랑 */}
                  <span className="w-10 shrink-0 text-center text-blue-600 dark:text-blue-400">LOW</span>
                </div>
                {data.byTesterDifficulty.length === 0 ? (
                  <p className="py-6 text-center text-sm break-keep text-muted-foreground">배정된 미완료 오더가 없습니다.</p>
                ) : data.byTesterDifficulty.map(t => {
                  const sum = t.high + t.medium + t.low
                  return (
                    <div key={t.testerId} className="flex min-w-0 items-center gap-2 sm:gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground sm:w-20 sm:flex-none">{t.name}</span>
                      <div className="hidden h-2.5 min-w-0 flex-1 overflow-hidden rounded-md bg-muted sm:flex">
                        {sum > 0 && (
                          <>
                            <div className="h-full bg-red-500" style={{ width: `${(t.high / sum) * 100}%` }} />
                            <div className="h-full bg-amber-400" style={{ width: `${(t.medium / sum) * 100}%` }} />
                            <div className="h-full bg-blue-500" style={{ width: `${(t.low / sum) * 100}%` }} />
                          </>
                        )}
                      </div>
                      <span className="w-10 shrink-0 text-center text-sm font-semibold tabular-nums text-red-600 dark:text-red-400">{t.high}</span>
                      <span className="w-10 shrink-0 text-center text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-400">{t.medium}</span>
                      <span className="w-10 shrink-0 text-center text-sm font-semibold tabular-nums text-blue-600 dark:text-blue-400">{t.low}</span>
                    </div>
                  )
                })}
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
