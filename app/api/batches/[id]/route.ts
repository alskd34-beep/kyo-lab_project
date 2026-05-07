import { NextRequest } from 'next/server'
import { getBatch, updateBatch } from '@backend/services/batches'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const batch = await getBatch(id)
    return Response.json({ batch })
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
  try {
    const { id } = await params
    const body = await req.json()
    const batch = await updateBatch(id, {
      productId:               body.productId,
      spec:                    body.spec,
      batchNo:                 body.batchNo,
      dosageFormId:            body.dosageFormId,
      packagingPlannedDate:    body.packagingPlannedDate,
      recordReviewDeadline:    body.recordReviewDeadline,
      qcPlannedCompletionDate: body.qcPlannedCompletionDate,
      status:                  body.status,
    })
    return Response.json({ batch })
  } catch (err) {
    console.error('[api/batches/[id] PATCH]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
