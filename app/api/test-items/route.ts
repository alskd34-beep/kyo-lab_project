import { NextRequest } from 'next/server'
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

export async function GET() {
  try {
    const rows = await listTestItems()
    return Response.json({ rows })
  } catch (err) {
    console.error('[api/test-items GET]', err)
    return Response.json({ error: serializeError(err) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const row = await createTestItem({
      name: body.name,
      category: body.category,
      estimatedHours: body.estimatedHours,
      requiresDuo: body.requiresDuo,
    })
    return Response.json({ row }, { status: 201 })
  } catch (err) {
    console.error('[api/test-items POST]', err)
    return Response.json({ error: serializeError(err) }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
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
