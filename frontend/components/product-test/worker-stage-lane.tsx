"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp, Clock } from "lucide-react"
import { DELAYED_STATUS, IN_PROGRESS_STATUS, JOB_STAGES } from "@shared/qc-status"
import { cn } from "@frontend/lib/utils"
import { Badge } from "@frontend/components/ui/badge"

// ─── Types ───────────────────────────────────────────────────────────────────
export interface OverviewJob {
  jobId: string
  qcNo: string
  productName: string
  batchNo: string
  status: string
  dueDate: string | null
  isUrgent: boolean
  itemsTotal: number
  itemsCleared: number
  workStartDate: string | null
  workEndDate: string | null
}

export interface OverviewPending {
  orderId: string
  productName: string
  batchNo: string
  dueDate: string | null
  isUrgent: boolean
}

export interface WorkerRow {
  testerId: string
  name: string
  employeeNo: string
  isActive: boolean
  pendingCount: number
  inProgress: number
  reviewing: number
  delayed: number
  completedTotal: number
  activeJobs: OverviewJob[]
  completedJobs: OverviewJob[]
  pendingOrders: OverviewPending[]
}

// ─── Pipeline Track (시작 + 5개 QC 표준 단계) ──────────────────────────────────
const START_NODE = "시작"
export const TRACK = [START_NODE, ...JOB_STAGES] as const

/**
 * 작업 상태 → 파이프라인 정거장 인덱스 (0: 시작, 1: 진행중, 2: 검토전, 3: 검토중, 4: 승인전, 5: 승인완료)
 */
export function trackIndexOf(status: string): number {
  const i = (JOB_STAGES as readonly string[]).indexOf(status)
  if (i >= 0) return i + 1
  if (status === DELAYED_STATUS) return (JOB_STAGES as readonly string[]).indexOf(IN_PROGRESS_STATUS) + 1
  return 1
}

// ─── Helper Components ───────────────────────────────────────────────────────
function dDay(due: string | null): number | null {
  if (!due) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const d = new Date(due)
  d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

export function DDay({ due, className }: { due: string | null; className?: string }) {
  const dd = dDay(due)
  if (dd === null) return null
  const label = dd === 0 ? "D-Day" : dd > 0 ? `D-${dd}` : `D+${-dd}`
  const cls =
    dd <= 3
      ? "border-red-300 bg-red-50 text-red-600"
      : dd <= 7
        ? "border-amber-300 bg-amber-50 text-amber-600"
        : "border-slate-200 bg-slate-50 text-slate-600"

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0.2 text-xs font-semibold tabular-nums leading-none",
        cls,
        className,
      )}
    >
      <Clock className="size-2.5" />
      {label}
    </span>
  )
}

/** 레일 위(또는 완료 목록 안)에 놓이는 작업 카드 (완료 탭용) */
export function JobChip({
  job,
  tone = "active",
  onOpen,
}: {
  job: OverviewJob
  tone?: "active" | "done"
  onOpen: (jobId: string) => void
}) {
  const delayed = job.status === DELAYED_STATUS
  return (
    <button
      type="button"
      onClick={() => onOpen(job.jobId)}
      title={`${job.productName} / ${job.batchNo} — ${job.status}`}
      className={cn(
        "w-full cursor-pointer rounded-md border bg-card p-2.5 text-left shadow-sm transition-colors",
        "hover:border-blue-300 hover:bg-blue-50/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        tone === "done" && "border-blue-200 bg-blue-50/40",
        delayed && "border-red-200 bg-red-50/50",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="truncate font-mono text-xs leading-normal font-bold text-blue-700">QC {job.qcNo}</span>
        <span className="flex shrink-0 items-center gap-1">
          {job.isUrgent && (
            <Badge variant="outline" className="border-red-200 px-1 py-0 text-xs leading-normal text-red-700">
              긴급
            </Badge>
          )}
          {tone === "active" ? (
            <DDay due={job.dueDate} />
          ) : (
            <span className="font-mono text-xs leading-normal tabular-nums text-muted-foreground">
              {job.workEndDate ?? "-"}
            </span>
          )}
        </span>
      </div>
      <p className="mt-0.5 truncate text-xs leading-normal font-medium text-foreground">{job.productName}</p>
      <p className="truncate font-mono text-xs leading-normal text-slate-600">{job.batchNo}</p>
    </button>
  )
}

// ─── Main Pipeline Component ─────────────────────────────────────────────────
export function WorkerStageLane({
  worker,
  mode,
  completedJobs,
  onOpenJob,
}: {
  worker: WorkerRow
  mode: "active" | "completed"
  completedJobs: OverviewJob[]
  onOpenJob: (jobId: string) => void
  showWorker?: boolean
}) {
  const w = worker
  const [queueOpen, setQueueOpen] = useState(true)

  // 6개 정거장별로 작업 배치
  const byNode: OverviewJob[][] = TRACK.map(() => [])
  for (const j of w.activeJobs) {
    const idx = trackIndexOf(j.status)
    byNode[idx].push(j)
  }

  // 첫 번째 대기 오더 (곡선 분기선 끝에 표시)
  const firstPending = w.pendingOrders[0] ?? null

  // 완료 모드
  if (mode === "completed") {
    return (
      <div className="rounded-md border border-slate-200 bg-white p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-xs font-bold text-slate-800">
            {w.name} — 완료된 작업 ({completedJobs.length}건)
          </h3>
          <Badge variant="secondary" className="text-xs leading-normal">
            누적 완료 {w.completedTotal}건
          </Badge>
        </div>
        {completedJobs.length === 0 ? (
          <p className="py-8 text-center text-xs text-slate-500">선택한 기간에 완료된 작업이 없습니다.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {completedJobs.map((j) => (
              <JobChip key={j.jobId} job={j} tone="done" onOpen={onOpenJob} />
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col justify-between rounded-md border border-slate-200 bg-white p-5 shadow-sm min-h-[400px]">
      {/* ─── 상단 파이프라인 레일 영역 ─── */}
      <div className="relative pt-2 pb-6">
        {/* 1. 상단 활성 작업 콜아웃 카드들 */}
        <div className="grid grid-cols-6 items-end pb-3">
          {TRACK.map((_, i) => {
            const jobs = byNode[i]
            if (!jobs || jobs.length === 0) {
              return <div key={i} className="h-28" />
            }

            const mainJob = jobs[0]
            const restCount = jobs.length - 1

            return (
              <div key={i} className="flex flex-col items-center justify-end px-1">
                {/* Popover Callout Card */}
                <div
                  onClick={() => onOpenJob(mainJob.jobId)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault()
                      onOpenJob(mainJob.jobId)
                    }
                  }}
                  className={cn(
                    "relative z-20 w-full max-w-[210px] cursor-pointer rounded-md border border-slate-200 bg-white p-2.5 shadow-md transition-all",
                    "hover:border-blue-400 hover:shadow-lg focus:outline-none focus:ring-2 focus:ring-blue-400 text-left",
                  )}
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="truncate font-mono text-xs leading-normal font-bold text-slate-900">
                      QC {mainJob.qcNo}
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      <DDay due={mainJob.dueDate} />
                      <span className="text-xs leading-normal font-bold text-slate-400 hover:text-slate-600 select-none">
                        •••
                      </span>
                    </div>
                  </div>

                  <p className="mt-1 truncate text-xs leading-normal font-medium text-slate-700">
                    {mainJob.productName} / {mainJob.batchNo}
                  </p>

                  {mainJob.itemsTotal > 0 && (
                    <div className="mt-2 flex items-center gap-1.5">
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-blue-600 transition-all"
                          style={{
                            width: `${Math.min(100, Math.round((mainJob.itemsCleared / mainJob.itemsTotal) * 100))}%`,
                          }}
                        />
                      </div>
                      <span className="shrink-0 font-mono text-xs leading-normal font-semibold tabular-nums text-slate-600">
                        {mainJob.itemsCleared}/{mainJob.itemsTotal}
                      </span>
                    </div>
                  )}

                  {restCount > 0 && (
                    <div className="mt-1 text-right text-xs leading-normal font-semibold text-blue-600">
                      외 {restCount}건
                    </div>
                  )}

                  {/* Pin / Pointer triangle pointing to node */}
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 size-2.5 rotate-45 border-r border-b border-slate-200 bg-white" />
                </div>
              </div>
            )
          })}
        </div>

        {/* 2. SVG 레일 선 (메인 수평선 + 시작 노드 곡선 분기선) */}
        <div className="relative">
          <svg
            className="pointer-events-none absolute inset-0 -top-2.5 h-28 w-full overflow-visible"
            viewBox="0 0 600 70"
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {/* 메인 레일 수평선 (노드 0의 중심(50)부터 노드 5의 중심(550)까지) */}
            <line
              x1="50"
              y1="14"
              x2="550"
              y2="14"
              stroke="#64748b"
              strokeWidth="3"
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
            />

            {/* 시작 노드에서 아래로 분기하는 S-Curve 레일 */}
            {firstPending && (
              <path
                d="M 50 14 C 50 55, 95 62, 150 62"
                fill="none"
                stroke="#64748b"
                strokeWidth="3"
                vectorEffect="non-scaling-stroke"
                strokeLinecap="round"
              />
            )}
          </svg>

          {/* 3. 6개 노드 및 라벨 */}
          <div className="relative z-10 grid grid-cols-6">
            {TRACK.map((nodeName, idx) => {
              const hasActiveJob = byNode[idx].length > 0

              return (
                <div key={nodeName} className="flex flex-col items-center">
                  {/* 노드 아이콘 */}
                  <div className="flex h-7 items-center justify-center">
                    {idx === 0 ? (
                      /* 시작 노드: 솔리드 블루 */
                      <div className="size-3.5 rounded-full bg-blue-600 shadow-sm" />
                    ) : idx === 5 ? (
                      /* 승인완료: 그레이/완료 링 */
                      <div className="size-3.5 rounded-full border-2 border-slate-400 bg-white shadow-sm" />
                    ) : hasActiveJob ? (
                      /* 현재 작업이 있는 단계: 활성 더블 링 */
                      <div className="flex size-5.5 items-center justify-center rounded-full border-2 border-blue-600 bg-white shadow-sm">
                        <div className="size-2.5 rounded-full bg-blue-600" />
                      </div>
                    ) : (
                      /* 일반 단계 노드 */
                      <div className="size-3.5 rounded-full bg-blue-500 shadow-sm" />
                    )}
                  </div>

                  {/* 단계명 라벨 */}
                  <span className={cn(
                    "mt-2 text-xs font-bold select-none",
                    hasActiveJob ? "text-blue-950 font-extrabold" : "text-slate-800",
                  )}>
                    {nodeName}
                  </span>
                </div>
              )
            })}
          </div>
        </div>

        {/* 4. 곡선 분기선 끝의 '시작 대기' 카드 */}
        {firstPending && (
          <div className="relative z-10 mt-5 ml-[25%] max-w-[280px]">
            <div className="rounded-md border border-slate-200 bg-white px-3.5 py-2.5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs leading-normal font-bold text-slate-800">
                  시작 대기 {w.pendingCount}건
                </span>
                <DDay due={firstPending.dueDate} />
              </div>
              <p className="mt-1 truncate text-xs leading-normal text-slate-600">
                {firstPending.productName} {firstPending.batchNo}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ─── 하단 대기 큐 (Queue) 블록 ─── */}
      {w.pendingOrders.length > 0 && (
        <div className="mt-8 flex max-w-xl overflow-hidden rounded-md border border-slate-200 bg-white shadow-sm">
          {/* 좌측 '대기 큐' 타이틀 박스 */}
          <div className="flex w-22 shrink-0 items-center justify-center bg-slate-100/90 text-xs font-bold text-slate-800 select-none">
            대기 큐
          </div>

          {/* 우측 아코디언 목록 */}
          <div className="flex-1 p-3">
            <button
              type="button"
              onClick={() => setQueueOpen((v) => !v)}
              className="flex w-full items-center justify-between text-xs font-bold text-slate-800 hover:text-slate-950"
            >
              <span className="flex items-center gap-1.5">
                <Clock className="size-3.5 text-slate-500" />
                시작 대기 ({w.pendingOrders.length}건)
              </span>
              {queueOpen ? (
                <ChevronUp className="size-4 text-slate-500" />
              ) : (
                <ChevronDown className="size-4 text-slate-500" />
              )}
            </button>

            {queueOpen && (
              <div className="mt-2.5 flex flex-col gap-2 border-t border-slate-100 pt-2">
                {w.pendingOrders.map((order) => (
                  <div
                    key={order.orderId}
                    className="flex items-center justify-between gap-3 text-xs leading-normal text-slate-700"
                  >
                    <span className="truncate font-medium text-slate-800">
                      {order.productName}{" "}
                      <span className="font-mono text-slate-600">{order.batchNo}</span>
                    </span>
                    <div className="flex shrink-0 items-center gap-1">
                      {order.isUrgent && (
                        <Badge
                          variant="outline"
                          className="border-red-200 px-1 py-0 text-xs leading-normal text-red-700"
                        >
                          긴급
                        </Badge>
                      )}
                      <DDay due={order.dueDate} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
