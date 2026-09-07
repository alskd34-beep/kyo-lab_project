/**
 * [BACKEND] QC 작업 항목
 *   PATCH /api/qc-jobs/[id]/items  { itemId, action }
 *     action='start'  — 항목 시작(진행 중으로 전환, 시작 시각 적재) → { ok, startedAt }
 *     action='cancel' — 시작 취소(대기로 되돌림)                    → { ok }
 *     action='clear'  — 항목 완료(시간 적재+알림)                    → { ok, allCleared, statusChangedTo }
 *
 *   시험자는 순번대로 시험하지 않는다 — 시작할 항목을 직접 고르고, 오래 걸리는 시험을
 *   걸어둔 채 다른 항목을 병행할 수 있다. 그래서 진행 중 항목은 여러 건일 수 있다.
 *   전 항목 완료 시 작업 상태가 '검토전' 으로 자동 전환되며 statusChangedTo 로 알린다.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { cancelItemStart, clearItem, startItem } from '@backend/services/qcJobs'

export const runtime = 'nodejs'

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const body = await req.json() as { itemId?: string; action?: string }
    if (!body.itemId) return Response.json({ error: 'itemId는 필수입니다.' }, { status: 400 })

    if (body.action === 'start') {
      const result = await startItem(id, body.itemId, auth.payload.sub)
      return Response.json({ ok: true, ...result })
    }
    if (body.action === 'cancel') {
      await cancelItemStart(id, body.itemId, auth.payload.sub)
      return Response.json({ ok: true })
    }
    if (body.action === 'clear') {
      const result = await clearItem(id, body.itemId, auth.payload.sub)
      return Response.json({ ok: true, ...result })
    }
    return Response.json({ ok: true, allCleared: false, statusChangedTo: null })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
