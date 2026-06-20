/**
 * [BACKEND] 동시분석 품목군 단건
 *   PATCH  /api/concurrent-product-families/[id]  { name?, note?, codes?[] }  — 수정 (admin)
 *   DELETE /api/concurrent-product-families/[id]                              — 삭제 (admin)
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { updateFamily, deleteFamily } from '@backend/services/concurrentProductFamilies'

export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body = await req.json() as { name?: string; note?: string | null; codes?: string[] }
    await updateFamily(id, body)
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
    await deleteFamily(id)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
