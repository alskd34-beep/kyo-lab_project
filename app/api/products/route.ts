import { NextRequest } from 'next/server'
import {
  listProducts, createProduct, updateProduct, deleteProduct,
  listProductCategories, listProductClassifications,
} from '@backend/services/products'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams
    const [rows, categories, classifications] = await Promise.all([
      listProducts({
        search: sp.get('search') ?? undefined,
        limit: sp.get('limit') ? Number(sp.get('limit')) : undefined,
      }),
      listProductCategories(),
      listProductClassifications(),
    ])
    return Response.json({ rows, categories, classifications })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const row = await createProduct({
      productCode:      body.productCode,
      name:             body.name,
      nameAlt:          body.nameAlt,
      abbreviation:     body.abbreviation,
      difficulty:       body.difficulty,
      categoryId:       body.categoryId,
      classificationId: body.classificationId,
      unit:             body.unit,
      productType:      body.productType,
      packageSpec:      body.packageSpec,
      avgHours:         body.avgHours,
      avgWorkdays:      body.avgWorkdays,
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
    await updateProduct(id, fields)
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
    await deleteProduct(id)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
