"use client"

/**
 * [FRONTEND] QC 작업 상세 모달
 *
 * 작업현황(prod-status)에서 작업 카드(진행 중·완료)를 클릭하면 열린다.
 * "진행중" 이라는 상태값만으로는 알 수 없는 **어떤 시험항목을 수행 중인지**를
 * 항목 체크리스트 + 현재 항목 강조 + 항목별 소요시간으로 보여준다.
 *
 * 관리자는 여기서 상태도 바꾼다 — 다음 단계 전진과, 잘못 넘긴 단계를 사유와 함께
 * 되돌리는 직접 변경 두 경로 모두 공통 JobStatusControl 이 담당한다(시험현황과 동일).
 *
 * qc_job_items 에는 항목별 '진행중' 플래그가 없다(pending|cleared).
 * 백엔드 getJobDetail 이 미완료 항목 중 순번이 가장 빠른 항목을 현재 항목으로 계산해 내려준다.
 */

import { useCallback, useEffect, useState } from "react"
import {
  CheckCircle2, Circle, Clock, LoaderCircle, TriangleAlert, User,
} from "lucide-react"
import { IN_PROGRESS_STATUS, stageStyle } from "@shared/qc-status"
import { cn } from "@frontend/lib/utils"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { ManagementDrawer } from "@frontend/components/common/management-drawer"
import { JobStageTrack } from "@frontend/components/common/job-stage-track"
import { JobStatusControl } from "@frontend/components/common/job-status-control"
import { JobStatusHistory } from "@frontend/components/common/job-status-history"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { formatElapsedMinutes, formatItemElapsed } from "@frontend/lib/elapsed-format"

/** "진행중" 표시색은 상태 팔레트(types/qc-status.ts)에서 가져온다. 화면마다 색이 갈리지 않게. */
const IN_PROGRESS_STYLE = stageStyle(IN_PROGRESS_STATUS)

// ─── Types (백엔드 JobDetail 과 동일) ────────────────────────────────────────
interface JobItem {
  id: string; testItemName: string; sequenceOrder: number
  status: string; clearedAt: string | null
  /** 직전 항목 완료 이후 구간 소요 분 */
  elapsedMinutes: number | null
  /** 작업 시작부터 이 항목 완료까지 누적 소요 분 */
  elapsedTotalMinutes: number | null
}
export interface JobDetail {
  jobId: string; qcNo: string; status: string
  workStartDate: string | null; workEndDate: string | null
  workStartedAt: string | null; createdAt: string | null
  orderId: string; productCode: string | null; productName: string; batchNo: string
  dueDate: string | null; isUrgent: boolean; method: string | null
  testerName: string | null; testerEmployeeNo: string | null
  items: JobItem[]
  currentItemId: string | null
  currentItemStartedAt: string | null
  nextStage: string | null
  nextStageLabel: string | null
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  })
}

/** 라벨 + 값 (읽기 전용 요약) */
function SummaryField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <span className={cn("text-sm font-medium text-foreground", mono && "font-mono")}>{value}</span>
    </div>
  )
}

// ─── 모달 ────────────────────────────────────────────────────────────────────
export function JobDetailModal({
  jobId, open, onOpenChange, isAdmin = false, onAdvanced,
}: {
  jobId: string | null
  open: boolean
  onOpenChange: (v: boolean) => void
  /** 관리자만 상태를 바꿀 수 있다(단계 전이 + 직접 변경) */
  isAdmin?: boolean
  /** 상태가 바뀐 뒤 목록을 새로고침하도록 알린다 */
  onAdvanced?: () => void
}) {
  const [detail, setDetail] = useState<JobDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 상태를 바꾼 뒤 상세·이력을 다시 읽게 하는 키
  const [historyKey, setHistoryKey] = useState(0)

  const load = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/qc-jobs/${id}`, { credentials: "include" })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? "불러오기 실패")
      setDetail((await res.json()) as JobDetail)
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패")
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [])

  /** 상태가 바뀌면 상세·이력·목록을 모두 최신으로 맞춘다 */
  const handleChanged = useCallback(() => {
    if (jobId) void load(jobId)
    setHistoryKey(k => k + 1)
    onAdvanced?.()
  }, [jobId, load, onAdvanced])

  useEffect(() => {
    if (open && jobId) void load(jobId)
    if (!open) { setDetail(null); setError(null) }
  }, [open, jobId, load])

  const cleared = detail?.items.filter(i => i.status === "cleared").length ?? 0
  const total = detail?.items.length ?? 0
  const pct = total > 0 ? Math.round((cleared / total) * 100) : 0
  const statusMeta = detail ? stageStyle(detail.status) : null
  // 순번은 sequence_order 값(0-based/1-based 혼재 가능)이 아니라 정렬된 배열 위치로 표기한다
  const currentIdx = detail ? detail.items.findIndex(i => i.id === detail.currentItemId) : -1
  const currentItem = currentIdx >= 0 ? detail!.items[currentIdx] : null

  const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  // 현재 항목 경과시간 (직전 클리어 시각 기준)
  const currentElapsed = detail?.currentItemStartedAt ? minutesSince(detail.currentItemStartedAt) : null
  // 작업 시작 이후 누적 경과시간 — 항목 완료로 초기화되지 않는 기준값
  const jobElapsed = detail?.workStartedAt ? minutesSince(detail.workStartedAt) : null

  return (
    <ManagementDrawer
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={(
        <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-blue-700">QC {detail?.qcNo ?? ""}</span>
            {statusMeta && (
              <Badge variant="outline" className={cn("gap-1.5", statusMeta.cls)}>
                <span className={cn("size-1.5 rounded-full", statusMeta.dot)} />
                {detail?.status}
              </Badge>
            )}
            {detail?.isUrgent && (
              <Badge variant="outline" className="border-red-200 text-red-700">긴급</Badge>
            )}
        </span>
      )}
      description="시험항목 진행 내역을 확인하고, 관리자는 작업 상태를 변경합니다."
      footer={(
        <div className="flex w-full justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>닫기</Button>
        </div>
      )}
    >
        <div className="flex flex-col gap-3">
          {loading ? (
            <>
              <Skeleton className="h-20 w-full rounded-md" />
              <Skeleton className="h-16 w-full rounded-md" />
              <div className="flex flex-col gap-1.5">
                {Array.from({ length: 4 }).map((_, i) => (
                  <Skeleton key={i} className="h-11 w-full rounded-md" />
                ))}
              </div>
            </>
          ) : error ? (
            <div className="flex flex-col items-center gap-1 rounded-md border border-amber-200 bg-amber-50 py-10 text-center">
              <TriangleAlert className="mb-1 size-6 text-amber-500" />
              <p className="text-sm font-semibold text-amber-800">{error}</p>
            </div>
          ) : detail ? (
            <>
              {/* 단계 진행 막대 */}
              <section className="rounded-md border bg-card p-3 shadow-sm">
                <JobStageTrack status={detail.status} />
              </section>

              {/* 작업 요약 */}
              <section className="rounded-md border bg-card p-3 shadow-sm">
                <p className="truncate text-sm font-semibold text-foreground">
                  {detail.productName}
                  <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">
                    / {detail.batchNo}
                  </span>
                </p>
                <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <SummaryField
                    label="담당자"
                    value={detail.testerName ? `${detail.testerName} (${detail.testerEmployeeNo ?? "-"})` : "-"}
                  />
                  <SummaryField label="시작일" value={detail.workStartDate ?? "-"} mono />
                  <SummaryField label="완료예정" value={detail.dueDate ?? "-"} mono />
                  <SummaryField label="시험방법" value={detail.method ?? "-"} />
                </div>
              </section>

              {/* 상태 변경 (관리자) — 잘못 넘긴 단계를 사유와 함께 되돌릴 수 있다 */}
              {isAdmin && (
                <JobStatusControl
                  jobId={detail.jobId}
                  status={detail.status}
                  onChanged={handleChanged}
                />
              )}

              {/* 현재 수행 항목 */}
              {currentItem ? (
                <section className="rounded-md border bg-muted/40 p-3">
                  <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted-foreground">
                    <LoaderCircle className="size-3" />
                    현재 수행 중인 시험항목
                  </p>
                  <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">
                      {currentItem.testItemName}
                    </span>
                    {(jobElapsed !== null || currentElapsed !== null) && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Clock className="size-3" />
                        {jobElapsed !== null && `작업 시작 후 ${formatElapsedMinutes(jobElapsed)}`}
                        {jobElapsed !== null && currentElapsed !== null && " · "}
                        {currentElapsed !== null && `현재 항목 ${formatElapsedMinutes(currentElapsed)}`}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    미완료 항목 중 순번이 가장 빠른 항목입니다. ({currentIdx + 1}번째 / 총 {total}개)
                  </p>
                </section>
              ) : detail.items.length > 0 && cleared === total ? (
                <section className="rounded-md border border-blue-200 bg-blue-50/60 p-3">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-blue-800">
                    <CheckCircle2 className="size-4" />
                    모든 시험항목이 완료되었습니다.
                  </p>
                </section>
              ) : null}

              {/* 진행률 */}
              <div className="flex items-center gap-2 px-0.5">
                <span className="shrink-0 text-xs font-semibold text-muted-foreground">
                  시험항목 진행
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-md bg-muted">
                  <div
                    className={cn(
                      "h-full rounded-md transition-all",
                      total > 0 && cleared === total ? "bg-blue-700" : IN_PROGRESS_STYLE.dot,
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="shrink-0 text-xs font-medium tabular-nums text-muted-foreground">
                  {cleared}/{total}
                </span>
              </div>

              {/* 항목 목록 */}
              {detail.items.length === 0 ? (
                <p className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
                  등록된 시험항목이 없습니다. (품목-시험항목 매핑 확인 필요)
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {detail.items.map((it, idx) => {
                    const done = it.status === "cleared"
                    const isCurrent = it.id === detail.currentItemId
                    return (
                      <li
                        key={it.id}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-md border px-3 py-2.5",
                          done && "border-blue-200 bg-blue-50/60",
                          isCurrent && "border-primary/40 bg-primary/5",
                        )}
                      >
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                            {idx + 1}
                          </span>
                          {done
                            ? <CheckCircle2 className="size-4 shrink-0 text-blue-600" />
                            : isCurrent
                              ? <LoaderCircle className="size-4 shrink-0 text-primary" />
                              : <Circle className="size-4 shrink-0 text-muted-foreground" />}
                          <span className={cn(
                            "truncate text-sm",
                            done ? "font-medium text-blue-800"
                              : isCurrent ? "font-semibold text-foreground"
                              : "text-foreground",
                          )}>
                            {it.testItemName}
                          </span>
                        </div>

                        <div className="flex shrink-0 items-center gap-2">
                          {done ? (
                            <span className="text-[11px] text-blue-700">
                              {it.clearedAt && formatDateTime(it.clearedAt)}
                              {/* 작업 시작 기준 누적 소요시간 (구간이 다르면 함께 표기) */}
                              {(() => {
                                const label = formatItemElapsed(it.elapsedTotalMinutes, it.elapsedMinutes)
                                return label && ` · ${label}`
                              })()}
                            </span>
                          ) : isCurrent ? (
                            <Badge variant="outline" className={cn("gap-1", IN_PROGRESS_STYLE.cls)}>
                              <span className={cn("size-1.5 rounded-full", IN_PROGRESS_STYLE.dot)} />진행 중
                            </Badge>
                          ) : (
                            <Badge variant="secondary">대기</Badge>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}

              {/* 상태 변경 이력 */}
              <JobStatusHistory jobId={detail.jobId} reloadKey={historyKey} />

              {/* 담당자 안내 */}
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <User className="size-3" />
                항목 완료 처리는 담당자의 “내 작업” 화면에서만 가능합니다.
              </p>
            </>
          ) : null}
        </div>
    </ManagementDrawer>
  )
}
