/**
 * [BACKEND] 휴가 기간 가용성 기반 "가능 품목" 제안
 *   GET /api/operator-schedule/suggestions?from=&to=   — 인증
 *       해당 기간 휴가/출장으로 빠지는 시험자를 제외하고,
 *       남은 인원으로 진행 가능한 / 불가한 대기 PCT 오더 품목을 제안.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { suggestForLeaveWindow } from '@backend/services/leaveSuggestions'

export const runtime = 'nodejs'

const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const from = searchParams.get('from') ?? ''
    const to   = searchParams.get('to') ?? ''
    if (!ISO.test(from) || !ISO.test(to)) {
      return Response.json({ error: 'from·to (YYYY-MM-DD) 가 필요합니다.' }, { status: 400 })
    }
    if (to < from) {
      return Response.json({ error: 'to 는 from 이후여야 합니다.' }, { status: 400 })
    }
    const result = await suggestForLeaveWindow(from, to)
    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
