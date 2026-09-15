/**
 * [BACKEND] 동시분석 그룹 시험항목 검토 (관리자 전용)
 *   POST /api/qc-jobs/group/[groupId]/review  { testItemName, action }
 *     action = 'review_start' | 'review_complete'
 *     → { ok, groupId, action, testItemName, count, processed[], skipped[] }
 *
 * 조작 시점의 그룹 구성 전 배치(담당자 무관)에서 같은 이름의 항목을 검토한다. 화면에서 누른 배치는 진입점일 뿐이다.
 * 한 트랜잭션(DB 함수 group_item_review_action, 0051). 조건이 맞지 않는 배치는 건너뛰고 skipped 에 사유를 담는다.
 * 처리 0건이면 "처리할 시험항목이 없습니다." 로 거절. 검토 이력은 배치·항목마다 남는다.
 * 규칙 전문: intent/2026-09-15-group-stage-progress-spec.md
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { reviewGroupItem } from '@backend/services/qcJobGroupStage'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, ctx: { params: Promise<{ groupId: string }> }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { groupId } = await ctx.params
    const body: unknown = await req.json().catch(() => null)
    const obj = body !== null && typeof body === 'object' && !Array.isArray(body)
      ? body as { testItemName?: unknown; action?: unknown }
      : {}
    const result = await reviewGroupItem(groupId, obj.testItemName, auth.payload.sub, obj.action)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
