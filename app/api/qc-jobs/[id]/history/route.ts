/**
 * [BACKEND] QC 작업 상태 변경 이력
 *   GET /api/qc-jobs/[id]/history — 상태 전이 이력(오래된 순)
 *
 * 상세(GET /api/qc-jobs/[id])와 같은 열람 규칙: 관리자는 전체, 담당자는 본인 작업만.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { getJobAssigneeUserId } from '@backend/services/qcJobs'
import { listJobStatusHistory, updateHistoryAttribution } from '@backend/services/qcJobStatusHistory'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const owner = await getJobAssigneeUserId(id)
    if (owner === undefined) return Response.json({ error: '작업을 찾을 수 없습니다.' }, { status: 404 })
    if (auth.payload.role !== 'admin' && owner !== auth.payload.sub) {
      return Response.json({ error: '본인 작업만 조회할 수 있습니다.' }, { status: 403 })
    }
    return Response.json({ rows: await listJobStatusHistory(id) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  if (auth.payload.role !== 'admin') return Response.json({ error: '관리자만 지연 사유의 통제 범위를 수정할 수 있습니다.' }, { status: 403 })
  try {
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({})) as { historyId?: string; attribution?: string }
    if (!body.historyId || !['external', 'internal', 'unknown'].includes(body.attribution ?? '')) {
      return Response.json({ error: '상태 이력과 통제 범위를 확인해 주세요.' }, { status: 400 })
    }
    const owner = await getJobAssigneeUserId(id)
    if (owner === undefined) return Response.json({ error: '작업을 찾을 수 없습니다.' }, { status: 404 })
    await updateHistoryAttribution(body.historyId, body.attribution as 'external' | 'internal' | 'unknown', auth.payload.sub)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
