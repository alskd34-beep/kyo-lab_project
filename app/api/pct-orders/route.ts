/**
 * [BACKEND] PCT 오더
 *   GET   /api/pct-orders?status=&assigneeTesterId=&includeDeleted=  — 목록 (인증)
 *   POST  /api/pct-orders  { ...오더필드 }                          — 수동 오더 생성 (admin)
 *         필수: productName·dueDate. productCode·batchNo 를 비우면 N/A(서버가 NA-… 대체값 생성)
 *   PATCH /api/pct-orders  { id, patch, reason, assignees? }         — 사유 필수 수정 (admin)
 *         assignees: [{ slot: 1~5, testerId }] 병렬 배정 담당자 구성(빈 배열 = 미배정). 없으면 구성은 그대로.
 *   DELETE /api/pct-orders { id|ids, reason }                      — 선택 오더 소프트 삭제 (admin, 사유 필수)
 */

import { NextRequest } from 'next/server'
import { requireAuth, requireAdmin } from '@backend/lib/guard'
import { listOrders, createOrder, updateOrderWithReason, deleteOrders } from '@backend/services/pctOrders'

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
      dosageForm?: string | null; validationType?: string | null
      packagingDate?: string | null; dueDate?: string | null; plannedStartDate?: string | null
      isUrgent?: boolean; method?: string; status?: string
      assigneeTesterId?: string | null; note?: string | null
      /** method='개별항목' 일 때 배정할 시험항목 */
      testItems?: Array<{ testItemId?: string | null; testItemName?: string }>
    }
    // 수동 오더 필수 = 품목명 + 완료예정일. 품목코드·제조번호는 비우면 N/A(서비스가 대체값 생성)
    if (!body.productName?.trim() || !body.dueDate?.trim()) {
      return Response.json({ error: '품목명·완료예정일은 필수입니다.' }, { status: 400 })
    }
    const row = await createOrder({
      productCode: body.productCode ?? '',
      productName: body.productName,
      batchNo: body.batchNo ?? '',
      dosageForm: body.dosageForm ?? null,
      validationType: body.validationType ?? null,
      packagingDate: body.packagingDate ?? null,
      dueDate: body.dueDate ?? null,
      plannedStartDate: body.plannedStartDate ?? null,
      isUrgent: body.isUrgent ?? false,
      method: body.method,
      status: body.status,
      assigneeTesterId: body.assigneeTesterId ?? null,
      note: body.note ?? null,
      testItems: (body.testItems ?? [])
        .filter(i => (i.testItemName ?? '').trim())
        .map((i, idx) => ({
          testItemId: i.testItemId ?? null,
          testItemName: (i.testItemName ?? '').trim(),
          sequenceOrder: idx,
        })),
      createdBy: auth.payload.sub ?? null,
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
      /** 병렬 배정 담당자 구성 — 형식 검증·규칙 판정은 서비스와 DB 함수(0049)가 한다 */
      assignees?: unknown
      /** 편집 모달에서 함께 저장할 시험항목 슬롯 배분 */
      itemAssignments?: unknown
    }
    if (!body.id || !body.patch) {
      return Response.json({ error: 'id와 patch는 필수입니다.' }, { status: 400 })
    }
    const replication = await updateOrderWithReason(body.id, body.patch, body.reason ?? '', auth.payload.sub ?? null, {
      assignees: body.assignees,
      itemAssignments: body.itemAssignments,
    })
    return Response.json({ ok: true, replication })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json().catch(() => ({})) as { id?: string; ids?: string[]; reason?: string }
    const ids = Array.from(new Set([...(body.ids ?? []), ...(body.id ? [body.id] : [])].filter(Boolean)))
    if (ids.length === 0) return Response.json({ error: 'id 또는 ids 필수' }, { status: 400 })
    const { succeeded, skipped } = await deleteOrders(ids, body.reason ?? '', auth.payload.sub ?? null)
    return Response.json({ ok: true, succeeded, skipped })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
