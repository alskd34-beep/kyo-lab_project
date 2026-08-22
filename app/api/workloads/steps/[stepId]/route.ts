/**
 * [BACKEND] 작업단계 단건
 *   PUT    /api/workloads/steps/[stepId] — 수정 (admin)
 *   DELETE /api/workloads/steps/[stepId] — 삭제 (admin, Soft Delete)
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { deleteStep, updateStep } from '@backend/services/workloadStandard'
import type { StepInput } from '@backend/services/workloadStandard'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ stepId: string }> }

export async function PUT(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { stepId } = await ctx.params
    const patch = (await req.json()) as Partial<StepInput>
    await updateStep(stepId, patch)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { stepId } = await ctx.params
    await deleteStep(stepId)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
