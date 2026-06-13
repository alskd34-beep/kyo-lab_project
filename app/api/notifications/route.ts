/**
 * [BACKEND] 알림
 *   GET   /api/notifications?unreadOnly=1   — 내 알림 목록 (인증)
 *   PATCH /api/notifications { id? }         — 읽음 처리 (id 미지정 시 전체)
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { listForUser, markRead } from '@backend/services/notifications'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { searchParams } = new URL(req.url)
    const rows = await listForUser(auth.payload.sub, auth.payload.role, {
      unreadOnly: searchParams.get('unreadOnly') === '1',
      limit: Number(searchParams.get('limit')) || 50,
    })
    const unread = rows.filter(r => !r.isRead).length
    return Response.json({ rows, unread })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json().catch(() => ({})) as { id?: string }
    await markRead(auth.payload.sub, auth.payload.role, body.id)
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
