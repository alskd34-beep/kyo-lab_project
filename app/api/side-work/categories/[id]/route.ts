/**
 * [BACKEND] 부업무 분류 단건 (admin)
 *   PATCH  /api/side-work/categories/[id] { code?, name?, sortOrder?, isActive? }
 *   DELETE /api/side-work/categories/[id]
 *       · 기록이 달린 분류는 지우지 못한다. 비활성화(isActive=false)로 끈다.
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { deleteCategory, updateCategory } from '@backend/services/sideWork'

export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body = await req.json() as { code?: string; name?: string; sortOrder?: number; isActive?: boolean }
    await updateCategory(id, body)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    const bad = /이미 있습니다|비울 수 없/.test(msg)
    return Response.json({ error: msg }, { status: bad ? 400 : 500 })
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    await deleteCategory(id)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    // "기록이 있어 삭제 불가"는 충돌이다 — 사용자가 비활성화로 바꿀 수 있다.
    const conflict = msg.includes('삭제할 수 없습니다')
    return Response.json({ error: msg }, { status: conflict ? 409 : 500 })
  }
}
