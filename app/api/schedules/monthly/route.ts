/**
 * [BACKEND] 월간 스케줄 조회 API
 *   GET /api/schedules/monthly?month=YYYY-MM   (인증)
 *
 * 로직은 @backend/services/monthlySchedule 에 있다(라우트는 thin).
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { getMonthlySchedule } from '@backend/services/monthlySchedule'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  try {
    const month = req.nextUrl.searchParams.get('month')
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return Response.json({ error: 'month 파라미터가 YYYY-MM 형식이어야 합니다.' }, { status: 400 })
    }
    return Response.json(await getMonthlySchedule(month))
  } catch (err) {
    console.error('[api/schedules/monthly]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
