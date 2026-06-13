/**
 * [BACKEND] PCT 오더 수정이력
 *   GET /api/pct-orders/[id]/edits   (인증)
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { listEdits } from '@backend/services/pctOrders'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const rows = await listEdits(id)
    return Response.json({ rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
