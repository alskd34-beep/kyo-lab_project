"use client"

/**
 * [FRONTEND] 진행 중 시험항목 담당자 변경(F2) 모달 — 관리자 [담당자 변경] · 시험자 [넘기기] 공통
 *
 *   GET  /api/pct-orders/[id]/test-items/reassign  → 담당자별 작업·항목 상태(열 때마다 새로 읽는다)
 *   POST /api/pct-orders/[id]/test-items/reassign  { testItemName, expectedFromSlot, toSlot, reason }
 *
 * 받는 사람은 **같은 오더에 병렬 배정된 다른 담당자**뿐이다. 사유는 시작 취소 모달과 같은 형식의
 * 선택지(F2-8)이고, 기타는 직접 입력(2자 이상). 최종 판정은 서버(DB 함수 reassign_job_item)가 한다 —
 * 여기의 비활성·안내는 눌러도 거절될 것을 미리 보여 주는 보조 판정이다.
 * 거절되면 모달을 닫지 않고 서버 메시지를 그대로 보이며, 상태와 바깥 목록을 한 번 다시 읽는다.
 */

import { useEffect, useMemo, useState } from "react"
import { ArrowRightLeft, Loader2 } from "lucide-react"
import { api, errorMessage } from "@frontend/lib/api-client"
import { displayBatchNo } from "@shared/order-na"
import { Button } from "@frontend/components/ui/button"
import { Input } from "@frontend/components/ui/input"
import { Skeleton } from "@frontend/components/ui/skeleton"
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@frontend/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@frontend/components/ui/select"
import {
  ITEM_REASSIGN_REASONS, ITEM_REASSIGN_REASON_MIN, ITEM_REASSIGN_REASON_OTHER,
  reassignPartyLabel, reassignSuccessMessage,
  type ItemReassignAssignee, type ItemReassignContext, type ItemReassignResult,
} from "@shared/item-reassign"

export function ItemReassignDialog({
  orderId, testItemName, fromSlot, mode, onDone, onFailed, onClose,
}: {
  orderId: string
  testItemName: string
  /** 화면이 보고 있던 현재 담당자 번호 — 서버가 잠금 뒤 다르면 거절한다(F2-7) */
  fromSlot: number
  /** admin = 오더 수정 서랍의 [담당자 변경] / tester = 할 일의 [넘기기] */
  mode: "admin" | "tester"
  onDone: (message: string, type: "info" | "error") => void
  /** 요청 실패 뒤 바깥 목록을 다시 읽는다(서버는 처리했는데 응답만 유실됐을 수 있다) */
  onFailed?: () => Promise<void> | void
  onClose: () => void
}) {
  const [ctx, setCtx] = useState<ItemReassignContext | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)
  /** 사용자가 고른 받는 슬롯 — 고르기 전이거나 받을 수 없게 바뀌면 받을 수 있는 첫 담당자를 쓴다 */
  const [picked, setPicked] = useState<string | null>(null)
  const [choice, setChoice] = useState<string>(ITEM_REASSIGN_REASONS[0])
  const [custom, setCustom] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /** 올리면 상태를 다시 읽는다(거절 뒤) */
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const data = await api.get<ItemReassignContext>(`/api/pct-orders/${orderId}/test-items/reassign`)
        if (alive) { setCtx(data); setLoadErr(null) }
      } catch (e) {
        if (alive) setLoadErr(errorMessage(e, "담당자 정보를 불러오지 못했습니다."))
      }
    })()
    return () => { alive = false }
  }, [orderId, reloadKey])

  const item = useMemo(() => ctx?.items.find(i => i.testItemName === testItemName) ?? null, [ctx, testItemName])
  const from = useMemo(() => ctx?.assignees.find(a => a.slot === fromSlot) ?? null, [ctx, fromSlot])
  const candidates = useMemo(() => (ctx?.assignees ?? []).filter(a => a.slot !== fromSlot), [ctx, fromSlot])

  // 사용자가 고른 사람은 **말없이 바꾸지 않는다**(리뷰 L3) — 다시 읽은 뒤 받을 수 없게 됐으면 그 사람을 그대로 두고
  // 사유를 보이며 제출을 막는다. 고르기 전에만 받을 수 있는 첫 담당자를 기본값으로 쓴다.
  const pickedCandidate = picked === null ? null : candidates.find(c => String(c.slot) === picked) ?? null
  const target: ItemReassignAssignee | null = picked === null
    ? candidates.find(c => !c.receiveBlockReason) ?? null
    : pickedCandidate
  const toSlot = target ? String(target.slot) : ""

  // 넘길 수 없는 이유 — 서버 판정을 미리 보여 준다
  const blockReason = !ctx ? null
    : !item ? "시험항목을 찾을 수 없습니다."
    : item.slot !== fromSlot ? "그 사이 담당자가 바뀌었습니다. 새로고침 후 다시 확인해 주세요."
    : picked !== null && !pickedCandidate ? "고른 담당자가 더 이상 이 오더에 없습니다. 받는 담당자를 다시 고르세요."
    : target?.receiveBlockReason
      ?? item.blockReason

  const reason = choice === ITEM_REASSIGN_REASON_OTHER ? custom.trim() : choice
  const reasonOk = reason.length >= ITEM_REASSIGN_REASON_MIN
  const canSubmit = !!ctx && !!target && !blockReason && reasonOk && !submitting

  const submit = async () => {
    if (!target) return
    if (!reasonOk) { setError("사유를 2자 이상 입력해 주세요."); return }
    setSubmitting(true)
    setError(null)
    try {
      const res = await api.post<ItemReassignResult & { ok: true; warning?: string }>(
        `/api/pct-orders/${orderId}/test-items/reassign`,
        { testItemName, expectedFromSlot: fromSlot, toSlot: target.slot, reason },
      )
      const done = reassignSuccessMessage(res, mode === "tester" ? (ctx?.viewerSlot ?? null) : null)
      if (res.warning) onDone(`${done} ${res.warning}`, "error")
      else onDone(done, "info")
    } catch (e) {
      // 모달을 닫지 않는다 — 서버 메시지를 그대로 보이고 상태를 다시 읽는다
      setError(errorMessage(e))
      setSubmitting(false)
      setReloadKey(k => k + 1)
      await onFailed?.()
    }
  }

  const title = mode === "admin" ? "시험항목 담당자 변경" : "시험항목 넘기기"
  const fromName = from?.testerName ?? "현재 담당자"
  const toName = target?.testerName ?? "받는 담당자"

  return (
    <Dialog open onOpenChange={next => { if (!next && !submitting) onClose() }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-xs leading-normal break-keep">
            {ctx ? <>{ctx.productName} / <span className="font-mono">{displayBatchNo(ctx.batchNo)}</span> · </> : null}
            {testItemName}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="space-y-3">
          {loadErr ? (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-normal break-keep text-destructive">{loadErr}</p>
          ) : !ctx ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full rounded-md" />
              <Skeleton className="h-20 w-full rounded-md" />
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">받는 담당자</p>
                {candidates.length === 0 ? (
                  <p className="text-xs leading-normal break-keep text-muted-foreground">같은 오더에 병렬 배정된 다른 담당자가 없습니다.</p>
                ) : (
                  <Select value={toSlot} onValueChange={v => { setPicked(v); setError(null) }} disabled={submitting}>
                    <SelectTrigger className="h-9 w-full" aria-label="받는 담당자"><SelectValue placeholder="담당자 선택" /></SelectTrigger>
                    <SelectContent>
                      {candidates.map(c => (
                        <SelectItem key={c.slot} value={String(c.slot)} disabled={!!c.receiveBlockReason}>
                          {reassignPartyLabel(c)}
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            {c.jobId ? `작업 중 · QC ${c.qcNo}` : "미시작"}
                            {c.receiveBlockReason ? " · 받을 수 없음" : ""}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>

              {target && !blockReason && (
                <p className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs leading-normal break-keep text-blue-900 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200">
                  &quot;{testItemName}&quot; 을(를) {fromName}님에게서 {toName}님에게 넘깁니다.
                  {!target.jobId && <> {toName}님은 아직 작업을 시작하지 않아, [작업 시작] 할 때 이 항목이 포함됩니다.</>}
                  {" "}변경 사실과 사유는 오더 수정 이력에 남습니다.
                </p>
              )}
              {blockReason && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-normal break-keep text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  {blockReason}
                </p>
              )}

              <fieldset className="space-y-1.5">
                <legend className="mb-1 text-xs font-medium text-muted-foreground">변경 사유</legend>
                {ITEM_REASSIGN_REASONS.map(r => (
                  <label key={r} className="flex min-h-8 cursor-pointer items-center gap-2 text-sm text-foreground">
                    <input
                      type="radio"
                      name="item-reassign-reason"
                      className="size-4 accent-primary"
                      checked={choice === r}
                      onChange={() => { setChoice(r); setError(null) }}
                      disabled={submitting}
                    />
                    {r === ITEM_REASSIGN_REASON_OTHER ? "기타(직접 입력)" : r}
                  </label>
                ))}
                {choice === ITEM_REASSIGN_REASON_OTHER && (
                  <Input
                    autoFocus
                    value={custom}
                    onChange={e => { setCustom(e.target.value); setError(null) }}
                    placeholder="사유를 직접 입력하세요 (2자 이상)"
                    disabled={submitting}
                  />
                )}
              </fieldset>
            </>
          )}
          {error && <p className="text-xs leading-normal break-keep text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={submitting}>닫기</Button>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {submitting ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />}
            넘기기
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
