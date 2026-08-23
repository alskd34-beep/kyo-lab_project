/**
 * [BACKEND] PCT 오더 배정
 *   POST /api/pct-orders/assign   (admin)
 *     { mode: 'auto', orderIds?: string[] }      — AI 자동배정
 *     { mode: 'manual', orderId, testerId|null } — 수동 배정
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { autoAssign, assignManually } from '@backend/services/pctAssign'

export const runtime = 'nodejs'

/**
 * 도메인 규칙 위반(LOCK, 비활성 시험자 등)은 사용자 실수이므로 4xx 로 내린다.
 * 예전에는 전부 500 이라 클라이언트가 서버 장애와 구분할 수 없었고,
 * 5xx 알람이 오탐으로 가득 찼다.
 */
function errorStatus(msg: string): number {
  if (msg.includes('확정(LOCK)') || msg.includes('이미 시작')) return 409
  if (msg.includes('비활성') || msg.includes('필수') || msg.includes('허용되지 않는')) return 400
  if (msg.includes('찾을 수 없습니다')) return 404
  return 500
}

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json() as {
      mode?: 'auto' | 'manual'
      orderIds?: string[]
      orderId?: string
      testerId?: string | null
      reason?: string | null
    }
    // orderIds 는 문자열 배열이어야 한다. 문자열 하나를 보내면 PostgREST 필터가 깨진다.
    if (body.orderIds !== undefined) {
      if (!Array.isArray(body.orderIds) || body.orderIds.some(x => typeof x !== 'string')) {
        return Response.json({ error: 'orderIds 는 문자열 배열이어야 합니다.' }, { status: 400 })
      }
      if (body.orderIds.length > 1000) {
        return Response.json({ error: '한 번에 최대 1000건까지 배정할 수 있습니다.' }, { status: 400 })
      }
    }
    if (body.mode === 'manual') {
      if (!body.orderId) return Response.json({ error: 'orderId는 필수입니다.' }, { status: 400 })
      await assignManually(body.orderId, body.testerId ?? null, {
        changedBy: auth.payload.sub,
        reason: body.reason ?? null,
      })
      return Response.json({ ok: true })
    }
    const result = await autoAssign(body.orderIds)
    return Response.json(result)
  } catch (err) {
    console.error('[api/pct-orders/assign]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: errorStatus(msg) })
  }
}
