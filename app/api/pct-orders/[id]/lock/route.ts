/**
 * [BACKEND] PCT 오더 확정/LOCK 토글 (관리자 전용)
 *   POST /api/pct-orders/[id]/lock   body: { lock: boolean }
 *
 * PRD 원칙1(관리자 확정 → LOCK) / 원칙3(LOCK 존중). 관리자만 가능.
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { setOrderLock } from '@backend/services/pctOrders'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({}))
    const lock = body.lock !== false   // 기본 true(확정)
    await setOrderLock(id, lock, auth.payload.sub)
    return Response.json({ ok: true, locked: lock })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
