/**
 * [BACKEND] 월간 스케줄 조회
 *
 * 레거시 `schedules` 테이블(2026-04 적재, 65행)에서 해당 월 배정을 읽는다.
 *
 * ⚠️ `schedules` 는 **동결된 레거시**다.
 *    - `tester_id`/`batch_id` 가 int 라 현재 uuid 체계(`testers.id`)와 맞지 않는다.
 *      월간 화면은 시험자를 **이름으로** 매칭하므로 표시에는 문제가 없다.
 *    - 새로 쓰는 곳은 없다. 주간 배정은 `pct_orders`(AI 스케줄 화면)로 통합됐다(2026-08-22).
 *    - 월간 화면을 `pct_orders` 기준으로 옮기는 것은 후속 과제다
 *      (docs/system-audit-2026-08-22.md 5번 항목).
 *
 * ⚠️ 반환 필드가 snake_case 인 것은 의도적 예외다. 월간 화면이 이 응답과
 *    PCT 브릿지(`frontend/lib/pct-schedule-bridge.ts`)의 행을 같은 배열에서 병합하므로
 *    두 소스의 키가 같아야 한다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { selectAll } from '@backend/lib/supabasePage'

export interface MonthlyScheduleRow {
  /** 레거시 `schedules` 는 int 다 */
  id: string | number
  tester_id: string | number | null
  batch_id: string | number | null
  product_name: string | null
  test_items: string[] | null
  scheduled_date: string | null
  workdays: number | null
  is_urgent: boolean
  is_duo: boolean
  duo_partner_id: string | number | null
  status: string
  note: string | null
}

export interface MonthlyTester {
  id: string
  name: string
  employee_no: string
}

export interface MonthlyScheduleResult {
  month: string
  monthStart: string
  monthEnd: string
  schedules: MonthlyScheduleRow[]
  testers: MonthlyTester[]
}

const SELECT =
  'id, tester_id, batch_id, product_name, test_items, scheduled_date, workdays, is_urgent, is_duo, duo_partner_id, status, note'

/** 'YYYY-MM' → 해당 월의 첫날·마지막날 ISO 문자열 */
export function monthRange(month: string): { monthStart: string; monthEnd: string } {
  const [yearStr, monthStr] = month.split('-')
  const year = Number(yearStr)
  const monthIdx = Number(monthStr) - 1
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return {
    monthStart: fmt(new Date(Date.UTC(year, monthIdx, 1))),
    monthEnd:   fmt(new Date(Date.UTC(year, monthIdx + 1, 0))),
  }
}

export async function getMonthlySchedule(month: string): Promise<MonthlyScheduleResult> {
  const { monthStart, monthEnd } = monthRange(month)

  const [scheduleRes, testerRes] = await Promise.all([
    supabaseAdmin
      .from('schedules')
      .select(SELECT)
      .gte('scheduled_date', monthStart)
      .lte('scheduled_date', monthEnd)
      .order('scheduled_date', { ascending: true }),
    selectAll(supabaseAdmin, 'testers', 'id, name, employee_no'),
  ])
  if (scheduleRes.error) throw new Error(`스케줄 조회 실패: ${scheduleRes.error.message}`)
  if (testerRes.error) throw new Error(`시험자 조회 실패: ${testerRes.error.message}`)

  return {
    month,
    monthStart,
    monthEnd,
    schedules: (scheduleRes.data ?? []) as unknown as MonthlyScheduleRow[],
    testers:   (testerRes.data ?? []) as unknown as MonthlyTester[],
  }
}
