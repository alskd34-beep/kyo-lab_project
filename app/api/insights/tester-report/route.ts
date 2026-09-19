import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { getTesterReport } from '@backend/services/testerReport'

export const runtime = 'nodejs'
const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const sp = req.nextUrl.searchParams
    const year = /^\d{4}$/.test(sp.get('year') ?? '') ? sp.get('year')! : String(new Date().getFullYear())
    const from = `${year}-01-01`
    const today = new Date().toISOString().slice(0, 10)
    const to = year === today.slice(0, 4) ? today : `${year}-12-31`
    if (!ISO.test(from) || !ISO.test(to)) return Response.json({ error: '연도를 확인해 주세요.' }, { status: 400 })
    const data = await getTesterReport({
      from, to, actorUserId: auth.payload.sub, actorRole: auth.payload.role,
      testerId: sp.get('testerId') ?? undefined,
    })
    return Response.json(data)
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}
