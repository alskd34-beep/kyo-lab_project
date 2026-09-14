/**
 * [BACKEND] QC 작업 상태 직접 변경 (관리자 전용)
 *   PATCH /api/qc-jobs/[id]/status  { status, reason }
 *
 * 순차 전이(POST .../stage)로는 표현할 수 없는 정정 — 되돌리기, 지연 지정/해제 —
 * 를 위한 통로다. 사유가 필수이며 상태 이력에 사유까지 남는다.
 *   → { ok, from, to, message? }  to = 실제로 된 단계(항목 상태로 재도출된 결과), message = 요청과 다를 때 안내
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { setJobStatusByAdmin } from '@backend/services/qcJobs'

export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({})) as { status?: string; reason?: string }
    if (!body.status) return Response.json({ error: '변경할 상태를 지정하세요.' }, { status: 400 })
    const result = await setJobStatusByAdmin(id, auth.payload.sub, body.status, body.reason ?? '')
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
