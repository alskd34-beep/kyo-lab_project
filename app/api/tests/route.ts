/**
 * [BACKEND] Tests API Route
 * GET /api/tests?from=YYYY-MM-DD&to=YYYY-MM-DD&search=...&status=completed&deviationOnly=1
 *
 * 전사 시험현황(`/test-mgmt/test-status`)만 쓰는 목록이고 그 화면이 관리자 전용이라
 * 라우트도 관리자로 막는다(화면만 감추면 API 로는 그대로 열린다).
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { listTests } from '@backend/services/tests'
import type { StatusKey } from '@shared/qc'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const sp = req.nextUrl.searchParams
    const rows = await listTests({
      from:           sp.get('from')    ?? undefined,
      to:             sp.get('to')      ?? undefined,
      search:         sp.get('search')  ?? undefined,
      status:         (sp.get('status') as StatusKey | null) ?? undefined,
      deviationOnly:  sp.get('deviationOnly') === '1',
    })
    return Response.json({ rows })
  } catch (err) {
    console.error('[api/tests]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
