/**
 * [BACKEND] 운영 결과 리포트 — 시험업무 vs 부업무
 *   GET /api/insights/operation-report?from=YYYY-MM-DD&to=YYYY-MM-DD   (admin)
 *
 * 인사이트는 전사 실적을 보는 화면이라 관리자 전용이다(types/route-access.ts 와 같은 선).
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { getOperationReport } from '@backend/services/operationReport'

export const runtime = 'nodejs'

const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const sp = req.nextUrl.searchParams
    const from = sp.get('from') ?? ''
    const to   = sp.get('to') ?? ''
    if (!ISO.test(from) || !ISO.test(to)) {
      return Response.json({ error: 'from·to (YYYY-MM-DD) 가 필요합니다.' }, { status: 400 })
    }
    if (to < from) {
      return Response.json({ error: '종료일은 시작일 이후여야 합니다.' }, { status: 400 })
    }
    return Response.json(await getOperationReport({ from, to }))
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
