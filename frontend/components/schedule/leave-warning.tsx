"use client"

/**
 * 수동 배정 시 휴가/출장 경고 — 배정 화면 공용 조각.
 *
 * 정책: 수동 배정은 막지 않는다(현장 예외가 있다). 화면에서 경고하고 확인만 받으며,
 * 서버는 backend/services/leaveConflicts 가 관리자 알림을 남긴다.
 * 판정은 서버 배정 로직과 같은 @shared/leave 순수 함수를 쓴다.
 */

import { useCallback, useEffect, useState } from "react"
import { CalendarOff, TriangleAlert } from "lucide-react"
import { cn } from "@frontend/lib/utils"
import {
  describeConflicts,
  findAbsenceConflicts,
  hasHardConflict,
  orderTestWindow,
  todayIso,
  type OrderDates,
  type TesterAbsence,
} from "@shared/leave"

/** 부재 조회 구간 — 과거 3개월 ~ 향후 9개월. 신규 배정이 일어나는 현실적 범위. */
const PAST_DAYS = 90
const FUTURE_DAYS = 270

function shiftDays(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * 시험자 부재 구간 목록. 배정 화면이 담당자 선택 시 겹침을 판정하는 데 쓴다.
 * 조회 실패 시 빈 배열 — 경고는 부가 기능이므로 화면을 막지 않는다.
 */
export function useTesterAbsences(): { absences: TesterAbsence[]; reload: () => void } {
  const [absences, setAbsences] = useState<TesterAbsence[]>([])

  const reload = useCallback(() => {
    const from = shiftDays(-PAST_DAYS)
    const to = shiftDays(FUTURE_DAYS)
    void (async () => {
      try {
        const res = await fetch(
          `/api/operator-schedule/absences?from=${from}&to=${to}`,
          { credentials: "include" },
        )
        if (!res.ok) { setAbsences([]); return }
        const data = (await res.json()) as { rows?: TesterAbsence[] }
        setAbsences(data.rows ?? [])
      } catch {
        setAbsences([])
      }
    })()
  }, [])

  useEffect(() => { reload() }, [reload])

  return { absences, reload }
}

/** 오더 1건 + 담당자의 휴가 충돌. 없으면 빈 배열. */
export function conflictsFor(
  testerId: string | null,
  order: OrderDates,
  absences: readonly TesterAbsence[],
): TesterAbsence[] {
  if (!testerId) return []
  return findAbsenceConflicts(testerId, orderTestWindow(order, todayIso()), absences)
}

/** Select 옵션 뒤에 붙는 작은 휴가 표시 */
export function LeaveChip({ conflicts }: { conflicts: readonly TesterAbsence[] }) {
  if (conflicts.length === 0) return null
  const hard = hasHardConflict(conflicts)
  return (
    <span
      className={cn(
        "ml-1 inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs leading-normal font-medium",
        // 연한 칩은 밝은 배경 전제라 다크에서 명도만 뒤집는다(50->950, 700->300, 200->800).
        hard
          ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
          : "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300",
      )}
    >
      <CalendarOff className="size-2.5" />
      {describeConflicts(conflicts)}
    </span>
  )
}

/** 폼 하단에 노출하는 경고 박스 — 저장을 막지는 않는다 */
export function LeaveConflictNotice({
  conflicts,
  testerName,
  className,
}: {
  conflicts: readonly TesterAbsence[]
  testerName?: string | null
  className?: string
}) {
  if (conflicts.length === 0) return null
  const hard = hasHardConflict(conflicts)
  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-md border px-3 py-2 text-xs",
        // 위 LeaveChip 과 같은 규칙 — 글자 800 은 다크에서 200 으로 간다.
        hard
          ? "border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300"
          : "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200",
        className,
      )}
    >
      <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
      <span>
        {testerName ? `${testerName} 담당자는 ` : "선택한 담당자는 "}
        이 오더의 시험 기간에 <strong>{describeConflicts(conflicts)}</strong> 일정이 있습니다.
        {hard
          ? " 연차·출장은 근무일이 아니므로 AI 자동배정에서는 제외되는 조건입니다."
          : " 반차는 근무일이지만 가용 공수가 줄어듭니다."}
        {" 그대로 저장할 수 있으며, 저장 시 관리자 알림이 남습니다."}
      </span>
    </div>
  )
}

/** 확인 대화상자 본문 — 여러 오더를 한꺼번에 배정할 때 */
export function bulkConflictSummary(
  items: { label: string; conflicts: TesterAbsence[] }[],
): string {
  return items
    .filter(i => i.conflicts.length > 0)
    .map(i => `· ${i.label} — ${describeConflicts(i.conflicts)}`)
    .join("\n")
}
