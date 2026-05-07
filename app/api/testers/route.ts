import { NextRequest } from 'next/server'
import { listTesters, createTester, updateTester, deleteTester } from '@backend/services/testers'

export const runtime = 'nodejs'

export async function GET() {
  try {
    const rows = await listTesters()
    return Response.json({ rows })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const row = await createTester({
      employeeNo: body.employeeNo,
      name:       body.name,
      canSolo:    body.canSolo ?? true,
      canDuo:     body.canDuo ?? false,
    })
    return Response.json({ row }, { status: 201 })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { id, ...fields } = body
    if (!id) return Response.json({ error: 'id 필수' }, { status: 400 })
    await updateTester(id, fields)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const body = await req.json()
    const { id } = body
    if (!id) return Response.json({ error: 'id 필수' }, { status: 400 })
    await deleteTester(id)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}
