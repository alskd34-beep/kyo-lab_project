/**
 * [BACKEND] 근무일 계산 — 주말·공휴일을 뺀 날짜 산술.
 *
 * 원래 `scheduleEngine.ts` 안에 private 함수로만 있었다. 월간 스케줄 화면이
 * 같은 계산(배정 1건이 달력의 어느 날짜들을 차지하는가)을 필요로 하게 되면서
 * 여기로 옮겼다 — 두 곳이 각자 계산하면 엔진이 잡은 날짜와 달력이 그리는 날짜가
 * 어긋난다.
 *
 * 날짜는 전부 'YYYY-MM-DD' 문자열이고, 비교·순회는 UTC 기준으로 한다
 * (로컬 타임존이 끼면 하루가 밀린다).
 */

/** 폭주 방지 상한 — 어떤 순회도 이 일수를 넘지 않는다 */
const GUARD_DAYS = 400

export function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function isWeekend(iso: string): boolean {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay()
  return dow === 0 || dow === 6
}

/** 주말이거나 공휴일이거나, 호출자가 따로 건너뛰라고 준 날(skip: 휴가 등) */
export function isNonWorkingDay(iso: string, holidays: Set<string>, skip?: Set<string>): boolean {
  return isWeekend(iso) || holidays.has(iso) || (skip?.has(iso) ?? false)
}

/** startISO(당일 포함)부터 정방향으로 count개의 근무일 */
export function workingDaysFromInclusive(
  startISO: string, count: number, holidays: Set<string>, skip?: Set<string>,
): string[] {
  const out: string[] = []
  let cur = startISO
  let guard = 0
  while (out.length < count && guard < GUARD_DAYS) {
    if (!isNonWorkingDay(cur, holidays, skip)) out.push(cur)
    cur = addDays(cur, 1)
    guard++
  }
  return out
}

/** 포장일 **다음** 근무일부터 count개의 근무일 (시험은 포장이 끝난 뒤 시작한다) */
export function workingDaysAfter(packISO: string, count: number, holidays: Set<string>): string[] {
  return workingDaysFromInclusive(addDays(packISO, 1), count, holidays)
}

/**
 * 완료예정일(dueISO)부터 거꾸로 count개의 근무일을 모아 오름차순 반환.
 * 마지막 날 ≤ dueISO (완료예정일 당일이 근무일이면 그 날 완료). 역순 ALAP 스케줄링용.
 */
export function workingDaysBefore(dueISO: string, count: number, holidays: Set<string>): string[] {
  const out: string[] = []
  let cur = dueISO
  let guard = 0
  while (out.length < count && guard < GUARD_DAYS) {
    if (!isNonWorkingDay(cur, holidays)) out.unshift(cur)
    cur = addDays(cur, -1)
    guard++
  }
  return out
}

/** 'YYYY-MM-DD' 구간을 하루 단위로 펼친다 (양끝 포함) */
export function expandRange(from: string, to: string): string[] {
  const out: string[] = []
  let cur = from
  let guard = 0
  while (cur <= to && guard < GUARD_DAYS) { out.push(cur); cur = addDays(cur, 1); guard++ }
  return out
}
