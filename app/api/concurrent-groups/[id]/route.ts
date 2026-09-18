/**
 * [BACKEND] 동시분석 그룹 단건
 *   PATCH  /api/concurrent-groups/[id] { groupLock }              — 잠금 토글 (admin)
 *   PATCH  /api/concurrent-groups/[id] { addOrderIds }            — 멤버 추가(다른 그룹에서 옮겨 옴)
 *   PATCH  /api/concurrent-groups/[id] { removeOrderIds }         — 멤버 제거(1건 이하가 되면 해체)
 *   DELETE /api/concurrent-groups/[id]                            — 그룹 해체 (오더 자체는 그대로)
 *
 * group_lock=true 인 그룹은 재생성(rebuild) 시 보존된다. 수동 그룹은 항상 잠긴 상태로
 * 만들어지므로, 잠금을 풀면 다음 재생성에서 규칙대로 다시 갈라진다.
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import {
  addGroupMembers, dissolveGroup, removeGroupMembers, setGroupLock, setGroupRepresentative,
} from '@backend/services/concurrentGroups'

export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body = await req.json() as {
      groupLock?: boolean; addOrderIds?: string[]; removeOrderIds?: string[]; representativeOrderId?: string
    }
    if (Array.isArray(body.addOrderIds) && body.addOrderIds.length > 0) {
      const added = await addGroupMembers(id, body.addOrderIds)
      return Response.json({ ok: true, added })
    }
    if (Array.isArray(body.removeOrderIds) && body.removeOrderIds.length > 0) {
      const r = await removeGroupMembers(id, body.removeOrderIds)
      return Response.json({ ok: true, ...r })
    }
    if (typeof body.groupLock === 'boolean') {
      await setGroupLock(id, body.groupLock)
      return Response.json({ ok: true })
    }
    if (body.representativeOrderId) {
      await setGroupRepresentative(id, body.representativeOrderId)
      return Response.json({ ok: true })
    }
    return Response.json(
      { error: 'groupLock · addOrderIds · removeOrderIds · representativeOrderId 중 하나는 필요합니다.' },
      { status: 400 },
    )
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
    await dissolveGroup(id)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
