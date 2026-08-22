/**
 * [BACKEND] 그룹을 품목별 시험항목에 붙여넣기 (관리자)
 *   POST /api/test-item-groups/[id]/apply   { productId }
 *
 * 이미 있는 항목은 건너뛰고 없는 것만 품목 끝에 그룹 순서대로 덧붙인다(덮어쓰지 않는다).
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { applyGroupToProduct } from '@backend/services/testItemGroups'

export const runtime = 'nodejs'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const { id } = await ctx.params
    const { productId } = await req.json() as { productId?: string }
    if (!productId) return Response.json({ error: 'productId는 필수입니다.' }, { status: 400 })
    const added = await applyGroupToProduct(id, productId)
    return Response.json({ ok: true, added })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 400 })
  }
}
