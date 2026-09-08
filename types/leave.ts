/**
 * [SHARED] 휴가/출장 충돌 판정 — 배정 화면과 서버가 같은 규칙을 쓰기 위한 공용 모듈.
 *
 * 배정 경로별 정책
 *   - AI 자동배정: 연차·출장은 후보에서 하드 제외, 반차는 0.5일 공수 차감 후순위
 *     (판정은 scheduleEngine 이 근무일 단위로 수행)
 *   - 수동 배정(오더 추가·수정·일괄배정): 막지 않는다. 현장 예외가 있으므로
 *     화면에서 경고하고, 서버는 관리자 알림을 남긴다.
 *
 * 이 모듈은 순수 함수만 둔다(DB 접근 없음). 서버 조회는 backend/services/leaveConflicts.ts.
 */

export type LeaveType = 'ANNUAL' | 'HALF_DAY' | 'BUSINESS_TRIP'

export const LEAVE_TYPE_LABEL: Record<string, string> = {
  ANNUAL: '연차',
  HALF_DAY: '반차',
  BUSINESS_TRIP: '출장',
}

export function leaveTypeLabel(type: string): string {
  return LEAVE_TYPE_LABEL[type] ?? type
}

/** operator_schedule 1행 = 시험자 부재 1구간 (양끝 포함) */
export interface TesterAbsence {
  testerId: string
  from: string   // YYYY-MM-DD
  to: string     // YYYY-MM-DD
  type: string   // LeaveType (미래 값 대비 string)
}

/** 충돌 판정에 필요한 오더 날짜만 */
export interface OrderDates {
  packagingDate: string | null
  dueDate: string | null
  /**
   * 관리자가 정한 착수 예정일(0042). 있으면 이 날이 시험 구간의 시작이다.
   * "월요일이 휴가니 화요일부터" 를 담는 자리 — 없으면 예전처럼 포장일·오늘로 추정한다.
   */
  plannedStartDate?: string | null
}

export interface DateWindow {
  from: string
  to: string
}

/**
 * 반차(HALF_DAY)는 근무를 하므로 "제외" 대상이 아니다 — 확인만 받는다.
 * 연차·출장은 그 날 근무 자체가 없으므로 배정하면 안 되는 하드 충돌.
 */
export function isHardLeave(type: string): boolean {
  return type !== 'HALF_DAY'
}

/**
 * 오더의 시험 수행 구간 [from, to].
 *
 * 시험은 포장 이후 ~ 완료예정일 사이에 수행된다.
 *   from : 착수 예정일(관리자 지정) → 없으면 포장일이 미래면 포장일 → 아니면 오늘
 *          (이미 지난 포장일은 시험 시점과 무관)
 *   to   : 완료예정일 → 없으면 포장일 → 없으면 from
 *
 * 착수 예정일이 최우선인 것이 이 함수의 핵심이다. 관리자가 "월요일은 휴가니 화요일부터"
 * 라고 정하면 구간이 화요일부터 시작해 월요일 휴가와 더 이상 겹치지 않는다. 그 지정이
 * 없을 때만 예전처럼 포장일·오늘로 추정한다.
 *
 * 지난 날짜를 착수 예정일로 지정해 둔 오더는 오늘로 당긴다 — 이미 지나간 계획으로
 * 구간을 잡으면 오늘 이후의 휴가를 놓친다.
 *
 * 납기가 지나 구간이 뒤집히면 to 를 from 에 맞춰 하루 구간으로 만든다.
 * (pctAssign.leaveWindow 가 전체 오더를 묶어 잡는 구간과 같은 사고를 오더 1건에 적용한 것)
 */
export function orderTestWindow(order: OrderDates, today: string): DateWindow {
  const planned = order.plannedStartDate
  const from = planned
    ? (planned > today ? planned : today)
    : (order.packagingDate && order.packagingDate > today ? order.packagingDate : today)
  const rawTo = order.dueDate ?? order.packagingDate ?? from
  return { from, to: rawTo < from ? from : rawTo }
}

/** 두 날짜 구간이 하루라도 겹치는가 (양끝 포함) */
export function overlaps(a: DateWindow, b: DateWindow): boolean {
  return a.from <= b.to && a.to >= b.from
}

/** 해당 시험자가 구간과 겹치는 부재 목록. 하드(연차·출장)를 먼저 돌려준다. */
export function findAbsenceConflicts(
  testerId: string | null,
  window: DateWindow,
  absences: readonly TesterAbsence[],
): TesterAbsence[] {
  if (!testerId) return []
  return absences
    .filter(a => a.testerId === testerId && overlaps(window, { from: a.from, to: a.to }))
    .sort((x, y) => Number(isHardLeave(y.type)) - Number(isHardLeave(x.type)))
}

/** 충돌 1건을 "연차 08-25~08-29" 형태로 (같은 날이면 "연차 08-25") */
export function describeAbsence(a: TesterAbsence): string {
  const short = (d: string) => d.slice(5)
  const range = a.from === a.to ? short(a.from) : `${short(a.from)}~${short(a.to)}`
  return `${leaveTypeLabel(a.type)} ${range}`
}

/** 충돌 목록 요약 — 경고 문구·알림 본문 공용 */
export function describeConflicts(conflicts: readonly TesterAbsence[]): string {
  return conflicts.map(describeAbsence).join(', ')
}

/** 하드 충돌이 하나라도 있으면 true (경고 강도 구분용) */
export function hasHardConflict(conflicts: readonly TesterAbsence[]): boolean {
  return conflicts.some(c => isHardLeave(c.type))
}

/** 오늘 날짜 (YYYY-MM-DD) — 판정 기준일을 한 곳에서 만든다 */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}
