/**
 * 공수 표기 변환 — DB 는 항상 '분(minute)', 화면은 사람이 읽기 쉬운 단위.
 *
 * 표기 규칙(§7)
 *   5     → "5분"
 *   90    → "1시간 30분"
 *   480   → "8시간"
 *   1800  → "30시간"
 *
 * 인적/기기/검토 공수는 '시간' 기준으로 읽는다. '일'로는 환산하지 않는다 —
 * 표준 소요일과 혼동되기 때문이다(공수 합계 ≠ 소요일).
 */

/** 분 → "N시간 M분" (0 이면 "-") */
export function formatMinutes(minutes: number | null | undefined, emptyText = "—"): string {
  if (minutes == null) return emptyText
  const m = Math.round(minutes)
  if (m === 0) return emptyText
  if (m < 0) return `-${formatMinutes(-m, emptyText)}`

  const hours = Math.floor(m / 60)
  const rest = m % 60
  if (hours === 0) return `${rest}분`
  if (rest === 0) return `${hours}시간`
  return `${hours}시간 ${rest}분`
}

/** 분 → 시간(소수 1자리 숫자). 차트 축·집계용. */
export function minutesToHours(minutes: number | null | undefined): number {
  if (!minutes) return 0
  return Number((minutes / 60).toFixed(1))
}

/** 분 → "N.N시간" (KPI 평균값 표기용) */
export function formatHours(minutes: number | null | undefined, emptyText = "—"): string {
  if (minutes == null) return emptyText
  const h = minutesToHours(minutes)
  if (h === 0) return emptyText
  return `${h}시간`
}

/** 표준 소요일 표기 — 공수와 구분되도록 항상 "일" 단위 */
export function formatLeadDays(days: number | null | undefined, emptyText = "—"): string {
  if (days == null) return emptyText
  const rounded = Number(days.toFixed(1))
  return `${rounded}일`
}

/** 편차 분 → "+15분" / "-5분" */
export function formatVarianceMinutes(minutes: number | null | undefined): string {
  if (minutes == null) return "—"
  if (minutes === 0) return "0분"
  const sign = minutes > 0 ? "+" : "-"
  return `${sign}${formatMinutes(Math.abs(minutes), "0분")}`
}

/** 편차율 → "+56.7%" */
export function formatVarianceRate(rate: number | null | undefined): string {
  if (rate == null) return "—"
  const sign = rate > 0 ? "+" : ""
  return `${sign}${rate.toFixed(1)}%`
}

/** "시간 + 분" 두 입력값을 분으로 합친다 */
export function toMinutes(hours: string | number, minutes: string | number): number {
  const h = Number(hours) || 0
  const m = Number(minutes) || 0
  return Math.max(0, Math.round(h * 60 + m))
}

/** 분 → { hours, minutes } 두 입력값으로 분해 */
export function splitMinutes(total: number): { hours: number; minutes: number } {
  const m = Math.max(0, Math.round(total))
  return { hours: Math.floor(m / 60), minutes: m % 60 }
}
