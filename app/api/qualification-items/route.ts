/**
 * [BACKEND] 자격 OJT 항목 마스터 (쓰기=관리자). 조회는 /api/tester-qualifications 가 함께 내려준다.
 *   POST   /api/qualification-items  { categoryId, name, validMonths?, note?, sortOrder? }
 *   PATCH  /api/qualification-items  { id, ...fields }
 *   DELETE /api/qualification-items  { id }
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { createItem, deleteItem, updateItem } from '@backend/services/testerQualifications'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const body = await req.json()
    await createItem({
      categoryId:  body.categoryId,
      name:        body.name,
      validMonths: body.validMonths,
      note:        body.note,
      sortOrder:   body.sortOrder,
    })
    return Response.json({ ok: true }, { status: 201 })
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
    await updateItem(id, fields)
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
    await deleteItem(id)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 400 })
  }
}
