/**
 * [BACKEND] 휴가/출장 일정 단건
 *   PATCH  /api/operator-schedule/[id] { startDate?, endDate?, type?, managerChecked?, memo? }
 *   DELETE /api/operator-schedule/[id]
 *
 * managerChecked(관리자 확인) 토글은 admin 전용.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { updateSchedule, deleteSchedule, type ScheduleType } from '@backend/services/operatorSchedule'

export const runtime = 'nodejs'

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
    // 관리자 확인 토글은 admin 전용
    if (body.managerChecked !== undefined && auth.payload.role !== 'admin') {
      return Response.json({ error: '관리자만 확인 처리할 수 있습니다.' }, { status: 403 })
    }
    await updateSchedule(id, body)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    await deleteSchedule(id)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
