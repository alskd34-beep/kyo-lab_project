/**
 * [BACKEND] 작업자 현황 (관리자)
 *   GET /api/qc-jobs/overview — "내 작업"을 수행 중인 작업자별 진행 현황 집계
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { listWorkerOverview } from '@backend/services/qcJobs'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const data = await listWorkerOverview()
    return Response.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
