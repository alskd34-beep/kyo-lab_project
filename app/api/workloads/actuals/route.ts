/**
 * [BACKEND] 표준공수 vs 실제공수 비교
 *   GET /api/workloads/actuals?months=3&productId=... — 최근 N개월 실적 비교 (인증)
 *
 * 실측 데이터를 아직 수집하지 않는 단계라 대부분 hasData:false 로 응답한다.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { getActualSummary } from '@backend/services/workloadStandard'

export const runtime = 'nodejs'

const ALLOWED_MONTHS = [1, 3, 6, 12]

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const sp = req.nextUrl.searchParams
    const requested = Number(sp.get('months') ?? 3)
    const months = ALLOWED_MONTHS.includes(requested) ? requested : 3
    const data = await getActualSummary({ months, productId: sp.get('productId') })
    return Response.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
