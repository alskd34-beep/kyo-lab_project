/**
 * [BACKEND] 반복 부업무 묶음
 *   DELETE /api/side-work/series/[id]?from=YYYY-MM-DD — 묶음 삭제 (인증)
 *
 * from 을 주지 않으면 **오늘 이후**만 지운다. 이미 지난 날의 기록까지 지우면
 * "그날 한 일" 이 사라지고 운영 리포트가 사실과 멀어진다.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { deleteSeries, resolveActor } from '@backend/services/sideWork'

export const runtime = 'nodejs'

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const actor = await resolveActor(auth.payload.sub, auth.payload.role)
    const from = req.nextUrl.searchParams.get('from') ?? undefined
    const deleted = await deleteSeries(id, actor, from)
    return Response.json({ ok: true, deleted })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
