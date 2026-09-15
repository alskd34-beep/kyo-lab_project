/**
 * [BACKEND] 동시분석 그룹 승인 (관리자 전용)
 *   POST /api/qc-jobs/group/[groupId]/approve
 *     → { ok, groupId, processed[], skipped[] }
 *
 * 조작 시점의 그룹 구성 전 작업 중 "승인전" 인 것을 승인완료로 넘긴다. 작업마다 기존 승인 경로
 * (조건부 update + 전 항목 검토 완료 확인 + 오더 동기화·이력·알림)를 차례로 부르므로 **원자적이지 않다.**
 * 조건이 맞지 않는 배치는 건너뛴다. 승인 0건이면 "승인할 배치가 없습니다." 로 거절.
 * 규칙 전문: intent/2026-09-15-group-stage-progress-spec.md §6
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { approveGroup } from '@backend/services/qcJobGroupStage'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, ctx: { params: Promise<{ groupId: string }> }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { groupId } = await ctx.params
    const result = await approveGroup(groupId, auth.payload.sub)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
