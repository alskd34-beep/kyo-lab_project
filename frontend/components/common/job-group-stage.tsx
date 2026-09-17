"use client"

/**
 * [FRONTEND] 동시분석 그룹 단계 일괄 진행 — 멤버 표시 · 대상 배치 계산 · 확인 모달 · 결과 토스트 · "동시 N" 배지
 *
 * 관리자 작업 현황 패널(JobDetailModal)과 시험현황 서랍(TestDetailDrawer), 그리고 공통 검토·승인 부품
 * (job-item-review · job-status-control)이 같은 규칙으로 그룹을 보이게 한 곳에 모은다.
 *
 * 대상 배치 계산은 **보조 판정**이다. 서버가 누른 시점의 그룹 구성으로 다시 계산하고, 조건이 맞지 않는
 * 배치는 건너뛴 뒤 결과(처리·건너뜀)를 돌려준다. 규칙 전문: intent/2026-09-15-group-stage-progress-spec.md
 */

import { Layers, Loader2 } from "lucide-react"
import {
  APPROVAL_READY_STATUS, CLOSED_STAGE, ITEM_CLEARED, ITEM_REVIEW_NONE, ITEM_REVIEW_REVIEWING,
  stageStyle, type ItemReviewBulkAction,
} from "@shared/qc-status"
import type {
  GroupMember, GroupStageProcessed, GroupStageSkipped, JobGroupSummary,
} from "@shared/qc-group-stage"
import { displayBatchNo } from "@shared/order-na"
import { cn } from "@frontend/lib/utils"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@frontend/components/ui/dialog"
import { useToastMessage } from "@frontend/components/common/toast-message"

export type { JobGroupSummary } from "@shared/qc-group-stage"

/** 그룹 버튼을 보일 만한가 — 그룹의 **시작된 작업**이 2건 이상(작업 1건이면 그룹 적용이 단건과 같다) */
export function isGroupActionable(group: JobGroupSummary | null | undefined): group is JobGroupSummary {
  return !!group && group.members.filter(m => m.jobId).length >= 2
}

/** 검토 동작의 항목 전제 — 서버 판정(0051 S4~S7)과 같은 조건의 보조 판정 */
function itemEligible(item: { status: string; reviewStatus: string }, action: ItemReviewBulkAction): boolean {
  return action === "review_start"
    ? item.status === ITEM_CLEARED && item.reviewStatus === ITEM_REVIEW_NONE
    : item.reviewStatus === ITEM_REVIEW_REVIEWING
}

/** 그룹에서 (항목명, 동작)이 적용될 배치 — 항목명이 null 이면 일괄(그 동작의 대상 항목이 1건 이상인 배치) */
export function groupReviewTargets(
  group: JobGroupSummary, action: ItemReviewBulkAction, testItemName: string | null,
): GroupMember[] {
  return group.members.filter(m =>
    m.jobId && m.status !== CLOSED_STAGE
    && m.items.some(it => (testItemName === null || it.testItemName === testItemName) && itemEligible(it, action)))
}

/** 그룹에서 그 동작의 대상 항목 수 합계(일괄 바 요약용) */
export function groupReviewItemCount(group: JobGroupSummary, action: ItemReviewBulkAction): number {
  return group.members
    .filter(m => m.jobId && m.status !== CLOSED_STAGE)
    .reduce((n, m) => n + m.items.filter(it => itemEligible(it, action)).length, 0)
}

/** 그룹 승인 대상 배치 — "승인전" 작업(전 항목 검토 완료 여부는 서버가 배치마다 확인) */
export function groupApproveTargets(group: JobGroupSummary): GroupMember[] {
  return group.members.filter(m => m.jobId && m.status === APPROVAL_READY_STATUS)
}

/** 그룹 적용 버튼 문구의 꼬리 */
export function groupApplyLabel(count: number): string {
  return `그룹 ${count}배치에 적용`
}

/** "동시 N" 배지 — 그룹 오더가 2건 이상일 때만 */
export function ConcurrentBadge({ size, className }: { size: number | null | undefined; className?: string }) {
  if (!size || size < 2) return null
  return (
    <Badge
      variant="outline"
      title={`동시분석 그룹 ${size}건`}
      className={cn("shrink-0 gap-1 border-blue-200 px-1 py-0 text-xs leading-normal text-blue-700 dark:border-blue-800 dark:text-blue-300", className)}
    >
      <Layers className="size-3" />동시 {size}
    </Badge>
  )
}

/** 결과 토스트 — "처리 N · 건너뜀 M" + 건너뜀 사유 목록 */
export function useGroupStageResultToast() {
  const { showToast } = useToastMessage()
  return (title: string, res: { processed: GroupStageProcessed[]; skipped: GroupStageSkipped[] }) => {
    const processedBatches = new Set(res.processed.map(p => p.jobId)).size
    const reasons = [...new Set(res.skipped.map(s => `${s.qcNo ? `QC ${s.qcNo}` : "작업"} ${s.reason}`))]
    const skippedBatches = new Set(res.skipped.map(s => s.jobId)).size
    showToast({
      title: `${title} — 처리 ${processedBatches} · 건너뜀 ${skippedBatches}`,
      description: reasons.length > 0 ? `건너뜀: ${reasons.join(", ")}` : undefined,
      variant: skippedBatches > 0 ? "warning" : "success",
      duration: skippedBatches > 0 ? 8000 : 3500,
    })
  }
}

/** 개별 경로에서 짝 배치 전파 결과를 표시한다. 적용·건너뜀·실패를 모두 알려 준다. */
export function useGroupPropagationResultToast() {
  const { showToast } = useToastMessage()
  return (title: string, propagation: {
    applied: number
    skipped: number
    failed: number
    warnings: string[]
  }) => {
    const hasWarning = propagation.failed > 0 || propagation.warnings.length > 0
    showToast({
      title: `${title} — 적용 ${propagation.applied} · 건너뜀 ${propagation.skipped} · 실패 ${propagation.failed}`,
      description: propagation.warnings.length > 0 ? propagation.warnings.join(" / ") : undefined,
      variant: hasWarning ? "warning" : "success",
      duration: hasWarning ? 8000 : 3500,
    })
  }
}

/** 관리자 상세 상단의 "동시분석 N건" 섹션 — 멤버 QC번호·제조번호·단계·담당자 */
export function GroupMembersSection({ group, currentJobId, className }: {
  group: JobGroupSummary
  currentJobId: string | null
  className?: string
}) {
  return (
    <section className={cn("rounded-md border border-blue-200 bg-blue-50/40 p-3 dark:border-blue-800 dark:bg-blue-950/40", className)}>
      <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold text-foreground">
        <Layers className="size-3.5 text-blue-600 dark:text-blue-300" />
        동시분석 <span className="tabular-nums">{group.orderCount}</span>건
        {group.groupLabel && <span className="font-normal text-muted-foreground">· {group.groupLabel}</span>}
        {group.sameTestItemSet ? (
          <Badge variant="secondary" className="px-1 py-0 text-xs leading-normal">시험항목 동일 · 함께 진행</Badge>
        ) : (
          <Badge variant="outline" className="px-1 py-0 text-xs leading-normal text-muted-foreground">시험항목 상이 · 개별 진행</Badge>
        )}
      </p>
      <ul className="mt-2 flex flex-col gap-1">
        {group.members.map(m => {
          const style = stageStyle(m.status)
          const current = !!m.jobId && m.jobId === currentJobId
          return (
            <li
              key={m.jobId ?? `order-${m.orderId}`}
              className={cn(
                "flex flex-wrap items-center justify-between gap-2 rounded-md border bg-card px-2.5 py-1.5",
                current && "border-primary/40 bg-primary/5",
              )}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-mono text-xs font-semibold text-blue-700 dark:text-blue-300">
                  {m.qcNo ? `QC ${m.qcNo}` : "미시작"}
                </span>
                <span className="truncate font-mono text-xs text-muted-foreground">{displayBatchNo(m.batchNo) || "-"}</span>
                {current && <Badge variant="secondary" className="shrink-0 px-1 py-0 text-xs leading-normal">이 배치</Badge>}
              </span>
              <span className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-muted-foreground">{m.testerName ?? (m.jobId ? "-" : "")}</span>
                <Badge variant="outline" className={cn("gap-1 px-1.5 py-0 text-xs leading-normal", style.cls)}>
                  <span className={cn("size-1.5 rounded-full", style.dot)} />{m.status || "-"}
                </Badge>
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/** 그룹 검토 완료·그룹 승인 확인 모달 — 대상 배치 목록과 되돌릴 수 없음 안내 */
export function GroupTargetConfirmDialog({
  title, description, warning, targets, busy, error, confirmLabel, onConfirm, onClose,
}: {
  title: string
  description: string
  warning: string
  targets: GroupMember[]
  busy: boolean
  error: string | null
  confirmLabel: string
  onConfirm: () => void
  onClose: () => void
}) {
  return (
    <Dialog open onOpenChange={next => { if (!next && !busy) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-xs leading-normal break-keep">{description}</DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-normal break-keep text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
            {warning}
          </p>
          <div className="flex flex-col gap-1">
            <span className="text-xs font-medium text-muted-foreground">대상 배치 {targets.length}건</span>
            <ul className="max-h-48 overflow-y-auto rounded-md border px-3 py-2 text-sm text-foreground">
              {targets.map(m => (
                <li key={m.jobId ?? m.orderId} className="flex items-center gap-2 truncate">
                  <span className="font-mono text-xs font-semibold text-blue-700 dark:text-blue-300">QC {m.qcNo}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">{displayBatchNo(m.batchNo) || "-"}</span>
                </li>
              ))}
            </ul>
            <span className="text-xs leading-normal break-keep text-muted-foreground">
              서버가 누른 시점의 그룹 구성으로 다시 확인하며, 조건이 맞지 않는 배치는 건너뛰고 결과로 알려 드립니다.
            </span>
          </div>
          {error && <p className="text-xs leading-normal break-keep text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>닫기</Button>
          <Button onClick={onConfirm} disabled={busy}>
            {busy && <Loader2 className="animate-spin" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
