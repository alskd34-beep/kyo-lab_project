/**
 * [BACKEND] 공휴일 API
 *   GET    /api/holidays?year=YYYY   — 목록 조회 (인증)
 *   POST   /api/holidays             — 추가 { date, description } (관리자)
 *   DELETE /api/holidays             — 삭제 { date } (관리자)
 */

import { NextRequest } from 'next/server'
import { requireAuth, requireAdmin } from '@backend/lib/guard'
import { listHolidays, addHoliday, removeHoliday } from '@backend/services/holidays'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const yearParam = searchParams.get('year')
    const year = yearParam != null ? Number(yearParam) : undefined
    const rows = await listHolidays(year)
    return Response.json({ rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json() as { date?: string; description?: string }
    if (!body.date) {
      return Response.json({ error: '날짜(date)는 필수입니다.' }, { status: 400 })
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      return Response.json({ error: '날짜 형식은 YYYY-MM-DD 이어야 합니다.' }, { status: 400 })
    }
    await addHoliday(body.date, body.description ?? '')
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json() as { date?: string }
    if (!body.date) {
      return Response.json({ error: '날짜(date)는 필수입니다.' }, { status: 400 })
    }
    await removeHoliday(body.date)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
