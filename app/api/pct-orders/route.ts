/**
 * [BACKEND] PCT 오더
 *   GET   /api/pct-orders?status=&assigneeTesterId=&includeDeleted=  — 목록 (인증)
 *   POST  /api/pct-orders  { ...오더필드 }                          — 수동 오더 생성 (admin)
 *   PATCH /api/pct-orders  { id, patch, reason }                     — 사유 필수 수정 (admin)
 */

import { NextRequest } from 'next/server'
import { requireAuth, requireAdmin } from '@backend/lib/guard'
import { listOrders, createOrder, updateOrderWithReason } from '@backend/services/pctOrders'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const rows = await listOrders({
      status: searchParams.get('status') ?? undefined,
      assigneeTesterId: searchParams.get('assigneeTesterId') ?? undefined,
      includeDeleted: searchParams.get('includeDeleted') === '1',
    })
    return Response.json({ rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json() as {
      productCode?: string; productName?: string; batchNo?: string
      dosageForm?: string | null; packagingDate?: string | null; dueDate?: string | null
      isUrgent?: boolean; method?: string; status?: string
      assigneeTesterId?: string | null; note?: string | null
    }
    if (!body.productCode || !body.productName || !body.batchNo) {
      return Response.json({ error: '품목코드·품목명·제조번호는 필수입니다.' }, { status: 400 })
    }
    const row = await createOrder({
      productCode: body.productCode,
      productName: body.productName,
      batchNo: body.batchNo,
      dosageForm: body.dosageForm ?? null,
      packagingDate: body.packagingDate ?? null,
      dueDate: body.dueDate ?? null,
      isUrgent: body.isUrgent ?? false,
      method: body.method,
      status: body.status,
      assigneeTesterId: body.assigneeTesterId ?? null,
      note: body.note ?? null,
    })
    return Response.json({ row }, { status: 201 })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json() as {
      id?: string
      patch?: Record<string, string | boolean | null>
      reason?: string
    }
    if (!body.id || !body.patch) {
      return Response.json({ error: 'id와 patch는 필수입니다.' }, { status: 400 })
    }
    await updateOrderWithReason(body.id, body.patch, body.reason ?? '', auth.payload.sub ?? null)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
