/**
 * [BACKEND] 공휴일 서비스
 *
 * ⚠️ 방어적 설계: holidays 테이블이 아직 없을 수 있으므로,
 * 모든 함수는 테이블 부재 시(Postgres 42P01) graceful 폴백한다.
 */

import { supabase } from '@backend/lib/supabase'

export interface HolidayRow {
  date: string
  description: string
  createdAt?: string
}

/** DB row → 앱 레이어 camelCase 변환 */
function mapRow(row: { date: string; description: string; created_at?: string }): HolidayRow {
  return {
    date:        row.date,
    description: row.description,
    createdAt:   row.created_at,
  }
}

/**
 * 공휴일 목록 조회.
 * year 지정 시 해당 연도만(date LIKE 'YYYY-%'), date 오름차순.
 * 테이블 부재 시 빈 배열 반환.
 */
export async function listHolidays(year?: number): Promise<HolidayRow[]> {
  try {
    let q = supabase.from('holidays').select('date, description, created_at').order('date', { ascending: true })
    if (year != null) {
      q = q.like('date', `${year}-%`)
    }
    const { data, error } = await q
    if (error) {
      // 42P01: relation does not exist — 테이블 미적용 상태
      if ((error as { code?: string }).code === '42P01') return []
      console.error('[holidays] listHolidays 오류:', error.message)
      return []
    }
    return (data ?? []).map(mapRow)
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
  try {
    const { error } = await supabase
      .from('holidays')
      .upsert({ date, description }, { onConflict: 'date' })
    if (error) {
      if ((error as { code?: string }).code === '42P01') return
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
    const { error } = await supabase.from('holidays').delete().eq('date', date)
    if (error) {
      if ((error as { code?: string }).code === '42P01') return
      throw new Error(`공휴일 삭제 실패: ${error.message}`)
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('공휴일 삭제 실패')) throw err
    console.error('[holidays] removeHoliday 예외:', err)
  }
}
