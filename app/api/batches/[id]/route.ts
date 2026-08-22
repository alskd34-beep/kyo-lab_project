/**
 * @deprecated 호출하는 화면이 없다 (2026-08-22 점검 기준).
 * production_batches(레거시 PQM 스키마) 단건 조회/수정. 현재 UI 는 pct_orders 를 쓴다.
 * 제거 여부는 운영 확인 후 결정한다 — docs/system-audit-2026-08-22.md 9번 항목.
 */
import { NextRequest } from 'next/server'
import { requireAdmin, requireAuth } from '@backend/lib/guard'
import { getBatch, updateBatch } from '@backend/services/batches'

export const runtime = 'nodejs'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await requireAuth(req)
  if (!g.ok) return g.response
  try {
    const { id } = await params
    const row = await getBatch(id)
    return Response.json({ row })
  } catch (err) {
    console.error('[api/batches/[id] GET]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    const status = msg.includes('JSON') || msg.includes('No rows') ? 404 : 500
    return Response.json({ error: msg }, { status })
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const { id } = await params
    const body = await req.json()
    const row = await updateBatch(id, {
      productId:               body.productId,
      spec:                    body.spec,
      batchNo:                 body.batchNo,
      dosageFormId:            body.dosageFormId,
      packagingPlannedDate:    body.packagingPlannedDate,
      recordReviewDeadline:    body.recordReviewDeadline,
      qcPlannedCompletionDate: body.qcPlannedCompletionDate,
      status:                  body.status,
    })
    return Response.json({ row })
  } catch (err) {
    console.error('[api/batches/[id] PATCH]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
