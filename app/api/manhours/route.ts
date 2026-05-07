import { NextRequest } from 'next/server'
import { listManhours, createManhour, updateManhour, deleteManhour } from '@backend/services/manhours'

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

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      productId:   string
      packageUnit: string
      avgHours:    number
    }
    if (!body.productId || !body.packageUnit || body.avgHours === undefined) {
      return Response.json(
        { error: 'productId, packageUnit, avgHours는 필수입니다.' },
        { status: 400 },
      )
    }
    if (isNaN(body.avgHours) || body.avgHours < 0) {
      return Response.json({ error: 'avgHours는 0 이상의 숫자여야 합니다.' }, { status: 400 })
    }
    const row = await createManhour(body)
    return Response.json({ row }, { status: 201 })
  } catch (err) {
    console.error('[api/manhours POST]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json() as {
      id:           string
      avgHours?:    number
      packageUnit?: string
    }
    if (!body.id) {
      return Response.json({ error: 'id는 필수입니다.' }, { status: 400 })
    }
    if (body.avgHours === undefined && body.packageUnit === undefined) {
      return Response.json({ error: '수정할 값이 없습니다.' }, { status: 400 })
    }
    await updateManhour(body.id, { avgHours: body.avgHours, packageUnit: body.packageUnit })
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
