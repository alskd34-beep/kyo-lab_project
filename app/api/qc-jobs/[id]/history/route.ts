/**
 * [BACKEND] QC 작업 상태 변경 이력
 *   GET /api/qc-jobs/[id]/history — 상태 전이 이력(오래된 순)
 *
 * 상세(GET /api/qc-jobs/[id])와 같은 열람 규칙: 관리자는 전체, 담당자는 본인 작업만.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { getJobAssigneeUserId } from '@backend/services/qcJobs'
import { listJobStatusHistory } from '@backend/services/qcJobStatusHistory'

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
