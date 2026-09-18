"use client"

/**
 * 동시분석 그룹 지정 — AI 스케줄에서 오더를 고르고 「동시분석 그룹 지정」을 눌렀을 때.
 *
 * 이 화면이 지켜야 하는 것: **동시분석 그룹 지정 전에 무엇이 걸리는지 다 보여준다.**
 * 관리자의 판단이 규칙보다 우선하므로 막지 않는다. 대신 품목코드가 섞였는지, 포장일이
 * 얼마나 벌어졌는지, 이미 시작된 시험이 끼었는지를 눌러 보기 전에 알려준다.
 * 경고 판정은 서버(previewGrouping)가 하고 화면은 그대로 옮긴다 — 두 곳에서 판단하면
 * 미리보기와 실제 결과가 갈린다.
 *
 * ⚠️ 그룹은 **함께 수행한다**는 실행 단위다. 제조번호마다 시험 기록·성적서는 그대로
 *    분리된다(GMP 추적성). 이 다이얼로그는 배치를 합치지 않는다.
 */

import { useCallback, useEffect, useState } from "react"
import { Layers, Loader2, TriangleAlert, Unlink } from "lucide-react"
import {
  Dialog, DialogBody, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@frontend/components/ui/dialog"
import { Button } from "@frontend/components/ui/button"
import { Input } from "@frontend/components/ui/input"
import { cn } from "@frontend/lib/utils"
import { displayBatchNo, displayProductCode } from "@shared/order-na"

export interface GroupWarning { level: "warn" | "block"; message: string }

export interface GroupCandidate {
  orderId: string
  productCode: string
  productName: string
  batchNo: string
  packagingDate: string | null
  dueDate: string | null
  status: string
  currentGroupId: string | null
  hasJob: boolean
}

/** 선택이 기존 그룹 하나와 정확히 겹칠 때만 해체를 제안한다 */
export interface DissolvableGroup { id: string; label: string | null; size: number }

export interface RepresentativeGroup {
  id: string
  label: string | null
  representativeOrderId: string | null
  items: Pick<GroupCandidate, "orderId" | "productName" | "batchNo">[]
}

/** 기존 그룹의 대표 로트를 바꾸는 관리자 전용 Dialog. 기존 배정은 소급하지 않는다. */
export function RepresentativeDialog({
  open, group, onClose, onDone,
}: {
  open: boolean
  group: RepresentativeGroup | null
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [selected, setSelected] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open && group) {
      setSelected(group.representativeOrderId ?? group.items.slice().sort((a, b) => a.orderId.localeCompare(b.orderId))[0]?.orderId ?? "")
      setError(null)
    }
  }, [open, group])

  async function submit() {
    if (!group || !selected) return
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/concurrent-groups/${group.id}`, {
        method: "PATCH", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ representativeOrderId: selected }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "대표 로트 변경 실패")
      onDone("대표 로트를 변경했습니다. 기존 배정에는 소급 적용되지 않습니다.")
    } catch (e) {
      setError(e instanceof Error ? e.message : "대표 로트 변경 실패")
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!next && !saving) onClose() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>대표 로트 변경</DialogTitle>
          <DialogDescription>
            {group?.label ?? "동시분석 그룹"}의 이후 담당자 복제 기준을 선택합니다. 이미 적용된 배정은 소급 변경되지 않습니다.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-2">
          {group?.items.map(item => (
            <button
              key={item.orderId}
              type="button"
              role="radio"
              aria-checked={selected === item.orderId}
              onClick={() => setSelected(item.orderId)}
              className={cn(
                "flex items-center gap-3 rounded-md border px-3 py-2 text-left text-xs leading-normal transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                selected === item.orderId ? "border-primary bg-primary/5 text-foreground" : "border-border hover:border-primary/50",
              )}
            >
              <span aria-hidden className={cn("size-4 shrink-0 rounded-full border-2", selected === item.orderId ? "border-primary bg-primary ring-2 ring-primary/20" : "border-muted-foreground/50")} />
              <span className="min-w-0 flex-1 truncate font-medium">{item.productName}</span>
              <span className="shrink-0 text-muted-foreground">{displayBatchNo(item.batchNo)}</span>
            </button>
          ))}
          {error && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs leading-normal text-destructive">{error}</p>}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          <Button onClick={() => void submit()} disabled={saving || !selected}>{saving ? <Loader2 className="animate-spin" /> : null}변경</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function ConcurrentGroupDialog({
  open, orderIds, dissolvable, onClose, onDone,
}: {
  open: boolean
  orderIds: string[]
  dissolvable: DissolvableGroup | null
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const [candidates, setCandidates] = useState<GroupCandidate[]>([])
  const [warnings, setWarnings] = useState<GroupWarning[]>([])
  const [label, setLabel] = useState("")
  const [note, setNote] = useState("")
  const [representativeOrderId, setRepresentativeOrderId] = useState("")
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setError(null)
    try {
      const res = await fetch("/api/concurrent-groups/manual?preview=1", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "확인 실패")
      setCandidates(json.candidates ?? [])
      setRepresentativeOrderId((json.candidates ?? [])[0]?.orderId ?? "")
      setWarnings(json.warnings ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : "확인 실패")
    } finally { setLoading(false) }
  }, [orderIds])

  useEffect(() => { if (open) void load() }, [open, load])

  const blocked = warnings.filter(w => w.level === "block")
  const warns   = warnings.filter(w => w.level === "warn")

  async function submit() {
    setSaving(true); setError(null)
    try {
      const res = await fetch("/api/concurrent-groups/manual", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderIds, label: label.trim() || null, note: note.trim() || null, representativeOrderId: representativeOrderId || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "그룹 지정 실패")
      onDone(`동시분석 그룹을 지정했습니다 (${candidates.length}건).`)
    } catch (e) {
      setError(e instanceof Error ? e.message : "그룹 지정 실패")
    } finally { setSaving(false) }
  }

  async function dissolve() {
    if (!dissolvable) return
    setSaving(true); setError(null)
    try {
      const res = await fetch(`/api/concurrent-groups/${dissolvable.id}`, {
        method: "DELETE", credentials: "include",
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "해체 실패")
      onDone("동시분석 그룹을 해체했습니다. 오더는 그대로 남아 있습니다.")
    } catch (e) {
      setError(e instanceof Error ? e.message : "해체 실패")
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!next && !saving) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Layers className="size-4" />
            </span>
            동시분석 그룹 지정
          </DialogTitle>
          <DialogDescription>
            함께 시험할 오더를 하나의 동시분석 그룹으로 지정합니다. 제조번호별 시험 기록과 성적서는 그대로 분리됩니다.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="grid gap-4">
          {loading ? (
            <p className="flex items-center gap-1.5 py-6 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />확인 중…
            </p>
          ) : (
            <>
              {/* 동시분석 그룹으로 지정할 오더 */}
              <section className="rounded-md border bg-card p-4 shadow-sm">
                <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">
                  동시분석 그룹으로 지정할 오더 <span className="tabular-nums text-muted-foreground">{candidates.length}건</span>
                </h3>
                <ul className="flex flex-col divide-y">
                  {candidates.map(c => (
                    <li key={c.orderId} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 py-1.5 text-xs leading-normal">
                      <span className="flex min-w-0 items-baseline gap-2">
                        <span className="shrink-0 font-mono text-muted-foreground">{displayProductCode(c.productCode)}</span>
                        <span className="min-w-0 truncate font-medium text-foreground">{c.productName}</span>
                        <span className="shrink-0 text-muted-foreground">/ {displayBatchNo(c.batchNo)}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2 tabular-nums text-muted-foreground">
                        <button type="button" role="radio" aria-checked={representativeOrderId === c.orderId}
                          onClick={() => setRepresentativeOrderId(c.orderId)}
                          className="inline-flex items-center gap-1 rounded-md px-1 text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                          <span aria-hidden className={cn("size-3.5 rounded-full border-2", representativeOrderId === c.orderId ? "border-primary bg-primary ring-1 ring-primary/20" : "border-muted-foreground/50")} /> 대표
                        </button>
                        포장 {c.packagingDate ?? "-"}
                        {c.hasJob && <span className="ml-1.5 text-amber-700 dark:text-amber-300">시험 시작됨</span>}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>

              {/* 걸리는 것 — 막지 않고 알린다 */}
              {blocked.length > 0 && (
                <ul className="flex flex-col gap-1 rounded-md border border-destructive/30 bg-destructive/10 p-3">
                  {blocked.map((w, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs leading-normal font-medium text-destructive">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />{w.message}
                    </li>
                  ))}
                </ul>
              )}
              {warns.length > 0 && (
                <ul className="flex flex-col gap-1 rounded-md border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-950">
                  {warns.map((w, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-xs leading-normal break-keep text-amber-800 dark:text-amber-200">
                      <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />{w.message}
                    </li>
                  ))}
                </ul>
              )}

              {blocked.length === 0 && (
                <section className="rounded-md border bg-card p-4 shadow-sm">
                  <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">기록</h3>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">그룹 이름 (선택)</span>
                      <Input value={label} onChange={e => setLabel(e.target.value)} placeholder="예: 경옥고 9월 2주" />
                    </label>
                    <label className="grid gap-1.5">
                      <span className="text-xs font-medium text-muted-foreground">동시분석 그룹 지정 이유 (선택)</span>
                      <Input value={note} onChange={e => setNote(e.target.value)} placeholder="예: 포장일 하루 차이 — 함께 진행" />
                    </label>
                  </div>
                  <p className="mt-2 text-xs leading-normal text-muted-foreground">
                    대표 로트의 담당자 구성이 그룹 배정의 기준이 됩니다. 이유를 남겨 두면 나중에 이 동시분석 그룹 지정이 타당했는지 되짚을 수 있습니다.
                  </p>
                </section>
              )}
            </>
          )}

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">{error}</p>
          )}
        </DialogBody>

        <DialogFooter className={cn(dissolvable && "sm:justify-between")}>
          {/* 선택이 기존 그룹과 정확히 겹칠 때만 해체를 제안한다 — 일부만 고른 상태에서
              해체 버튼을 보여주면 무엇이 풀리는지 오해하게 된다. */}
          {dissolvable && (
            <Button variant="outline" onClick={() => void dissolve()} disabled={saving}
              className="text-destructive hover:text-destructive">
              <Unlink />이 그룹 해체 ({dissolvable.size}건)
            </Button>
          )}
          <span className="flex gap-2">
            <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
            <Button onClick={() => void submit()} disabled={saving || loading || blocked.length > 0 || candidates.length < 2}>
              {saving ? <Loader2 className="animate-spin" /> : <Layers />}
              {candidates.length >= 2 ? `${candidates.length}건 동시분석 그룹 지정` : "동시분석 그룹 지정"}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
