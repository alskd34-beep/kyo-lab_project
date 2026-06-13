/**
 * [BACKEND] PCT 적재(가져온) 이력
 *   GET /api/pct-ingest-log?limit=100   (인증)
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { listIngestLog } from '@backend/services/pctOrders'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const limit = Number(searchParams.get('limit')) || 100
    const rows = await listIngestLog(limit)
    return Response.json({ rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
