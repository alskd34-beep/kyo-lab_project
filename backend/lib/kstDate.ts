/**
 * [BACKEND] KST(Asia/Seoul) 기준 날짜 헬퍼 — 단일 기준
 *
 * 이 시스템은 한국 공장의 근무일 기준으로만 동작한다. 그런데 배정·적재 경로는
 * `new Date().toISOString().slice(0,10)`(= UTC 날짜)을 쓰고 있었고, 챗봇 경로만
 * `Date.now() + 9h` 로 KST 를 계산하고 있었다(2026-08-23 점검).
 *
 * UTC 기준이면 KST 00:00~09:00 구간에서 "오늘"이 하루 전으로 계산된다.
 * 적재 크론이 09:00 KST(= 00:00 UTC)라 정확히 그 경계에서 돈다:
 *   - 휴가 조회 시작일이 하루 당겨지고
 *   - D-7 마감 알림이 하루 어긋나고
 *   - qc_jobs.work_start_date 가 전날로 기록되고
 *   - 중금속 주차 순환 담당자가 주 경계에서 한 주 밀린다
 *
 * 새 코드는 반드시 이 모듈을 쓴다. `new Date().toISOString().slice(0,10)` 금지.
 */

/** KST 오프셋 (밀리초) */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000

/**
 * KST 벽시계 시각을 값으로 갖는 Date.
 *
 * 주의: 반환된 Date 의 `getUTC*()` 계열이 KST 의 연/월/일/요일을 준다.
 * 이 프로젝트의 날짜 유틸(scheduleEngine, assignRules)이 전부 `getUTC*` 기반이라
 * 그 관례에 맞춘 것이다. 표시용 포맷팅에는 쓰지 말 것.
 */
export function kstNow(): Date {
  return new Date(Date.now() + KST_OFFSET_MS)
}

/** KST 기준 오늘 (YYYY-MM-DD) */
export function kstToday(): string {
  return kstNow().toISOString().slice(0, 10)
}

/** KST 기준 오늘로부터 n일 뒤/앞 (YYYY-MM-DD) */
export function kstDateAfter(days: number): string {
  return new Date(Date.now() + KST_OFFSET_MS + days * 86_400_000)
    .toISOString()
    .slice(0, 10)
}

/** KST 기준 현재 연도 */
export function kstYear(): number {
  return kstNow().getUTCFullYear()
}
