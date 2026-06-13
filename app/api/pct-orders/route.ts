/**
 * [BACKEND] PCT 오더
 *   GET   /api/pct-orders?status=&assigneeTesterId=&includeDeleted=  — 목록 (인증)
 *   PATCH /api/pct-orders  { id, patch, reason }                     — 사유 필수 수정 (admin)
 */

import { NextRequest } from 'next/server'
import { requireAuth, requireAdmin } from '@backend/lib/guard'
import { listOrders, updateOrderWithReason } from '@backend/services/pctOrders'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const rows = await listOrders({
      status: searchParams.get('status') ?? undefined,
      assigneeTesterId: searchParams.get('assigneeTesterId') ?? undefined,
      includeDeleted: searchParams.get('includeDeleted') === '1',
    })
    return Response.json({ rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json() as {
      id?: string
      patch?: Record<string, string | boolean | null>
      reason?: string
    }
    if (!body.id || !body.patch) {
      return Response.json({ error: 'id와 patch는 필수입니다.' }, { status: 400 })
    }
    await updateOrderWithReason(body.id, body.patch, body.reason ?? '', auth.payload.sub ?? null)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
