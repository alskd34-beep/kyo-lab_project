/**
 * [BACKEND] 동시분석 그룹 단위 작업 시작
 *   POST /api/qc-jobs/group/[groupId]/start (인증)
 *
 * 그룹 안에서 아직 시작하지 않은 **내 배정 오더**를 한꺼번에 시작한다.
 * 장비 검증은 오더마다 그대로 돌고, 한 건이 막히면 그 건만 실패로 돌려준다 —
 * 하나 때문에 전부 못 시작하면 묶은 의미가 없다.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { startGroupJobs } from '@backend/services/qcJobs'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, ctx: { params: Promise<{ groupId: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { groupId } = await ctx.params
    const result = await startGroupJobs(groupId, auth.payload.sub)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
