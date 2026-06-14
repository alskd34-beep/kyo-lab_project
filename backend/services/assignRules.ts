/**
 * [BACKEND] AI 배정 보조 — 규칙 모듈
 *
 * 광동제약 QC 업무 자동배정에 적용되는 도메인 규칙을 "순수 함수"로 모은 모듈.
 * 모든 함수는 부수효과(DB I/O, 전역 상태 변경) 없이 입력 → 출력만 하므로 단위테스트가 쉽다.
 * 추후 pctAssign.ts 에서 import 하여 배정 후보 필터링/정렬/강제배정 로직과 통합한다.
 *
 * 구현 규칙 요약:
 *  1) 향정신성 의약품 — 특정 시험자 제외 + 관리자 알림
 *  2) 개별 중금속 시험 — 매주 금요일 순환 강제배정 (1DAY 고정)
 *  3) 긴급 업무 — 공수 3DAY 이하 품목만 허용
 *  4) 난이도 기반 — 최근 HIGH 난이도 부담이 큰 시험자에게 차주 penalty 부여
 */

// ─── 상수 ──────────────────────────────────────────────────────────────────────

/** [규칙1] 향정신성 의약품 대상 품목명 */
export const PSYCHOTROPIC_PRODUCTS = ['자이렌정', '아디펙스정'] as const

/** [규칙1] 향정신성 의약품 배정 제외 시험자 이름 */
export const PSYCHOTROPIC_EXCLUDED_NAMES = ['강지윤', '김정호'] as const

/** [규칙2] 개별 중금속 시험 주차별 순환 대상자 이름 (인덱스 0=1주차 …) */
export const HEAVY_METAL_ROTATION = ['박성호', '이영남', '정예찬'] as const

/** [규칙3] 긴급(EMERGENCY) 배정 허용 최대 공수(DAY) */
export const EMERGENCY_MAX_DAYS = 3

// ─── 타입 ──────────────────────────────────────────────────────────────────────

/** 배정 후보 최소 정보 (TesterRow 의 부분집합) */
export interface TesterLite {
  id: string
  name: string
}

// ─── 규칙1: 향정신성 의약품 ──────────────────────────────────────────────────────

/**
 * [규칙1] 향정신성 의약품 여부 판정.
 * 품목명이 PSYCHOTROPIC_PRODUCTS 중 하나를 포함하면 true.
 * (품목명에 제형/규격 등이 덧붙는 경우를 고려해 정확 일치가 아닌 부분 포함으로 판정)
 */
export function isPsychotropic(productName: string): boolean {
  if (!productName) return false
  return PSYCHOTROPIC_PRODUCTS.some(p => productName.includes(p))
}

/**
 * [규칙1] 향정신성 의약품 배정 후보 필터링.
 * - 향정신성이면: 제외 이름(PSYCHOTROPIC_EXCLUDED_NAMES)을 뺀 후보 + 관리자 알림 필요(true).
 * - 일반 품목이면: 전체 후보 + 알림 불필요(false).
 */
export function filterPsychotropicCandidates(
  productName: string,
  testers: TesterLite[],
): { candidates: TesterLite[]; requiresAdminAlert: boolean } {
  if (!isPsychotropic(productName)) {
    return { candidates: testers, requiresAdminAlert: false }
  }
  const excluded = new Set<string>(PSYCHOTROPIC_EXCLUDED_NAMES)
  const candidates = testers.filter(t => !excluded.has(t.name))
  return { candidates, requiresAdminAlert: true }
}

// ─── 규칙2: 개별 중금속 시험 (금요일 순환 강제배정) ───────────────────────────────

/**
 * [규칙2] 기준일로부터의 ISO 주차 인덱스(연속 증가 정수).
 * 월~일 주 경계 기준으로 결정적인 정수를 산출한다.
 * (1970-01-01 이 목요일이므로 +3 보정 후 7로 나눠 월요일 시작 주로 정렬)
 */
export function isoWeekIndex(date: Date): number {
  const y = date.getUTCFullYear()
  const m = date.getUTCMonth()
  const d = date.getUTCDate()
  return Math.floor((Date.UTC(y, m, d) / 86400000 + 3) / 7)
}

/** [규칙2] 해당 날짜가 금요일인지 여부 (개별 중금속 시험 강제배정 요일) */
export function isFriday(date: Date): boolean {
  return date.getUTCDay() === 5
}

/**
 * [규칙2] 주차 인덱스에 해당하는 개별 중금속 시험 담당자 반환.
 * HEAVY_METAL_ROTATION[weekIndex % 3] 이름과 매칭되는 tester 를 찾아 반환,
 * 매칭되는 시험자가 후보에 없으면 null.
 * (공수는 호출측에서 1DAY 고정으로 처리)
 */
export function heavyMetalAssigneeForWeek(
  weekIndex: number,
  testers: TesterLite[],
): TesterLite | null {
  const len = HEAVY_METAL_ROTATION.length
  // 음수 weekIndex 도 안전하게 0..len-1 로 정규화
  const idx = ((weekIndex % len) + len) % len
  const targetName = HEAVY_METAL_ROTATION[idx]
  return testers.find(t => t.name === targetName) ?? null
}

// ─── 규칙3: 긴급 업무 제한 ────────────────────────────────────────────────────────

/**
 * [규칙3] 긴급(EMERGENCY) 배정 허용 여부.
 * 공수(dayCount, avg_hours 를 DAY 로 환산했거나 별도 산정한 일수)가
 * EMERGENCY_MAX_DAYS(3DAY) 이하인 품목만 긴급 배정을 허용한다.
 */
export function emergencyAllowed(dayCount: number): boolean {
  return dayCount <= EMERGENCY_MAX_DAYS
}

// ─── 규칙4: 난이도 기반 배정 ─────────────────────────────────────────────────────

/**
 * [규칙4] 최근 HIGH 난이도 부담 점수 → penalty.
 * 최근 2주간 받은 HIGH 난이도 업무 건수가 많을수록 penalty 가 커진다.
 * 정렬 시 workload 에 가산하여 "HIGH 부담이 큰 시험자"를 MEDIUM/LOW 우선에서 뒤로 보낸다.
 */
export function difficultyPenalty(recentHighCount: number): number {
  // 음수 입력 방지 후 그대로 점수화 (선형). 가중치가 필요하면 호출측에서 곱한다.
  return Math.max(0, recentHighCount)
}

/**
 * [규칙4] MEDIUM/LOW 난이도 배정용 시험자 비교자(오름차순).
 * penalty(=difficultyPenalty(recentHighCount)) + workload 합이 작은 시험자를 우선한다.
 * Array.prototype.sort 에 그대로 전달 가능.
 */
export function compareTestersForLowDifficulty(
  a: { recentHighCount: number; workload: number },
  b: { recentHighCount: number; workload: number },
): number {
  const scoreA = difficultyPenalty(a.recentHighCount) + a.workload
  const scoreB = difficultyPenalty(b.recentHighCount) + b.workload
  return scoreA - scoreB
}
