import { NextRequest } from 'next/server'
import { listManhours, updateManhour, deleteManhour } from '@backend/services/manhours'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const rows = await listManhours()
    return Response.json({ rows })
  } catch (err) {
    console.error('[api/manhours GET]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as { id: string; avgHours: number }
    if (!body.id || body.avgHours === undefined) {
      return Response.json({ error: 'id와 avgHours는 필수입니다.' }, { status: 400 })
    }
    await updateManhour(body.id, body.avgHours)
    return Response.json({ ok: true })
  } catch (err) {
    console.error('[api/manhours PATCH]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json() as { id: string }
    if (!body.id) {
      return Response.json({ error: 'id는 필수입니다.' }, { status: 400 })
    }
    await deleteManhour(body.id)
    return Response.json({ ok: true })
  } catch (err) {
    console.error('[api/manhours DELETE]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
