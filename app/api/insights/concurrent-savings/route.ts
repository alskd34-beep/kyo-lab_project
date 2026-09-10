/**
 * [BACKEND] 동시분석 절감
 *   GET /api/insights/concurrent-savings?from=&to=   (admin)
 *
 * 단일 분석 대비 동시분석이 얼마나 줄였는지. 계획(공수, 일)과 실적(소요, 분)을 따로 준다 —
 * 한 축으로 뭉치면 "계획이 좋았는지" 와 "실행이 좋았는지" 를 구분할 수 없다.
 *
 * 절감은 저장하지 않고 매번 계산한다(파생값). 기간을 주면 그 기간에 **완료된 항목**만
 * 실적에 넣는다 — 운영 리포트와 같은 기준이다.
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { listGroupSavings, summarizeSavings } from '@backend/services/concurrentSavings'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const sp = req.nextUrl.searchParams
    const rows = await listGroupSavings({
      from: sp.get('from') ?? undefined,
      to:   sp.get('to') ?? undefined,
    })
    return Response.json({ rows, summary: summarizeSavings(rows) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
