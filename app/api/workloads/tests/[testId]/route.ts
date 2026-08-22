/**
 * [BACKEND] 시험항목 단건
 *   PUT    /api/workloads/tests/[testId] — 수정 (admin)
 *   DELETE /api/workloads/tests/[testId] — 삭제 (admin, Soft Delete · 하위 작업단계 포함)
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { deleteTestItem, updateTestItem } from '@backend/services/workloadStandard'
import type { TestItemInput } from '@backend/services/workloadStandard'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ testId: string }> }

export async function PUT(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { testId } = await ctx.params
    const patch = (await req.json()) as Partial<TestItemInput>
    await updateTestItem(testId, patch)
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
    const { testId } = await ctx.params
    await deleteTestItem(testId)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
