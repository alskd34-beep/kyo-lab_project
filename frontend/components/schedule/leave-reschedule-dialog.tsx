"use client"

/**
 * 휴가와 겹치는 배정을 어떻게 할지 고르는 다이얼로그.
 *
 * 예전에는 「그대로 배정」과 「취소」 둘뿐이었다. 그런데 현장에서 실제로 하고 싶은 일은
 * 셋째 것이다 — "월요일이 휴가니 화요일부터 시작". 취소하면 배정 자체가 없던 일이 되고,
 * 그대로 배정하면 휴가 중인 사람에게 일이 걸린 채 관리자 알림만 쌓인다.
 *
 * 그래서 **착수 예정일을 여기서 정하고 배정**할 수 있게 한다(pct_orders.planned_start_date).
 * 추천 날짜는 충돌한 휴가가 모두 끝난 뒤의 첫 근무일이다 — 주말·공휴일을 건너뛰므로
 * "금요일 휴가" 는 토·일을 넘겨 월요일이 된다.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { CalendarOff, CalendarCheck, TriangleAlert } from "lucide-react"
import {
  Dialog, DialogBody, DialogContent, DialogDescription,
  DialogFooter, DialogHeader, DialogTitle,
} from "@frontend/components/ui/dialog"
import { Button } from "@frontend/components/ui/button"
import { DateField } from "@frontend/components/ui/date-field"
import { cn } from "@frontend/lib/utils"
import { addDays, isNonWorkingDay } from "@shared/workdays"
import {
  describeConflicts, findAbsenceConflicts, hasHardConflict,
  type TesterAbsence,
} from "@shared/leave"

/** 경고 대상 1건 — 오더 이름과 그 오더에서 걸린 휴가들 */
export interface LeaveConflictItem {
  label: string
  conflicts: TesterAbsence[]
}

/** 관리자가 고른 처리 방법 */
export type LeaveResolution =
  | { kind: "as-is" }                    // 그대로 배정 (예전 동작)
  | { kind: "shift"; date: string }      // 착수 예정일을 정하고 배정

/**
 * 충돌한 휴가가 전부 끝난 다음 첫 근무일.
 * 휴가 종료일 자체는 아직 부재이므로 그 다음 날부터 찾는다.
 */
export function recommendStartDate(
  conflicts: readonly TesterAbsence[],
  holidays: ReadonlySet<string>,
  today: string,
): string {
  const lastTo = conflicts.reduce((max, c) => (c.to > max ? c.to : max), "")
  let cur = addDays(lastTo && lastTo >= today ? lastTo : today, 1)
  // 상한 400일 — 공휴일 데이터가 비어도 무한 루프에 빠지지 않게 한다.
  for (let i = 0; i < 400 && isNonWorkingDay(cur, holidays as Set<string>); i++) {
    cur = addDays(cur, 1)
  }
  return cur
}

/** 그 해의 공휴일 집합. 실패하면 빈 집합 — 주말만 건너뛴다(추천이 없는 것보다 낫다). */
export function useHolidaySet(year: number): Set<string> {
  const [set, setSet] = useState<Set<string>>(new Set())
  useEffect(() => {
    let aborted = false
    void (async () => {
      try {
        // 연말에 다음 해로 넘어가는 추천을 위해 두 해를 함께 읽는다.
        const years = [year, year + 1]
        const lists = await Promise.all(years.map(async y => {
          const res = await fetch(`/api/holidays?year=${y}`, { credentials: "include" })
          if (!res.ok) return [] as { date: string }[]
          const json = await res.json()
          return (json.rows ?? []) as { date: string }[]
        }))
        if (aborted) return
        setSet(new Set(lists.flat().map(r => r.date)))
      } catch { /* 주말만 건너뛴다 */ }
    })()
    return () => { aborted = true }
  }, [year])
  return set
}

export function LeaveRescheduleDialog({
  open, testerName, items, absences, testerId, busy, onResolve, onCancel,
}: {
  open: boolean
  testerName: string
  items: LeaveConflictItem[]
  /** 고른 날짜가 또 휴가에 걸리는지 즉시 확인하기 위해 전체 부재 목록을 받는다 */
  absences: readonly TesterAbsence[]
  testerId: string | null
  busy?: boolean
  onResolve: (r: LeaveResolution) => void
  onCancel: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const holidays = useHolidaySet(Number(today.slice(0, 4)))

  const allConflicts = useMemo(() => items.flatMap(i => i.conflicts), [items])
  const recommended = useMemo(
    () => recommendStartDate(allConflicts, holidays, today),
    [allConflicts, holidays, today],
  )

  // 고른 값이 없으면 추천값을 쓴다. effect 로 state 를 맞추지 않는 이유는, 공휴일이
  // 늦게 도착해 추천이 바뀔 때마다 사용자가 이미 고른 날짜를 덮어쓰기 때문이다.
  // (다이얼로그는 요청마다 새로 마운트되므로 닫으면 선택도 함께 사라진다)
  const [picked, setPicked] = useState<string | null>(null)
  const date = picked ?? recommended
  const setDate = setPicked

  /** 고른 날짜가 여전히 휴가에 걸리는가 — 하루짜리 구간으로 본다 */
  const stillConflicts = useMemo(() => {
    if (!date || !testerId) return []
    return findAbsenceConflicts(testerId, { from: date, to: date }, absences)
  }, [date, testerId, absences])

  const chosenIsNonWorking = date ? isNonWorkingDay(date, holidays) : false
  const hard = hasHardConflict(allConflicts)

  return (
    <Dialog open={open} onOpenChange={next => { if (!next && !busy) onCancel() }}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className={cn(
              "flex size-8 items-center justify-center rounded-md",
              hard ? "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-300"
                   : "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
            )}>
              <CalendarOff className="size-4" />
            </span>
            휴가 기간과 겹칩니다
          </DialogTitle>
          <DialogDescription>
            {testerName} 담당자의 휴가·출장과 겹치는 오더가 {items.length}건 있습니다.
            시작할 날짜를 정해 배정하거나, 그대로 배정할 수 있습니다.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="grid gap-4">
          {/* 무엇이 왜 걸렸는지 */}
          <ul className="flex flex-col gap-1 rounded-md border bg-muted/40 p-3">
            {items.map(i => (
              <li key={i.label} className="flex flex-wrap items-baseline gap-x-2 text-xs leading-normal">
                <span className="font-medium text-foreground">{i.label}</span>
                <span className="text-muted-foreground">— {describeConflicts(i.conflicts)}</span>
              </li>
            ))}
          </ul>

          <section className="rounded-md border bg-card p-4 shadow-sm">
            <h3 className="mb-3 border-b pb-2 text-sm font-semibold text-foreground">
              착수 예정일을 정해 배정
            </h3>
            <div className="flex flex-wrap items-end gap-3">
              <div className="w-48">
                <DateField label="시작할 날짜" value={date} onChange={setDate} />
              </div>
              {recommended && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDate(recommended)}
                  disabled={busy || date === recommended}
                >
                  <CalendarCheck />
                  휴가 다음 근무일 ({recommended.slice(5).replace("-", "/")})
                </Button>
              )}
            </div>

            {/* 고른 날짜가 여전히 문제면 저장 전에 알린다 */}
            {stillConflicts.length > 0 ? (
              <p className="mt-2 flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs leading-normal text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                고른 날짜도 {describeConflicts(stillConflicts)} 와 겹칩니다. 다른 날짜를 골라 주세요.
              </p>
            ) : chosenIsNonWorking ? (
              <p className="mt-2 flex items-start gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-normal text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
                주말·공휴일입니다. 그대로 두면 달력에서 다음 근무일부터 그려집니다.
              </p>
            ) : (
              <p className="mt-2 text-xs leading-normal text-muted-foreground">
                이 날짜부터 시험을 시작하는 것으로 기록되고, 월간 스케줄도 이 날짜에 그려집니다.
              </p>
            )}
          </section>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onCancel} disabled={busy}>취소</Button>
          <Button
            variant="outline"
            onClick={() => onResolve({ kind: "as-is" })}
            disabled={busy}
          >
            그대로 배정
          </Button>
          <Button
            onClick={() => onResolve({ kind: "shift", date })}
            disabled={busy || !date || stillConflicts.length > 0}
          >
            <CalendarCheck />
            이 날짜로 배정
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** 다이얼로그 요청 입력 — 호출부가 await 한 줄로 쓰게 한다 */
export interface LeaveRescheduleRequest {
  testerId: string | null
  testerName: string
  items: LeaveConflictItem[]
  absences: readonly TesterAbsence[]
}

/**
 * `const { request, node } = useLeaveReschedule()` 로 쓴다.
 *
 * 기존 호출부가 `await requestConfirm(...)` 한 줄이었으므로 같은 모양을 유지한다.
 * 취소하면 null 을 돌려준다 — 호출부는 그때 아무것도 하지 않으면 된다.
 */
export function useLeaveReschedule() {
  const [req, setReq] = useState<LeaveRescheduleRequest | null>(null)
  const resolverRef = useRef<((r: LeaveResolution | null) => void) | null>(null)

  const finish = useCallback((r: LeaveResolution | null) => {
    resolverRef.current?.(r)
    resolverRef.current = null
    setReq(null)
  }, [])

  const request = useCallback((input: LeaveRescheduleRequest) => {
    // 이전 요청이 남아 있으면 취소로 닫아 준다 — 리졸버가 영영 안 불리면 호출부가 멈춘다.
    resolverRef.current?.(null)
    setReq(input)
    return new Promise<LeaveResolution | null>(resolve => { resolverRef.current = resolve })
  }, [])

  const node = req ? (
    <LeaveRescheduleDialog
      open
      testerId={req.testerId}
      testerName={req.testerName}
      items={req.items}
      absences={req.absences}
      onResolve={finish}
      onCancel={() => finish(null)}
    />
  ) : null

  return { request, node }
}
