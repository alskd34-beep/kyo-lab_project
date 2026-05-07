import { NextRequest } from 'next/server'
import { listProducts, getProductTestItems } from '@backend/services/products'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const productName = sp.get('productName')
    if (productName) {
      const items = await getProductTestItems(productName)
      return Response.json({ items })
    }
    const rows = await listProducts({
      search: sp.get('search') ?? undefined,
      category: sp.get('category') ?? undefined,
    })
    return Response.json({ rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
