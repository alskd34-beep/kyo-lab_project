"use client"

import { useEffect, useState } from "react"
import type { DelayReasonCategory, DelayReasonKind } from "@shared/delay-reason"
import { api } from "@frontend/lib/api-client"
import { Button } from "@frontend/components/ui/button"
import { Input } from "@frontend/components/ui/input"
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@frontend/components/ui/dialog"

export function DelayReasonDialog({
  open, kind, count = 1, onClose, onSubmit,
}: {
  open: boolean
  kind: DelayReasonKind
  count?: number
  onClose: () => void
  onSubmit: (category: DelayReasonCategory, reason: string) => Promise<void>
}) {
  const [categories, setCategories] = useState<DelayReasonCategory[]>([])
  const [categoryId, setCategoryId] = useState("")
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setCategoryId(""); setReason(""); setError(null)
    void api.get<{ rows: DelayReasonCategory[] }>(`/api/delay-reasons?kind=${kind}`).then(r => setCategories(r.rows))
      .catch(e => setError(e instanceof Error ? e.message : "사유 분류를 불러오지 못했습니다."))
  }, [kind, open])

  const submit = async () => {
    const category = categories.find(c => c.id === categoryId)
    if (!category) { setError("사유 분류를 선택해 주세요."); return }
    if (reason.trim().length < 2) { setError("사유를 2자 이상 입력해 주세요."); return }
    setBusy(true); setError(null)
    try { await onSubmit(category, reason.trim()) }
    catch (e) { setError(e instanceof Error ? e.message : "저장하지 못했습니다.") }
    finally { setBusy(false) }
  }

  return <Dialog open={open} onOpenChange={next => { if (!next && !busy) onClose() }}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{kind === "delay" ? "지연 사유 기록" : "복귀 사유 기록"}{count > 1 ? ` (${count}건)` : ""}</DialogTitle>
        <DialogDescription>{kind === "delay" ? "지연으로 변경하려면 분류와 사유를 입력해야 합니다." : "해제하면 시험항목 상태에 맞는 단계로 돌아갑니다."}</DialogDescription>
      </DialogHeader>
      <DialogBody className="space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {categories.map(c => <Button key={c.id} type="button" variant={categoryId === c.id ? "default" : "outline"} className="h-auto min-h-9 whitespace-normal text-xs leading-normal" onClick={() => setCategoryId(c.id)}>{c.label}</Button>)}
        </div>
        <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="사유를 2자 이상 입력하세요" maxLength={500} autoFocus />
        {error && <p className="text-xs leading-normal text-destructive">{error}</p>}
      </DialogBody>
      <DialogFooter><Button type="button" variant="outline" onClick={onClose} disabled={busy}>취소</Button><Button type="button" onClick={() => void submit()} disabled={busy}>{kind === "delay" ? "지연으로 변경" : "복귀"}</Button></DialogFooter>
    </DialogContent>
  </Dialog>
}

