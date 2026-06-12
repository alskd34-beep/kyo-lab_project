import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { getTableauSummary } from '@backend/services/tableau'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  try {
    const limit = req.nextUrl.searchParams.get('limit')
    const row = await getTableauSummary(limit ? Number(limit) : undefined)
    return Response.json({ row })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Tableau 연동 오류'
    return Response.json({ error: msg }, { status: 502 })
  }
}
