"use client"

/**
 * [FRONTEND] QC 작업 상태 변경 이력 타임라인
 *
 * `qc_job_status_history` 를 시간순으로 보여준다. 상태 전이가 언제·누가·왜 일어났는지가
 * 시험 기록 신뢰의 근거라, 작업 상세와 시험 미리보기 양쪽에서 같은 모양으로 쓴다.
 *
 * 아직 시작되지 않은 오더(jobId 없음)는 전이 자체가 없으므로 안내 문구만 보여준다.
 */

import { useCallback, useEffect, useState } from "react"
import { ArrowRight, History, RefreshCw, TriangleAlert } from "lucide-react"
import { stageStyle } from "@shared/qc-status"
import { cn } from "@frontend/lib/utils"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@frontend/components/ui/select"

export interface JobStatusHistoryRow {
  id: string
  jobId: string
  orderId: string | null
  fromStatus: string | null
  toStatus: string
  changedById: string | null
  changedByName: string | null
  source: "manual" | "auto" | "system" | "backfill"
  note: string | null
  reasonCategoryId: string | null
  reasonCategoryName: string | null
  attribution: "external" | "internal" | "unknown" | null
  createdAt: string
}

/*
 * 전이를 일으킨 주체 — 사람이 누른 것과 서버가 자동으로 넘긴 것을 구분해 읽게 한다.
 * 연한 칩은 밝은 배경 전제라 다크에서 명도만 뒤집어 짝을 붙인다(50->950, 700->300, 200->800).
 * 이미 시맨틱 토큰인 manual·system 은 테마를 따라가므로 그대로 둔다.
 */
const SOURCE_META: Record<JobStatusHistoryRow["source"], { label: string; cls: string }> = {
  manual:   { label: "수동",        cls: "border-border text-muted-foreground" },
  auto:     { label: "자동 전환",   cls: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300" },
  system:   { label: "시스템",      cls: "border-border text-muted-foreground" },
  backfill: { label: "이력 도입 전", cls: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300" },
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    year: "2-digit", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  })
}

function StatusChip({ status }: { status: string }) {
  const meta = stageStyle(status)
  return (
    <Badge variant="outline" className={cn("gap-1", meta.cls)}>
      <span className={cn("size-1.5 rounded-full", meta.dot)} />
      {status}
    </Badge>
  )
}

export function JobStatusHistory({
  jobId, reloadKey = 0, className, delayOnly = false, isAdmin = false,
}: {
  jobId: string | null
  /** 상태를 바꾼 뒤 이 값을 올리면 이력을 다시 읽는다 */
  reloadKey?: number
  className?: string
  /** 지연 지정·해제만 별도 표시해 상세 상단에 배치한다. */
  delayOnly?: boolean
  /** 관리자만 지연 이력의 통제 범위를 수정할 수 있다. */
  isAdmin?: boolean
}) {
  const [rows, setRows] = useState<JobStatusHistoryRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<string | null>(null)

  const load = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/qc-jobs/${id}/history`, { credentials: "include" })
      const data = await res.json().catch(() => ({})) as { rows?: JobStatusHistoryRow[]; error?: string }
      if (!res.ok) throw new Error(data.error ?? "이력을 불러오지 못했습니다.")
      setRows(data.rows ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "이력을 불러오지 못했습니다.")
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!jobId) { setRows([]); setError(null); return }
    void load(jobId)
  }, [jobId, reloadKey, load])

  const visibleRows = delayOnly ? rows.filter(r => r.toStatus === "지연" || r.fromStatus === "지연") : rows

  async function updateAttribution(row: JobStatusHistoryRow, attribution: string) {
    if (!jobId || !isAdmin || row.toStatus !== "지연") return
    setSavingId(row.id); setError(null)
    try {
      const res = await fetch(`/api/qc-jobs/${jobId}/history`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ historyId: row.id, attribution }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "통제 범위를 수정하지 못했습니다.")
      await load(jobId)
    } catch (e) {
      setError(e instanceof Error ? e.message : "통제 범위를 수정하지 못했습니다.")
    } finally {
      setSavingId(null)
    }
  }

  return (
    <section className={cn("rounded-md border bg-card p-3 shadow-sm", className)}>
      <div className="flex items-center gap-1.5">
        <History className="size-3.5 text-muted-foreground" />
        <span className="text-xs font-semibold text-foreground">상태 변경 이력</span>
        {visibleRows.length > 0 && (
          <Badge variant="secondary" className="tabular-nums">{visibleRows.length}건</Badge>
        )}
        {jobId && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-7 px-2 text-xs"
            onClick={() => void load(jobId)}
            disabled={loading}
          >
            <RefreshCw className={cn("size-3", loading && "animate-spin")} />
            새로고침
          </Button>
        )}
      </div>

      {!jobId ? (
        <p className="mt-3 rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
          아직 시작되지 않은 시험입니다. 담당자가 작업을 시작하면 상태 이력이 쌓입니다.
        </p>
      ) : loading ? (
        <div className="mt-3 flex flex-col gap-1.5">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)}
        </div>
      ) : error ? (
        <p className="mt-3 flex items-center justify-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 py-6 text-center text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <TriangleAlert className="size-3.5 text-amber-500" />{error}
        </p>
      ) : visibleRows.length === 0 ? (
        <p className="mt-3 rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
          기록된 상태 변경이 없습니다.
        </p>
      ) : (
        <ol className="mt-3 flex flex-col">
          {visibleRows.map((r, idx) => {
            const src = SOURCE_META[r.source] ?? SOURCE_META.manual
            const last = idx === visibleRows.length - 1
            return (
              <li key={r.id} className="flex gap-2.5">
                {/* 타임라인 축 */}
                <div className="flex flex-col items-center pt-1.5">
                  <span className={cn("size-2 shrink-0 rounded-full", stageStyle(r.toStatus).dot)} />
                  {!last && <span className="w-px flex-1 bg-border" />}
                </div>

                <div className={cn("min-w-0 flex-1", last ? "pb-0.5" : "pb-3")}>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {r.fromStatus ? (
                      <>
                        <StatusChip status={r.fromStatus} />
                        <ArrowRight className="size-3 text-muted-foreground" />
                      </>
                    ) : (
                      <span className="text-xs leading-normal text-muted-foreground">작업 시작</span>
                    )}
                    <StatusChip status={r.toStatus} />
                    <Badge variant="outline" className={cn("text-xs leading-normal", src.cls)}>{src.label}</Badge>
                    {r.reasonCategoryName && <Badge variant="secondary" className="text-xs leading-normal">{r.reasonCategoryName}</Badge>}
                    {delayOnly && r.toStatus === "지연" && (
                      isAdmin ? (
                        <Select value={r.attribution ?? "unknown"} onValueChange={value => void updateAttribution(r, value)} disabled={savingId === r.id}>
                          <SelectTrigger className="h-6 w-32 text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="external">시험자 통제 밖</SelectItem>
                            <SelectItem value="internal">시험자 통제 안</SelectItem>
                            <SelectItem value="unknown">미확인</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        <Badge variant="outline" className="text-xs leading-normal">
                          {r.attribution === "external" ? "시험자 통제 밖" : r.attribution === "internal" ? "시험자 통제 안" : "미확인"}
                        </Badge>
                      )
                    )}
                  </div>
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-normal text-muted-foreground">
                    <span className="font-mono tabular-nums">{formatDateTime(r.createdAt)}</span>
                    <span>{r.changedByName ?? (r.source === "auto" ? "시스템 자동" : "변경자 미상")}</span>
                  </p>
                  {r.note && (
                    <p className="mt-1 rounded-md bg-muted/50 px-2 py-1 text-xs leading-normal text-foreground">{r.note}</p>
                  )}
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
