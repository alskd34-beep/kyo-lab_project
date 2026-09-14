/**
 * [BACKEND] 진행 중 시험항목 담당자 변경(F2) — 같은 오더의 병렬 배정 담당자 사이
 *
 *   GET  /api/pct-orders/[id]/test-items/reassign   → ItemReassignContext (인증)
 *        담당자별 작업·항목 흔적·넘길 수 없는 이유. 관리자 또는 이 오더의 병렬 담당자만.
 *
 *   POST /api/pct-orders/[id]/test-items/reassign   (인증)
 *        { testItemName, expectedFromSlot, toSlot, reason }  → { ok, ...ItemReassignResult, warning? }
 *        관리자: 그룹원 사이 누구의 항목이든 / 시험자: 자기 슬롯의 항목만. 받는 사람은 그 오더의 슬롯.
 *        권한·흔적·단계 판정은 DB 함수 reassign_job_item(0050)이 한 트랜잭션으로 한다(서비스는 번역만).
 *
 * 규칙 전문: intent/2026-09-15-in-progress-item-reassign-spec.md
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import {
  ItemReassignForbiddenError,
  getItemReassignContext,
  reassignJobItem,
} from '@backend/services/jobItemReassign'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    return Response.json(await getItemReassignContext(id, auth.payload.sub, auth.payload.role))
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: err instanceof ItemReassignForbiddenError ? 403 : 400 })
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body = await req.json().catch(() => null) as {
      testItemName?: unknown; expectedFromSlot?: unknown; toSlot?: unknown; reason?: unknown
    } | null
    if (!body || typeof body.testItemName !== 'string' || !body.testItemName) {
      return Response.json({ error: 'testItemName 은 필수입니다.' }, { status: 400 })
    }
    const result = await reassignJobItem({
      orderId: id,
      testItemName: body.testItemName,
      expectedFromSlot: body.expectedFromSlot,
      toSlot: body.toSlot,
      userSub: auth.payload.sub,
      reason: body.reason,
    })
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
