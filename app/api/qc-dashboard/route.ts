/**
 * [BACKEND] QC 관리자 대시보드
 *   GET /api/qc-dashboard  — 관리자 전용 집계
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { getQcDashboard } from '@backend/services/qcDashboard'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const data = await getQcDashboard()
    return Response.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
