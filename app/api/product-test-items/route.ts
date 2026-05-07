import { NextRequest } from 'next/server'
import { listByProduct, addMapping, removeMapping } from '@backend/services/productTestItems'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const productId = req.nextUrl.searchParams.get('productId')
    if (!productId) return Response.json({ error: 'productId 필수' }, { status: 400 })
    const rows = await listByProduct(productId)
    return Response.json({ rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { productId, testItemId, sequenceOrder } = body
    if (!productId || !testItemId) return Response.json({ error: 'productId, testItemId 필수' }, { status: 400 })
    await addMapping(productId, testItemId, sequenceOrder)
    return Response.json({ ok: true }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json()
    const { productId, testItemId } = body
    if (!productId || !testItemId) return Response.json({ error: 'productId, testItemId 필수' }, { status: 400 })
    await removeMapping(productId, testItemId)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
