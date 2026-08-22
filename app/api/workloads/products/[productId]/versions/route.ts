/**
 * [BACKEND] 품목 공수 표준 버전 변경이력
 *   GET /api/workloads/products/[productId]/versions — 버전 목록 (인증, 최신 우선)
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { listWorkloadVersions } from '@backend/services/workloadStandard'

export const runtime = 'nodejs'

export async function GET(req: NextRequest, ctx: { params: Promise<{ productId: string }> }) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const { productId } = await ctx.params
    const rows = await listWorkloadVersions(productId)
    return Response.json({ rows })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
