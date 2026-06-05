/**
 * [BACKEND] 월간 스케줄 조회 API
 * GET /api/schedules/monthly?month=YYYY-MM
 *
 * schedules 테이블에서 해당 월의 모든 배정 데이터 + 시험자 정보 반환
 */

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { requireAuth } from '@backend/lib/guard'

export const runtime = 'nodejs'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  try {
    const { searchParams } = new URL(req.url)
    const month = searchParams.get('month') // 'YYYY-MM'

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return Response.json({ error: 'month 파라미터가 YYYY-MM 형식이어야 합니다.' }, { status: 400 })
    }

    const [yearStr, monthStr] = month.split('-')
    const year     = Number(yearStr)
    const monthIdx = Number(monthStr) - 1
    const firstDay = new Date(Date.UTC(year, monthIdx, 1))
    const lastDay  = new Date(Date.UTC(year, monthIdx + 1, 0))
    const fmt = (d: Date) => d.toISOString().slice(0, 10)
    const monthStart = fmt(firstDay)
    const monthEnd   = fmt(lastDay)

    const { data: schedules, error: scheduleErr } = await supabase
      .from('schedules')
      .select('id, tester_id, batch_id, product_name, test_items, scheduled_date, workdays, is_urgent, is_duo, duo_partner_id, status, note')
      .gte('scheduled_date', monthStart)
      .lte('scheduled_date', monthEnd)
      .order('scheduled_date', { ascending: true })

    if (scheduleErr) throw new Error(`스케줄 조회 실패: ${scheduleErr.message}`)

    const { data: testers, error: testerErr } = await supabase
      .from('testers')
      .select('id, name, employee_no')

    if (testerErr) throw new Error(`시험자 조회 실패: ${testerErr.message}`)

    return Response.json({
      month,
      monthStart,
      monthEnd,
      schedules: schedules ?? [],
      testers:   testers ?? [],
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
