/**
 * [BACKEND] PCT 오더 배정
 *   POST /api/pct-orders/assign   (admin)
 *     { mode: 'auto', orderIds?: string[] }      — AI 자동배정
 *     { mode: 'manual', orderId, testerId|null } — 수동 배정
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { autoAssign, assignManually } from '@backend/services/pctAssign'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json() as {
      mode?: 'auto' | 'manual'
      orderIds?: string[]
      orderId?: string
      testerId?: string | null
    }
    if (body.mode === 'manual') {
      if (!body.orderId) return Response.json({ error: 'orderId는 필수입니다.' }, { status: 400 })
      await assignManually(body.orderId, body.testerId ?? null)
      return Response.json({ ok: true })
    }
    const result = await autoAssign(body.orderIds)
    return Response.json(result)
  } catch (err) {
    console.error('[api/pct-orders/assign]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
