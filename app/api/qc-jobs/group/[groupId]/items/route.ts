/**
 * [BACKEND] 동시분석 그룹 단위 시험항목 처리
 *   PATCH /api/qc-jobs/group/[groupId]/items { testItemName, action } (인증)
 *     action='start' | 'clear' | 'cancel'
 *     → { ok, affected, skipped, jobs, advanced }  advanced = 항목 완료로 작업 단계가 자동으로 바뀐 작업의 QC번호
 *        skipped = 읽은 뒤 그 사이 상태가 바뀌었거나 다른 담당자에게 넘어가 건너뛴 배치 수(나머지는 계속 처리)
 *
 * 같은 그룹의 배치들을 한 번의 조작으로 처리한다. 대상은 **요청자 본인의 작업**뿐이며
 * 관리자라도 넓히지 않는다 — 이 경로는 "내 손으로 하는 시험" 의 조작이다.
 *
 * ⚠️ 묶이는 것은 조작뿐이고 qc_job_items 는 배치별로 그대로 남는다(GMP 추적성).
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { applyGroupItemAction } from '@backend/services/qcJobs'

export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ groupId: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { groupId } = await ctx.params
    const body = await req.json() as { testItemName?: string; action?: string }
    if (!body.testItemName) return Response.json({ error: 'testItemName은 필수입니다.' }, { status: 400 })
    if (body.action !== 'start' && body.action !== 'clear' && body.action !== 'cancel') {
      return Response.json({ error: "action은 'start' | 'clear' | 'cancel' 이어야 합니다." }, { status: 400 })
    }
    const result = await applyGroupItemAction(groupId, body.testItemName, body.action, auth.payload.sub)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
