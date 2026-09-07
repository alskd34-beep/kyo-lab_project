"use client"

/**
 * 부업무 기록 다이얼로그 — 월간 그리드에서 칸 하나를 눌렀을 때 열린다.
 *
 * 이 화면이 지켜야 하는 것: **기록이 30초 안에 끝나야 한다.**
 * 시험자는 시험을 하다 말고 들어오는 사람이라, 입력이 번거로우면 기록 자체를 안 한다.
 * 그래서 날짜는 누른 칸이 이미 정했고(다시 묻지 않는다), 소요시간은 프리셋 한 번으로
 * 끝나고, 저장하면 폼이 비워져 그 자리에서 다음 건을 이어 넣을 수 있다.
 *
 * 남의 칸을 누른 시험자에게는 같은 다이얼로그가 읽기 전용으로 열린다 —
 * 팀이 그날 무엇을 했는지는 보이되 손댈 수는 없다(서버도 같은 규칙으로 막는다).
 */

import { useEffect, useMemo, useRef, useState } from "react"
import { Pencil, Plus, Trash2, X } from "lucide-react"
import {
  MINUTE_PRESETS, MAX_MINUTES_PER_LOG,
  type SideWorkCategory, type SideWorkLog,
} from "@shared/side-work"
import { cn } from "@frontend/lib/utils"
import { formatMinutes } from "@frontend/lib/workload-format"
import { Button } from "@frontend/components/ui/button"
import { Input } from "@frontend/components/ui/input"
import { DateField } from "@frontend/components/ui/date-field"
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@frontend/components/ui/dialog"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@frontend/components/ui/select"
import { useConfirmMessage } from "@frontend/components/common/confirm-message"
import { useToastMessage } from "@frontend/components/common/toast-message"

const DOW_KOR = ["일", "월", "화", "수", "목", "금", "토"]

function dowOf(dateStr: string): string {
  return DOW_KOR[new Date(dateStr + "T00:00:00Z").getUTCDay()]
}

export interface SideWorkDialogTarget {
  date: string
  testerId: string
  testerName: string
  /** 이 칸을 고칠 수 있는가 — 본인 칸이거나 관리자 */
  canEdit: boolean
}

interface Props {
  target: SideWorkDialogTarget
  logs: SideWorkLog[]
  categories: SideWorkCategory[]
  onClose: () => void
  /** 저장·삭제 후 목록을 다시 읽어오도록 부모에 알린다 */
  onChanged: () => void
}

/** 빈 폼 — 분류는 직전에 고른 것을 이어 쓴다(같은 종류를 연달아 넣는 일이 잦다) */
function emptyForm(categoryId: string, date: string) {
  return { id: null as string | null, categoryId, title: "", minutes: 60, note: "", workDate: date }
}

export function SideWorkDialog({ target, logs, categories, onClose, onChanged }: Props) {
  const { showToast } = useToastMessage()
  const { requestConfirm } = useConfirmMessage()
  const titleRef = useRef<HTMLInputElement>(null)

  const [form, setForm] = useState(() => emptyForm(categories[0]?.id ?? "", target.date))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 분류 목록이 늦게 도착하면 select 가 빈 채로 남는다 — 첫 값으로 채워 준다.
  useEffect(() => {
    if (!form.categoryId && categories.length > 0) {
      setForm(f => ({ ...f, categoryId: categories[0].id }))
    }
  }, [categories, form.categoryId])

  const dayTotal = useMemo(() => logs.reduce((s, l) => s + l.minutes, 0), [logs])
  const editing = form.id !== null

  function startEdit(log: SideWorkLog) {
    setError(null)
    setForm({
      id: log.id, categoryId: log.categoryId, title: log.title,
      minutes: log.minutes, note: log.note ?? "", workDate: log.workDate,
    })
    // 편집으로 바꾼 직후 커서를 내용 칸에 둔다 — 대개 고치는 것이 그 값이다.
    requestAnimationFrame(() => titleRef.current?.focus())
  }

  function cancelEdit() {
    setError(null)
    setForm(emptyForm(form.categoryId, target.date))
  }

  async function submit() {
    if (!form.categoryId) { setError("부업무 분류를 선택해 주세요."); return }
    if (!form.title.trim()) { setError("업무 내용을 입력해 주세요."); return }
    if (!Number.isInteger(form.minutes) || form.minutes <= 0) {
      setError("소요시간을 분 단위로 입력해 주세요."); return
    }
    if (form.minutes > MAX_MINUTES_PER_LOG) {
      setError("한 건의 소요시간은 24시간을 넘을 수 없습니다."); return
    }

    setSaving(true)
    setError(null)
    try {
      const body = {
        workDate: form.workDate,
        categoryId: form.categoryId,
        title: form.title.trim(),
        minutes: form.minutes,
        note: form.note.trim() || null,
      }
      const res = await fetch(
        editing ? `/api/side-work/${form.id}` : "/api/side-work",
        {
          method: editing ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          // 관리자가 남의 칸에 넣을 수 있어야 한다. 시험자가 보내도 서버가 본인으로 되돌린다.
          body: JSON.stringify(editing ? body : { ...body, testerId: target.testerId }),
        },
      )
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "저장에 실패했습니다.")

      showToast({ title: editing ? "부업무를 수정했습니다." : "부업무를 기록했습니다.", variant: "success" })
      // 분류는 남긴다 — 같은 분류를 연달아 넣는 일이 잦다.
      setForm(emptyForm(form.categoryId, target.date))
      onChanged()
      requestAnimationFrame(() => titleRef.current?.focus())
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류")
    } finally {
      setSaving(false)
    }
  }

  async function remove(log: SideWorkLog) {
    const confirmed = await requestConfirm({
      title: "이 부업무 기록을 삭제할까요?",
      description: `${log.categoryName} · ${log.title} (${formatMinutes(log.minutes)}) 기록이 지워지고 운영 리포트 집계에서도 빠집니다.`,
      confirmLabel: "삭제",
      variant: "danger",
    })
    if (!confirmed) return

    try {
      const res = await fetch(`/api/side-work/${log.id}`, { method: "DELETE", credentials: "include" })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? "삭제에 실패했습니다.")
      showToast({ title: "부업무 기록을 삭제했습니다.", variant: "success" })
      if (form.id === log.id) setForm(emptyForm(form.categoryId, target.date))
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "알 수 없는 오류")
    }
  }

  return (
    <Dialog open onOpenChange={next => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>부업무 기록</DialogTitle>
          <DialogDescription className="text-xs leading-normal break-keep">
            <span className="tabular-nums">{target.date}</span> ({dowOf(target.date)})
            <span className="px-1 text-border">·</span>
            {target.testerName}
            {!target.canEdit && (
              <>
                <span className="px-1 text-border">·</span>
                읽기 전용
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="space-y-4">
          {/* ── 그날 기록 ─────────────────────────────────────────────────── */}
          <section>
            <div className="flex items-baseline justify-between gap-2">
              <h3 className="text-xs font-semibold text-muted-foreground">이 날 기록</h3>
              <p className="text-xs tabular-nums text-muted-foreground">
                {logs.length}건 · 합계 <span className="font-semibold text-foreground">{formatMinutes(dayTotal, "0분")}</span>
              </p>
            </div>

            {logs.length === 0 ? (
              <p className="mt-2 rounded-md border border-dashed px-3 py-4 text-center text-xs break-keep text-muted-foreground">
                {target.canEdit
                  ? "아직 기록이 없습니다. 아래에서 바로 추가할 수 있습니다."
                  : "이 날 기록된 부업무가 없습니다."}
              </p>
            ) : (
              <ul className="mt-2 divide-y rounded-md border">
                {logs.map(log => (
                  <li
                    key={log.id}
                    className={cn(
                      "flex min-w-0 items-start gap-2 px-3 py-2",
                      form.id === log.id && "bg-muted/60",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        {/* 분류는 색이 아니라 글자로 구분한다 — 분류가 계속 늘어나는 목록이라
                            색을 배정하면 곧 뜻 없는 무지개가 된다 */}
                        <span className="shrink-0 rounded-md border border-teal-300 bg-teal-50 px-1.5 py-0.5 text-xs leading-normal font-medium text-teal-700 dark:border-teal-800 dark:bg-teal-950 dark:text-teal-300">
                          {log.categoryName}
                        </span>
                        <span className="min-w-0 flex-1 text-sm break-keep text-foreground">{log.title}</span>
                        <span className="shrink-0 text-sm font-semibold tabular-nums text-foreground">
                          {formatMinutes(log.minutes)}
                        </span>
                      </div>
                      {log.note && (
                        <p className="mt-0.5 text-xs leading-normal break-keep text-muted-foreground">{log.note}</p>
                      )}
                    </div>
                    {target.canEdit && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button
                          type="button" variant="ghost" size="icon"
                          aria-label={`${log.title} 수정`}
                          onClick={() => startEdit(log)}
                        >
                          <Pencil size={14} />
                        </Button>
                        <Button
                          type="button" variant="ghost" size="icon"
                          aria-label={`${log.title} 삭제`}
                          onClick={() => void remove(log)}
                        >
                          <Trash2 size={14} className="text-destructive" />
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* ── 추가 / 수정 폼 ────────────────────────────────────────────── */}
          {target.canEdit && (
            <section className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-xs font-semibold text-muted-foreground">
                  {editing ? "기록 수정" : "부업무 추가"}
                </h3>
                {editing && (
                  <Button type="button" variant="ghost" size="sm" onClick={cancelEdit} className="h-7 gap-1">
                    <X size={13} />
                    수정 취소
                  </Button>
                )}
              </div>

              {/* 분류 + 내용 — 좁은 화면에서는 두 줄로 접힌다 */}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select
                  value={form.categoryId}
                  onValueChange={v => setForm(f => ({ ...f, categoryId: v }))}
                >
                  <SelectTrigger className="w-full sm:w-44" aria-label="부업무 분류">
                    <SelectValue placeholder="분류 선택" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  ref={titleRef}
                  value={form.title}
                  onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
                  onKeyDown={e => { if (e.key === "Enter" && !saving) void submit() }}
                  placeholder="무슨 일을 했나요? (예: 일탈보고서 작성)"
                  aria-label="업무 내용"
                  className="flex-1"
                />
              </div>

              {/* 소요시간 — 프리셋 한 번이 기본, 직접 입력은 예외 */}
              <div className="flex flex-wrap items-center gap-1.5">
                {MINUTE_PRESETS.map(p => (
                  <Button
                    key={p.minutes}
                    type="button"
                    size="sm"
                    variant={form.minutes === p.minutes ? "default" : "outline"}
                    aria-pressed={form.minutes === p.minutes}
                    onClick={() => setForm(f => ({ ...f, minutes: p.minutes }))}
                  >
                    {p.label}
                  </Button>
                ))}
                <div className="ml-auto flex items-center gap-1.5">
                  <Input
                    type="number" min={1} max={MAX_MINUTES_PER_LOG} step={5}
                    value={form.minutes}
                    onChange={e => setForm(f => ({ ...f, minutes: Number(e.target.value) }))}
                    aria-label="소요 분"
                    className="w-20 tabular-nums"
                  />
                  <span className="text-xs whitespace-nowrap text-muted-foreground">
                    분 = {formatMinutes(form.minutes, "0분")}
                  </span>
                </div>
              </div>

              {/* 메모 — 선택 입력이라 한 줄로 둔다 */}
              <Input
                value={form.note}
                onChange={e => setForm(f => ({ ...f, note: e.target.value }))}
                placeholder="메모 (선택)"
                aria-label="메모"
              />

              {/* 날짜는 누른 칸이 정했다. 잘못 넣은 건을 옮길 때만 고칠 수 있게 편집 중에만 낸다. */}
              {editing && (
                <div className="max-w-48">
                  <DateField
                    size="sm"
                    label="날짜"
                    value={form.workDate}
                    onChange={v => setForm(f => ({ ...f, workDate: v || target.date }))}
                  />
                </div>
              )}

              {error && (
                <p className="text-xs break-keep text-destructive">{error}</p>
              )}

              <div className="flex justify-end">
                <Button type="button" onClick={() => void submit()} disabled={saving} className="gap-1.5">
                  <Plus size={14} />
                  {saving ? "저장 중…" : editing ? "수정 저장" : "기록 추가"}
                </Button>
              </div>
            </section>
          )}
        </DialogBody>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>닫기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
