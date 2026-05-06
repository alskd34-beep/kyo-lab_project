/**
 * [BACKEND] Tests API Route
 * GET /api/tests?from=YYYY-MM-DD&to=YYYY-MM-DD&search=...&status=completed&deviationOnly=1
 */

import { NextRequest } from 'next/server'
import { listTests } from '@backend/services/tests'
import type { StatusKey } from '@shared/qc'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
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
