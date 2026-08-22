/**
 * @deprecated 호출하는 화면이 없다 (2026-08-22 점검 기준).
 * production_batches 기반 통계. 현재 대시보드는 /api/qc-dashboard 를 쓴다.
 * 제거 여부는 운영 확인 후 결정한다 — docs/system-audit-2026-08-22.md 9번 항목.
 */
import { NextRequest } from 'next/server'
import { getDashboardStats } from '@backend/services/batches'
import { requireAuth } from '@backend/lib/guard'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const g = await requireAuth(req)
  if (!g.ok) return g.response
  try {
    const stats = await getDashboardStats()
    return Response.json(stats)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
