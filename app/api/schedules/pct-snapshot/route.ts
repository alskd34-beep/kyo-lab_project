/**
 * [BACKEND] PCT 월간 스케줄 스냅샷 (서버 영속화)
 *   GET  /api/schedules/pct-snapshot   → { snapshot }   (인증)
 *   POST { snapshot }                  → 저장            (인증)
 *
 * AI 스케줄 생성 결과를 서버에 저장해 기기/브라우저 무관하게 월간 스케줄에서 공유한다.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { savePctSnapshot, loadPctSnapshot, clearPctSnapshot } from '@backend/services/pctSnapshot'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const raw = await loadPctSnapshot()
    let snapshot: unknown = null
    if (raw) { try { snapshot = JSON.parse(raw) } catch { snapshot = null } }
    return Response.json({ snapshot })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json()
    const snapshot = body?.snapshot
    if (!snapshot || snapshot.version !== 1 || !Array.isArray(snapshot.assignments)) {
      return Response.json({ error: '유효한 snapshot이 필요합니다.' }, { status: 400 })
    }
    await savePctSnapshot(JSON.stringify(snapshot))
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    await clearPctSnapshot()
    return Response.json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
