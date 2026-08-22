/**
 * [SHARED] 시험자 자격 인증 — 상태 판정 규칙과 선택지.
 *
 * 만료 여부는 DB에 저장하지 않고 `expires_on` 과 기준일을 비교해 계산한다.
 * 저장하면 날짜가 지날 때마다 배치로 갱신해야 하고, 갱신 누락이 곧 오판이 된다.
 * 서버(집계)와 화면(칩 색)이 같은 판정을 쓰도록 이 모듈에 한 벌만 둔다.
 *
 * 스키마: supabase/migrations/0031_tester_qualifications.sql
 */

/** 만료 임박으로 볼 남은 일수. 재인증 준비 기간(약 2개월)을 기준으로 한다. */
export const EXPIRING_SOON_DAYS = 60

/** 자격 상태 — 저장값이 아니라 계산값 */
export type QualificationStatus =
  | 'valid'     // 유효
  | 'expiring'  // 만료 임박 (EXPIRING_SOON_DAYS 이내)
  | 'expired'   // 만료
  | 'none'      // 미보유 (자격 행이 없음)

export const QUALIFICATION_STATUS_LABEL: Record<QualificationStatus, string> = {
  valid:    '유효',
  expiring: '만료 임박',
  expired:  '만료',
  none:     '미보유',
}

/** 자격종류 — 같은 OJT 항목을 역할별로 따로 인증받는다 */
export const QUALIFICATION_ROLES = ['시험자', '검토자', '승인자'] as const
export type QualificationRole = (typeof QUALIFICATION_ROLES)[number]

/** 인증구분 */
export const CERT_TYPES = ['최초인증', '재인증', '기존인증'] as const
export type CertType = (typeof CERT_TYPES)[number]

/** 인증방법 */
export const CERT_METHODS = ['OJT', 'Skill 평가 점수 충족', '기존인증'] as const
export type CertMethod = (typeof CERT_METHODS)[number]

/** YYYY-MM-DD 문자열을 UTC 자정 기준 시각(ms)으로. 로컬 타임존 때문에 하루가 밀리는 것을 막는다. */
function dayValue(isoDate: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate)
  if (!m) return null
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
}

/** 오늘 날짜(YYYY-MM-DD, 로컬 기준) */
export function todayIso(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * 만료일까지 남은 일수. 만료일이 없으면(무기한) null.
 * 오늘이 만료일이면 0, 지났으면 음수.
 */
export function daysUntilExpiry(expiresOn: string | null, baseDate = todayIso()): number | null {
  if (!expiresOn) return null
  const target = dayValue(expiresOn)
  const base = dayValue(baseDate)
  if (target == null || base == null) return null
  return Math.round((target - base) / 86_400_000)
}

/**
 * 자격 1건의 상태.
 * @param expiresOn 만료일(YYYY-MM-DD). null 이면 무기한 → 항상 유효.
 */
export function qualificationStatus(
  expiresOn: string | null,
  baseDate = todayIso(),
): Exclude<QualificationStatus, 'none'> {
  const left = daysUntilExpiry(expiresOn, baseDate)
  if (left == null) return 'valid'
  if (left < 0) return 'expired'
  if (left <= EXPIRING_SOON_DAYS) return 'expiring'
  return 'valid'
}

/** 부여일 + 유효기간(개월) → 만료일. 말일 보정(1/31 + 1개월 = 2/28) 포함. */
export function calcExpiryDate(grantedOn: string, validMonths: number): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(grantedOn)
  if (!m || !Number.isFinite(validMonths) || validMonths <= 0) return null
  const year = Number(m[1])
  const month = Number(m[2]) - 1
  const day = Number(m[3])

  const target = new Date(Date.UTC(year, month + validMonths, 1))
  // 그 달의 마지막 날 — 부여일이 31일인데 대상 달이 30일까지면 30일로 맞춘다.
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  const d = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(day, lastDay)))
  return d.toISOString().slice(0, 10)
}
