/**
 * [BACKEND] 장비 예약 단건
 *   PATCH  /api/equipment-reservation/[id] { action: 'cancel' | 'complete' }  (인증)
 *   DELETE /api/equipment-reservation/[id]  (admin)
 */

import { NextRequest } from 'next/server'
import { requireAuth, requireAdmin } from '@backend/lib/guard'
import {
  cancelReservation, completeReservation, deleteReservation, reservationOwnerId,
} from '@backend/services/equipmentReservation'

export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body = await req.json() as { action?: 'cancel' | 'complete' }
    if (body.action !== 'cancel' && body.action !== 'complete') {
      return Response.json({ error: "action 은 'cancel' 또는 'complete' 여야 합니다." }, { status: 400 })
    }

    // 담당자는 본인 예약만 변경 가능, 관리자는 전체
    if (auth.payload.role !== 'admin') {
      const ownerId = await reservationOwnerId(id)
      if (ownerId !== auth.payload.sub) {
        return Response.json({ error: '본인 예약만 변경할 수 있습니다.' }, { status: 403 })
      }
    }

    if (body.action === 'cancel') await cancelReservation(id)
    else await completeReservation(id)

    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    await deleteReservation(id)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
