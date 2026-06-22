import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { listAiScheduleHistory } from '@backend/services/aiScheduleHistory'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const limit = Number(searchParams.get('limit')) || 800
    const from = searchParams.get('from') ?? undefined
    const to = searchParams.get('to') ?? undefined
    const result = await listAiScheduleHistory(limit, { from, to })
    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
