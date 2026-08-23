"use client"

import { useState } from "react"
import { ChevronDown, ChevronUp, Clock } from "lucide-react"
import { DELAYED_STATUS, IN_PROGRESS_STATUS, JOB_STAGES, stageStyle } from "@shared/qc-status"
import { cn } from "@frontend/lib/utils"
import { Badge } from "@frontend/components/ui/badge"
import { TesterAvatar } from "@frontend/lib/tester-profiles"

// ─── Types (백엔드 listWorkerOverview 와 동일) ───────────────────────────────
export interface OverviewJob {
  jobId: string; qcNo: string; productName: string; batchNo: string
  status: string; dueDate: string | null; isUrgent: boolean
  itemsTotal: number; itemsCleared: number
  workStartDate: string | null; workEndDate: string | null
}
export interface OverviewPending {
  orderId: string; productName: string; batchNo: string
  dueDate: string | null; isUrgent: boolean
}
export interface WorkerRow {
  testerId: string; name: string; employeeNo: string; isActive: boolean
  pendingCount: number; inProgress: number; reviewing: number; delayed: number
  completedTotal: number
  activeJobs: OverviewJob[]; completedJobs: OverviewJob[]; pendingOrders: OverviewPending[]
}

// ─── 레인(정거장) 정의 ───────────────────────────────────────────────────────
/**
 * 레일 위 정거장 — 실제 단계(JOB_STAGES) 앞에 '시작'을 하나 더 둔다.
 * '시작'은 상태값이 아니라 **아직 시작하지 않은 오더(대기 큐)가 매달리는 자리**다.
 * 그래서 정거장은 6개(시작 + 5단계)이고, 작업은 자기 단계 정거장 위에 선다.
 */
const START_NODE = "시작"
export const TRACK = [START_NODE, ...JOB_STAGES] as const

/** 정거장 6개에 대응하는 파랑 램프 — JobStageTrack·STAGE_STYLE 과 같은 계열 */
const RAMP = ["#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af"] as const

/**
 * 작업 상태 → 정거장 번호.
 * '지연'은 단계가 아니라 납기 경과 표시라 제 자리가 없다 — 시험을 붙잡고 있는
 * 상태이므로 '진행중' 정거장에 세우고, 카드 색(빨강)으로 지연임을 드러낸다.
 */
export function trackIndexOf(status: string): number {
  const i = (JOB_STAGES as readonly string[]).indexOf(status)
  if (i >= 0) return i + 1
  if (status === DELAYED_STATUS) return (JOB_STAGES as readonly string[]).indexOf(IN_PROGRESS_STATUS) + 1
  return 1
}

// ─── 작은 조각들 ─────────────────────────────────────────────────────────────
function dDay(due: string | null): number | null {
  if (!due) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(due); d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

export function DDay({ due, className }: { due: string | null; className?: string }) {
  const dd = dDay(due)
  if (dd === null) return null
  const label = dd === 0 ? "D-Day" : dd > 0 ? `D-${dd}` : `D+${-dd}`
  const cls =
    dd <= 3 ? "border-red-200 bg-red-50 text-red-700"
    : dd <= 7 ? "border-amber-200 bg-amber-50 text-amber-700"
    : "text-muted-foreground"
  return (
    <Badge
      variant="outline"
      className={cn("shrink-0 gap-0.5 px-1 py-0 text-[10px] font-semibold tabular-nums", cls, className)}
    >
      <Clock className="size-2.5" />{label}
    </Badge>
  )
}

function MiniProgress({ cleared, total }: { cleared: number; total: number }) {
  const pct = total > 0 ? Math.round((cleared / total) * 100) : 0
  const done = total > 0 && cleared === total
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <div className="h-1 flex-1 overflow-hidden rounded-md bg-muted">
        <div
          className={cn("h-full rounded-md transition-all", done ? "bg-blue-700" : "bg-blue-400")}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground">
        {cleared}/{total}
      </span>
    </div>
  )
}

/** 레일 위(또는 완료 목록 안)에 놓이는 작업 카드 */
export function JobChip({
  job, tone = "active", onOpen,
}: { job: OverviewJob; tone?: "active" | "done"; onOpen: (jobId: string) => void }) {
  const meta = stageStyle(job.status)
  const delayed = job.status === DELAYED_STATUS
  return (
    <button
      type="button"
      onClick={() => onOpen(job.jobId)}
      title={`${job.productName} / ${job.batchNo} — ${job.status}`}
      className={cn(
        "w-full cursor-pointer rounded-md border bg-card p-2 text-left shadow-sm transition-colors",
        "hover:border-blue-300 hover:bg-blue-50/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        tone === "done" && "border-blue-200 bg-blue-50/40",
        delayed && "border-red-200 bg-red-50/50",
      )}
    >
      <div className="flex items-center justify-between gap-1">
        <span className="truncate font-mono text-[10px] font-bold text-blue-700">QC {job.qcNo}</span>
        <span className="flex shrink-0 items-center gap-1">
          {job.isUrgent && (
            <Badge variant="outline" className="border-red-200 px-1 py-0 text-[9px] text-red-700">긴급</Badge>
          )}
          {tone === "active"
            ? <DDay due={job.dueDate} />
            : <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{job.workEndDate ?? "-"}</span>}
          <span className={cn("size-1.5 rounded-full", meta.dot)} title={job.status} />
        </span>
      </div>
      <p className="mt-0.5 truncate text-[11px] font-medium text-foreground">{job.productName}</p>
      <p className="truncate font-mono text-[10px] text-muted-foreground">{job.batchNo}</p>
      {job.itemsTotal > 0 && <MiniProgress cleared={job.itemsCleared} total={job.itemsTotal} />}
    </button>
  )
}

/** '시작' 정거장에 매달리는 대기 큐 */
function PendingQueue({ orders, count }: { orders: OverviewPending[]; count: number }) {
  const [open, setOpen] = useState(false)
  const collapsible = orders.length > 2
  const shown = open || !collapsible ? orders : orders.slice(0, 2)
  const rest = orders.length - shown.length
  return (
    <div className="col-span-3">
      {/* '시작' 정거장(칸 1의 가운데 = 3칸 폭의 1/6)에서 내려오는 연결선 */}
      <div className="ml-[16.666%] h-2.5 w-px bg-blue-200" />
      <div className="rounded-md border border-dashed border-blue-200 bg-blue-50/30 p-2">
        <button
          type="button"
          onClick={() => setOpen(v => !v)}
          disabled={!collapsible}
          className="flex w-full items-center gap-1.5 text-[11px] font-semibold text-blue-800 disabled:cursor-default"
        >
          <Clock className="size-3" />
          시작 대기 {count}건
          {collapsible && (open
            ? <ChevronUp className="ml-auto size-3.5" />
            : <ChevronDown className="ml-auto size-3.5" />)}
        </button>
        <ul className="mt-1.5 flex flex-col gap-1">
          {shown.map(o => (
            <li key={o.orderId} className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate text-foreground">
                {o.productName}
                <span className="ml-1 font-mono text-muted-foreground">{o.batchNo}</span>
              </span>
              <span className="flex shrink-0 items-center gap-1">
                {o.isUrgent && <span className="text-[9px] font-semibold text-red-600">긴급</span>}
                <DDay due={o.dueDate} />
              </span>
            </li>
          ))}
          {rest > 0 && <li className="text-[10px] text-muted-foreground">외 {rest}건</li>}
        </ul>
      </div>
    </div>
  )
}

// ─── 레인 ────────────────────────────────────────────────────────────────────
/**
 * 작업자 한 명 = 가로 레인 하나.
 *
 * 예전에는 작업자마다 카드를 하나씩 놓고 그 안에 작업을 세로로 쌓았다. 작업이
 * "어느 단계에 있는지"는 배지 글자를 읽어야 알 수 있어서, 화면을 훑어도 병목
 * (예: 검토전에 몰려 있음)이 보이지 않았다. 이제 단계를 가로 레일로 깔고 작업을
 * 자기 정거장 위에 세워, **어디에 몰려 있는지가 배치 자체로 드러나게** 한다.
 */
export function WorkerStageLane({
  worker, mode, completedJobs, onOpenJob,
}: {
  worker: WorkerRow
  mode: "active" | "completed"
  completedJobs: OverviewJob[]
  onOpenJob: (jobId: string) => void
}) {
  const w = worker

  // 정거장별로 작업을 담는다 (0번 '시작'은 대기 큐 자리라 작업이 오지 않는다)
  const byNode: OverviewJob[][] = TRACK.map(() => [])
  for (const j of w.activeJobs) byNode[trackIndexOf(j.status)].push(j)

  // 레일을 어디까지 칠할지 — 가장 멀리 간 작업이 레일의 선두다
  const leadIdx = w.activeJobs.length > 0
    ? Math.max(...w.activeJobs.map(j => trackIndexOf(j.status)))
    : w.pendingCount > 0 ? 0 : -1

  const hasNothing = w.activeJobs.length === 0 && w.pendingCount === 0

  return (
    <div className="flex flex-col gap-3 rounded-md border bg-card p-3 shadow-sm md:flex-row md:gap-4 md:p-4">
      {/* 작업자 */}
      <div className="flex shrink-0 items-center gap-3 md:w-40 md:flex-col md:items-start md:gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <TesterAvatar testerId={w.testerId} name={w.name} size="md" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-foreground">{w.name}</p>
            <p className="font-mono text-[11px] text-muted-foreground">{w.employeeNo}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {mode === "completed" ? (
            <>
              <Badge variant="outline" className="border-blue-300 px-1.5 py-0 text-[10px] text-blue-800 tabular-nums">
                완료 {completedJobs.length}
              </Badge>
              <Badge variant="secondary" className="px-1.5 py-0 text-[10px] tabular-nums">누적 {w.completedTotal}</Badge>
            </>
          ) : (
            <>
              {w.inProgress > 0 && <Badge variant="outline" className="gap-1 border-blue-200 px-1.5 py-0 text-[10px] text-blue-700"><span className="size-1.5 rounded-full bg-blue-400" />진행 {w.inProgress}</Badge>}
              {w.reviewing > 0 && <Badge variant="outline" className="gap-1 border-blue-300 px-1.5 py-0 text-[10px] text-blue-800"><span className="size-1.5 rounded-full bg-blue-600" />검토 {w.reviewing}</Badge>}
              {w.delayed > 0 && <Badge variant="outline" className="gap-1 border-red-200 px-1.5 py-0 text-[10px] text-red-700"><span className="size-1.5 rounded-full bg-red-500" />지연 {w.delayed}</Badge>}
              {w.pendingCount > 0 && <Badge variant="secondary" className="px-1.5 py-0 text-[10px] tabular-nums">대기 {w.pendingCount}</Badge>}
              {hasNothing && <span className="text-[11px] text-muted-foreground">보유 작업 없음</span>}
            </>
          )}
        </div>
      </div>

      {mode === "completed" ? (
        /* 완료 보기 — 작업이 전부 종점에 모여 레일이 의미를 잃는다. 목록으로 편다. */
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {completedJobs.length === 0
            ? <p className="text-xs text-muted-foreground">선택한 기간에 완료된 작업이 없습니다.</p>
            : completedJobs.map(j => <JobChip key={j.jobId} job={j} tone="done" onOpen={onOpenJob} />)}
        </div>
      ) : (
        <div className="min-w-0 flex-1 overflow-x-auto pb-1">
          <div className="min-w-[700px]">
            {/* 정거장 위에 선 작업 카드 */}
            <div className="grid grid-cols-6 items-end gap-x-1.5">
              {TRACK.map((node, i) => {
                const jobs = byNode[i]
                const shown = jobs.slice(0, 3)
                return (
                  <div key={node} className="flex flex-col justify-end gap-1">
                    {shown.map(j => <JobChip key={j.jobId} job={j} onOpen={onOpenJob} />)}
                    {jobs.length > shown.length && (
                      <span className="text-center text-[10px] text-muted-foreground">
                        외 {jobs.length - shown.length}건
                      </span>
                    )}
                    {jobs.length > 0 && <span className="mx-auto h-2 w-px bg-blue-200" />}
                  </div>
                )
              })}
            </div>

            {/* 레일 + 정거장 */}
            <div className="relative">
              {/* 첫 정거장(1/12) ~ 마지막 정거장(11/12)을 5구간으로 잇는다 */}
              <div className="absolute top-2 right-[8.3333%] left-[8.3333%] flex h-0.5 -translate-y-1/2 overflow-hidden rounded-md">
                {RAMP.slice(0, 5).map((from, i) => (
                  <div
                    key={i}
                    className={cn("h-full flex-1", i + 1 > leadIdx && "bg-muted")}
                    style={i + 1 <= leadIdx
                      ? { backgroundImage: `linear-gradient(90deg, ${from}, ${RAMP[i + 1]})` }
                      : undefined}
                  />
                ))}
              </div>
              <div className="relative grid grid-cols-6">
                {TRACK.map((node, i) => {
                  const active = i === 0 ? w.pendingCount > 0 : byNode[i].length > 0
                  const reached = i <= leadIdx
                  return (
                    <div key={node} className="flex flex-col items-center gap-1">
                      <span className="relative flex size-4 items-center justify-center">
                        {active && <span className="absolute inset-0 rounded-full bg-blue-100" />}
                        <span
                          className={cn(
                            "relative rounded-full",
                            active ? "size-2.5" : "size-2",
                            !reached && "bg-muted-foreground/30",
                          )}
                          style={reached ? { backgroundColor: RAMP[i] } : undefined}
                        />
                      </span>
                      <span className={cn(
                        "truncate text-[10px]",
                        active ? "font-semibold text-foreground"
                          : reached ? "text-muted-foreground" : "text-muted-foreground/60",
                      )}>
                        {node}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* '시작' 정거장에 매달린 대기 큐 */}
            {w.pendingOrders.length > 0 && (
              <div className="grid grid-cols-6 gap-x-1.5">
                <PendingQueue orders={w.pendingOrders} count={w.pendingCount} />
              </div>
            )}

          </div>
        </div>
      )}
    </div>
  )
}
