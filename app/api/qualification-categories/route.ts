/**
 * [BACKEND] 자격 카테고리 마스터 (쓰기=관리자). 조회는 /api/tester-qualifications 가 함께 내려준다.
 *   POST   /api/qualification-categories  { name, sortOrder? }
 *   PATCH  /api/qualification-categories  { id, ...fields }
 *   DELETE /api/qualification-categories  { id }
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { createCategory, deleteCategory, updateCategory } from '@backend/services/testerQualifications'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const body = await req.json()
    const row = await createCategory({ name: body.name, sortOrder: body.sortOrder })
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
    await updateCategory(id, fields)
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
    await deleteCategory(id)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 400 })
  }
}
