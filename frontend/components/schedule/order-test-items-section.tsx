"use client"

/**
 * [FRONTEND] 오더별 시험항목 가감 섹션
 *
 * 품목별 시험항목은 "항상 쓰는 기준"이고, 오더(개인별 스케줄)는 그 기준 위에서
 * 그때그때 빼거나 더한다. 그래서 이 섹션은 품목 기준 전체를 늘 펼쳐 보여주고,
 * 각 항목을 이 오더에서만 제외/복구하거나 마스터에서 새 항목을 더하게 한다.
 * 진행방법(전항목/개별항목)이 아니라 **이 목록**이 무엇을 배정할지 결정한다.
 *
 *   GET    /api/pct-orders/[id]/test-items  → 품목 기준 전체(제외분 포함)
 *   PATCH  … { testItemName, excluded, reason? }  제외/복구
 *   POST   … { testItemId?, testItemName }        이 오더에만 추가
 *   DELETE … { testItemName }                     추가분 삭제(기준분은 제외 처리)
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { Check, ListChecks, Loader2, Lock, Plus, Search, Trash2 } from "lucide-react"
import { api, errorMessage } from "@frontend/lib/api-client"
import { cn } from "@frontend/lib/utils"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import { Skeleton } from "@frontend/components/ui/skeleton"
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@frontend/components/ui/dialog"

/** GET /api/pct-orders/[id]/test-items 의 행 */
export interface OrderTestItemDetailRow {
  testItemId: string | null
  testItemName: string
  sequenceOrder: number
  isExcluded: boolean
  excludedReason: string | null
  source: "product" | "manual"
}

interface TestItemMasterRow { id: string; name: string; category: string }

const reasonInputCls =
  "mt-1.5 h-8 w-full rounded-md border border-input bg-background px-2.5 text-xs text-foreground shadow-xs " +
  "placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"

export function OrderTestItemsSection({ orderId, productName, canEdit, locked }: {
  orderId: string
  productName: string
  /** 관리자이고 확정(LOCK) 전일 때만 true — 그 외에는 읽기 전용 */
  canEdit: boolean
  /** 확정(LOCK) 여부 — 안내 문구를 다르게 보여준다 */
  locked: boolean
}) {
  const [rows, setRows] = useState<OrderTestItemDetailRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [busyNames, setBusyNames] = useState<Set<string>>(() => new Set())
  const [reasonDrafts, setReasonDrafts] = useState<Record<string, string>>({})
  const [pickerOpen, setPickerOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const data = await api.get<{ rows: OrderTestItemDetailRow[] }>(`/api/pct-orders/${orderId}/test-items`)
      setRows(data.rows ?? [])
      setErr(null)
    } catch (e) {
      setRows([])
      setErr(errorMessage(e, "시험항목을 불러오지 못했습니다."))
    }
  }, [orderId])

  useEffect(() => { void load() }, [load])

  const markBusy = (name: string, on: boolean) =>
    setBusyNames(prev => {
      const next = new Set(prev)
      if (on) next.add(name); else next.delete(name)
      return next
    })

  /** 서버 호출 → 성공하면 목록을 다시 읽는다(순번·source 는 서버가 정한다) */
  const run = async (name: string, fn: () => Promise<unknown>) => {
    markBusy(name, true)
    setErr(null)
    try {
      await fn()
      await load()
    } catch (e) {
      setErr(errorMessage(e, "변경하지 못했습니다."))
    } finally {
      markBusy(name, false)
    }
  }

  const toggle = (row: OrderTestItemDetailRow) => {
    const nextExcluded = !row.isExcluded
    void run(row.testItemName, () => api.patch(`/api/pct-orders/${orderId}/test-items`, {
      testItemName: row.testItemName,
      excluded: nextExcluded,
      reason: nextExcluded ? (reasonDrafts[row.testItemName] ?? row.excludedReason ?? "") : undefined,
    }))
  }

  const saveReason = (row: OrderTestItemDetailRow) => {
    const draft = reasonDrafts[row.testItemName]
    if (draft === undefined || draft.trim() === (row.excludedReason ?? "").trim()) return
    void run(row.testItemName, () => api.patch(`/api/pct-orders/${orderId}/test-items`, {
      testItemName: row.testItemName, excluded: true, reason: draft,
    }))
  }

  const removeManual = (row: OrderTestItemDetailRow) =>
    void run(row.testItemName, () => api.del(`/api/pct-orders/${orderId}/test-items`, {
      testItemName: row.testItemName,
    }))

  /** 마스터에서 고른 항목들을 이 오더에만 추가한다(이미 있으면 서버가 제외만 해제한다) */
  const addItems = async (picked: TestItemMasterRow[]) => {
    setErr(null)
    try {
      for (const it of picked) {
        await api.post(`/api/pct-orders/${orderId}/test-items`, { testItemId: it.id, testItemName: it.name })
      }
      await load()
      setPickerOpen(false)
    } catch (e) {
      setErr(errorMessage(e, "항목을 추가하지 못했습니다."))
    }
  }

  const total = rows?.length ?? 0
  const activeCount = useMemo(() => (rows ?? []).filter(r => !r.isExcluded).length, [rows])

  return (
    <section className="mt-4 rounded-md border bg-muted/20 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <ListChecks className="size-4 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">시험항목</span>
          {rows !== null && (
            <Badge variant="outline" className="border-blue-200 tabular-nums text-blue-700 dark:border-blue-800 dark:text-blue-300">
              {total}개 중 {activeCount}개 진행
            </Badge>
          )}
        </div>
        {canEdit && (
          <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
            <Plus />항목 추가
          </Button>
        )}
      </div>

      <p className="mt-1.5 text-xs leading-normal text-muted-foreground">
        품목 기준 시험항목 전체입니다. 이 오더에서만 빼거나 더할 수 있고, 품목 기준은 바뀌지 않습니다.
      </p>

      {locked && (
        <p className="mt-2 flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs leading-normal text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <Lock className="size-3 shrink-0" />
          확정(LOCK)된 오더입니다. 확정을 해제해야 시험항목을 바꿀 수 있습니다.
        </p>
      )}

      {err && (
        <p className="mt-2 rounded-md border border-red-200 bg-red-50 px-2.5 py-2 text-xs leading-normal text-red-600 dark:border-red-800 dark:bg-red-950 dark:text-red-300">{err}</p>
      )}

      {rows === null ? (
        <div className="mt-2 flex flex-col gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-md" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-2 rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
          이 품목에 등록된 시험항목이 없습니다.
          <br />
          <span className="text-xs leading-normal">기준 설정 › 품목별 시험항목 관리에서 먼저 등록하거나, 「항목 추가」로 이 오더에만 넣으세요.</span>
        </p>
      ) : (
        <ul className="mt-2 flex flex-col gap-1.5">
          {rows.map(row => {
            const busy = busyNames.has(row.testItemName)
            return (
              <li key={row.testItemName}>
                <div className={cn(
                  "flex items-start gap-2 rounded-md border px-3 py-2.5",
                  row.isExcluded ? "border-dashed bg-muted/40" : "bg-card",
                )}>
                  <input
                    type="checkbox"
                    className="cb-custom mt-0.5"
                    checked={!row.isExcluded}
                    disabled={!canEdit || busy}
                    onChange={() => toggle(row)}
                    aria-label={`${row.testItemName} 진행 여부`}
                    title={row.isExcluded ? "이 오더에 다시 포함" : "이 오더에서 제외"}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className={cn(
                        "text-sm",
                        row.isExcluded ? "text-muted-foreground line-through" : "font-medium text-foreground",
                      )}>
                        {row.testItemName}
                      </span>
                      {row.source === "manual" && (
                        <Badge variant="outline" className="border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-300">추가</Badge>
                      )}
                      {row.isExcluded && (
                        <Badge variant="outline" className="border-amber-200 text-amber-700 dark:border-amber-800 dark:text-amber-300">제외</Badge>
                      )}
                    </div>
                    {row.isExcluded && (canEdit ? (
                      <input
                        value={reasonDrafts[row.testItemName] ?? row.excludedReason ?? ""}
                        onChange={e => setReasonDrafts(prev => ({ ...prev, [row.testItemName]: e.target.value }))}
                        onBlur={() => saveReason(row)}
                        placeholder="제외 사유 (선택)"
                        className={reasonInputCls}
                      />
                    ) : row.excludedReason ? (
                      <p className="mt-1 text-xs leading-normal text-muted-foreground">사유: {row.excludedReason}</p>
                    ) : null)}
                  </div>
                  {busy ? (
                    <Loader2 className="mt-0.5 size-3.5 shrink-0 animate-spin text-muted-foreground" />
                  ) : canEdit && row.source === "manual" ? (
                    <Button
                      type="button" variant="ghost" size="icon-sm"
                      onClick={() => removeManual(row)}
                      title="이 오더에서 추가한 항목 삭제"
                      className="-mr-1 shrink-0 text-destructive hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  ) : null}
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {pickerOpen && (
        <AddTestItemDialog
          productName={productName}
          existing={rows ?? []}
          onClose={() => setPickerOpen(false)}
          onConfirm={addItems}
        />
      )}
    </section>
  )
}

// ─── 항목 추가 팝업 (시험항목 마스터에서 고른다) ────────────────────────────────
function AddTestItemDialog({ productName, existing, onClose, onConfirm }: {
  productName: string
  existing: OrderTestItemDetailRow[]
  onClose: () => void
  onConfirm: (picked: TestItemMasterRow[]) => Promise<void>
}) {
  const [master, setMaster] = useState<TestItemMasterRow[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [q, setQ] = useState("")
  const [checked, setChecked] = useState<Set<string>>(() => new Set())
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const data = await api.get<{ rows: TestItemMasterRow[] }>("/api/test-items")
        if (alive) setMaster(data.rows ?? [])
      } catch (e) {
        if (alive) { setMaster([]); setErr(errorMessage(e, "시험항목 마스터를 불러오지 못했습니다.")) }
      }
    })()
    return () => { alive = false }
  }, [])

  // 이미 진행 중인 항목은 다시 넣을 수 없다. 제외된 항목은 고르면 다시 포함된다.
  const activeNames = useMemo(
    () => new Set(existing.filter(r => !r.isExcluded).map(r => r.testItemName)),
    [existing],
  )
  const excludedNames = useMemo(
    () => new Set(existing.filter(r => r.isExcluded).map(r => r.testItemName)),
    [existing],
  )

  const visible = useMemo(() => {
    const kw = q.trim().toLowerCase()
    return (master ?? []).filter(m =>
      !kw || m.name.toLowerCase().includes(kw) || (m.category ?? "").toLowerCase().includes(kw))
  }, [master, q])

  const toggle = (id: string) =>
    setChecked(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })

  const confirm = async () => {
    setSaving(true)
    try {
      await onConfirm((master ?? []).filter(m => checked.has(m.id)))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={next => { if (!next && !saving) onClose() }}>
      <DialogContent size="lg" className="max-h-[85dvh]">
        <DialogHeader>
          <DialogTitle>시험항목 추가</DialogTitle>
          <DialogDescription>
            {productName} — 이 오더에만 추가할 항목을 고르세요. 품목별 기준 항목은 바뀌지 않습니다.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="시험항목명·분류로 검색"
              className="h-9 w-full rounded-md border border-input bg-background pl-8 pr-3 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            />
          </div>

          {master === null ? (
            <div className="flex flex-col gap-1.5">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-11 w-full rounded-md" />)}
            </div>
          ) : err ? (
            <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-6 text-center text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200">{err}</p>
          ) : visible.length === 0 ? (
            <p className="rounded-md border border-dashed py-10 text-center text-sm text-muted-foreground">
              검색 결과가 없습니다.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {visible.map(m => {
                const already = activeNames.has(m.name)
                const wasExcluded = excludedNames.has(m.name)
                return (
                  <li key={m.id}>
                    <label className={cn(
                      "flex items-center gap-2 rounded-md border px-3 py-2.5",
                      already ? "cursor-not-allowed bg-muted/40" : "cursor-pointer",
                      !already && checked.has(m.id) && "border-primary/40 bg-primary/5",
                    )}>
                      <input
                        type="checkbox"
                        className="cb-custom"
                        checked={checked.has(m.id)}
                        disabled={already}
                        onChange={() => toggle(m.id)}
                      />
                      <span className={cn(
                        "min-w-0 flex-1 truncate text-sm",
                        already ? "text-muted-foreground" : "text-foreground",
                      )}>
                        {m.name}
                      </span>
                      {m.category && (
                        <Badge variant="outline" className="shrink-0 font-normal text-muted-foreground">{m.category}</Badge>
                      )}
                      {already && <Badge variant="outline" className="shrink-0 border-blue-200 text-blue-700 dark:border-blue-800 dark:text-blue-300">포함됨</Badge>}
                      {wasExcluded && <Badge variant="outline" className="shrink-0 border-amber-200 text-amber-700 dark:border-amber-800 dark:text-amber-300">제외됨 · 다시 포함</Badge>}
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          <Button onClick={confirm} disabled={checked.size === 0 || saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Check />}{checked.size}개 추가
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
