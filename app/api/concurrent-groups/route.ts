/**
 * [BACKEND] 동시분석 그룹
 *   GET  /api/concurrent-groups        — 목록 (인증)
 *   POST /api/concurrent-groups        — 잠기지 않은 그룹 재생성 (admin)
 */

import { NextRequest } from 'next/server'
import { requireAuth, requireAdmin } from '@backend/lib/guard'
import { listGroups, rebuildGroups } from '@backend/services/concurrentGroups'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const rows = await listGroups()
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
    const result = await rebuildGroups()
    return Response.json(result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
