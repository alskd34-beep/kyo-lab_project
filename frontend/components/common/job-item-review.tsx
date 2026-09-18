"use client"

/**
 * [FRONTEND] 시험항목 단위 검토 — 배지 · 항목 행 액션(관리자) · 일괄 편의 버튼(관리자)
 *
 * 작업자 작업 현황(JobDetailModal)과 시험현황(TestDetailDrawer)이 같은 부품을 써야
 * 화면마다 검토 표현·버튼 노출 규칙이 갈리지 않는다.
 *
 * 버튼 노출은 보조 판정일 뿐이다. 최종 허용 판정·기록·작업 단계 도출은 서버(DB 함수 0048)가 한다.
 * 규칙 전문: intent/2026-09-15-item-level-review-spec.md
 *
 * 검토 시작·완료는 판정 성격이므로 개별 경로에서는 이 배치에만 적용한다.
 * 관리자가 명시적으로 그룹 버튼을 누른 경우에만 여러 배치에 일괄 적용한다(0051).
 * 규칙 전문: intent/2026-09-15-group-stage-progress-spec.md
 */

import { useState } from "react"
import { CheckCheck, ClipboardCheck, Loader2, RotateCcw, Undo2 } from "lucide-react"
import {
  CLOSED_STAGE, ITEM_CLEARED, ITEM_REVIEW_ACTION_LABEL, ITEM_REVIEW_LABEL, ITEM_REVIEW_NONE,
  ITEM_REVIEW_REVIEWED, ITEM_REVIEW_REVIEWING,
  type ItemReviewAction, type ItemReviewBulkAction, type ItemReviewStatus,
} from "@shared/qc-status"
import { api, errorMessage } from "@frontend/lib/api-client"
import { cn } from "@frontend/lib/utils"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Input } from "@frontend/components/ui/input"
import type { GroupReviewResult } from "@shared/qc-group-stage"
import {
  GroupTargetConfirmDialog, groupApplyLabel, groupReviewItemCount, groupReviewTargets, isGroupActionable,
  useGroupStageResultToast, type JobGroupSummary,
} from "@frontend/components/common/job-group-stage"
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@frontend/components/ui/dialog"

/** 검토 표시에 필요한 항목 필드 (백엔드 JobItemRow 의 부분집합) */
export interface ReviewableItem {
  id: string
  testItemName: string
  status: string
  reviewStatus?: string | null
  reviewStartedAt?: string | null
  reviewStartedByName?: string | null
  reviewedAt?: string | null
  reviewedByName?: string | null
}

function reviewStatusOf(item: ReviewableItem): ItemReviewStatus {
  const s = item.reviewStatus
  return s === ITEM_REVIEW_REVIEWING || s === ITEM_REVIEW_REVIEWED ? s : ITEM_REVIEW_NONE
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  })
}

/** 검토 배지 색 — 검토 대기(중립) · 검토 중(파랑 옅게) · 검토 완료(파랑 진하게) */
const REVIEW_BADGE_CLS: Record<ItemReviewStatus, string> = {
  none: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
  reviewing: "border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-300",
  reviewed: "border-blue-400 bg-blue-100 text-blue-900 dark:border-blue-600 dark:bg-blue-900/60 dark:text-blue-200",
}

/**
 * 항목 검토 배지. 시험이 끝나지 않은 항목에는 아무것도 그리지 않는다.
 * meta 를 켜면 검토자·시각을 함께 보인다(도입 전 백필 항목은 기록이 없다고 적는다).
 */
export function ItemReviewBadge({ item, meta = false, className }: {
  item: ReviewableItem
  meta?: boolean
  className?: string
}) {
  if (item.status !== ITEM_CLEARED) return null
  const rs = reviewStatusOf(item)
  let metaText: string | null = null
  if (meta && rs === ITEM_REVIEW_REVIEWING) {
    metaText = item.reviewStartedByName || item.reviewStartedAt
      ? [item.reviewStartedByName, item.reviewStartedAt && formatDateTime(item.reviewStartedAt)].filter(Boolean).join(" · ")
      : "검토자 기록 없음(도입 전)"
  } else if (meta && rs === ITEM_REVIEW_REVIEWED) {
    metaText = item.reviewedByName || item.reviewedAt
      ? [item.reviewedByName, item.reviewedAt && formatDateTime(item.reviewedAt)].filter(Boolean).join(" · ")
      : "검토자 기록 없음(도입 전)"
  }
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      <Badge variant="outline" className={cn("shrink-0", REVIEW_BADGE_CLS[rs])}>{ITEM_REVIEW_LABEL[rs]}</Badge>
      {metaText && <span className="truncate text-xs leading-normal text-muted-foreground">{metaText}</span>}
    </span>
  )
}

/** 사유 입력 모달의 동작별 문구 — spec §8 */
const REASON_DIALOG_BODY: Partial<Record<ItemReviewAction, string>> = {
  reopen: "이 시험항목의 시작·완료 시각, 소요시간, 검토 기록이 비워지고 대기로 돌아갑니다. 원래 기록은 이력에 남습니다.",
  review_cancel: "이 시험항목의 검토 시작 기록이 비워지고 검토 대기로 돌아갑니다. 원래 기록은 이력에 남습니다.",
}

/** 검토 완료 확인 문구 — 검토 완료는 되돌릴 수 없다(F1-2) (리뷰 M1) */
const REVIEW_COMPLETE_WARNING =
  "검토 완료는 되돌릴 수 없습니다. 바꾸려면 재실시해야 하며, 재실시는 시험 기록을 초기화합니다."

/** 검토 완료 확인 모달 — 단건·일괄 공통. 대상 항목 수와 이름을 보여 준다 */
function ReviewCompleteConfirmDialog({ names, busy, error, onConfirm, onClose }: {
  names: string[]
  busy: boolean
  error: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={next => { if (!next && !busy) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>검토 완료</DialogTitle>
          <DialogDescription className="text-xs leading-normal break-keep">
            시험항목 {names.length}건을 검토 완료로 기록합니다.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-normal break-keep text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {REVIEW_COMPLETE_WARNING}
          </p>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">대상 시험항목 {names.length}건</span>
            <ul className="max-h-48 overflow-y-auto rounded-md border px-3 py-2 text-sm text-foreground">
              {names.map((n, i) => <li key={`${n}-${i}`} className="truncate">{n}</li>)}
            </ul>
          </div>
          {error && <p className="text-xs leading-normal break-keep text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>닫기</Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <CheckCheck />}
            검토 완료 {names.length}건
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 검토 취소·재실시 사유 모달 — 사유가 2자 이상일 때만 확인 버튼이 활성화된다 */
function ReviewReasonDialog({ action, item, busy, error, onSubmit, onClose }: {
  action: "review_cancel" | "reopen"
  item: ReviewableItem
  busy: boolean
  error: string | null
  onSubmit: (reason: string) => void
  onClose: () => void
}) {
  const [reason, setReason] = useState("")
  const label = ITEM_REVIEW_ACTION_LABEL[action]
  const ok = reason.trim().length >= 2
  return (
    <Dialog open onOpenChange={next => { if (!next && !busy) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription className="text-xs leading-normal break-keep">
            시험항목 &quot;{item.testItemName}&quot;
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-normal break-keep text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {REASON_DIALOG_BODY[action]}
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">{label} 사유 (필수, 2자 이상)</span>
            <Input
              autoFocus
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="사유를 입력하세요"
              disabled={busy}
            />
          </label>
          {error && <p className="text-xs leading-normal break-keep text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>닫기</Button>
          <Button
            variant={action === "reopen" ? "destructive" : "default"}
            onClick={() => onSubmit(reason.trim())}
            disabled={busy || !ok}
          >
            {busy ? <Loader2 className="animate-spin" /> : action === "reopen" ? <RotateCcw /> : <Undo2 />}
            {label}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/**
 * 항목 행의 관리자 검토 액션.
 *   검토 대기(cleared+none) → [검토 시작] · 검토 중 → [검토 완료] [검토 취소] · 완료 항목 → [재실시]
 * 작업이 승인완료면 전부 숨긴다.
 */
export function ItemReviewActions({ jobId, jobStatus, item, disabled = false, onChanged, group = null }: {
  jobId: string
  jobStatus: string
  item: ReviewableItem
  disabled?: boolean
  /** 검토가 반영된 뒤 호출 — 상세·이력·목록 갱신에 쓴다 */
  onChanged: () => void
  /** 작업이 속한 동시분석 그룹(관리자 상세 응답). 명시적 그룹 검토 버튼의 대상 계산에 쓴다 */
  group?: JobGroupSummary | null
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reasonAction, setReasonAction] = useState<"review_cancel" | "reopen" | null>(null)
  const [confirmComplete, setConfirmComplete] = useState(false)
  const [confirmGroupStart, setConfirmGroupStart] = useState(false)
  const [confirmGroupComplete, setConfirmGroupComplete] = useState(false)
  const [busySource, setBusySource] = useState<"group" | "single" | null>(null)
  const showGroupResult = useGroupStageResultToast()

  if (jobStatus === CLOSED_STAGE || item.status !== ITEM_CLEARED) return null
  const rs = reviewStatusOf(item)

  // 그룹 적용 대상 — 이 배치 말고 다른 배치에도 적용할 것이 있을 때만 그룹 버튼을 보인다(보조 판정)
  const groupOn = isGroupActionable(group)
  const startTargets = groupOn ? groupReviewTargets(group, "review_start", item.testItemName) : []
  const completeTargets = groupOn ? groupReviewTargets(group, "review_complete", item.testItemName) : []
  const showGroupStart = startTargets.some(m => m.jobId !== jobId)
  const showGroupComplete = completeTargets.some(m => m.jobId !== jobId)

  async function runGroup(action: ItemReviewBulkAction) {
    if (!group) return
    setBusy(true); setBusySource("group"); setError(null)
    try {
      const res = await api.post<GroupReviewResult>(
        `/api/qc-jobs/group/${group.groupId}/review`, { testItemName: item.testItemName, action },
      )
      showGroupResult(`"${item.testItemName}" ${ITEM_REVIEW_ACTION_LABEL[action]}(그룹)`, res)
      setConfirmGroupStart(false)
      setConfirmGroupComplete(false)
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false); setBusySource(null)
    }
  }

  async function run(action: ItemReviewAction, reason?: string) {
    setBusy(true); setBusySource("single"); setError(null)
    try {
      await api.post(`/api/qc-jobs/${jobId}/items/${item.id}/review`, reason === undefined ? { action } : { action, reason })
      setReasonAction(null)
      setConfirmComplete(false)
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false); setBusySource(null)
    }
  }

  const off = busy || disabled
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-1">
        {/* 판정은 배치별이 기본 — 그룹 버튼은 관리자가 명시적으로 누를 때만 실행한다 */}
        {showGroupStart && (
          <Button size="sm" variant="outline" onClick={() => { setError(null); setConfirmGroupStart(true) }} disabled={off}>
            {busySource === "group" ? <Loader2 className="animate-spin" /> : <ClipboardCheck />}
            검토 시작 ({groupApplyLabel(startTargets.length)})
          </Button>
        )}
        {rs === ITEM_REVIEW_NONE && (
          <Button size="sm" variant="default" onClick={() => void run("review_start")} disabled={off}>
            {busySource === "single" ? <Loader2 className="animate-spin" /> : <ClipboardCheck />}
            {showGroupStart ? "이 배치만" : "검토 시작"}
          </Button>
        )}
        {showGroupComplete && (
          <Button size="sm" variant="outline" onClick={() => { setError(null); setConfirmGroupComplete(true) }} disabled={off}>
            <CheckCheck />검토 완료 ({groupApplyLabel(completeTargets.length)})
          </Button>
        )}
        {rs === ITEM_REVIEW_REVIEWING && (
          <>
            <Button
              size="sm"
              variant="default"
              onClick={() => { setError(null); setConfirmComplete(true) }}
              disabled={off}
            >
              {busySource === "single" ? <Loader2 className="animate-spin" /> : <CheckCheck />}{showGroupComplete ? "이 배치만 검토 완료" : "검토 완료"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setError(null); setReasonAction("review_cancel") }} disabled={off}>
              <Undo2 />검토 취소
            </Button>
          </>
        )}
        <Button size="sm" variant="ghost" onClick={() => { setError(null); setReasonAction("reopen") }} disabled={off}>
          <RotateCcw />재실시
        </Button>
      </div>
      {error && !reasonAction && !confirmComplete && !confirmGroupStart && !confirmGroupComplete && <p className="text-right text-xs leading-normal break-keep text-destructive">{error}</p>}
      {confirmGroupStart && (
        <GroupTargetConfirmDialog
          title="검토 시작 — 동시분석 그룹"
          description={`시험항목 "${item.testItemName}" 을 그룹 ${startTargets.length}배치에서 검토 시작으로 기록합니다. 검토 기록은 배치마다 남습니다.`}
          warning="모든 배치에 같은 판정이 적용됩니다."
          targets={startTargets}
          busy={busy}
          error={error}
          confirmLabel={`검토 시작 ${startTargets.length}배치`}
          onConfirm={() => void runGroup("review_start")}
          onClose={() => { setConfirmGroupStart(false); setError(null) }}
        />
      )}
      {confirmGroupComplete && (
        <GroupTargetConfirmDialog
          title="검토 완료 — 동시분석 그룹"
          description={`시험항목 "${item.testItemName}" 을 그룹 ${completeTargets.length}배치에서 검토 완료로 기록합니다. 검토 기록은 배치마다 남습니다.`}
          warning={`모든 배치에 같은 판정이 적용됩니다. ${REVIEW_COMPLETE_WARNING}`}
          targets={completeTargets}
          busy={busy}
          error={error}
          confirmLabel={`검토 완료 ${completeTargets.length}배치`}
          onConfirm={() => void runGroup("review_complete")}
          onClose={() => { setConfirmGroupComplete(false); setError(null) }}
        />
      )}
      {confirmComplete && (
        <ReviewCompleteConfirmDialog
          names={[item.testItemName]}
          busy={busy}
          error={error}
          onConfirm={() => void run("review_complete")}
          onClose={() => { setConfirmComplete(false); setError(null) }}
        />
      )}
      {reasonAction && (
        <ReviewReasonDialog
          action={reasonAction}
          item={item}
          busy={busy}
          error={error}
          onSubmit={reason => void run(reasonAction, reason)}
          onClose={() => { setReasonAction(null); setError(null) }}
        />
      )}
    </div>
  )
}

/**
 * 일괄 편의 버튼 + 검토 요약(관리자).
 *   완료 항목 전체 검토 시작 / 검토 중 항목 전체 검토 완료 — 각각 대상이 1건 이상일 때만.
 * 서버가 한 트랜잭션으로 처리한다(전부 성공 아니면 전부 실패). 기록은 항목마다 남는다.
 */
export function BulkReviewBar({ jobId, jobStatus, items, onChanged, className, group = null }: {
  jobId: string
  jobStatus: string
  items: ReviewableItem[]
  onChanged: () => void
  className?: string
  /** 작업이 속한 동시분석 그룹. 그룹 버튼은 명시적으로 선택한 경우에만 여러 배치에 적용 */
  group?: JobGroupSummary | null
}) {
  const [busy, setBusy] = useState<ItemReviewBulkAction | null>(null)
  const [busySource, setBusySource] = useState<"group" | "single" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmComplete, setConfirmComplete] = useState(false)
  const [confirmGroupStart, setConfirmGroupStart] = useState(false)
  const [confirmGroupComplete, setConfirmGroupComplete] = useState(false)
  const showGroupResult = useGroupStageResultToast()

  const groupOn = isGroupActionable(group)
  const groupStartTargets = groupOn ? groupReviewTargets(group, "review_start", null) : []
  const groupCompleteTargets = groupOn ? groupReviewTargets(group, "review_complete", null) : []
  const groupCompleteItems = groupOn ? groupReviewItemCount(group, "review_complete") : 0
  const showGroupStart = groupStartTargets.some(m => m.jobId !== jobId)
  const showGroupComplete = groupCompleteTargets.some(m => m.jobId !== jobId)

  async function runGroup(action: ItemReviewBulkAction) {
    if (!group) return
    setBusy(action); setBusySource("group"); setError(null)
    try {
      const res = await api.post<GroupReviewResult>(`/api/qc-jobs/group/${group.groupId}/review-bulk`, { action })
      showGroupResult(
        action === "review_start" ? "완료 항목 전체 검토 시작(그룹)" : "검토 중 항목 전체 검토 완료(그룹)", res,
      )
      setConfirmGroupStart(false)
      setConfirmGroupComplete(false)
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null); setBusySource(null)
    }
  }

  const waiting = items.filter(i => i.status === ITEM_CLEARED && reviewStatusOf(i) === ITEM_REVIEW_NONE).length
  const reviewing = items.filter(i => reviewStatusOf(i) === ITEM_REVIEW_REVIEWING).length
  const reviewed = items.filter(i => reviewStatusOf(i) === ITEM_REVIEW_REVIEWED).length
  const closed = jobStatus === CLOSED_STAGE

  async function run(action: ItemReviewBulkAction) {
    setBusy(action); setBusySource("single"); setError(null)
    try {
      await api.post(`/api/qc-jobs/${jobId}/review-bulk`, { action })
      setConfirmComplete(false)
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null); setBusySource(null)
    }
  }

  return (
    <section className={cn("rounded-md border bg-card p-3 shadow-sm", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-foreground">시험항목 검토</span>
        <span className="text-xs leading-normal tabular-nums text-muted-foreground">
          검토 대기 {waiting}건 · 검토 중 {reviewing}건 · 검토 완료 {reviewed}/{items.length}
        </span>
        {groupOn && (
          <span className="text-xs leading-normal tabular-nums text-muted-foreground">
            (그룹 전체: 검토 대기 {groupReviewItemCount(group, "review_start")}건 · 검토 중 {groupCompleteItems}건)
          </span>
        )}
        {!closed && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {/* 배치별 처리가 기본이며, 그룹 처리는 대상 배치 확인 모달 뒤 실행 */}
            {showGroupStart && (
              <Button size="sm" variant="outline" onClick={() => { setError(null); setConfirmGroupStart(true) }} disabled={busy !== null}>
                {busySource === "group" ? <Loader2 className="animate-spin" /> : <ClipboardCheck />}
                완료 항목 전체 검토 시작 ({groupApplyLabel(groupStartTargets.length)})
              </Button>
            )}
            {waiting > 0 && (
              <Button
                size="sm"
                variant="default"
                onClick={() => void run("review_start")}
                disabled={busy !== null}
              >
                {busySource === "single" ? <Loader2 className="animate-spin" /> : <ClipboardCheck />}
                {showGroupStart ? "이 배치만" : "완료 항목 전체 검토 시작"}
              </Button>
            )}
            {showGroupComplete && (
              <Button size="sm" variant="outline" onClick={() => { setError(null); setConfirmGroupComplete(true) }} disabled={busy !== null}>
                {busySource === "group" ? <Loader2 className="animate-spin" /> : <CheckCheck />}
                검토 중 항목 전체 검토 완료 ({groupApplyLabel(groupCompleteTargets.length)})
              </Button>
            )}
            {reviewing > 0 && (
              <Button
                size="sm"
                variant="default"
                onClick={() => { setError(null); setConfirmComplete(true) }}
                disabled={busy !== null}
              >
                {busySource === "single" ? <Loader2 className="animate-spin" /> : <CheckCheck />}
                {showGroupComplete ? "이 배치만 검토 완료" : "검토 중 항목 전체 검토 완료"}
              </Button>
            )}
          </div>
        )}
      </div>
      {error && !confirmComplete && !confirmGroupStart && !confirmGroupComplete && <p className="mt-2 text-xs font-medium text-destructive">{error}</p>}
      {confirmGroupStart && (
        <GroupTargetConfirmDialog
          title="검토 시작 — 동시분석 그룹"
          description={`그룹 ${groupStartTargets.length}배치의 완료 항목 전체를 검토 시작으로 기록합니다. 검토 기록은 배치·항목마다 남습니다.`}
          warning="모든 배치에 같은 판정이 적용됩니다."
          targets={groupStartTargets}
          busy={busy !== null}
          error={error}
          confirmLabel={`검토 시작 ${groupStartTargets.length}배치`}
          onConfirm={() => void runGroup("review_start")}
          onClose={() => { setConfirmGroupStart(false); setError(null) }}
        />
      )}
      {confirmGroupComplete && (
        <GroupTargetConfirmDialog
          title="검토 중 항목 전체 검토 완료 — 동시분석 그룹"
          description={`그룹 ${groupCompleteTargets.length}배치의 검토 중 시험항목 ${groupCompleteItems}건을 검토 완료로 기록합니다. 검토 기록은 배치·항목마다 남습니다.`}
          warning={`모든 배치에 같은 판정이 적용됩니다. ${REVIEW_COMPLETE_WARNING}`}
          targets={groupCompleteTargets}
          busy={busy !== null}
          error={error}
          confirmLabel={`검토 완료 ${groupCompleteTargets.length}배치`}
          onConfirm={() => void runGroup("review_complete")}
          onClose={() => { setConfirmGroupComplete(false); setError(null) }}
        />
      )}
      {confirmComplete && (
        <ReviewCompleteConfirmDialog
          names={items.filter(i => reviewStatusOf(i) === ITEM_REVIEW_REVIEWING).map(i => i.testItemName)}
          busy={busy !== null}
          error={error}
          onConfirm={() => void run("review_complete")}
          onClose={() => { setConfirmComplete(false); setError(null) }}
        />
      )}
    </section>
  )
}
