/**
 * [BACKEND] 장비 마스터 단건
 *   PATCH  /api/equipment-master/[id]  { ...patch } — 수정 (admin)
 *   DELETE /api/equipment-master/[id]               — 삭제 (admin)
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { updateEquipment, deleteEquipment } from '@backend/services/equipmentMaster'
import type { EquipmentMasterRow } from '@backend/services/equipmentMaster'

export const runtime = 'nodejs'

export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const patch = await req.json() as Partial<EquipmentMasterRow>
    await updateEquipment(id, patch)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> }
) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    await deleteEquipment(id)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
