/**
 * [BACKEND] QC 작업 항목
 *   PATCH /api/qc-jobs/[id]/items  { itemId, action: 'clear' }  — 항목 클리어(시간 적재+알림)
 *     응답: { ok, allCleared, statusChangedTo }
 *     전 항목 완료 시 작업 상태가 '검토중' 으로 자동 전환되며 statusChangedTo 로 알린다.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { clearItem } from '@backend/services/qcJobs'

export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body = await req.json() as { itemId?: string; action?: string }
    if (!body.itemId) return Response.json({ error: 'itemId는 필수입니다.' }, { status: 400 })
    if (body.action === 'clear') {
      const result = await clearItem(id, body.itemId, auth.payload.sub)
      return Response.json({ ok: true, ...result })
    }
    return Response.json({ ok: true, allCleared: false, statusChangedTo: null })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
