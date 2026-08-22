/**
 * 시험항목 소요시간 표기 헬퍼.
 *
 * 소요시간에는 두 기준이 있고, 화면에서 섞이면 "완료를 누를 때마다 시간이 초기화된다" 처럼 읽힌다.
 *  - 누적(total) : 작업 시작 → 항목 완료. 사용자가 "소요시간" 이라고 부르는 값.
 *  - 구간(delta) : 직전 항목 완료 → 이 항목 완료. 항목별 통계·평가 기준.
 * 그래서 누적을 앞에 두고, 값이 다를 때만 구간을 덧붙여 둘을 구분해 보여준다.
 */

/** 분 → "1시간 20분" (0분은 "0분") */
export function formatElapsedMinutes(min: number): string {
  const m = Math.max(0, Math.round(min))
  if (m < 60) return `${m}분`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h}시간` : `${h}시간 ${rest}분`
}

/**
 * 완료된 항목의 소요시간 문구.
 * totalMinutes 가 없으면(0030 마이그레이션 이전에 완료된 항목) 구간 값만 보여준다.
 */
export function formatItemElapsed(
  totalMinutes: number | null | undefined,
  deltaMinutes: number | null | undefined,
): string | null {
  const total = totalMinutes ?? deltaMinutes
  if (total == null) return null
  const head = formatElapsedMinutes(total)
  if (deltaMinutes == null || totalMinutes == null || deltaMinutes === totalMinutes) return head
  return `누적 ${head} · 구간 ${formatElapsedMinutes(deltaMinutes)}`
}
