/**
 * [BACKEND] 그룹에 속한 시험항목
 *   GET /api/test-item-groups/[id]/items          → { rows }   (인증)
 *   PUT /api/test-item-groups/[id]/items          { testItemIds: string[] }  (관리자)
 *     준 순서가 그대로 그룹 내 순번이 된다.
 */

import { NextRequest } from 'next/server'
import { requireAuth, requireAdmin } from '@backend/lib/guard'
import { listGroupItems, replaceGroupItems } from '@backend/services/testItemGroups'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireAuth(req)
  if (!g.ok) return g.response
  try {
    const { id } = await ctx.params
    return Response.json({ rows: await listGroupItems(id) })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const { id } = await ctx.params
    const body = await req.json() as { testItemIds?: string[] }
    if (!Array.isArray(body.testItemIds)) {
      return Response.json({ error: 'testItemIds(배열)는 필수입니다.' }, { status: 400 })
    }
    await replaceGroupItems(id, body.testItemIds)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 400 })
  }
}
