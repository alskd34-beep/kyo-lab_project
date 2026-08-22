/**
 * [BACKEND] 품목 공수 표준 목록
 *   GET  /api/workloads/products          — 전체 목록 (시험항목·작업단계 포함, 인증)
 *   POST /api/workloads/products  { ... } — 품목 등록 (admin)
 *
 * POST 에 copyFromProductId 를 주면 기준 품목의 시험항목·작업단계를 복사한다.
 */

import { NextRequest } from 'next/server'
import { requireAuth, requireAdmin } from '@backend/lib/guard'
import { createProductWorkload, listProductWorkloads } from '@backend/services/workloadStandard'
import type { ProductWorkloadInput } from '@backend/services/workloadStandard'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { rows, schemaReady } = await listProductWorkloads()
    return Response.json({ rows, schemaReady })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const body = (await req.json()) as Partial<ProductWorkloadInput>
    if (!body.productCode?.trim()) {
      return Response.json({ error: '품목코드는 필수입니다.' }, { status: 400 })
    }
    if (!body.productName?.trim()) {
      return Response.json({ error: '품목명은 필수입니다.' }, { status: 400 })
    }
    const leadTime = Number(body.standardLeadTimeDays)
    if (!(leadTime > 0)) {
      return Response.json({ error: '표준 소요일은 0보다 커야 합니다.' }, { status: 400 })
    }

    const row = await createProductWorkload(
      { ...body, productCode: body.productCode, productName: body.productName, standardLeadTimeDays: leadTime },
      auth.payload.username,
    )
    return Response.json({ row }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
