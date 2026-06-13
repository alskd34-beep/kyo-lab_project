/**
 * [BACKEND] QC 작업 수정
 *   PATCH /api/qc-jobs/[id]
 *     { workStartDate?, workEndDate? }  — 시작/종료일
 *     { status }                        — 상태 변경
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { updateJobDates, changeJobStatus } from '@backend/services/qcJobs'

export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body = await req.json() as {
      workStartDate?: string | null
      workEndDate?: string | null
      status?: string
    }
    if (body.status !== undefined) {
      await changeJobStatus(id, auth.payload.sub, body.status)
    }
    if ('workStartDate' in body || 'workEndDate' in body) {
      await updateJobDates(id, auth.payload.sub, { workStartDate: body.workStartDate, workEndDate: body.workEndDate })
    }
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
