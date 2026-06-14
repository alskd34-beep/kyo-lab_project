/**
 * [BACKEND] 재배정 이력 (reassignment_history)
 *   GET /api/reassignment-history?afterUser=&productName=&limit=
 *       · admin 전용. { rows, stats } 반환.
 *       · afterUser:   변경 후 시험자(tester id) 필터.
 *       · productName: 품목명 부분검색.
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { listReassignments, reassignmentStats } from '@backend/services/reassignmentHistory'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const afterUser   = searchParams.get('afterUser') ?? undefined
    const productName = searchParams.get('productName') ?? undefined
    const limitRaw    = searchParams.get('limit')
    const limit       = limitRaw ? Number(limitRaw) : undefined

    const [rows, stats] = await Promise.all([
      listReassignments({ afterUser, productName, limit }),
      reassignmentStats(),
    ])
    return Response.json({ rows, stats })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
