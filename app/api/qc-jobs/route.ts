/**
 * [BACKEND] QC 작업
 *   GET  /api/qc-jobs           — 내 작업 화면 데이터 (인증)
 *   POST /api/qc-jobs { orderId } — 작업 시작 (채번)
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { listWorkspace, startJob } from '@backend/services/qcJobs'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const data = await listWorkspace(auth.payload.sub)
    return Response.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json() as { orderId?: string }
    if (!body.orderId) return Response.json({ error: 'orderId는 필수입니다.' }, { status: 400 })
    const result = await startJob(body.orderId, auth.payload.sub)
    return Response.json(result, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
