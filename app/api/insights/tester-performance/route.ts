import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { getTesterPerformance } from '@backend/services/testerPerformance'

// 관리자 전용 시험자 운영 성과·지연 지표 조회 API
export const runtime = 'nodejs'
const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const sp = req.nextUrl.searchParams; const today = new Date().toISOString().slice(0, 10)
    const to = ISO.test(sp.get('to') ?? '') ? sp.get('to')! : today
    const from = ISO.test(sp.get('from') ?? '') ? sp.get('from')! : (() => { const d = new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 90); return d.toISOString().slice(0, 10) })()
    if (from > to) return Response.json({ error: '시작일이 종료일보다 늦습니다.' }, { status: 400 })
    return Response.json(await getTesterPerformance({ from, to }))
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}
