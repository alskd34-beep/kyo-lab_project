/**
 * [BACKEND] 품목의 시험항목
 *   GET  /api/workloads/products/[productId]/tests          — 시험항목 목록 (인증)
 *   POST /api/workloads/products/[productId]/tests  { ... } — 시험항목 추가 (admin)
 */

import { NextRequest } from 'next/server'
import { requireAuth, requireAdmin } from '@backend/lib/guard'
import { createTestItem, getProductWorkload } from '@backend/services/workloadStandard'
import type { TestItemInput } from '@backend/services/workloadStandard'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ productId: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { productId } = await ctx.params
    const { row } = await getProductWorkload(productId)
    if (!row) return Response.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 })
    return Response.json({ rows: row.testItems })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { productId } = await ctx.params
    const body = (await req.json()) as Partial<TestItemInput>
    if (!body.testName?.trim()) {
      return Response.json({ error: '시험항목명은 필수입니다.' }, { status: 400 })
    }
    const row = await createTestItem(productId, { ...body, testName: body.testName })
    return Response.json({ row }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
