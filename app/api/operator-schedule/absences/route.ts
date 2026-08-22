/**
 * [BACKEND] 시험자 부재(휴가/출장) 구간 — 배정 화면의 휴가 경고용
 *   GET /api/operator-schedule/absences?from=YYYY-MM-DD&to=YYYY-MM-DD   (인증)
 *
 * users.tester_id 가 연결된 사용자만 포함하므로 배정 후보(tester) 기준으로 바로 쓸 수 있다.
 * 판정 자체는 화면이 @shared/leave 의 순수 함수로 수행한다(서버 배정 로직과 같은 규칙).
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { testerAbsences } from '@backend/services/operatorSchedule'

export const runtime = 'nodejs'

const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const sp = req.nextUrl.searchParams
    const from = sp.get('from') ?? ''
    const to = sp.get('to') ?? ''
    if (!ISO.test(from) || !ISO.test(to)) {
      return Response.json({ error: 'from·to 는 YYYY-MM-DD 형식이어야 합니다.' }, { status: 400 })
    }
    if (from > to) {
      return Response.json({ error: '시작일이 종료일보다 늦습니다.' }, { status: 400 })
    }
    const rows = await testerAbsences(from, to)
    return Response.json({ rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
