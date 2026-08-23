/**
 * [BACKEND] 시험 역량 마스터 단건
 *   PATCH  /api/tester-capabilities/master/[id]  { code?, name?, sortOrder? }  — 수정 (admin)
 *   DELETE /api/tester-capabilities/master/[id][?force=1]                      — 삭제 (admin)
 *
 * force=1 은 이 역량에 매겨 둔 시험자 숙련도까지 함께 지운다(FK on delete cascade).
 * 화면에서 건수를 확인시킨 뒤에만 붙인다.
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { deleteCapability, updateCapability } from '@backend/services/testers'

export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body = await req.json() as { code?: string; name?: string; sortOrder?: number }
    await updateCapability(id, body)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    await deleteCapability(id, { force: req.nextUrl.searchParams.get('force') === '1' })
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 400 })
  }
}
