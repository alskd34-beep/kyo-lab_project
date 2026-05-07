import { NextRequest } from 'next/server'
import { listProducts } from '@backend/services/products'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const isActiveParam = sp.get('isActive')

    const rows = await listProducts({
      search:     sp.get('search')     ?? undefined,
      category:   sp.get('category')   ?? undefined,
      difficulty: sp.get('difficulty') ?? undefined,
      type:       sp.get('type')       ?? undefined,
      isActive:   isActiveParam !== null ? isActiveParam === 'true' : undefined,
    })
    return Response.json({ rows })
  } catch (err) {
    console.error('[api/products GET]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
