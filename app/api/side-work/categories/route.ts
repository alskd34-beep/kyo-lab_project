/**
 * [BACKEND] 부업무 분류 마스터
 *   GET  /api/side-work/categories?includeInactive=1   — 목록 (인증)
 *       · 기록 화면은 켜진 분류만, 관리 화면은 꺼진 것까지(관리자만).
 *   POST /api/side-work/categories { code, name, sortOrder?, isActive? }   (admin)
 */

import { NextRequest } from 'next/server'
import { requireAdmin, requireAuth } from '@backend/lib/guard'
import { createCategory, listCategories } from '@backend/services/sideWork'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    // 꺼진 분류는 관리 화면에만 필요하다 — 기록 화면에 흘러가면 다시 고를 수 있게 된다.
    const includeInactive =
      req.nextUrl.searchParams.get('includeInactive') === '1' && auth.payload.role === 'admin'
    const rows = await listCategories(includeInactive)
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
    const body = await req.json() as { code?: string; name?: string; sortOrder?: number; isActive?: boolean }
    if (!body.code || !body.name) {
      return Response.json({ error: '분류 코드와 이름은 필수입니다.' }, { status: 400 })
    }
    const row = await createCategory({
      code: body.code, name: body.name, sortOrder: body.sortOrder, isActive: body.isActive,
    })
    return Response.json({ row })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    const bad = /필수|이미 있습니다|비울 수 없/.test(msg)
    return Response.json({ error: msg }, { status: bad ? 400 : 500 })
  }
}
