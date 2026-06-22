/**
 * [BACKEND] 공휴일 서비스
 *
 * ⚠️ 방어적 설계: holidays 테이블이 아직 없을 수 있으므로,
 * 모든 함수는 테이블 부재 시(Postgres 42P01) graceful 폴백한다.
 */

import { supabase } from '@backend/lib/supabase'
import { getRestHolidaysForYear } from '@backend/lib/holiday'

/** 출처: 'api'(공휴일 API 수집) | 'manual'(사용자 직접 등록) */
export type HolidaySource = 'api' | 'manual'

export interface HolidayRow {
  date: string
  description: string
  source: HolidaySource
  createdAt?: string
}

/** DB row → 앱 레이어 camelCase 변환 (source 컬럼 미적용 환경은 'manual' 로 간주) */
function mapRow(row: { date: string; description: string; source?: string; created_at?: string }): HolidayRow {
  return {
    date:        row.date,
    description: row.description,
    source:      row.source === 'api' ? 'api' : 'manual',
    createdAt:   row.created_at,
  }
}

/** Postgres 에러코드 추출 (42P01 테이블부재 / 42703 컬럼부재 판별용) */
function pgCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code
}

/**
 * 공휴일 목록 조회.
 * year 지정 시 해당 연도만(date LIKE 'YYYY-%'), date 오름차순.
 * 테이블 부재 시 빈 배열 반환.
 */
export async function listHolidays(year?: number): Promise<HolidayRow[]> {
  // source 컬럼 미적용 환경(42703)에서도 목록이 깨지지 않도록 컬럼 유무를 폴백한다.
  const query = (cols: string) => {
    let q = supabase.from('public_holidays').select(cols).order('date', { ascending: true })
    // date 는 date형 컬럼이라 LIKE(~~) 불가 → 연도 범위로 필터한다.
    if (year != null) q = q.gte('date', `${year}-01-01`).lte('date', `${year}-12-31`)
    return q
  }
  try {
    let { data, error } = await query('date, description, created_at, source')
    if (error && pgCode(error) === '42703') {
      // source 컬럼 미적용 → 컬럼 없이 재조회 (mapRow 가 'manual' 로 간주)
      ;({ data, error } = await query('date, description, created_at'))
    }
    if (error) {
      // 42P01: relation does not exist — 테이블 미적용 상태
      if (pgCode(error) === '42P01') return []
      console.error('[holidays] listHolidays 오류:', error.message)
      return []
    }
    return ((data ?? []) as unknown as { date: string; description: string; source?: string; created_at?: string }[]).map(mapRow)
  } catch (err) {
    console.error('[holidays] listHolidays 예외:', err)
    return []
  }
}

/**
 * 엔진용 공휴일 Set 반환.
 * year 지정 시 해당 연도만, 미지정 시 전체.
 * 테이블 부재·오류 시 빈 Set 반환 → 엔진이 기존처럼 주말만 처리.
 */
export async function getHolidaySet(year?: number): Promise<Set<string>> {
  const rows = await listHolidays(year)
  return new Set(rows.map(r => r.date))
}

/**
 * 공휴일 추가/수정 (upsert).
 * 테이블 부재 시 조용히 실패.
 */
export async function addHoliday(date: string, description: string): Promise<void> {
  const upsert = (payload: Record<string, unknown>) =>
    supabase.from('public_holidays').upsert(payload, { onConflict: 'date' })
  try {
    // 수동 등록은 source='manual' 로 명시(이후 API 수집이 덮어쓰지 않도록).
    let { error } = await upsert({ date, description, source: 'manual' })
    if (error && pgCode(error) === '42703') {
      // source 컬럼 미적용 환경 → 컬럼 없이 재시도
      ;({ error } = await upsert({ date, description }))
    }
    if (error) {
      if (pgCode(error) === '42P01') return
      throw new Error(`공휴일 추가 실패: ${error.message}`)
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('공휴일 추가 실패')) throw err
    console.error('[holidays] addHoliday 예외:', err)
  }
}

/**
 * 공휴일 삭제.
 * 테이블 부재 시 조용히 실패.
 */
export async function removeHoliday(date: string): Promise<void> {
  try {
    const { error } = await supabase.from('public_holidays').delete().eq('date', date)
    if (error) {
      if ((error as { code?: string }).code === '42P01') return
      throw new Error(`공휴일 삭제 실패: ${error.message}`)
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('공휴일 삭제 실패')) throw err
    console.error('[holidays] removeHoliday 예외:', err)
  }
}

// ─── API 수집 → public_holidays 반영 ──────────────────────────────────────────
export interface ImportResult {
  /** API 에서 수집한 공휴일 수(날짜 기준 중복 제거 후) */
  total: number
  /** 실제 저장(api)한 수 */
  imported: number
  /** 기존 수동(manual) 우선으로 건너뛴 수 */
  skippedManual: number
}

/** locdate(YYYYMMDD 숫자) → 'YYYY-MM-DD' */
function locdateToDateStr(locdate: number): string {
  const s = String(locdate)
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
}

/**
 * 지정 연도의 공휴일을 data.go.kr API 에서 수집해 public_holidays 에 upsert 한다.
 *
 * - locdate 기준 중복 방지(PK=date, onConflict=date) → 다시 실행해도 개수가 늘지 않음(idempotent).
 * - 같은 날짜에 manual 행이 이미 있으면 덮어쓰지 않음(수동 우선).
 * - 저장 필드: date(locdate 변환), description(dateName), source='api'.
 *
 * ⚠️ source 컬럼(0021 마이그레이션) 적용이 선행되어야 한다.
 */
export async function importHolidays(year: number): Promise<ImportResult> {
  // 1) 연 단위 수집
  const items = await getRestHolidaysForYear(year)

  // 2) 날짜 기준 중복 제거(같은 날 여러 item → 첫 명칭 사용; 배치 upsert 의 중복키 충돌 방지)
  const byDate = new Map<string, string>() // date → dateName
  for (const it of items) {
    const date = locdateToDateStr(it.locdate)
    if (!byDate.has(date)) byDate.set(date, it.dateName ?? '')
  }
  const total = byDate.size
  if (total === 0) return { total: 0, imported: 0, skippedManual: 0 }

  // 3) 기존 manual 날짜 조회(덮어쓰기 금지 대상)
  const { data: existing, error: exErr } = await supabase
    .from('public_holidays')
    .select('date, source')
    .gte('date', `${year}-01-01`)
    .lte('date', `${year}-12-31`)
  if (exErr) {
    if (pgCode(exErr) === '42703') {
      throw new Error('source 컬럼이 없습니다. 0024_public_holidays_source 마이그레이션을 먼저 적용하세요.')
    }
    if (pgCode(exErr) !== '42P01') {
      throw new Error(`공휴일 가져오기 실패(기존 조회): ${exErr.message}`)
    }
  }
  const manualDates = new Set(
    ((existing ?? []) as { date: string; source?: string }[])
      .filter(r => r.source === 'manual')
      .map(r => r.date),
  )

  // 4) manual 제외하고 source='api' 로 upsert
  const toUpsert = Array.from(byDate.entries())
    .filter(([date]) => !manualDates.has(date))
    .map(([date, description]) => ({ date, description, source: 'api' as const }))
  const skippedManual = total - toUpsert.length

  if (toUpsert.length > 0) {
    const { error } = await supabase.from('public_holidays').upsert(toUpsert, { onConflict: 'date' })
    if (error) {
      if (pgCode(error) === '42703') {
        throw new Error('source 컬럼이 없습니다. 0024_public_holidays_source 마이그레이션을 먼저 적용하세요.')
      }
      throw new Error(`공휴일 가져오기 실패(저장): ${error.message}`)
    }
  }
  return { total, imported: toUpsert.length, skippedManual }
}
