"use client"

/**
 * [FRONTEND] QC 작업 상세 모달
 *
 * 작업현황(prod-status)에서 작업 카드(진행 중·완료)를 클릭하면 열린다.
 * "진행중" 이라는 상태값만으로는 알 수 없는 **어떤 시험항목을 수행 중인지**를
 * 항목 체크리스트 + 현재 항목 강조 + 항목별 소요시간으로 보여준다.
 *
 * 관리자는 여기서 시험항목을 **항목마다 검토**한다 — 항목 행의 [검토 시작]·[검토 완료]·[검토 취소]·[재실시]와
 * 일괄 편의 버튼(공통 job-item-review). 작업 단계(진행중·검토전·검토중·승인전)는 서버가 항목 상태에서
 * 도출하므로 단계 막대는 서버 값을 그대로 보여 준다. 승인과 사유가 필요한 직접 변경은 공통 JobStatusControl.
 *
 * 항목은 0040 부터 'in_progress' 상태와 started_at 을 직접 갖는다. 진행 중 항목은 서버(getJobDetail)가
 * 시험자가 [시작]으로 정한 것만 내려준다(병행 시험이라 여럿일 수 있다).
 */

import { useCallback, useEffect, useState } from "react"
import {
  CheckCircle2, Circle, Clock, LoaderCircle, TriangleAlert, User,
} from "lucide-react"
import { IN_PROGRESS_STATUS, stageStyle } from "@shared/qc-status"
import {
  BulkReviewBar, ItemReviewActions, ItemReviewBadge,
} from "@frontend/components/common/job-item-review"
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
  status: string
  /** 시험자가 이 항목을 시작한 시각. null = 아직 시작 안 함 */
  startedAt: string | null
  clearedAt: string | null
  /** 이 항목의 실소요 분(시작→완료) */
  elapsedMinutes: number | null
  /** 작업 시작부터 이 항목 완료까지 누적 소요 분 */
  elapsedTotalMinutes: number | null
  /** 검토 축(0048): none | reviewing | reviewed */
  reviewStatus: string
  reviewStartedAt: string | null
  reviewStartedByName: string | null
  reviewedAt: string | null
  reviewedByName: string | null
}
export interface JobDetail {
  jobId: string; qcNo: string; status: string
  workStartDate: string | null; workEndDate: string | null
  workStartedAt: string | null; createdAt: string | null
  orderId: string; productCode: string | null; productName: string; batchNo: string
  dueDate: string | null; isUrgent: boolean; method: string | null
  testerName: string | null; testerEmployeeNo: string | null
  items: JobItem[]
  /** 시험자가 시작한 진행 중 항목 id 목록 (병행 시험이라 여럿일 수 있다) */
  currentItemIds: string[]
  currentItemId: string | null
  currentItemStartedAt: string | null
  nextStage: string | null
  nextStageLabel: string | null
  /** 0048 미적용 안내 — 검토 상태를 읽지 못했을 때만 */
  reviewSetupError: string | null
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
      <span className="text-xs leading-normal text-muted-foreground">{label}</span>
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
  // 시험자가 [시작]을 누른 항목들. 순번으로 추론하지 않으므로 아무것도 안 눌렀으면 빈 목록이다.
  const runningIds = new Set(detail?.currentItemIds ?? [])
  const runningItems = detail?.items.filter(i => runningIds.has(i.id)) ?? []

  const minutesSince = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  // 작업 시작 이후 누적 경과시간 — 항목 완료로 초기화되지 않는 기준값
  const jobElapsed = detail?.workStartedAt ? minutesSince(detail.workStartedAt) : null

  return (
    <ManagementDrawer
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={(
        <span className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-blue-700 dark:text-blue-300">QC {detail?.qcNo ?? ""}</span>
            {statusMeta && (
              <Badge variant="outline" className={cn("gap-1.5", statusMeta.cls)}>
                <span className={cn("size-1.5 rounded-full", statusMeta.dot)} />
                {detail?.status}
              </Badge>
            )}
            {detail?.isUrgent && (
              <Badge variant="outline" className="border-red-200 text-red-700 dark:border-red-800 dark:text-red-300">긴급</Badge>
            )}
        </span>
      )}
      description="시험항목 진행 내역을 확인하고, 관리자는 시험항목을 검토하고 작업 상태를 변경합니다."
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
            <div className="flex flex-col items-center gap-1 rounded-md border border-amber-200 bg-amber-50 py-10 text-center dark:border-amber-800 dark:bg-amber-950">
              <TriangleAlert className="mb-1 size-6 text-amber-500" />
              <p className="text-sm font-semibold text-amber-800 dark:text-amber-200">{error}</p>
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

              {/* 상태 변경 (관리자) — 승인, 사유를 적는 직접 변경 */}
              {isAdmin && (
                <JobStatusControl
                  jobId={detail.jobId}
                  status={detail.status}
                  onChanged={handleChanged}
                />
              )}

              {detail.reviewSetupError && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-normal break-keep text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  {detail.reviewSetupError}
                </p>
              )}

              {/* 시험항목 검토 요약 + 일괄 편의 버튼 (관리자) */}
              {/* 0048 미적용 안내가 떠 있으면 검토 버튼을 숨긴다(눌러도 설치 안내로 거절된다) */}
              {isAdmin && !detail.reviewSetupError && detail.items.length > 0 && (
                <BulkReviewBar
                  jobId={detail.jobId}
                  jobStatus={detail.status}
                  items={detail.items}
                  onChanged={handleChanged}
                />
              )}

              {/* 현재 수행 항목 — 시험자가 직접 시작한 것만. 병행 시험이라 여러 건일 수 있다. */}
              {runningItems.length > 0 ? (
                <section className="rounded-md border bg-muted/40 p-3">
                  <p className="flex flex-wrap items-center justify-between gap-2 text-xs leading-normal font-semibold text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <LoaderCircle className="size-3" />
                      진행 중인 시험항목 <span className="tabular-nums">{runningItems.length}</span>건
                    </span>
                    {jobElapsed !== null && (
                      <span className="flex items-center gap-1 font-normal">
                        <Clock className="size-3" />
                        작업 시작 후 {formatElapsedMinutes(jobElapsed)}
                      </span>
                    )}
                  </p>
                  <ul className="mt-1.5 flex flex-col gap-1">
                    {runningItems.map(it => (
                      <li key={it.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-foreground">{it.testItemName}</span>
                        {it.startedAt && (
                          <span className="text-xs tabular-nums text-muted-foreground">
                            {formatElapsedMinutes(minutesSince(it.startedAt))} 경과
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs leading-normal text-muted-foreground">
                    시험자가 직접 시작한 항목입니다. (완료 {cleared} / 총 {total}개)
                  </p>
                </section>
              ) : detail.items.length > 0 && cleared === total ? (
                <section className="rounded-md border border-blue-200 bg-blue-50/60 p-3 dark:border-blue-800 dark:bg-blue-950/60">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-blue-800 dark:text-blue-200">
                    <CheckCircle2 className="size-4" />
                    모든 시험항목이 완료되었습니다.
                  </p>
                </section>
              ) : detail.status === IN_PROGRESS_STATUS && detail.items.length > 0 ? (
                /* 순번으로 추론하지 않으므로 "아직 아무것도 시작 안 함"이 실제로 존재한다.
                   빈칸으로 두면 화면이 고장난 것처럼 보여 상태를 그대로 적어 준다. */
                <section className="rounded-md border border-dashed bg-muted/40 p-3">
                  <p className="text-xs leading-normal text-muted-foreground">
                    아직 시작한 시험항목이 없습니다. 시험자가 시작할 항목을 직접 고릅니다.
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
                      "h-full rounded-md transition-[width]",
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
                    const isCurrent = runningIds.has(it.id)
                    return (
                      <li
                        key={it.id}
                        className={cn(
                          "flex flex-col gap-1.5 rounded-md border px-3 py-2.5",
                          // 완료 행의 연한 파랑은 밝은 배경 전제 — 다크에서 명도만 뒤집는다
                          done && "border-blue-200 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-950/60",
                          isCurrent && "border-primary/40 bg-primary/5",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                              {idx + 1}
                            </span>
                            {done
                              ? <CheckCircle2 className="size-4 shrink-0 text-blue-600 dark:text-blue-300" />
                              : isCurrent
                                ? <LoaderCircle className="size-4 shrink-0 text-primary" />
                                : <Circle className="size-4 shrink-0 text-muted-foreground" />}
                            <span className={cn(
                              "truncate text-sm",
                              done ? "font-medium text-blue-800 dark:text-blue-200"
                                : isCurrent ? "font-semibold text-foreground"
                                : "text-foreground",
                            )}>
                              {it.testItemName}
                            </span>
                          </div>

                          <div className="flex shrink-0 items-center gap-2">
                            {done ? (
                              <span className="text-xs leading-normal text-blue-700 dark:text-blue-300">
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
                        </div>

                        {/* 검토 — 시험이 끝난 항목만. 관리자는 여기서 항목마다 검토한다 */}
                        {done && (
                          <div className="flex flex-wrap items-center justify-between gap-2 pl-7">
                            <ItemReviewBadge item={it} meta />
                            {isAdmin && !detail.reviewSetupError && (
                              <ItemReviewActions
                                jobId={detail.jobId}
                                jobStatus={detail.status}
                                item={it}
                                onChanged={handleChanged}
                              />
                            )}
                          </div>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}

              {/* 상태 변경 이력 */}
              <JobStatusHistory jobId={detail.jobId} reloadKey={historyKey} />

              {/* 담당자 안내 */}
              <p className="flex items-center gap-1.5 text-xs leading-normal text-muted-foreground">
                <User className="size-3" />
                항목 완료 처리는 담당자의 “내 작업” 화면에서만 가능합니다.
              </p>
            </>
          ) : null}
        </div>
    </ManagementDrawer>
  )
}
