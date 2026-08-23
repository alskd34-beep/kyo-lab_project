/**
 * [BACKEND] 휴가/출장 일정 단건
 *   PATCH  /api/operator-schedule/[id] { startDate?, endDate?, type?, managerChecked?, memo? }
 *   DELETE /api/operator-schedule/[id]
 *
 * 담당자는 **본인 일정만** 수정/삭제할 수 있다(서비스가 소유권을 검사한다).
 * managerChecked(관리자 확인) 토글은 admin 전용.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { updateSchedule, deleteSchedule, type ScheduleType } from '@backend/services/operatorSchedule'

export const runtime = 'nodejs'

/** 소유권/검증 오류는 4xx 로 내린다(서버 장애 5xx 와 구분) */
function errorStatus(msg: string): number {
  if (msg.includes('본인') || msg.includes('관리자만')) return 403
  if (msg.includes('찾을 수 없습니다')) return 404
  if (msg.includes('이후여야')) return 400
  return 500
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body = await req.json() as {
      startDate?: string
      endDate?: string
      type?: ScheduleType
      managerChecked?: boolean
      memo?: string | null
    }
    await updateSchedule(id, body, { userId: auth.payload.sub, role: auth.payload.role })
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
    await deleteSchedule(id, { userId: auth.payload.sub, role: auth.payload.role })
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: errorStatus(msg) })
  }
}
