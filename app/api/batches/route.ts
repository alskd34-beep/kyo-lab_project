import { NextRequest } from 'next/server'
import { listBatches, createBatch } from '@backend/services/batches'
import type { BatchStatus } from '@shared/pqm'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
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
  try {
    const body = await req.json()
    const batch = await createBatch({
      productId:               body.productId,
      spec:                    body.spec,
      batchNo:                 body.batchNo,
      dosageFormId:            body.dosageFormId,
      packagingPlannedDate:    body.packagingPlannedDate,
      recordReviewDeadline:    body.recordReviewDeadline,
      qcPlannedCompletionDate: body.qcPlannedCompletionDate,
      status:                  body.status,
    })
    return Response.json({ batch }, { status: 201 })
  } catch (err) {
    console.error('[api/batches POST]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
