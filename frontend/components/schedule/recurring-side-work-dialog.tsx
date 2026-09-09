"use client"

/**
 * 반복 부업무 등록 — 월간 그리드에서 [반복 부업무] 를 눌렀을 때 열린다.
 *
 * 이 화면이 푸는 문제: 문서작성·시험실 정리처럼 **매일 하는 일**을 시험자가 날마다 한 건씩
 * 손으로 넣고 있었다. 한 달이면 스무 번 넘게 같은 내용을 다시 적는다.
 *
 * 그래서 지켜야 하는 것 두 가지.
 *  1) 기본값만으로 끝나야 한다 — 기간은 이번 달 남은 기간, 요일은 평일, 건너뛰기는 전부 켬.
 *     분류·내용·시간만 정하면 바로 만들 수 있다.
 *  2) 무엇이 만들어지는지 **누르기 전에** 보여야 한다. 넣고 나서 "왜 15일이 아니라 11일이지?"
 *     를 묻게 하면, 편하려고 만든 기능이 오히려 확인 부담이 된다.
 *     그래서 미리보기는 서버가 실제 생성과 **같은 함수로** 계산한 결과를 그대로 보여준다.
 */

import { useCallback, useEffect, useMemo, useState } from "react"
import { CalendarRange, Loader2, Repeat } from "lucide-react"
import {
  MINUTE_PRESETS, MAX_MINUTES_PER_LOG, type SideWorkCategory,
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
import { useToastMessage } from "@frontend/components/common/toast-message"

const DOW = [
  { v: 1, label: "월" }, { v: 2, label: "화" }, { v: 3, label: "수" },
  { v: 4, label: "목" }, { v: 5, label: "금" }, { v: 6, label: "토" }, { v: 0, label: "일" },
] as const
/** 기본 선택 요일 — 평일. 부업무는 근무 중에 하는 일이다 */
const WEEKDAYS = [1, 2, 3, 4, 5]

/** 오늘(로컬) YYYY-MM-DD */
function todayISO(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}
/** 그 달의 마지막 날 */
function monthEnd(iso: string): string {
  const [y, m] = iso.split("-").map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return `${iso.slice(0, 7)}-${String(last).padStart(2, "0")}`
}
const shortDate = (d: string) => d.slice(5).replace("-", "/")

interface Plan {
  dates: string[]
  skipped: Array<{ date: string; reason: string }>
  totalMinutes: number
}

export function RecurringSideWorkDialog({
  open, categories, testerName, onClose, onCreated,
}: {
  open: boolean
  categories: SideWorkCategory[]
  testerName: string
  onClose: () => void
  /** 생성 후 부모가 목록을 다시 읽도록 */
  onCreated: (created: number) => void
}) {
  const { showToast } = useToastMessage()
  const today = todayISO()

  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "")
  const [title, setTitle] = useState("")
  const [minutes, setMinutes] = useState(60)
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(monthEnd(today))
  const [weekdays, setWeekdays] = useState<number[]>(WEEKDAYS)
  const [skipHolidays, setSkipHolidays] = useState(true)
  const [skipAbsences, setSkipAbsences] = useState(true)

  const [plan, setPlan] = useState<Plan | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // 분류가 늦게 도착하면 첫 항목으로 맞춘다
  useEffect(() => {
    if (!categoryId && categories[0]) setCategoryId(categories[0].id)
  }, [categories, categoryId])

  const body = useMemo(() => ({
    from, to, categoryId, title: title.trim(), minutes,
    // 주말 제외는 요일 토글이 이미 표현한다(기본 월~금). 따로 보내면 토·일을 켜도 지워진다.
    weekdays, skipHolidays, skipAbsences,
  }), [from, to, categoryId, title, minutes, weekdays, skipHolidays, skipAbsences])

  const ready = Boolean(categoryId && title.trim() && from && to && from <= to && minutes > 0)

  /** 미리보기 — 서버가 실제 생성과 같은 함수로 계산한다(화면에서 따로 세지 않는다) */
  useEffect(() => {
    if (!open || !ready) { setPlan(null); return }
    let aborted = false
    const t = setTimeout(() => {
      void (async () => {
        setPreviewing(true)
        try {
          const res = await fetch("/api/side-work/recurring?preview=1", {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
          const json = await res.json()
          if (aborted) return
          if (!res.ok) { setPlan(null); setError(json.error ?? "미리보기 실패"); return }
          setPlan(json as Plan); setError(null)
        } catch {
          if (!aborted) setPlan(null)
        } finally {
          if (!aborted) setPreviewing(false)
        }
      })()
    }, 250)   // 타이핑마다 부르지 않는다
    return () => { aborted = true; clearTimeout(t) }
  }, [open, ready, body])

  const toggleDow = useCallback((v: number) => {
    setWeekdays(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v].sort())
  }, [])

  async function submit() {
    if (!ready || saving) return
    setSaving(true); setError(null)
    try {
      const res = await fetch("/api/side-work/recurring", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "생성 실패")
      showToast({
        title: `${json.created}일치 부업무를 만들었습니다`,
        description: `총 ${formatMinutes(json.totalMinutes)} · 개별 기록은 그날 칸에서 고치거나 지울 수 있습니다.`,
      })
      onCreated(json.created as number)
    } catch (e) {
      setError(e instanceof Error ? e.message : "생성 실패")
    } finally {
      setSaving(false)
    }
  }

  /** 건너뛴 사유별 건수 — 날짜를 전부 늘어놓으면 읽히지 않는다 */
  const skipSummary = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const s of plan?.skipped ?? []) {
      const list = m.get(s.reason) ?? []
      list.push(shortDate(s.date))
      m.set(s.reason, list)
    }
    return [...m.entries()]
  }, [plan])

  return (
    <Dialog open={open} onOpenChange={next => { if (!next && !saving) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-md bg-primary/10 text-primary">
              <Repeat className="size-4" />
            </span>
            반복 부업무
          </DialogTitle>
          <DialogDescription>
            매일 하는 일을 기간만큼 한 번에 넣습니다. 주말·공휴일{skipAbsences && "·휴가"}는 자동으로 건너뜁니다.
            {testerName && ` · 대상: ${testerName}`}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="grid gap-4">
          <section className="rounded-md border bg-card p-4 shadow-sm">
            <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">무엇을</h3>
            <div className="grid gap-3">
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">분류</span>
                <Select value={categoryId} onValueChange={setCategoryId}>
                  <SelectTrigger className="!h-9 px-3"><SelectValue placeholder="분류 선택" /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </label>
              <label className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">내용</span>
                <Input
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="예: 시험 기록서 정리"
                />
              </label>
              <div className="grid gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">하루 소요시간</span>
                <div className="flex flex-wrap items-center gap-1.5">
                  {MINUTE_PRESETS.map(p => (
                    <Button
                      key={p.minutes}
                      type="button"
                      size="sm"
                      variant={minutes === p.minutes ? "default" : "outline"}
                      aria-pressed={minutes === p.minutes}
                      onClick={() => setMinutes(p.minutes)}
                    >
                      {p.label}
                    </Button>
                  ))}
                  <span className="flex items-center gap-1.5">
                    <Input
                      type="number" min={1} max={MAX_MINUTES_PER_LOG}
                      value={minutes}
                      onChange={e => setMinutes(Number(e.target.value))}
                      className="h-8 w-20"
                    />
                    <span className="text-xs text-muted-foreground">분 = {formatMinutes(minutes, "0분")}</span>
                  </span>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-md border bg-card p-4 shadow-sm">
            <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">언제부터 언제까지</h3>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-40"><DateField label="시작일" value={from} onChange={setFrom} /></div>
              <div className="w-40"><DateField label="종료일" value={to} onChange={setTo} /></div>
              <Button type="button" variant="outline" size="sm" onClick={() => { setFrom(today); setTo(monthEnd(today)) }}>
                <CalendarRange />이번 달 남은 기간
              </Button>
            </div>

            <div className="mt-3 grid gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">요일</span>
              <div className="flex flex-wrap gap-1.5">
                {DOW.map(d => (
                  <Button
                    key={d.v}
                    type="button" size="sm"
                    variant={weekdays.includes(d.v) ? "default" : "outline"}
                    aria-pressed={weekdays.includes(d.v)}
                    onClick={() => toggleDow(d.v)}
                    className="w-9"
                  >
                    {d.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-4">
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" className="cb-custom" checked={skipHolidays} onChange={e => setSkipHolidays(e.target.checked)} />
                공휴일 건너뛰기
              </label>
              <label className="inline-flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input type="checkbox" className="cb-custom" checked={skipAbsences} onChange={e => setSkipAbsences(e.target.checked)} />
                내 휴가·출장일 건너뛰기
              </label>
            </div>
          </section>

          {/* 미리보기 — 누르기 전에 무엇이 만들어지는지 */}
          <section className={cn(
            "rounded-md border p-4",
            plan && plan.dates.length > 0
              ? "border-blue-200 bg-blue-50/60 dark:border-blue-800 dark:bg-blue-950/40"
              : "border-dashed bg-muted/40",
          )}>
            {!ready ? (
              <p className="text-xs leading-normal text-muted-foreground">분류·내용·기간을 정하면 만들어질 날짜를 보여드립니다.</p>
            ) : previewing ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />계산 중…</p>
            ) : plan ? (
              <>
                <p className="text-sm font-semibold text-foreground">
                  {shortDate(from)} ~ {shortDate(to)} 중{" "}
                  <span className="tabular-nums text-blue-700 dark:text-blue-300">{plan.dates.length}일</span>
                  {" · 총 "}
                  <span className="tabular-nums text-blue-700 dark:text-blue-300">{formatMinutes(plan.totalMinutes, "0분")}</span>
                </p>
                {plan.dates.length > 0 && (
                  <p className="mt-1 text-xs leading-normal break-keep text-muted-foreground">
                    {plan.dates.slice(0, 12).map(shortDate).join(", ")}
                    {plan.dates.length > 12 && ` 외 ${plan.dates.length - 12}일`}
                  </p>
                )}
                {skipSummary.length > 0 && (
                  <ul className="mt-2 flex flex-col gap-0.5 border-t pt-2">
                    {skipSummary.map(([reason, dates]) => (
                      <li key={reason} className="text-xs leading-normal break-keep text-muted-foreground">
                        <span className="font-medium text-foreground">{reason}</span> {dates.length}일 건너뜀
                        <span className="text-muted-foreground/70"> ({dates.slice(0, 8).join(", ")}{dates.length > 8 ? " …" : ""})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : null}
          </section>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-4 py-2 text-sm font-medium text-destructive">{error}</p>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          <Button onClick={() => void submit()} disabled={saving || !ready || !plan || plan.dates.length === 0}>
            {saving ? <Loader2 className="animate-spin" /> : <Repeat />}
            {saving ? "만드는 중…" : plan ? `${plan.dates.length}일치 만들기` : "만들기"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
