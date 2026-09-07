/**
 * [BACKEND] 부업무 기록 단건
 *   PATCH  /api/side-work/[id] { workDate?, categoryId?, title?, minutes?, note? }
 *   DELETE /api/side-work/[id]
 *
 * 시험자는 **본인 기록만** 수정/삭제할 수 있다(서비스가 소유권을 검사한다).
 * 이 값이 운영 리포트의 분모·분자로 들어가므로 화면 숨김이 아니라 서버에서 막는다.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { deleteLog, resolveActor, updateLog } from '@backend/services/sideWork'

export const runtime = 'nodejs'

/** 소유권·검증 오류는 4xx 로 내린다(서버 장애 5xx 와 구분) */
function errorStatus(msg: string): number {
  if (msg.includes('본인')) return 403
  if (msg.includes('찾을 수 없습니다')) return 404
  if (/필수|형식|입력|선택|넘을 수 없|이상이어야/.test(msg)) return 400
  return 500
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body = await req.json() as {
      workDate?: string; categoryId?: string; title?: string
      minutes?: number; note?: string | null
    }
    const actor = await resolveActor(auth.payload.sub, auth.payload.role)
    await updateLog(id, body, actor)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: errorStatus(msg) })
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const actor = await resolveActor(auth.payload.sub, auth.payload.role)
    await deleteLog(id, actor)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: errorStatus(msg) })
  }
}
