/**
 * [BACKEND] 품목 공수 표준 단건
 *   GET    /api/workloads/products/[productId] — 상세 (인증)
 *   PUT    /api/workloads/products/[productId] — 수정 (admin)
 *   DELETE /api/workloads/products/[productId] — 삭제 (admin, Soft Delete)
 */

import { NextRequest } from 'next/server'
import { requireAuth, requireAdmin } from '@backend/lib/guard'
import {
  deleteProductWorkload,
  getProductWorkload,
  updateProductWorkload,
} from '@backend/services/workloadStandard'
import type { ProductWorkloadPatch } from '@backend/services/workloadStandard'

export const runtime = 'nodejs'

type Ctx = { params: Promise<{ productId: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { productId } = await ctx.params
    const { row, schemaReady } = await getProductWorkload(productId)
    if (!row) return Response.json({ error: '품목을 찾을 수 없습니다.' }, { status: 404 })
    return Response.json({ row, schemaReady })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, ctx: Ctx) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { productId } = await ctx.params
    const patch = (await req.json()) as ProductWorkloadPatch
    if (patch.standardLeadTimeDays !== undefined && !(Number(patch.standardLeadTimeDays) > 0)) {
      return Response.json({ error: '표준 소요일은 0보다 커야 합니다.' }, { status: 400 })
    }
    await updateProductWorkload(productId, patch, auth.payload.username)
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
    const { productId } = await ctx.params
    await deleteProductWorkload(productId, auth.payload.username)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
