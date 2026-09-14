/**
 * [BACKEND] 시험항목 검토 동작 (관리자 전용)
 *   POST /api/qc-jobs/[id]/items/[itemId]/review  { action, reason? }
 *     action = 'review_start' | 'review_complete' | 'review_cancel' | 'reopen'
 *     reason = 검토 취소·재실시에 필수(2자 이상)
 *     → { ok, itemId, testItemName, action, reviewStatusBefore, reviewStatusAfter, jobId, stage }
 *
 * 검사·항목 갱신·검토 이력·작업 단계 재도출은 DB 함수 item_review_action(0048) 한 트랜잭션이 판정한다.
 * stage.changed 가 true 면 작업 단계가 바뀐 것이다(화면이 단계 막대·목록을 다시 읽는다).
 * 규칙 전문: intent/2026-09-15-item-level-review-spec.md
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { reviewJobItem } from '@backend/services/qcJobItemReview'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string; itemId: string }> }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { id, itemId } = await ctx.params
    const body: unknown = await req.json().catch(() => null)
    const obj = body !== null && typeof body === 'object' && !Array.isArray(body)
      ? body as { action?: unknown; reason?: unknown }
      : {}
    const result = await reviewJobItem(id, itemId, auth.payload.sub, obj.action, obj.reason)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
