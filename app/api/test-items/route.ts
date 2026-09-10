import { NextRequest } from 'next/server'
import { requireAdmin, requireAuth } from '@backend/lib/guard'
import { listTestItems, createTestItem, updateTestItem, deleteTestItem } from '@backend/services/testItems'

export const runtime = 'nodejs'

function serializeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (err && typeof err === 'object') {
    const o = err as Record<string, unknown>
    const parts = [o.message, o.details, o.hint, o.code].filter(Boolean)
    if (parts.length) return parts.join(' | ')
    try { return JSON.stringify(err) } catch { return String(err) }
  }
  return String(err)
}

export async function GET(req: NextRequest) {
  const g = await requireAuth(req)
  if (!g.ok) return g.response
  try {
    const rows = await listTestItems()
    return Response.json({ rows })
  } catch (err) {
    console.error('[api/test-items GET]', err)
    return Response.json({ error: serializeError(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const body = await req.json()
    const row = await createTestItem({
      name: body.name,
      category: body.category,
      // 예상시간은 분이 기준이다(0045). 옛 클라이언트가 시간을 보내면 분으로 환산해 받는다.
      estimatedMinutes: body.estimatedMinutes
        ?? (body.estimatedHours != null ? Math.round(Number(body.estimatedHours) * 60) : null),
      requiresDuo: body.requiresDuo,
      // 새 항목의 예상시간은 정의상 가정치라 출처를 받지 않아도 'assumed' 가 된다(0046).
      isTimeboxed: body.isTimeboxed === true,
    })
    return Response.json({ row }, { status: 201 })
  } catch (err) {
    console.error('[api/test-items POST]', err)
    return Response.json({ error: serializeError(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const body = await req.json()
    const { id, ...fields } = body
    if (!id) return Response.json({ error: 'id 필수' }, { status: 400 })
    await updateTestItem(id, fields)
    return Response.json({ ok: true })
  } catch (err) {
    console.error('[api/test-items PATCH]', err)
    return Response.json({ error: serializeError(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const body = await req.json()
    const { id } = body
    if (!id) return Response.json({ error: 'id 필수' }, { status: 400 })
    await deleteTestItem(id)
    return Response.json({ ok: true })
  } catch (err) {
    console.error('[api/test-items DELETE]', err)
    return Response.json({ error: serializeError(err) }, { status: 500 })
  }
}
