/**
 * [BACKEND] 시험항목 일괄 검토 (관리자 전용)
 *   POST /api/qc-jobs/[id]/review-bulk  { action }
 *     action = 'review_start'    — 완료 항목 전체 검토 시작
 *            | 'review_complete' — 검토 중 항목 전체 검토 완료
 *     → { ok, jobId, action, count, items, stage }
 *
 * 한 트랜잭션, 전부 성공 아니면 전부 실패(DB 함수 item_review_bulk_action, 0048). 기록은 항목마다 남는다.
 * 대상이 0건이면 "처리할 시험항목이 없습니다." 로 거절한다.
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { bulkReviewJobItems } from '@backend/services/qcJobItemReview'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body: unknown = await req.json().catch(() => null)
    const action = body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as { action?: unknown }).action
      : undefined
    const result = await bulkReviewJobItems(id, auth.payload.sub, action)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
