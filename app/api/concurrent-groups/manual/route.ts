/**
 * [BACKEND] 관리자 수동 동시분석 그룹
 *   POST /api/concurrent-groups/manual            { orderIds, label?, note? } — 묶기 (admin)
 *   POST /api/concurrent-groups/manual?preview=1  { orderIds }                — 검증만(쓰기 없음)
 *
 * 묶기는 관리자의 판단이 규칙보다 우선한다는 전제다. 그래서 대부분의 문제는 경고로만
 * 알리고 막지 않는다. 막는 것은 데이터가 성립하지 않는 경우뿐(오더 없음·삭제됨·2건 미만).
 */

import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { createManualGroup, previewGrouping } from '@backend/services/concurrentGroups'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return auth.response
  try {
    const body = await req.json() as { orderIds?: string[]; label?: string; note?: string }
    const orderIds = Array.isArray(body.orderIds) ? body.orderIds.filter(Boolean) : []
    if (orderIds.length === 0) {
      return Response.json({ error: '묶을 오더를 선택해 주세요.' }, { status: 400 })
    }
    if (req.nextUrl.searchParams.get('preview') === '1') {
      return Response.json(await previewGrouping(orderIds))
    }
    const result = await createManualGroup(
      orderIds, { label: body.label ?? null, note: body.note ?? null }, auth.payload.sub ?? null,
    )
    return Response.json({ ok: true, ...result })
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 400 })
  }
}
