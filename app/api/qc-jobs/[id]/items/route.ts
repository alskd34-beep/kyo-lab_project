/**
 * [BACKEND] QC 작업 항목
 *   PATCH /api/qc-jobs/[id]/items  { itemId, action }
 *     action='start'  — 항목 시작(진행 중으로 전환, 시작 시각 적재) → { ok, startedAt }
 *     action='cancel' — 시작 취소(대기로 되돌림)                    → { ok }
 *     action='clear'  — 항목 완료(시간 적재+알림)                    → { ok, allCleared, statusChangedTo }
 *
 *   시험자는 순번대로 시험하지 않는다 — 시작할 항목을 직접 고르고, 오래 걸리는 시험을
 *   걸어둔 채 다른 항목을 병행할 수 있다. 그래서 진행 중 항목은 여러 건일 수 있다.
 *   항목 완료 뒤 서버가 작업 단계를 시험항목 상태로 다시 도출한다(DB 함수 recompute_job_stage, 0048).
 *     allCleared      = 그 작업의 전 항목이 시험 완료인가
 *     statusChangedTo = 이번 완료로 도출된 작업 단계가 **바뀐 경우** 그 단계(대개 '검토전'), 아니면 null
 *   작업 단계가 진행중·지연·검토전·검토중일 때만 조작할 수 있고, 검토가 시작된 항목은 거절된다.
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
