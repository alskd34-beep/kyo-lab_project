/**
 * [BACKEND] 시험자 성과 집계 — 「시험자 운영 분석」(/insights/stats)의 '성과' 절반
 *   GET /api/insights/tester-evaluation?from=YYYY-MM-DD&to=YYYY-MM-DD   (admin)
 *   미지정 시 to=오늘, from=90일 전.
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { getTesterEvaluation } from '@backend/services/testerEvaluation'

export const runtime = 'nodejs'

const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const sp = req.nextUrl.searchParams
    const today = new Date()
    const to = ISO.test(sp.get('to') ?? '') ? sp.get('to')! : today.toISOString().slice(0, 10)
    let from = sp.get('from') ?? ''
    if (!ISO.test(from)) {
      const d = new Date(to + 'T00:00:00Z')
      d.setUTCDate(d.getUTCDate() - 90)
      from = d.toISOString().slice(0, 10)
    }
    if (from > to) return Response.json({ error: '시작일이 종료일보다 늦습니다.' }, { status: 400 })
    const data = await getTesterEvaluation({ from, to })
    return Response.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
