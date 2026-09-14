"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Play, CheckCircle2, Circle, LoaderCircle, Loader2, AlertTriangle, Clock, XCircle, Undo2, Layers,
  ShieldAlert, ClipboardList,
} from "lucide-react"
import {
  ACTIVE_JOB_STATUSES, CLOSED_STAGE, IN_PROGRESS_STATUS, ITEM_CLEARED, ITEM_EDITABLE_JOB_STATUSES, ITEM_IN_PROGRESS,
  ITEM_PENDING, ITEM_REVIEW_REVIEWED, ITEM_REVIEW_REVIEWING, PENDING_STATUS, TESTER_STATUS_CHANGE_STATUSES,
  hasReviewTrace, stageStyle,
} from "@shared/qc-status"
import { ItemReviewBadge } from "@frontend/components/common/job-item-review"
import { useAuth } from "@frontend/lib/auth-context"
import { api, errorMessage } from "@frontend/lib/api-client"
import { cn } from "@frontend/lib/utils"
import { Skeleton } from "@frontend/components/ui/skeleton"
import { DateField } from "@frontend/components/ui/date-field"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Card } from "@frontend/components/ui/card"
import { Input } from "@frontend/components/ui/input"
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@frontend/components/ui/dialog"
import { ManagementDrawer } from "@frontend/components/common/management-drawer"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@frontend/components/ui/select"
import { formatElapsedMinutes, formatItemElapsed } from "@frontend/lib/elapsed-format"

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
  /** 검토 축(0048): none | reviewing | reviewed — 시험자는 읽기만 한다 */
  reviewStatus?: string | null
  reviewStartedAt?: string | null
  reviewStartedByName?: string | null
  reviewedAt?: string | null
  reviewedByName?: string | null
}
interface Job {
  id: string; orderId: string; qcNo: string; productName: string; batchNo: string
  workStartDate: string | null; workEndDate: string | null; status: string
  isUrgent: boolean; dueDate: string | null; items: JobItem[]
  /** 동시분석 그룹 — 같은 그룹의 작업은 카드 하나로 묶어 한 번에 조작한다 */
  groupId: string | null; groupLabel: string | null; groupSize: number
}
interface PendingOrder {
  id: string; productCode: string; productName: string; batchNo: string
  dueDate: string | null; isUrgent: boolean; method: string
  groupId: string | null; groupLabel: string | null; groupSize: number
}

/** 그룹 카드의 시험항목 한 줄 — 같은 이름의 항목을 배치들에 걸쳐 합쳐 본다 */
interface MergedItem {
  name: string
  total: number
  cleared: number
  inProgress: number
  /** 진행 중인 것들 중 가장 이른 시작 시각 — "N분 경과" 표시용 */
  earliestStart: string | null
  /** 검토 중·검토 완료 배치 수 — 관리자가 항목마다 검토한다(읽기 전용 표시) */
  reviewing: number
  reviewed: number
}

/** equipmentMaster ReadinessResult (UI 전용 타입) */
interface EquipmentCheck {
  code: string; name: string | null; found: boolean; status: string | null
  calibrationOk: boolean; calibrationDueDate: string | null
  available: boolean
  blocked: boolean          // 하드 차단 — 사유는 reason
  warning: string | null    // 소프트 경고 문구 (미등록/검교정 중/예약 점유 등)
  reason: string | null     // blocked 사유
}
/** 시험 전 확인사항 (product_pretest_notes) */
interface PretestNote {
  id: string; content: string; remark: string | null; issueLot: string | null
  occurredAt: string | null; createdByName: string | null
}
interface ReadinessResult {
  ok: boolean; checks: EquipmentCheck[]; equipmentCodes: string[]
  pretestNotes?: PretestNote[]
}

/**
 * 시험자가 직접 바꿀 수 있는 상태만 남긴다(진행중 ↔ 지연).
 * 검토전·검토중·승인전은 시험항목 완료와 관리자의 항목 검토에서 서버가 도출하고,
 * 승인완료는 관리자가 승인한다. 지연을 풀면 서버가 항목 상태에 맞는 단계로 되돌린다. (types/qc-status.ts)
 */
const STATUS_OPTIONS: string[] = [...TESTER_STATUS_CHANGE_STATUSES]
const statusCls = (s: string) => stageStyle(s).cls

function dDay(due: string | null): number | null {
  if (!due) return null
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(due); d.setHours(0, 0, 0, 0)
  return Math.round((d.getTime() - today.getTime()) / 86400000)
}

/** 기준 시각(now) 이후 경과 분. now 를 인자로 받아야 1분 타이머가 다시 그릴 때 값이 따라온다. */
function minutesSince(iso: string, now: number): number {
  return Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000))
}

/**
 * 작업 시작을 되돌릴 수 있는 작업인가 — 버튼 노출용 보조 판정.
 * 최종 판정은 서버(cancelJobStart)가 한다. '진행중' 이고, 시험항목이 1건 이상이며
 * 전부 한 번도 시작·완료되지 않은 작업만 해당한다.
 */
function canCancelStart(job: Job): boolean {
  if (job.status !== IN_PROGRESS_STATUS || job.items.length === 0) return false
  return job.items.every(it =>
    it.status === ITEM_PENDING
    && it.startedAt == null && it.clearedAt == null
    && it.elapsedMinutes == null && it.elapsedTotalMinutes == null)
}

const CANCEL_REASON_OTHER = "기타"
const CANCEL_REASONS = ["잘못 눌렀습니다", "시험 준비가 안 됐습니다", CANCEL_REASON_OTHER]

/** 작업 시작 취소 확인 모달 — 사유를 골라야 취소할 수 있다 */
function CancelStartDialog({
  job,
  onDone,
  onFailed,
  onClose,
}: {
  job: Job
  onDone: (message: string, type: "info" | "error") => void
  /** 요청 실패 뒤 목록을 다시 읽는다. 대상 작업이 목록에서 사라졌으면(응답만 유실된 경우) 모달이 닫힌다 */
  onFailed: () => Promise<void>
  onClose: () => void
}) {
  const [choice, setChoice] = useState<string>(CANCEL_REASONS[0])
  const [custom, setCustom] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reason = choice === CANCEL_REASON_OTHER ? custom.trim() : choice
  const reasonOk = reason.length >= 2

  const submit = async () => {
    if (!reasonOk) { setError("사유를 2자 이상 입력해 주세요."); return }
    setSubmitting(true)
    setError(null)
    try {
      const res = await api.post<{
        ok: true; qcNo: string; orderStatusBefore: string; orderStatusAfter: string; warning?: string
      }>(`/api/qc-jobs/${job.id}/cancel-start`, { reason })
      // 성공 문구는 서버가 확정한 오더 상태로 가른다 — 2인 배정 상대 작업이 남으면 오더는 그대로다.
      const done = res.orderStatusAfter === PENDING_STATUS
        ? `QC ${res.qcNo} 작업 시작을 취소했습니다. 오더가 시작 대기로 돌아갔습니다.`
        : `QC ${res.qcNo} 내 작업 시작을 취소했습니다. 함께 배정된 담당자의 작업이 있어 오더는 '${res.orderStatusAfter}'로 유지됩니다.`
      if (res.warning) onDone(`${done} ${res.warning}`, "error")
      else onDone(done, "info")
    } catch (e) {
      // 모달을 닫지 않는다 — 사유를 다시 입력하지 않고 재확인할 수 있게 한다.
      // 서버는 취소했는데 응답만 유실됐을 수 있으므로 목록을 한 번 다시 읽는다.
      setError(errorMessage(e))
      setSubmitting(false)
      await onFailed()
    }
  }

  return (
    <Dialog open onOpenChange={next => { if (!next && !submitting) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>작업 시작 취소</DialogTitle>
          <DialogDescription className="text-xs leading-normal break-keep">
            <span className="font-mono">QC {job.qcNo}</span> · {job.productName} / <span className="font-mono">{job.batchNo}</span>
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-normal break-keep text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            내 작업 기록과 QC번호가 삭제됩니다. 다른 담당자 작업이 없으면 오더가 &apos;시작 대기&apos;로 돌아갑니다.
            취소 사실과 사유는 오더 수정 이력에 남습니다.
          </p>
          <fieldset className="space-y-1.5">
            <legend className="mb-1 text-xs font-medium text-muted-foreground">취소 사유</legend>
            {CANCEL_REASONS.map(r => (
              <label key={r} className="flex min-h-8 cursor-pointer items-center gap-2 text-sm text-foreground">
                <input
                  type="radio"
                  name="cancel-start-reason"
                  className="size-4 accent-primary"
                  checked={choice === r}
                  onChange={() => { setChoice(r); setError(null) }}
                  disabled={submitting}
                />
                {r}
              </label>
            ))}
            {choice === CANCEL_REASON_OTHER && (
              <Input
                autoFocus
                value={custom}
                onChange={e => { setCustom(e.target.value); setError(null) }}
                placeholder="사유를 직접 입력하세요 (2자 이상)"
                disabled={submitting}
              />
            )}
          </fieldset>
          {error && <p className="text-xs leading-normal break-keep text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>닫기</Button>
          <Button variant="destructive" onClick={() => void submit()} disabled={submitting || !reasonOk}>
            {submitting ? <Loader2 className="animate-spin" /> : <Undo2 />}
            시작 취소
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 장비 준비상태 모달 */
function ReadinessModal({
  result,
  onConfirm,
  onCancel,
  confirming,
}: {
  result: ReadinessResult
  onConfirm: () => void
  onCancel: () => void
  confirming: boolean
}) {
  const blocked = result.checks.filter(c => c.blocked)
  const warnings = result.checks.filter(c => c.warning && !c.blocked)
  const notes = result.pretestNotes ?? []
  const isBlocked = !result.ok && blocked.length > 0

  return (
    <ManagementDrawer
      open
      onOpenChange={(next) => { if (!next && !confirming) onCancel() }}
      size="md"
      title={(
        <span className="flex items-center gap-2">
          <span className={cn(
            "flex size-8 items-center justify-center rounded-md",
            isBlocked ? "bg-destructive/10 text-destructive" : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
          )}>
            {isBlocked ? <XCircle className="size-4" /> : <ShieldAlert className="size-4" />}
          </span>
          <span>{isBlocked ? "장비 검증 실패 — 시작 불가" : "시작 전 확인 — 확인 후 시작 가능"}</span>
        </span>
      )}
      description={isBlocked
        ? "아래 장비 문제를 해결한 후 다시 시도하세요."
        : "장비 경고·시험 전 확인사항을 확인하고 계속 진행할 수 있습니다."}
      footer={(
        <>
          <Button variant="outline" onClick={onCancel} disabled={confirming}>취소</Button>
          {!isBlocked && (
            <Button onClick={onConfirm} disabled={confirming}>
              {confirming ? <Loader2 className="animate-spin" /> : <Play />}
              확인 후 시작
            </Button>
          )}
        </>
      )}
    >
        <div className="grid gap-3">
          {blocked.length > 0 && (
            <ul className="flex flex-col gap-2">
              {blocked.map(c => (
                <li key={c.code} className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs dark:border-red-800 dark:bg-red-950">
                  <XCircle size={14} className="mt-0.5 shrink-0 text-red-500" />
                  <div>
                    {/* 마스터 미등록 장비는 name이 없으므로 코드로 대체 */}
                    <span className="font-semibold text-red-800 dark:text-red-200">{c.name ?? c.code}</span>
                    {c.reason && <p className="text-red-700 dark:text-red-300">{c.reason}</p>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {warnings.length > 0 && (
            <div className={blocked.length > 0 ? "mt-3" : ""}>
              {/* 한글에는 대문자가 없다 — uppercase·tracking-wide 를 걷어내고 자간을 원래대로 둔다 */}
              <p className="mb-1.5 flex items-center gap-1.5 text-xs leading-normal font-semibold text-muted-foreground">
                <AlertTriangle size={12} /> 장비 경고 <span className="tabular-nums">{warnings.length}</span>건
              </p>
              <ul className="flex flex-col gap-2">
                {warnings.map(c => (
                  <li key={c.code} className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs dark:border-amber-800 dark:bg-amber-950">
                    <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" />
                    <div>
                      {/* 마스터 미등록 장비는 name이 없으므로 코드로 대체 */}
                      <span className="font-semibold text-amber-800 dark:text-amber-200">{c.name ?? c.code}</span>
                      {/* 경고 사유는 warning 필드에 담긴다(reason은 blocked 전용) */}
                      {c.warning && <p className="text-amber-700 dark:text-amber-300">{c.warning}</p>}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {notes.length > 0 && (
            <div className={blocked.length > 0 || warnings.length > 0 ? "mt-3" : ""}>
              <p className="mb-1.5 flex items-center gap-1.5 text-xs leading-normal font-semibold text-muted-foreground">
                <ClipboardList size={12} /> 시험 전 확인사항 <span className="tabular-nums">{notes.length}</span>건
              </p>
              <ul className="flex flex-col gap-2">
                {notes.map(n => (
                  <li key={n.id} className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs dark:border-blue-800 dark:bg-blue-950">
                    <p className="font-semibold text-blue-900 dark:text-blue-200">{n.content}</p>
                    {n.remark && <p className="mt-0.5 text-blue-700 dark:text-blue-300">특이사항: {n.remark}</p>}
                    {(n.issueLot || n.createdByName) && (
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs leading-normal text-blue-600 dark:text-blue-300">
                        {n.issueLot && <span>이슈 로트 {n.issueLot}</span>}
                        {n.createdByName && <span>작성 {n.createdByName}</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
    </ManagementDrawer>
  )
}

export default function MyTasksPage() {
  // 화면 이름은 역할에 따라 다르다 — 시험자 메뉴는 「할 일」, 관리자 메뉴는 「내 작업」.
  const { user } = useAuth()
  const pageTitle = user?.role === "admin" ? "내 작업" : "할 일"
  const [linked, setLinked] = useState(true)
  const [pending, setPending] = useState<PendingOrder[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  /** 0048 미적용 안내 — 검토 상태를 읽지 못했을 때만 */
  const [reviewSetupError, setReviewSetupError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  // 진행 중 항목의 "N분 경과" 표시용 시계. 1분마다 한 번만 다시 그리면 충분하다.
  const [nowTick, setNowTick] = useState(() => Date.now())
  const [msg, setMsg] = useState<string | null>(null)
  const [msgType, setMsgType] = useState<"info" | "error">("info")
  // 다중 선택(배정완료·시작 대기) 일괄 실행
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkBusy, setBulkBusy] = useState(false)
  // 다중 선택(진행 중) 일괄 상태 변경
  const [selectedJobs, setSelectedJobs] = useState<Set<string>>(new Set())
  const [jobBulkBusy, setJobBulkBusy] = useState(false)
  const [bulkStatus, setBulkStatus] = useState<string>("진행중")

  /** 장비 준비상태 모달 상태 */
  const [readinessModal, setReadinessModal] = useState<{
    orderId: string
    result: ReadinessResult
  } | null>(null)
  const [startingFromModal, setStartingFromModal] = useState(false)
  /** 작업 시작 취소 모달 대상 */
  const [cancelTarget, setCancelTarget] = useState<Job | null>(null)

  /** 목록을 다시 읽고, 읽은 작업 목록을 돌려준다(시작 취소 실패 뒤 대상이 남아 있는지 확인용) */
  /** 목록을 다시 읽는다. 응답이 실패면 null — 빈 목록과 구분해야 "작업이 사라졌다" 고 오판하지 않는다 */
  const load = useCallback(async (): Promise<Job[] | null> => {
    setLoading(true)
    try {
      const res = await fetch("/api/qc-jobs", { credentials: "include" })
      const data = await res.json()
      const nextJobs: Job[] = data.jobs ?? []
      setLinked(data.testerLinked ?? false)
      setReviewSetupError(typeof data.reviewSetupError === "string" ? data.reviewSetupError : null)
      setPending(data.pendingOrders ?? [])
      setJobs(nextJobs)
      return res.ok && Array.isArray(data.jobs) ? nextJobs : null
    } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  // 진행 중 항목의 경과시간을 1분마다 갱신한다. 서버를 다시 부르지 않고 시계만 움직인다.
  useEffect(() => {
    const t = setInterval(() => setNowTick(Date.now()), 60_000)
    return () => clearInterval(t)
  }, [])

  // pending 갱신 시(시작 완료 등) 더 이상 없는 항목은 선택에서 제거
  useEffect(() => {
    setSelected(prev => {
      const ids = new Set(pending.map(o => o.id))
      const next = new Set([...prev].filter(id => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [pending])

  // jobs 갱신 시 더 이상 진행 중이 아닌(완료된 등) 항목은 선택에서 제거
  useEffect(() => {
    setSelectedJobs(prev => {
      const ids = new Set(jobs.filter(j => ACTIVE_JOB_STATUSES.has(j.status)).map(j => j.id))
      const next = new Set([...prev].filter(id => ids.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [jobs])

  const flash = (m: string, type: "info" | "error" = "info") => {
    setMsg(m); setMsgType(type); setTimeout(() => setMsg(null), 4000)
  }

  /**
   * 장비 준비상태 조회.
   * 응답이 실패(401 세션만료·500 등)면 body 에 checks 가 없으므로, 그대로 쓰면
   * "reading 'some'" 같은 엉뚱한 오류가 뜬다. 여기서 실제 사유로 바꿔 던진다.
   */
  const fetchReadiness = async (orderId: string): Promise<ReadinessResult> => {
    const res = await fetch(`/api/qc-jobs/readiness?orderId=${orderId}`, { credentials: "include" })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) throw new Error("로그인 세션이 만료되었습니다. 다시 로그인해주세요.")
    if (!res.ok) throw new Error(data?.error ?? `준비상태 조회 실패 (HTTP ${res.status})`)
    if (!Array.isArray(data?.checks)) throw new Error("준비상태 응답 형식이 올바르지 않습니다.")
    return data as ReadinessResult
  }

  /** 시작 API 호출(코어) — 알림/새로고침 없이 결과만 반환 (일괄 실행에서 재사용) */
  const doStartCore = async (orderId: string): Promise<{ qcNo: string; warnings?: string[] }> => {
    const res = await fetch("/api/qc-jobs", {
      method: "POST", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderId }),
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) throw new Error("로그인 세션이 만료되었습니다. 다시 로그인해주세요.")
    if (!res.ok) throw new Error(data?.error ?? `작업 시작 실패 (HTTP ${res.status})`)
    return data
  }

  /** 단건 시작 — 알림 + 새로고침 */
  const doStart = async (orderId: string) => {
    const data = await doStartCore(orderId)
    const warnNote = data.warnings?.length ? ` (경고: ${(data.warnings as string[]).join(", ")})` : ""
    flash(`작업 시작 — QC ${data.qcNo}${warnNote}`)
    await load()
  }

  /** 시작 버튼 클릭 — 준비상태 먼저 조회 */
  const start = async (orderId: string) => {
    setBusy(orderId)
    try {
      // 장비 준비상태 조회
      const readiness = await fetchReadiness(orderId)

      const hasBlocked = readiness.checks.some(c => c.blocked)
      const hasWarning = readiness.checks.some(c => c.warning && !c.blocked)
      const hasPretestNotes = (readiness.pretestNotes?.length ?? 0) > 0

      if (hasBlocked || hasWarning || hasPretestNotes) {
        // 모달 표시 (blocked이면 시작 불가, warning·시험 전 확인사항이면 확인 후 가능)
        setReadinessModal({ orderId, result: readiness })
        setBusy(null)
        return
      }

      // 문제 없으면 바로 시작
      await doStart(orderId)
    } catch (e) {
      flash(`시작 실패: ${e instanceof Error ? e.message : ""}`, "error")
    } finally {
      setBusy(null)
    }
  }

  /** 모달에서 경고 확인 후 시작 */
  const confirmStartFromModal = async () => {
    if (!readinessModal) return
    setStartingFromModal(true)
    try {
      await doStart(readinessModal.orderId)
      setReadinessModal(null)
    } catch (e) {
      flash(`시작 실패: ${e instanceof Error ? e.message : ""}`, "error")
      setReadinessModal(null)
    } finally {
      setStartingFromModal(false)
    }
  }

  /** 선택 실행 — 선택된 대기 오더를 순차 시작. 장비 차단(blocked) 건은 제외, 결과 요약 표시. */
  const startSelected = async () => {
    const ids = pending.filter(o => selected.has(o.id)).map(o => o.id)
    if (ids.length === 0) return
    setBulkBusy(true)
    const nameById = new Map(pending.map(o => [o.id, o.productName] as const))
    let started = 0
    const blocked: string[] = []
    const failed: string[] = []
    let lastError = ""
    try {
      for (const id of ids) {
        try {
          const readiness = await fetchReadiness(id)
          // 장비 차단 건은 단건 모달과 동일하게 시작 불가 → 제외
          if (readiness.checks.some(c => c.blocked)) { blocked.push(nameById.get(id) ?? id); continue }
          await doStartCore(id)
          started++
        } catch (e) {
          failed.push(nameById.get(id) ?? id)
          lastError = e instanceof Error ? e.message : ""
        }
      }
      await load()
      setSelected(new Set())
      const parts: string[] = [`${started}건 시작`]
      if (blocked.length) parts.push(`장비 차단 ${blocked.length}건 제외(${blocked.join(", ")})`)
      // 실패는 건수만 알려주면 원인을 알 수 없으므로 마지막 사유를 함께 표시한다.
      if (failed.length) parts.push(`실패 ${failed.length}건${lastError ? ` — ${lastError}` : ""}`)
      flash(parts.join(" · "), failed.length ? "error" : "info")
    } finally {
      setBulkBusy(false)
    }
  }

  const allSelected = pending.length > 0 && selected.size === pending.length
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(pending.map(o => o.id)))
  const toggleOne = (id: string) =>
    setSelected(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  /**
   * 시험항목 액션 — 시작 / 시작 취소 / 완료.
   *
   * 시험 순서는 시험자가 정한다. 순번대로 강제하지 않으므로 아무 항목이나 시작할 수
   * 있고, 오래 걸리는 시험을 걸어둔 채 다른 항목을 함께 시작해도 된다.
   */
  const itemAction = async (jobId: string, itemId: string, action: "start" | "cancel" | "clear") => {
    setBusy(itemId)
    try {
      const res = await fetch(`/api/qc-jobs/${jobId}/items`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId, action }),
      })
      const data = await res.json() as { error?: string; statusChangedTo?: string | null; stageSyncFailed?: boolean }
      if (!res.ok) throw new Error(data.error)
      await load()
      // 항목 완료로 서버가 작업 단계를 다시 도출해 바뀌었으면 — 사용자가 알 수 있게 안내
      if (data.stageSyncFailed) {
        flash("시험항목은 완료됐지만 작업 단계를 맞추지 못했습니다. 다음 처리 때 자동으로 맞춰집니다.", "error")
      } else if (data.statusChangedTo) {
        flash(`시험항목 완료 — 작업 단계가 "${data.statusChangedTo}" 로 자동 변경되었습니다.`)
      }
    } catch (e) { flash(`처리 실패: ${e instanceof Error ? e.message : ""}`, "error") }
    finally { setBusy(null) }
  }

  /**
   * 그룹 단위 항목 조작 — 한 번 눌러 그룹 안 내 배치 전부를 처리한다.
   * 기록은 배치별로 그대로 남는다(서버가 배치마다 개별 기록을 쓴다).
   */
  const groupItemAction = async (
    groupId: string, testItemName: string, action: "start" | "clear" | "cancel",
  ) => {
    setBusy(`${groupId}:${testItemName}`)
    try {
      const res = await fetch(`/api/qc-jobs/group/${groupId}/items`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ testItemName, action }),
      })
      const data = await res.json() as { error?: string; affected?: number; jobs?: number; advanced?: string[] }
      if (!res.ok) throw new Error(data.error)
      await load()
      // 0건은 성공이 아니라 "바뀐 것이 없음" 이다. 조용히 넘기면 버튼이 죽은 것과 구별되지 않는다.
      if ((data.affected ?? 0) === 0) {
        flash(`"${testItemName}" 에 처리할 배치가 없습니다. 목록을 새로 불러왔습니다.`, "error")
      } else if (data.advanced && data.advanced.length > 0) {
        flash(`시험항목 완료 — QC ${data.advanced.join(", ")} 작업 단계가 자동으로 변경되었습니다.`)
      } else if (action === "clear") {
        flash(`${data.affected}개 배치의 "${testItemName}" 을 완료 처리했습니다.`)
      }
    } catch (e) { flash(`처리 실패: ${e instanceof Error ? e.message : ""}`, "error") }
    finally { setBusy(null) }
  }

  /** 잡 PATCH 코어 — 새로고침/알림 없음 (일괄에서 재사용) */
  const patchJobCore = async (jobId: string, patch: Record<string, string>): Promise<{ message?: string }> => {
    const res = await fetch(`/api/qc-jobs/${jobId}`, {
      method: "PATCH", credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    })
    const data = await res.json().catch(() => ({})) as { error?: string; message?: string }
    if (!res.ok) throw new Error(data.error)
    return data
  }

  const patchJob = async (jobId: string, patch: Record<string, string>) => {
    try {
      const r = await patchJobCore(jobId, patch)
      await load()
      // 지연 해제는 서버가 항목 상태에 맞는 단계로 되돌린다 — 요청과 다르면 알린다
      if (r.message) flash(r.message)
    } catch (e) { flash(`저장 실패: ${e instanceof Error ? e.message : ""}`, "error") }
  }

  // 작업을 상태별로 분리
  const activeJobs = jobs.filter(j => ACTIVE_JOB_STATUSES.has(j.status))

  /**
   * 진행 중 작업을 동시분석 그룹으로 묶는다.
   * 순서는 원래 목록 순서를 따른다 — 그룹으로 묶었다고 카드가 위아래로 튀면
   * 어제 보던 자리에서 오늘 못 찾는다.
   */
  const activeGroupBlocks = useMemo(() => {
    // 그룹으로 묶는 대상은 **서버가 실제로 조작하는 작업**뿐이다(ITEM_EDITABLE_JOB_STATUSES —
    // 진행중·지연·검토전·검토중). 승인전 이후로 넘어간 작업까지 세면 카드는 "1/2" 라고 말하는데
    // 서버는 1건만 처리해, 눌러도 아무 일이 없는 것처럼 보인다. 화면과 서버가 같은 목록을 봐야 한다.
    const byGroup = new Map<string, Job[]>()
    for (const j of activeJobs) {
      if (!j.groupId || !ITEM_EDITABLE_JOB_STATUSES.has(j.status)) continue
      const a = byGroup.get(j.groupId) ?? []; a.push(j); byGroup.set(j.groupId, a)
    }
    const out: ({ kind: "group"; groupId: string; jobs: Job[] } | { kind: "single"; jobs: Job[] })[] = []
    const done = new Set<string>()
    for (const j of activeJobs) {
      const gid = j.groupId
      // 조작 불가 상태(승인전)의 작업은 그룹에 넣지 않고 낱개 카드로 남긴다.
      const mates = gid && ITEM_EDITABLE_JOB_STATUSES.has(j.status) ? byGroup.get(gid) ?? [] : []
      if (gid && mates.length >= 2) {
        if (done.has(gid)) continue
        done.add(gid)
        out.push({ kind: "group", groupId: gid, jobs: mates })
      } else {
        out.push({ kind: "single", jobs: [j] })
      }
    }
    return out
  }, [activeJobs])
  const doneJobs = jobs.filter(j => j.status === CLOSED_STAGE)

  const allJobsSelected = activeJobs.length > 0 && selectedJobs.size === activeJobs.length
  const toggleAllJobs = () => setSelectedJobs(allJobsSelected ? new Set() : new Set(activeJobs.map(j => j.id)))
  const toggleJob = (id: string) =>
    setSelectedJobs(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n })

  /** 선택 적용 — 선택된 진행 중 작업의 상태를 콤보 박스 값으로 일괄 변경 */
  const applyBulkStatus = async () => {
    const ids = activeJobs.filter(j => selectedJobs.has(j.id)).map(j => j.id)
    if (ids.length === 0) return
    setJobBulkBusy(true)
    const nameById = new Map(activeJobs.map(j => [j.id, `QC ${j.qcNo}`] as const))
    let ok = 0
    let redirected = 0
    const failed: string[] = []
    try {
      for (const id of ids) {
        try {
          const r = await patchJobCore(id, { status: bulkStatus })
          ok++
          if (r.message) redirected++
        }
        catch { failed.push(nameById.get(id) ?? id) }
      }
      await load()
      setSelectedJobs(new Set())
      const parts: string[] = [`${ok}건 '${bulkStatus}' 적용`]
      if (redirected) parts.push(`그중 ${redirected}건은 시험항목 상태에 따라 다른 단계로 복귀`)
      if (failed.length) parts.push(`실패 ${failed.length}건`)
      flash(parts.join(" · "), failed.length ? "error" : "info")
    } finally {
      setJobBulkBusy(false)
    }
  }

  if (loading) return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
      {/* 뼈대는 실제 화면과 같은 자리에 놓는다 — 머리말은 카드가 아니라 한 줄이다 */}
      <div className="flex shrink-0 items-baseline justify-between gap-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-3 w-40" />
      </div>
      {/* ① 배정완료 · 시작 대기 */}
      <section className="shrink-0">
        <Skeleton className="mb-3 h-4 w-36" />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="min-w-0 rounded-md border bg-card p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="mt-1 h-3 w-1/2" />
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-3 w-24" />
              </div>
              <Skeleton className="mt-3 h-9 w-full rounded-md" />
            </div>
          ))}
        </div>
      </section>
      {/* ② 진행 중 */}
      <section className="shrink-0">
        <Skeleton className="mb-3 h-4 w-24" />
        <div className="flex flex-col gap-3">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="rounded-md border bg-card">
              <div className="flex flex-col gap-3 border-b px-4 py-3">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-56" />
                <div className="flex gap-2">
                  <Skeleton className="h-8 w-36 rounded-md" />
                  <Skeleton className="h-8 w-36 rounded-md" />
                  <Skeleton className="h-8 w-20 rounded-md" />
                </div>
              </div>
              <div className="px-4 py-3">
                <Skeleton className="mb-2 h-3 w-32" />
                <div className="flex flex-col divide-y">
                  {Array.from({ length: 3 }).map((_, j) => (
                    <div key={j} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2">
                        <Skeleton className="h-4 w-4 rounded-full" />
                        <Skeleton className="h-4 w-32" />
                      </div>
                      <Skeleton className="h-7 w-14 rounded-md" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )

  if (!linked) {
    return (
      <div className="p-4 md:p-6">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-6 text-center dark:border-amber-800 dark:bg-amber-950">
          <AlertTriangle className="mx-auto mb-2 text-amber-500" size={24} />
          {/* break-keep: 좁은 폭에서 한글이 단어 중간에서 끊기지 않게 */}
          <p className="text-sm font-semibold break-keep text-amber-800 dark:text-amber-200">계정에 시험자(담당자)가 연결되어 있지 않습니다.</p>
          <p className="mt-1 text-xs leading-normal break-keep text-amber-700 dark:text-amber-300">관리자에게 계정-시험자 연결을 요청하세요.</p>
        </div>
      </div>
    )
  }

  return (
    <>
      {readinessModal && (
        <ReadinessModal
          result={readinessModal.result}
          onConfirm={confirmStartFromModal}
          onCancel={() => setReadinessModal(null)}
          confirming={startingFromModal}
        />
      )}
      {cancelTarget && (
        <CancelStartDialog
          job={cancelTarget}
          onClose={() => setCancelTarget(null)}
          onDone={(m, type) => {
            setCancelTarget(null)
            flash(m, type)
            void load()
          }}
          onFailed={async () => {
            const targetId = cancelTarget.id
            try {
              const nextJobs = await load()
              // 재조회 자체가 실패했으면(401·500) 판단하지 않는다 — 취소되지 않은 작업의 모달을 닫으면 안 된다.
              if (nextJobs && !nextJobs.some(j => j.id === targetId)) {
                setCancelTarget(null)
                flash("목록을 새로 불러왔습니다. 작업이 이미 취소됐는지 확인해 주세요.", "info")
              }
            } catch {
              // 재조회 실패는 무시한다 — 모달의 원래 오류 메시지를 그대로 둔다.
            }
          }}
        />
      )}

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4 md:p-6">
        {/* 화면 이름을 되풀이하는 부제 대신, 지금 무엇이 몇 건인지를 적는다 */}
        <header className="flex min-w-0 shrink-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold text-foreground">{pageTitle}</h1>
          <p className="text-xs leading-normal break-keep text-muted-foreground">
            시작 대기 <span className="font-semibold tabular-nums text-foreground">{pending.length}</span>건
            <span className="px-1 text-border">·</span>
            진행 중 <span className="font-semibold tabular-nums text-foreground">{activeJobs.length}</span>건
          </p>
        </header>

        {reviewSetupError && (
          <div className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-normal break-keep text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {reviewSetupError}
          </div>
        )}

        {msg && (
          <div className={cn(
            "shrink-0 rounded-md border px-3 py-2 text-sm font-medium",
            msgType === "error"
              ? "border-destructive/20 bg-destructive/10 text-destructive"
              : "border-primary/20 bg-primary/5 text-foreground",
          )}>{msg}</div>
        )}

        {/* ① 배정완료 · 시작 대기 */}
        <section className="flex min-w-0 shrink-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b pb-2">
            <h2 className="text-sm font-semibold text-foreground">
              ① 배정완료 · 시작 대기
              <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{pending.length}건</span>
            </h2>
            {pending.length > 0 && (
              /* flex-wrap: 320px 에서 「전체 선택 + 선택 실행」이 한 줄에 안 들어간다 */
              <div className="flex flex-wrap items-center justify-end gap-2">
                <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    disabled={bulkBusy}
                    className="cb-custom"
                  />
                  전체 선택
                </label>
                <Button
                  size="sm"
                  onClick={() => void startSelected()}
                  disabled={selected.size === 0 || bulkBusy || busy !== null}
                >
                  {bulkBusy ? <Loader2 className="animate-spin" /> : <Play />}
                  선택 실행 ({selected.size})
                </Button>
              </div>
            )}
          </div>
          {pending.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">대기 중인 오더가 없습니다.</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {pending.map(o => {
                const dd = dDay(o.dueDate)
                const isBusy = busy === o.id
                const isChecked = selected.has(o.id)
                return (
                  /* min-w-0: 그리드 칸의 기본 최소폭은 내용 크기라, 긴 품목명이 칸을 화면 밖으로 밀어낸다 */
                  <Card key={o.id} className={cn("min-w-0 gap-0 px-3 py-3", isChecked && "ring-2 ring-primary/30")}>
                    <div className="flex items-start gap-2">
                      <input
                        type="checkbox"
                        checked={isChecked}
                        onChange={() => toggleOne(o.id)}
                        disabled={bulkBusy}
                        aria-label={`${o.productName} ${o.batchNo} 선택`}
                        className="cb-custom mt-0.5"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-foreground">{o.productName}</p>
                        <p className="font-mono text-xs text-muted-foreground">{o.batchNo}</p>
                      </div>
                      {o.isUrgent && <Badge variant="destructive">긴급</Badge>}
                    </div>
                    <div className="mt-2 flex min-w-0 items-center gap-2 text-xs leading-normal text-muted-foreground">
                      <span className="min-w-0 truncate">{o.method}</span>
                      {o.dueDate && (
                        <span className="shrink-0 tabular-nums">
                          · 완료예정 {o.dueDate}
                          {dd != null && dd <= 7 && (
                            <span className="ml-1 font-semibold text-destructive">
                              D{dd >= 0 ? `-${dd}` : `+${-dd}`}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    <Button
                      className="mt-3 w-full"
                      onClick={() => start(o.id)}
                      disabled={busy !== null || bulkBusy}
                    >
                      {isBusy ? <Loader2 className="animate-spin" /> : <Play />}
                      작업 시작
                    </Button>
                  </Card>
                )
              })}
            </div>
          )}
        </section>

        {/* ② 진행 중 */}
        <section className="flex min-w-0 shrink-0 flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b pb-2">
            <h2 className="text-sm font-semibold text-foreground">
              ② 진행 중
              <span className="ml-1.5 text-xs font-normal tabular-nums text-muted-foreground">{activeJobs.length}건</span>
            </h2>
            {activeJobs.length > 0 && (
              /* flex-wrap: 320px 에서 「전체 선택 + 상태 + 선택 적용」이 한 줄에 안 들어간다 */
              <div className="flex flex-wrap items-center justify-end gap-2">
                <label className="inline-flex min-h-8 cursor-pointer items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={allJobsSelected}
                    onChange={toggleAllJobs}
                    disabled={jobBulkBusy}
                    className="cb-custom"
                  />
                  전체 선택
                </label>
                <Select value={bulkStatus} onValueChange={setBulkStatus}>
                  <SelectTrigger className="h-8 w-20 rounded-md text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  onClick={() => void applyBulkStatus()}
                  disabled={selectedJobs.size === 0 || jobBulkBusy}
                >
                  {jobBulkBusy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
                  선택 적용 ({selectedJobs.size})
                </Button>
              </div>
            )}
          </div>
          {activeJobs.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">진행 중인 작업이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {/* 같은 동시분석 그룹의 작업이 2건 이상이면 카드 하나로 묶는다.
                  1건뿐이면 묶을 것이 없으므로 예전 낱개 카드 그대로 — 렌더 경로를 나눠
                  기존 화면이 이번 변경에 영향을 받지 않게 한다. */}
              {activeGroupBlocks.map(b =>
                b.kind === "group"
                  ? renderGroupCard(b.groupId, b.jobs)
                  : renderJobCard(b.jobs[0], true))}
            </div>
          )}
        </section>

        {/* ③ 종료 (완료) */}
        {/* 끝난 작업은 위계가 한 단 아래다 — 실선 없이 조용한 제목만 둔다(섹션마다 리듬을 다르게) */}
        <section className="flex min-w-0 shrink-0 flex-col gap-3">
          <h2 className="text-sm font-semibold text-muted-foreground">
            ③ 종료 · 완료
            <span className="ml-1.5 text-xs font-normal tabular-nums">{doneJobs.length}건</span>
          </h2>
          {doneJobs.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">완료된 작업이 없습니다.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {doneJobs.map(job => renderJobCard(job))}
            </div>
          )}
        </section>
      </div>
    </>
  )

  /**
   * 그룹 카드 — 같은 동시분석 그룹의 배치들을 하나로 본다.
   *
   * 시험자는 3개 배치를 한 시퀀스로 돌리면서 「성상 완료」를 세 번 누르고 있었다.
   * 여기서는 한 번이다. 다만 **기록은 배치마다 그대로 남는다** — 제조번호별 시험 기록과
   * 성적서가 분리돼야 한다는 것(GMP 추적성)은 화면 편의와 바꾸지 않는다.
   */
  function renderGroupCard(groupId: string, groupJobs: Job[]) {
    // 같은 이름의 항목을 배치들에 걸쳐 합친다. 배치마다 항목 구성이 다를 수 있어
    // total 은 "그 이름을 가진 배치 수" 다 — 3건 중 2건에만 있는 항목이 정상적으로 존재한다.
    const merged = new Map<string, MergedItem>()
    for (const j of groupJobs) {
      for (const it of j.items) {
        const m = merged.get(it.testItemName) ?? {
          name: it.testItemName, total: 0, cleared: 0, inProgress: 0, earliestStart: null, reviewing: 0, reviewed: 0,
        }
        m.total += 1
        if (it.status === ITEM_CLEARED) m.cleared += 1
        if (it.reviewStatus === ITEM_REVIEW_REVIEWING) m.reviewing += 1
        if (it.reviewStatus === ITEM_REVIEW_REVIEWED) m.reviewed += 1
        if (it.status === ITEM_IN_PROGRESS) {
          m.inProgress += 1
          if (it.startedAt && (!m.earliestStart || it.startedAt < m.earliestStart)) m.earliestStart = it.startedAt
        }
        merged.set(it.testItemName, m)
      }
    }
    const items = [...merged.values()]
    const allCleared = items.filter(i => i.cleared === i.total).length
    // 그룹에는 조작 가능한 작업만 묶이지만, 방어적으로 서버 기준(ITEM_EDITABLE_JOB_STATUSES)을 한 번 더 본다
    const anyDone = !groupJobs.every(j => ITEM_EDITABLE_JOB_STATUSES.has(j.status))
    const dd = dDay(groupJobs.map(j => j.dueDate).filter(Boolean).sort()[0] ?? null)

    return (
      <Card key={`grp-${groupId}`} className="gap-0 overflow-hidden border-primary/30 py-0">
        <div className="flex flex-col gap-2 border-b bg-primary/5 px-4 py-3">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <Badge variant="outline" className="gap-1 border-primary/40 bg-primary/10 text-primary">
              <Layers className="size-3" />동시분석 {groupJobs.length}건
            </Badge>
            <span className="min-w-0 truncate text-sm font-semibold text-foreground">
              {groupJobs[0].productName}
            </span>
            {groupJobs[0].groupLabel && (
              <span className="truncate text-xs text-muted-foreground">· {groupJobs[0].groupLabel}</span>
            )}
            {dd != null && dd <= 7 && !anyDone && (
              <Badge variant="outline" className="border-red-200 text-red-700 dark:border-red-800 dark:text-red-300">
                D{dd < 0 ? `+${-dd}` : `-${dd}`}
              </Badge>
            )}
          </div>
          {/* 어떤 제조번호가 함께 도는지 — 이것이 그룹 카드의 핵심 정보다 */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs leading-normal text-muted-foreground">
            {groupJobs.map(j => (
              <span key={j.id} className="inline-flex items-center rounded-md border px-1.5 font-mono tabular-nums">
                {j.batchNo}
                <span className={cn("ml-1 font-sans", statusCls(j.status))}>{j.status}</span>
                {/* 시작 취소는 배치(작업) 하나씩만 — 그룹 전체로 번지지 않는다 */}
                {canCancelStart(j) && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="ml-0.5"
                    title={`QC ${j.qcNo} 작업 시작 취소`}
                    aria-label={`QC ${j.qcNo} 작업 시작 취소`}
                    onClick={() => setCancelTarget(j)}
                    disabled={busy !== null}
                  >
                    <Undo2 className="size-3" />
                  </Button>
                )}
              </span>
            ))}
            {groupJobs[0].groupSize > groupJobs.length && (
              <span className="text-muted-foreground/70">
                (그룹 전체 {groupJobs[0].groupSize}건 중 내 몫 {groupJobs.length}건)
              </span>
            )}
          </div>
        </div>

        <div className="px-4 py-3">
          <p className="mb-1 text-xs leading-normal font-semibold text-muted-foreground">
            시험항목 진행 <span className="tabular-nums text-foreground">{allCleared}/{items.length}</span>
            <span className="px-1 text-border">·</span>
            한 번 누르면 <span className="font-medium text-foreground">{groupJobs.length}개 배치</span>에 함께 기록됩니다
          </p>
          {items.length === 0 ? (
            <p className="py-2 text-xs leading-normal text-muted-foreground">등록된 시험항목이 없습니다.</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {items.map(m => {
                const done = m.cleared === m.total
                const running = m.inProgress > 0
                const key = `${groupId}:${m.name}`
                const itemBusy = busy === key
                return (
                  <li key={m.name} className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5">
                    <div className="flex min-w-0 items-center gap-2">
                      {done
                        ? <CheckCircle2 size={16} className="shrink-0 text-blue-600 dark:text-blue-300" />
                        : running
                          ? <LoaderCircle size={16} className="shrink-0 animate-spin text-primary" />
                          : <Circle size={16} className="shrink-0 text-muted-foreground" />}
                      <span className={cn("min-w-0 truncate text-sm",
                        done ? "font-medium text-blue-800 dark:text-blue-200" : running ? "font-semibold text-foreground" : "text-foreground")}>
                        {m.name}
                      </span>
                      {/* 배치마다 상태가 다를 수 있다 — 합쳐 보이되 몇 건이 끝났는지는 숨기지 않는다 */}
                      <span className="shrink-0 text-xs leading-normal tabular-nums text-muted-foreground">
                        {m.cleared}/{m.total}
                      </span>
                      {running && m.earliestStart && (
                        <span className="shrink-0 text-xs leading-normal tabular-nums text-primary">
                          {formatElapsedMinutes(minutesSince(m.earliestStart, nowTick))} 경과
                        </span>
                      )}
                    </div>
                    {done ? (
                      <span className="shrink-0 text-xs leading-normal text-blue-700 dark:text-blue-300">
                        완료
                        {/* 검토는 관리자가 배치(항목)마다 한다 — 시험자는 진행 정도만 본다 */}
                        {m.reviewed + m.reviewing > 0 && (
                          <span className="ml-1.5 tabular-nums text-muted-foreground">
                            · 검토 완료 {m.reviewed}/{m.total}{m.reviewing > 0 && ` · 검토 중 ${m.reviewing}`}
                          </span>
                        )}
                      </span>
                    ) : anyDone ? null : running ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button variant="ghost" size="icon-sm" title="시작 취소 — 대기로 되돌립니다"
                          onClick={() => void groupItemAction(groupId, m.name, "cancel")} disabled={busy !== null}>
                          <Undo2 className="size-3.5" />
                        </Button>
                        <Button size="sm" onClick={() => void groupItemAction(groupId, m.name, "clear")} disabled={busy !== null}>
                          {itemBusy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}완료
                        </Button>
                      </div>
                    ) : (
                      <Button variant="outline" size="sm"
                        onClick={() => void groupItemAction(groupId, m.name, "start")} disabled={busy !== null}>
                        {itemBusy ? <Loader2 className="animate-spin" /> : <Play />}시작
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Card>
    )
  }

  function renderJobCard(job: Job, selectable = false) {
    const cleared = job.items.filter(i => i.status === ITEM_CLEARED).length
    const running = job.items.filter(i => i.status === ITEM_IN_PROGRESS).length
    const dd = dDay(job.dueDate)
    const isDone = job.status === CLOSED_STAGE
    return (
      <Card key={job.id} className={cn("gap-0 overflow-hidden py-0", isDone && "border-blue-300 dark:border-blue-700")}>
        <div className="flex flex-col gap-3 border-b px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div className="flex min-w-0 items-start gap-2">
            {selectable && (
              <input
                type="checkbox"
                checked={selectedJobs.has(job.id)}
                onChange={() => toggleJob(job.id)}
                disabled={jobBulkBusy}
                aria-label={`QC ${job.qcNo} 선택`}
                className="cb-custom mt-1"
              />
            )}
            <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-mono text-sm font-semibold text-primary">QC {job.qcNo}</span>
              {job.isUrgent && <Badge variant="destructive">긴급</Badge>}
              {dd != null && dd <= 7 && !isDone && (
                <Badge variant="outline" className="gap-1 border-destructive/30 tabular-nums text-destructive">
                  <Clock size={10} />D{dd >= 0 ? `-${dd}` : `+${-dd}`}
                </Badge>
              )}
            </div>
            <p className="mt-0.5 truncate text-sm font-semibold text-foreground">
              {job.productName} <span className="font-mono text-xs font-normal text-muted-foreground">/ {job.batchNo}</span>
              {/* 동시분석 묶음인데 지금은 함께 조작할 수 없는 경우(나머지가 검토 단계로 넘어감).
                  묶음 표시를 통째로 지우면 "어제는 한 카드였는데" 가 되므로 사실만 남긴다. */}
              {job.groupId && job.groupSize > 1 && (
                <span
                  className="ml-1.5 inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 align-middle text-xs leading-normal font-medium text-muted-foreground"
                  title={`동시분석 ${job.groupSize}건 묶음 · 지금 함께 진행할 수 있는 배치가 없어 따로 표시됩니다`}
                >
                  <Layers className="size-3" />동시 {job.groupSize}
                </span>
              )}
            </p>
            </div>
          </div>
          {/* 모바일에서는 날짜 두 칸을 각각 한 줄 꽉 채워 손가락으로 누르기 쉽게 하고,
              sm 이상에서만 고정 폭으로 나란히 세운다. */}
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2 md:justify-end">
            <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto sm:shrink-0">
              <span className="w-8 shrink-0 text-xs text-muted-foreground">시작</span>
              <div className="min-w-0 flex-1 sm:w-32 sm:flex-none">
                <DateField
                  size="sm"
                  noLabel
                  value={job.workStartDate ?? ""}
                  onChange={v => patchJob(job.id, { workStartDate: v })}
                  placeholder="시작일"
                />
              </div>
            </div>
            <div className="flex w-full min-w-0 items-center gap-1.5 sm:w-auto sm:shrink-0">
              <span className="w-8 shrink-0 text-xs text-muted-foreground">종료</span>
              <div className="min-w-0 flex-1 sm:w-32 sm:flex-none">
                <DateField
                  size="sm"
                  noLabel
                  value={job.workEndDate ?? ""}
                  onChange={v => patchJob(job.id, { workEndDate: v })}
                  placeholder="종료일"
                />
              </div>
            </div>
            {/* 담당자가 바꿀 수 있는 단계(진행중·지연)만 선택형으로 둔다.
                검토전·검토중·승인전은 서버가 항목 상태에서 도출하고 승인완료는 관리자가 승인하므로 읽기 전용으로 표시한다.
                (STATUS_OPTIONS 에 없는 값을 Select 에 넣으면 라벨이 빈칸으로 렌더된다) */}
            {STATUS_OPTIONS.includes(job.status) ? (
              <Select
                value={job.status}
                onValueChange={v => patchJob(job.id, { status: v })}
              >
                <SelectTrigger className={`h-8 shrink-0 rounded-md border px-2.5 text-xs leading-normal font-semibold focus-visible:outline-none ${statusCls(job.status)}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            ) : (
              <span
                title="검토·승인 단계는 시험항목 검토에 따라 서버가 정합니다. 승인은 관리자가 합니다."
                className={cn(
                  'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs leading-normal font-semibold',
                  statusCls(job.status),
                )}
              >
                <span className={cn('size-1.5 rounded-full', stageStyle(job.status).dot)} />
                {job.status}
              </span>
            )}
            {/* 잘못 누른 [작업 시작] 되돌리기 — 항목을 하나도 시작하지 않은 진행중 작업에만 보인다 */}
            {selectable && canCancelStart(job) && (
              <Button
                variant="outline"
                size="sm"
                className="shrink-0"
                title="작업 시작 취소 — 내 작업 기록과 QC번호가 삭제됩니다. 다른 담당자 작업이 없으면 오더가 시작 대기로 돌아갑니다."
                onClick={() => setCancelTarget(job)}
                disabled={busy !== null}
              >
                <Undo2 />시작 취소
              </Button>
            )}
          </div>
        </div>

        {/* 항목 체크리스트 */}
        <div className="px-4 py-3">
          {/* 카드 안에 또 카드를 넣지 않는다 — 항목마다 두르던 테두리를 걷고 실선 한 겹으로 나눈다 */}
          <p className="mb-1 text-xs leading-normal font-semibold text-muted-foreground">
            시험항목 진행 <span className="tabular-nums text-foreground">{cleared}/{job.items.length}</span>
            {running > 0 && (
              <span className="text-primary"> · 진행 중 <span className="tabular-nums">{running}</span>건</span>
            )}
          </p>
          {job.items.length === 0 ? (
            <p className="py-2 text-xs leading-normal text-muted-foreground">등록된 시험항목이 없습니다. (품목-시험항목 매핑 확인 필요)</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {/* 순번은 안내일 뿐 강제가 아니다 — 시험자가 시작할 항목을 직접 고른다. */}
              {job.items.map(it => {
                const done = it.status === ITEM_CLEARED
                const started = it.status === ITEM_IN_PROGRESS
                const itemBusy = busy === it.id
                // 조작 버튼은 서버가 받아 주는 경우에만 — 작업이 승인전·승인완료거나 검토가 시작된 항목이면 숨긴다
                const locked = !ITEM_EDITABLE_JOB_STATUSES.has(job.status) || hasReviewTrace(it.reviewStatus)
                return (
                  <li
                    key={it.id}
                    /* flex-wrap: 좁은 폭에서 완료 시각·소요시간이 항목명을 짓누르지 않고 아랫줄로 내려간다 */
                    className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-1.5"
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      {done
                        ? <CheckCircle2 size={16} className="shrink-0 text-blue-600 dark:text-blue-300" />
                        : started
                          ? <LoaderCircle size={16} className="shrink-0 animate-spin text-primary" />
                          : <Circle size={16} className="shrink-0 text-muted-foreground" />}
                      <span className={cn(
                        "min-w-0 truncate text-sm",
                        done ? "font-medium text-blue-800 dark:text-blue-200"
                          : started ? "font-semibold text-foreground"
                          : "text-foreground",
                      )}>
                        {it.testItemName}
                      </span>
                      {/* 진행 중 항목은 시작 후 경과시간을 이름 옆에 붙인다 — 여러 건을 걸어둔
                          시험자가 어느 것이 오래 돌고 있는지 한눈에 보게 한다. */}
                      {started && it.startedAt && (
                        <span className="shrink-0 text-xs leading-normal tabular-nums text-primary">
                          {formatElapsedMinutes(minutesSince(it.startedAt, nowTick))} 경과
                        </span>
                      )}
                    </div>
                    {done ? (
                      <span className="flex shrink-0 flex-wrap items-center justify-end gap-x-2 gap-y-0.5">
                        <span className="text-xs leading-normal tabular-nums text-blue-700 dark:text-blue-300">
                          {it.clearedAt && new Date(it.clearedAt).toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                          {/* 작업 시작 기준 누적 소요시간 (항목 실소요가 다르면 함께 표기) */}
                          {(() => {
                            const label = formatItemElapsed(it.elapsedTotalMinutes, it.elapsedMinutes)
                            return label && ` · ${label}`
                          })()}
                        </span>
                        {/* 검토 상태 — 읽기 전용. 검토는 관리자가 항목마다 한다 */}
                        <ItemReviewBadge item={it} />
                      </span>
                    ) : locked ? null : started ? (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="시작 취소 — 대기로 되돌립니다"
                          onClick={() => void itemAction(job.id, it.id, "cancel")}
                          disabled={busy !== null}
                        >
                          <Undo2 className="size-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          onClick={() => void itemAction(job.id, it.id, "clear")}
                          disabled={busy !== null}
                        >
                          {itemBusy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}완료
                        </Button>
                      </div>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void itemAction(job.id, it.id, "start")}
                        disabled={busy !== null}
                      >
                        {itemBusy ? <Loader2 className="animate-spin" /> : <Play />}시작
                      </Button>
                    )}
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </Card>
    )
  }
}
