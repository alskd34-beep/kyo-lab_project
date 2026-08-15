/**
 * [BACKEND] QC 작업 상세/수정
 *   GET   /api/qc-jobs/[id]           — 작업 상세(시험항목 진행 내역 포함)
 *   PATCH /api/qc-jobs/[id]
 *     { workStartDate?, workEndDate? }  — 시작/종료일
 *     { status }                        — 상태 변경
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { updateJobDates, changeJobStatus, getJobDetail } from '@backend/services/qcJobs'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const detail = await getJobDetail(id)
    if (!detail) return Response.json({ error: '작업을 찾을 수 없습니다.' }, { status: 404 })
    return Response.json(detail)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

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
