/**
 * @deprecated 호출하는 화면이 없다 (2026-08-22 점검 기준).
 * production_batches(레거시 PQM 스키마) CRUD. 현재 UI 는 pct_orders 를 쓴다.
 * 제거 여부는 운영 확인 후 결정한다 — docs/system-audit-2026-08-22.md 9번 항목.
 */
import { NextRequest } from 'next/server'
import { requireAdmin, requireAuth } from '@backend/lib/guard'
import { listBatches, createBatch } from '@backend/services/batches'
import type { BatchStatus } from '@shared/pqm'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const g = await requireAuth(req)
  if (!g.ok) return g.response
  try {
    const sp = req.nextUrl.searchParams
    const rows = await listBatches({
      status:    (sp.get('status') as BatchStatus | null) ?? undefined,
      from:      sp.get('from')      ?? undefined,
      to:        sp.get('to')        ?? undefined,
      search:    sp.get('search')    ?? undefined,
      productId: sp.get('productId') ?? undefined,
    })
    return Response.json({ rows })
  } catch (err) {
    console.error('[api/batches GET]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const body = await req.json()
    const row = await createBatch({
      productId:               body.productId,
      spec:                    body.spec,
      batchNo:                 body.batchNo,
      dosageFormId:            body.dosageFormId,
      packagingPlannedDate:    body.packagingPlannedDate,
      recordReviewDeadline:    body.recordReviewDeadline,
      qcPlannedCompletionDate: body.qcPlannedCompletionDate,
      status:                  body.status,
    })
    return Response.json({ row }, { status: 201 })
  } catch (err) {
    console.error('[api/batches POST]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
