/**
 * [BACKEND] 동시분석 그룹 단건
 *   PATCH /api/concurrent-groups/[id] { groupLock: boolean }  — 잠금 토글 (admin)
 *
 * group_lock=true 인 그룹은 재생성(rebuild) 시 보존된다.
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { setGroupLock } from '@backend/services/concurrentGroups'

export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body = await req.json() as { groupLock?: boolean }
    if (typeof body.groupLock !== 'boolean') {
      return Response.json({ error: 'groupLock(boolean)은 필수입니다.' }, { status: 400 })
    }
    await setGroupLock(id, body.groupLock)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
