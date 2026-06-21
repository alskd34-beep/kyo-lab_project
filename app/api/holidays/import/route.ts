/**
 * [API] 공휴일 API 수집 → public_holidays 반영
 *   POST /api/holidays/import   body: { year: number }   (관리자)
 *
 * data.go.kr 공휴일 API 로 지정 연도를 수집해 upsert 한다.
 * - idempotent(다시 실행해도 개수 불변), 수동(manual) 행은 보존.
 * - 호출·저장은 전부 서버에서. 키 값은 출력하지 않는다.
 */
import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { importHolidays } from '@backend/services/holidays'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const body = (await req.json().catch(() => ({}))) as { year?: number }
    const year = Number(body.year)
    if (!Number.isInteger(year) || year < 2000 || year > 2100) {
      return Response.json({ error: '연도(year)가 올바르지 않습니다.' }, { status: 400 })
    }
    const result = await importHolidays(year)
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 502 })
  }
}
