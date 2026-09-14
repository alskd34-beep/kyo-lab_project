/**
 * [BACKEND] 오더별 시험항목 — 품목 기준 스냅샷 위에서 개별 제외/추가 (0029) + 병렬 배정 슬롯 (0037 → 0049)
 *
 *   GET   /api/pct-orders/[id]/test-items   → { rows }   (인증)
 *         품목 기준 전체를 돌려준다. 제외된 항목도 isExcluded=true 로 함께 온다.
 *         행이 없으면 품목 기준으로 스냅샷을 먼저 깐다(지연 생성).
 *
 *   PATCH /api/pct-orders/[id]/test-items   (관리자)
 *         { testItemName, excluded: boolean, reason? }   — 제외/복구 토글
 *         { testItemName, assigneeSlot: 1~5 }             — 병렬 배정 담당자 슬롯 변경(오더에 있는 슬롯만, 작업 시작 전만)
 *         (assigneeSlot 이 있으면 슬롯 변경, excluded 가 있으면 제외/복구 — 둘 중 하나만 처리)
 *
 *   POST  /api/pct-orders/[id]/test-items   (관리자)
 *         { testItemId?, testItemName }                  — 이 오더에만 추가
 *
 *   DELETE /api/pct-orders/[id]/test-items  (관리자)
 *         { testItemName }   — manual 추가분은 삭제, 품목 기준분은 제외 처리
 */

import { NextRequest } from 'next/server'
import { requireAuth, requireAdmin } from '@backend/lib/guard'
import { MAX_PARALLEL_ASSIGNEES, isAssigneeSlot } from '@shared/assignment'
import { supabaseAdmin } from '@backend/lib/supabase'
import {
  listOrderDetail, setExcluded, addManualItem, removeItem, setAssigneeSlot,
} from '@backend/services/pctOrderTestItems'

export const runtime = 'nodejs'

/** 오더의 품목코드 — 스냅샷을 깔 때 기준이 된다 */
async function productCodeOf(orderId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('pct_orders').select('product_code').eq('id', orderId).maybeSingle()
  if (error) throw error
  if (!data) throw new Error('오더를 찾을 수 없습니다.')
  return (data.product_code as string) ?? ''
}

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireAuth(req)
  if (!g.ok) return g.response
  try {
    const { id } = await ctx.params
    return Response.json({ rows: await listOrderDetail(id, await productCodeOf(id)) })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const { id } = await ctx.params
    const body = await req.json() as {
      testItemName?: string
      excluded?: boolean
      reason?: string
      /** 병렬 배정 담당자 슬롯 변경 — excluded 와는 별개 액션, 둘 중 하나만 처리한다 */
      assigneeSlot?: number
    }
    if (!body.testItemName) {
      return Response.json({ error: 'testItemName 은 필수입니다.' }, { status: 400 })
    }

    if (body.assigneeSlot !== undefined) {
      if (!isAssigneeSlot(body.assigneeSlot)) {
        return Response.json({ error: `assigneeSlot 은 1~${MAX_PARALLEL_ASSIGNEES} 사이 정수여야 합니다.` }, { status: 400 })
      }
      // 병렬 배정 여부·LOCK·그 오더에 있는 슬롯·작업 0건 검증은 서비스가 한다.
      // 누가 배분을 바꿨는지 감사 이력(pct_order_edits)에 남긴다 — GMP 추적 대상이다.
      await setAssigneeSlot(id, body.testItemName, body.assigneeSlot, g.payload.sub ?? null)
      return Response.json({ ok: true })
    }

    if (typeof body.excluded !== 'boolean') {
      return Response.json({ error: 'testItemName 과 excluded(boolean)는 필수입니다.' }, { status: 400 })
    }
    await setExcluded(id, body.testItemName, body.excluded, body.reason)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 400 })
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const { id } = await ctx.params
    const body = await req.json() as { testItemId?: string; testItemName?: string }
    if (!body.testItemName) {
      return Response.json({ error: 'testItemName 은 필수입니다.' }, { status: 400 })
    }
    await addManualItem(id, body.testItemId ?? null, body.testItemName)
    return Response.json({ ok: true }, { status: 201 })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 400 })
  }
}

export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const { id } = await ctx.params
    const { testItemName } = await req.json() as { testItemName?: string }
    if (!testItemName) {
      return Response.json({ error: 'testItemName 은 필수입니다.' }, { status: 400 })
    }
    await removeItem(id, testItemName)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 400 })
  }
}
