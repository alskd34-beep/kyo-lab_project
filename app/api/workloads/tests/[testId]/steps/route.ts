/**
 * [BACKEND] 시험항목의 작업단계
 *   POST /api/workloads/tests/[testId]/steps  { ... } — 작업단계 추가 (admin)
 *
 * 추가 후 시험항목·품목의 공수 합계는 서비스가 자동 재계산한다.
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { createStep } from '@backend/services/workloadStandard'
import type { StepInput } from '@backend/services/workloadStandard'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, ctx: { params: Promise<{ testId: string }> }) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { testId } = await ctx.params
    const body = (await req.json()) as Partial<StepInput>
    if (!body.stepName?.trim()) {
      return Response.json({ error: '작업단계명은 필수입니다.' }, { status: 400 })
    }
    if (!body.workloadType) {
      return Response.json({ error: '공수구분은 필수입니다.' }, { status: 400 })
    }
    const row = await createStep(testId, {
      ...body,
      stepName: body.stepName,
      workloadType: body.workloadType,
      durationMinutes: Number(body.durationMinutes ?? 0),
    })
    return Response.json({ row }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
