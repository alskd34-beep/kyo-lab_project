/**
 * [BACKEND] 작업 시작 전 장비 준비상태 조회
 *   GET /api/qc-jobs/readiness?orderId= — 인증 필요
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { getStartReadiness } from '@backend/services/qcJobs'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const orderId = searchParams.get('orderId')
    if (!orderId) return Response.json({ error: 'orderId는 필수입니다.' }, { status: 400 })
    const result = await getStartReadiness(orderId)
    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
