"use client"

/**
 * [FRONTEND] 시험 미리보기 패널 (시험현황)
 *
 * 목록의 한 행이 실제로 무엇인지 — 어떤 시험항목을 어디까지 했고, 상태가 어떻게 흘러왔는지 —
 * 화면을 떠나지 않고 확인한다. 관리자는 여기서 바로 상태도 바꾼다.
 *
 * 데이터 출처
 *  - 요약           : 목록 행(TestRow) 그대로 — 추가 조회 없이 즉시 보인다
 *  - 시험항목       : 작업이 있으면 /api/qc-jobs/[id] 의 실제 체크리스트,
 *                     아직 시작 전이면 목록이 들고 있는 예정 항목
 *  - 상태 변경/이력 : 공통 컴포넌트(JobStatusControl / JobStatusHistory)
 */

import { useCallback, useEffect, useState } from "react"
import { CheckCircle2, Circle, ListChecks, LoaderCircle, TriangleAlert } from "lucide-react"
import type { TestRow } from "@shared/qc"
import { DELAYED_STATUS, IN_PROGRESS_STATUS, stageStyle } from "@shared/qc-status"
import { cn } from "@frontend/lib/utils"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { TesterAvatar } from "@frontend/lib/tester-profiles"
import { ManagementDrawer } from "@frontend/components/common/management-drawer"
import { JobStageTrack } from "@frontend/components/common/job-stage-track"
import { JobStatusControl } from "@frontend/components/common/job-status-control"
import { JobStatusHistory } from "@frontend/components/common/job-status-history"

/** /api/qc-jobs/[id] 응답 중 이 패널이 쓰는 부분만 */
interface JobItemsSnapshot {
  status: string
  workStartDate: string | null
  workEndDate: string | null
  /** 시험자가 [시작]을 눌러 진행 중인 항목 id 목록 (병행 시험이라 여럿일 수 있다) */
  currentItemIds: string[]
  items: Array<{
    id: string
    testItemName: string
    status: string
    startedAt: string | null
    clearedAt: string | null
    elapsedMinutes: number | null
  }>
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min}분`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}시간` : `${h}시간 ${m}분`
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  })
}

function SummaryField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <span className="text-xs leading-normal text-muted-foreground">{label}</span>
      <span className={cn("truncate text-sm font-medium text-foreground", mono && "font-mono text-xs")}>
        {value || "-"}
      </span>
    </div>
  )
}

export function TestDetailDrawer({
  row, open, onOpenChange, isAdmin = false, onChanged,
}: {
  row: TestRow | null
  open: boolean
  onOpenChange: (v: boolean) => void
  /** 관리자만 상태를 바꿀 수 있다 */
  isAdmin?: boolean
  /** 상태가 바뀐 뒤 목록을 새로고침하도록 알린다 */
  onChanged?: () => void
}) {
  const [detail, setDetail] = useState<JobItemsSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // 상태를 바꾸면 이력·체크리스트를 다시 읽는다
  const [reloadKey, setReloadKey] = useState(0)

  const jobId = row?.jobId ?? null

  const load = useCallback(async (id: string) => {
    setLoading(true); setError(null)
    try {
      const res = await fetch(`/api/qc-jobs/${id}`, { credentials: "include" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error((data as { error?: string }).error ?? "불러오기 실패")
      setDetail(data as JobItemsSnapshot)
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패")
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open || !jobId) {
      setDetail(null)
      setError(null)
      return
    }
    void load(jobId)
  }, [open, jobId, reloadKey, load])

  // 상태가 바뀌면 서버 값이 정본이다 — 목록 행(row.rawStatus)보다 상세 응답을 우선한다.
  const status = detail?.status ?? row?.rawStatus ?? ""
  const statusMeta = status ? stageStyle(status) : null
  const testing = status === IN_PROGRESS_STATUS || status === DELAYED_STATUS

  const items = detail?.items ?? null
  const cleared = items?.filter(i => i.status === "cleared").length ?? 0
  const total = items?.length ?? row?.itemList.length ?? 0
  const pct = total > 0 ? Math.round((cleared / total) * 100) : 0

  function handleChanged() {
    setReloadKey(k => k + 1)
    onChanged?.()
  }

  return (
    <ManagementDrawer
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={(
        <span className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-blue-700 dark:text-blue-300">
            {row?.testNo && row.testNo !== "-" ? `QC ${row.testNo}` : "시험 미리보기"}
          </span>
          {statusMeta && (
            <Badge variant="outline" className={cn("gap-1.5", statusMeta.cls)}>
              <span className={cn("size-1.5 rounded-full", statusMeta.dot)} />
              {status}
            </Badge>
          )}
          {row?.isUrgent && <Badge variant="outline" className="border-red-200 text-red-700 dark:border-red-800 dark:text-red-300">긴급</Badge>}
        </span>
      )}
      description="시험 요약·시험항목 진행·상태 변경 이력을 한 곳에서 확인합니다."
      footer={(
        <div className="flex w-full justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)}>닫기</Button>
        </div>
      )}
    >
      {!row ? null : (
        <div className="flex flex-col gap-3">
          {/* 단계 진행 막대 */}
          <section className="flex flex-col gap-1.5 rounded-md border bg-card p-3 shadow-sm">
            <JobStageTrack status={status} />
            {status === DELAYED_STATUS && (
              <p className="text-center text-xs font-medium text-red-700 dark:text-red-300">지연 — 완료예정일이 지났습니다.</p>
            )}
            {row.jobId === null && (
              <p className="text-center text-xs text-muted-foreground">
                아직 시작 전인 시험입니다. (오더 상태: {row.rawStatus})
              </p>
            )}
          </section>

          {/* 시험 요약 */}
          <section className="rounded-md border bg-card p-3 shadow-sm">
            <p className="truncate text-sm font-semibold text-foreground">
              {row.product}
              <span className="ml-1.5 font-mono text-xs font-normal text-muted-foreground">/ {row.batchNo}</span>
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <SummaryField label="구분" value={row.category} />
              <SummaryField label="진행방법" value={row.type} />
              <SummaryField label="수탁사" value={row.contractor} />
              <div className="flex min-w-0 flex-col gap-0.5">
                <span className="text-xs leading-normal text-muted-foreground">담당자</span>
                <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-foreground">
                  {row.manager ? <TesterAvatar name={row.manager} size="xs" /> : null}
                  <span className="truncate">{row.manager || "미배정"}</span>
                </span>
              </div>
              <SummaryField label="접수일" value={row.receiveDate} mono />
              <SummaryField label="완료예정" value={row.dueDate} mono />
            </div>
          </section>

          {/* 상태 변경 (관리자) */}
          {isAdmin && (
            <JobStatusControl jobId={row.jobId} status={status} onChanged={handleChanged} />
          )}

          {/* 시험항목 */}
          <section className="rounded-md border bg-card p-3 shadow-sm">
            <div className="flex items-center gap-1.5">
              <ListChecks className="size-3.5 text-muted-foreground" />
              <span className="shrink-0 text-xs font-semibold text-foreground">
                시험항목 {row.jobId ? "진행" : "(예정)"}
              </span>
              <Badge variant="secondary" className="tabular-nums">{total}개</Badge>
              {row.jobId && total > 0 && (
                <span className="ml-auto flex min-w-0 flex-1 items-center gap-2 pl-2">
                  <span className="h-1.5 flex-1 overflow-hidden rounded-md bg-muted">
                    <span
                      className={cn(
                        "block h-full rounded-md transition-[width]",
                        cleared === total ? "bg-blue-700" : "bg-blue-400",
                      )}
                      style={{ width: `${pct}%` }}
                    />
                  </span>
                  <span className="shrink-0 text-xs leading-normal font-medium tabular-nums text-muted-foreground">
                    {cleared}/{total}
                  </span>
                </span>
              )}
            </div>

            {loading ? (
              <div className="mt-3 flex flex-col gap-1.5">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-10 w-full rounded-md" />)}
              </div>
            ) : error ? (
              <p className="mt-3 flex items-center justify-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 py-6 text-center text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                <TriangleAlert className="size-3.5 text-amber-500" />{error}
              </p>
            ) : items ? (
              items.length === 0 ? (
                <p className="mt-3 rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
                  등록된 시험항목이 없습니다. (품목-시험항목 매핑 확인 필요)
                </p>
              ) : (
                <ul className="mt-3 flex flex-col gap-1.5">
                  {items.map((it, idx) => {
                    const done = it.status === "cleared"
                    const isCurrent = testing && (detail?.currentItemIds ?? []).includes(it.id)
                    return (
                      <li
                        key={it.id}
                        className={cn(
                          "flex items-center justify-between gap-2 rounded-md border px-3 py-2",
                          // 완료 행의 연한 파랑은 밝은 배경 전제 — 다크에서 명도만 뒤집는다
                          done && "border-blue-200 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-950/60",
                          isCurrent && "border-primary/40 bg-primary/5",
                        )}
                      >
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">{idx + 1}</span>
                          {done
                            ? <CheckCircle2 className="size-4 shrink-0 text-blue-600 dark:text-blue-300" />
                            : isCurrent
                              ? <LoaderCircle className="size-4 shrink-0 text-primary" />
                              : <Circle className="size-4 shrink-0 text-muted-foreground" />}
                          <span className={cn("truncate text-sm", done && "text-blue-800 dark:text-blue-200")}>
                            {it.testItemName}
                          </span>
                        </span>
                        <span className="shrink-0 text-xs leading-normal text-muted-foreground">
                          {done ? (
                            <>
                              {it.clearedAt && formatDateTime(it.clearedAt)}
                              {it.elapsedMinutes != null && ` · ${formatMinutes(it.elapsedMinutes)}`}
                            </>
                          ) : isCurrent ? (
                            <Badge variant="outline" className={cn("gap-1", stageStyle(IN_PROGRESS_STATUS).cls)}>진행 중</Badge>
                          ) : (
                            <Badge variant="secondary">대기</Badge>
                          )}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )
            ) : row.itemList.length === 0 ? (
              <p className="mt-3 rounded-md border border-dashed py-6 text-center text-xs text-muted-foreground">
                예정된 시험항목이 없습니다. (품목-시험항목 매핑 확인 필요)
              </p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {row.itemList.map((name, i) => (
                  <li key={`${name}-${i}`}>
                    <Badge variant="outline" className="text-muted-foreground">{name}</Badge>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 상태 변경 이력 */}
          <JobStatusHistory jobId={row.jobId} reloadKey={reloadKey} />
        </div>
      )}
    </ManagementDrawer>
  )
}
