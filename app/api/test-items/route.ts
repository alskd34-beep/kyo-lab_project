import { NextRequest } from 'next/server'
import { listTestItems, createTestItem, updateTestItem, deleteTestItem } from '@backend/services/testItems'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const rows = await listTestItems()
    return Response.json({ rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const row = await createTestItem({
      name: body.name,
      estimatedHours: body.estimatedHours,
      requiresDuo: body.requiresDuo,
    })
    return Response.json({ row }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
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
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
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
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
