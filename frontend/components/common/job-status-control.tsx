"use client"

/**
 * [FRONTEND] QC 작업 상태 변경 (관리자)
 *
 * 두 가지 경로를 한 곳에 모은다.
 *  1) 다음 단계로  — 정해진 순서대로 한 칸 전진 (POST /api/qc-jobs/[id]/stage)
 *  2) 직접 변경   — 되돌리기·지연 지정처럼 순서를 벗어나는 정정. **사유 필수**
 *                   (PATCH /api/qc-jobs/[id]/status)
 *
 * 어느 쪽이든 서버가 상태 이력에 남기므로, 바로 아래 이력 타임라인에서 확인할 수 있다.
 */

import { useState } from "react"
import { ArrowRight, LoaderCircle, PenLine, ShieldAlert } from "lucide-react"
import {
  DELAYED_STATUS, JOB_STAGES, NEXT_STAGE, STAGE_ACTION_LABEL, isJobStage,
} from "@shared/qc-status"
import { cn } from "@frontend/lib/utils"
import { Button } from "@frontend/components/ui/button"
import { Input } from "@frontend/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@frontend/components/ui/select"

/** 관리자가 지정할 수 있는 상태 — 단계 5개 + 지연 (오더 전용 '대기'·'삭제'는 제외) */
const SELECTABLE_STATUSES: string[] = [...JOB_STAGES, DELAYED_STATUS]

export function JobStatusControl({
  jobId, status, onChanged, className,
}: {
  /** 아직 시작되지 않은 오더면 null — 안내만 보여준다 */
  jobId: string | null
  /** 현재 상태(한글 원본) */
  status: string
  /** 상태가 실제로 바뀐 뒤 호출 — 목록·이력 갱신에 쓴다 */
  onChanged: () => void
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const [target, setTarget] = useState<string>("")
  const [reason, setReason] = useState("")

  const nextStage = isJobStage(status) ? NEXT_STAGE[status] : null
  const nextLabel = isJobStage(status) ? STAGE_ACTION_LABEL[status] : null

  async function advance() {
    if (!jobId) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/qc-jobs/${jobId}/stage`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        // 화면이 보고 있던 단계를 함께 보내 동시 클릭을 막는다
        body: JSON.stringify({ expected: status }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "단계 변경 실패")
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "단계 변경 실패")
    } finally {
      setBusy(false)
    }
  }

  async function applyManual() {
    if (!jobId || !target) return
    setBusy(true); setError(null)
    try {
      const res = await fetch(`/api/qc-jobs/${jobId}/status`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: target, reason }),
      })
      const data = await res.json().catch(() => ({})) as { error?: string }
      if (!res.ok) throw new Error(data.error ?? "상태 변경 실패")
      setManualOpen(false); setTarget(""); setReason("")
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "상태 변경 실패")
    } finally {
      setBusy(false)
    }
  }

  if (!jobId) {
    return (
      <section className={cn("rounded-md border border-dashed bg-muted/40 p-3", className)}>
        <p className="text-xs text-muted-foreground">
          아직 담당자가 작업을 시작하지 않아 상태를 변경할 수 없습니다.
          작업 시작은 담당자의 “내 작업” 화면에서 이뤄집니다.
        </p>
      </section>
    )
  }

  return (
    <section className={cn("rounded-md border bg-card p-3 shadow-sm", className)}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-foreground">상태 변경</span>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          {nextStage && nextLabel ? (
            <Button size="sm" onClick={() => void advance()} disabled={busy}>
              {busy ? <LoaderCircle className="animate-spin" /> : <ArrowRight />}
              {nextLabel} → {nextStage}
            </Button>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              {status === DELAYED_STATUS
                ? "지연은 단계 순서 밖의 상태라 직접 변경으로만 바꿉니다."
                : "이 단계에서 자동으로 넘길 다음 단계가 없습니다."}
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setManualOpen(o => !o); setError(null) }}
            disabled={busy}
          >
            <PenLine />직접 변경
          </Button>
        </div>
      </div>

      {manualOpen && (
        <div className="mt-3 flex flex-col gap-2 rounded-md border border-amber-200 bg-amber-50/60 p-2.5">
          <p className="flex items-start gap-1.5 text-[11px] text-amber-800">
            <ShieldAlert className="mt-px size-3.5 shrink-0 text-amber-500" />
            순서를 벗어난 상태 변경입니다. 사유는 상태 이력에 그대로 남습니다.
          </p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger className="h-9 w-full sm:w-40">
                <SelectValue placeholder="변경할 상태" />
              </SelectTrigger>
              <SelectContent>
                {SELECTABLE_STATUSES.filter(s => s !== status).map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              value={reason}
              onChange={e => setReason(e.target.value)}
              placeholder="변경 사유 (필수)"
              className="h-9 flex-1"
            />
            <Button
              size="sm"
              className="h-9"
              onClick={() => void applyManual()}
              disabled={busy || !target || reason.trim().length < 2}
            >
              {busy ? <LoaderCircle className="animate-spin" /> : null}적용
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs font-medium text-destructive">{error}</p>}
    </section>
  )
}
