/**
 * [BACKEND] 시험항목 그룹 (조회=인증 / 쓰기=관리자)
 *   GET    /api/test-item-groups            → { rows }
 *   POST   /api/test-item-groups            { name, description?, sortOrder? }
 *   PATCH  /api/test-item-groups            { id, ...fields }
 *   DELETE /api/test-item-groups            { id }
 */

import { NextRequest } from 'next/server'
import { requireAuth, requireAdmin } from '@backend/lib/guard'
import { listGroups, createGroup, updateGroup, deleteGroup } from '@backend/services/testItemGroups'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const g = await requireAuth(req)
  if (!g.ok) return g.response
  try {
    return Response.json({ rows: await listGroups() })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const body = await req.json()
    const row = await createGroup({
      name: body.name, description: body.description, sortOrder: body.sortOrder,
    })
    return Response.json({ row }, { status: 201 })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const { id, ...fields } = await req.json()
    if (!id) return Response.json({ error: 'id는 필수입니다.' }, { status: 400 })
    await updateGroup(id, fields)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const { id } = await req.json()
    if (!id) return Response.json({ error: 'id는 필수입니다.' }, { status: 400 })
    await deleteGroup(id)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 400 })
  }
}
