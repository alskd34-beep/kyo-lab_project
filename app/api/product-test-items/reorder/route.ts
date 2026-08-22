import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { reorderByProduct } from '@backend/services/productTestItems'

export const runtime = 'nodejs'

/**
 * POST /api/product-test-items/reorder
 * Body: { productId: string, orderedTestItemIds: string[] }
 *
 * 품목의 시험항목 순서를 입력 배열 순서대로 0,1,2,...로 재할당.
 */
export async function POST(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const body = await req.json()
    const { productId, orderedTestItemIds } = body as {
      productId?: string
      orderedTestItemIds?: string[]
    }
    if (!productId || !Array.isArray(orderedTestItemIds)) {
      return Response.json(
        { error: 'productId 와 orderedTestItemIds(배열) 필수' },
        { status: 400 },
      )
    }
    await reorderByProduct(productId, orderedTestItemIds)
    return Response.json({ ok: true })
  } catch (err) {
    console.error('[api/product-test-items/reorder POST]', err)
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}
