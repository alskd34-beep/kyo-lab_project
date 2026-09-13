/**
 * [BACKEND] QC 작업 시작 취소 (담당 시험자 본인)
 *   POST /api/qc-jobs/[id]/cancel-start  { reason }
 *     → { ok, qcNo, orderId, orderStatusBefore, orderStatusAfter, warning? }
 *
 * 잘못 누른 [작업 시작] 을 되돌린다 — 작업(QC번호·체크리스트)을 지우고, 다른 담당자 작업이 없으면
 * 오더를 시작 대기로 돌린다. 허용 조건·감사 기록·경합 처리는 서비스(cancelJobStart)와
 * DB 함수 cancel_job_start(0047) 가 판정한다.
 * 관리자 대리 정정은 이 경로가 아니라 PATCH /api/qc-jobs/[id]/status 를 쓴다.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { cancelJobStart } from '@backend/services/qcJobs'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body: unknown = await req.json().catch(() => null)
    const reason = body !== null && typeof body === 'object' && !Array.isArray(body)
      ? (body as { reason?: unknown }).reason
      : undefined
    if (typeof reason !== 'string') {
      return Response.json({ error: '시작 취소 사유를 입력해 주세요.' }, { status: 400 })
    }
    const result = await cancelJobStart(id, auth.payload.sub, reason)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
