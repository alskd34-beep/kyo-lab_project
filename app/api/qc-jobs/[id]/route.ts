/**
 * [BACKEND] QC 작업 상세/수정
 *   GET   /api/qc-jobs/[id]           — 작업 상세(시험항목 진행 내역 포함)
 *   PATCH /api/qc-jobs/[id]
 *     { workStartDate?, workEndDate? }  — 시작/종료일
 *     { status }                        — 상태 변경(담당자: 진행중 ↔ 지연. 지연 해제는 항목 상태로 도출한 단계로 복귀)
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { updateJobDates, changeJobStatus, getJobDetail, canViewJob } from '@backend/services/qcJobs'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    // 동시분석 그룹 요약(남의 배치 QC번호·담당자)은 관리자 응답에만 싣는다(spec §8)
    const detail = await getJobDetail(id, { includeGroup: auth.payload.role === 'admin' })
    if (!detail) return Response.json({ error: '작업을 찾을 수 없습니다.' }, { status: 404 })
    // 담당자는 본인 작업과 병렬 배정으로 함께 맡은 오더의 동료(담당자 1~5 전원) 작업만 열람할 수 있다(관리자는 전체).
    // 예전에는 requireAuth 만 통과하면 임의 작업 id 의 상세를 볼 수 있었다(IDOR).
    if (auth.payload.role !== 'admin' && !(await canViewJob(id, auth.payload.sub))) {
      return Response.json({ error: '본인 또는 함께 배정된 작업만 조회할 수 있습니다.' }, { status: 403 })
    }
    return Response.json(detail)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body = await req.json() as {
      workStartDate?: string | null
      workEndDate?: string | null
      status?: string
    }
    let statusResult: { from: string; to: string; message?: string } | null = null
    if (body.status !== undefined) {
      statusResult = await changeJobStatus(id, auth.payload.sub, body.status)
    }
    if ('workStartDate' in body || 'workEndDate' in body) {
      await updateJobDates(id, auth.payload.sub, { workStartDate: body.workStartDate, workEndDate: body.workEndDate })
    }
    // 지연 해제 등으로 실제 단계가 요청과 다르면 to·message 로 알린다
    return Response.json({ ok: true, ...(statusResult ?? {}) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
