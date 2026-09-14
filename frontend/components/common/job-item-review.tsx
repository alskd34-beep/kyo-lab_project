"use client"

/**
 * [FRONTEND] 시험항목 단위 검토 — 배지 · 항목 행 액션(관리자) · 일괄 편의 버튼(관리자)
 *
 * 작업자 작업 현황(JobDetailModal)과 시험현황(TestDetailDrawer)이 같은 부품을 써야
 * 화면마다 검토 표현·버튼 노출 규칙이 갈리지 않는다.
 *
 * 버튼 노출은 보조 판정일 뿐이다. 최종 허용 판정·기록·작업 단계 도출은 서버(DB 함수 0048)가 한다.
 * 규칙 전문: intent/2026-09-15-item-level-review-spec.md
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
export function ItemReviewActions({ jobId, jobStatus, item, disabled = false, onChanged }: {
  jobId: string
  jobStatus: string
  item: ReviewableItem
  disabled?: boolean
  /** 검토가 반영된 뒤 호출 — 상세·이력·목록 갱신에 쓴다 */
  onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reasonAction, setReasonAction] = useState<"review_cancel" | "reopen" | null>(null)
  const [confirmComplete, setConfirmComplete] = useState(false)

  if (jobStatus === CLOSED_STAGE || item.status !== ITEM_CLEARED) return null
  const rs = reviewStatusOf(item)

  async function run(action: ItemReviewAction, reason?: string) {
    setBusy(true); setError(null)
    try {
      await api.post(`/api/qc-jobs/${jobId}/items/${item.id}/review`, reason === undefined ? { action } : { action, reason })
      setReasonAction(null)
      setConfirmComplete(false)
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const off = busy || disabled
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-1">
        {rs === ITEM_REVIEW_NONE && (
          <Button size="sm" variant="outline" onClick={() => void run("review_start")} disabled={off}>
            {busy && !reasonAction ? <Loader2 className="animate-spin" /> : <ClipboardCheck />}검토 시작
          </Button>
        )}
        {rs === ITEM_REVIEW_REVIEWING && (
          <>
            <Button size="sm" onClick={() => { setError(null); setConfirmComplete(true) }} disabled={off}>
              <CheckCheck />검토 완료
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
      {error && !reasonAction && !confirmComplete && <p className="text-right text-xs leading-normal break-keep text-destructive">{error}</p>}
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
export function BulkReviewBar({ jobId, jobStatus, items, onChanged, className }: {
  jobId: string
  jobStatus: string
  items: ReviewableItem[]
  onChanged: () => void
  className?: string
}) {
  const [busy, setBusy] = useState<ItemReviewBulkAction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmComplete, setConfirmComplete] = useState(false)

  const waiting = items.filter(i => i.status === ITEM_CLEARED && reviewStatusOf(i) === ITEM_REVIEW_NONE).length
  const reviewing = items.filter(i => reviewStatusOf(i) === ITEM_REVIEW_REVIEWING).length
  const reviewed = items.filter(i => reviewStatusOf(i) === ITEM_REVIEW_REVIEWED).length
  const closed = jobStatus === CLOSED_STAGE

  async function run(action: ItemReviewBulkAction) {
    setBusy(action); setError(null)
    try {
      await api.post(`/api/qc-jobs/${jobId}/review-bulk`, { action })
      setConfirmComplete(false)
      onChanged()
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className={cn("rounded-md border bg-card p-3 shadow-sm", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-foreground">시험항목 검토</span>
        <span className="text-xs leading-normal tabular-nums text-muted-foreground">
          검토 대기 {waiting}건 · 검토 중 {reviewing}건 · 검토 완료 {reviewed}/{items.length}
        </span>
        {!closed && (
          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {waiting > 0 && (
              <Button size="sm" variant="outline" onClick={() => void run("review_start")} disabled={busy !== null}>
                {busy === "review_start" ? <Loader2 className="animate-spin" /> : <ClipboardCheck />}
                완료 항목 전체 검토 시작
              </Button>
            )}
            {reviewing > 0 && (
              <Button size="sm" onClick={() => { setError(null); setConfirmComplete(true) }} disabled={busy !== null}>
                <CheckCheck />
                검토 중 항목 전체 검토 완료
              </Button>
            )}
          </div>
        )}
      </div>
      {error && !confirmComplete && <p className="mt-2 text-xs font-medium text-destructive">{error}</p>}
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
