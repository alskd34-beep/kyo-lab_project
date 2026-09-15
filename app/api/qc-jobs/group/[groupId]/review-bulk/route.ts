/**
 * [BACKEND] 동시분석 그룹 일괄 검토 (관리자 전용)
 *   POST /api/qc-jobs/group/[groupId]/review-bulk  { action }
 *     action = 'review_start'    — 그룹 전 배치의 완료 항목 전체 검토 시작
 *            | 'review_complete' — 그룹 전 배치의 검토 중 항목 전체 검토 완료
 *     → { ok, groupId, action, testItemName: null, count, processed[], skipped[] }
 *
 * 한 트랜잭션(DB 함수 group_item_review_bulk_action, 0051). 승인완료 작업은 건너뛴다. 처리 0건이면 거절.
 * 규칙 전문: intent/2026-09-15-group-stage-progress-spec.md
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { bulkReviewGroup } from '@backend/services/qcJobGroupStage'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, ctx: { params: Promise<{ groupId: string }> }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { groupId } = await ctx.params
    const body: unknown = await req.json().catch(() => null)
    const action = body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as { action?: unknown }).action
      : undefined
    const result = await bulkReviewGroup(groupId, auth.payload.sub, action)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
