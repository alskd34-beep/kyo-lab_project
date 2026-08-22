/**
 * @deprecated 호출하는 화면이 없다 (2026-08-22 점검 기준).
 * 외부 Tableau 연동이 호출할 가능성이 있어 삭제하지 않고 남겨둔다.
 * 제거 여부는 운영 확인 후 결정한다 — docs/system-audit-2026-08-22.md 9번 항목.
 */
import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { getTableauSummary } from '@backend/services/tableau'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  try {
    const limit = req.nextUrl.searchParams.get('limit')
    const row = await getTableauSummary(limit ? Number(limit) : undefined)
    return Response.json({ row })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Tableau 연동 오류'
    return Response.json({ error: msg }, { status: 502 })
  }
}
