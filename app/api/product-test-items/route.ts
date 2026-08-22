import { NextRequest } from 'next/server'
import { requireAdmin, requireAuth } from '@backend/lib/guard'
import { listByProduct, addMapping, removeMapping } from '@backend/services/productTestItems'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const g = await requireAuth(req)
  if (!g.ok) return g.response
  try {
    const productId = req.nextUrl.searchParams.get('productId')
    if (!productId) return Response.json({ error: 'productId 필수' }, { status: 400 })
    const rows = await listByProduct(productId)
    return Response.json({ rows })
  } catch (err) {
    console.error('[api/product-test-items GET]', err)
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const body = await req.json()
    const { productId, testItemId, sequenceOrder } = body
    if (!productId || !testItemId) return Response.json({ error: 'productId, testItemId 필수' }, { status: 400 })
    await addMapping(productId, testItemId, sequenceOrder)
    return Response.json({ ok: true }, { status: 201 })
  } catch (err) {
    console.error('[api/product-test-items POST]', err)
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const body = await req.json()
    const { productId, testItemId } = body
    if (!productId || !testItemId) return Response.json({ error: 'productId, testItemId 필수' }, { status: 400 })
    await removeMapping(productId, testItemId)
    return Response.json({ ok: true })
  } catch (err) {
    console.error('[api/product-test-items DELETE]', err)
    const msg = err instanceof Error ? err.message : JSON.stringify(err)
    return Response.json({ error: msg }, { status: 500 })
  }
}
