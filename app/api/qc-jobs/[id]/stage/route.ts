/**
 * [BACKEND] QC 작업 단계 전이 (관리자 전용)
 *   POST /api/qc-jobs/[id]/stage  { expected?: string }
 *     검토전 ─[검토 시작]─▶ 검토중 ─[검토 완료]─▶ 승인전 ─[승인]─▶ 승인완료
 *
 * expected 를 주면 화면이 보고 있던 단계와 실제 단계가 같을 때만 전환한다(동시 클릭 방지).
 * 단계 정의는 types/qc-status.ts 가 단일 기준이다.
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { advanceJobStage } from '@backend/services/qcJobs'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body = await req.json().catch(() => ({})) as { expected?: string }
    const result = await advanceJobStage(id, body.expected, auth.payload.sub)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
