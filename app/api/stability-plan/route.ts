import { NextRequest } from 'next/server'
import { requireAdmin, requireAuth } from '@backend/lib/guard'
import { listStabilityPlans, syncStabilityPlans, transferStabilityPlans, type StabilityPlanInput } from '@backend/services/stabilityPlan'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req); if (!auth.ok) return auth.response
  try { return Response.json({ rows: await listStabilityPlans() }) }
  catch (e) { return Response.json({ error: e instanceof Error ? e.message : '시험계획 조회 오류' }, { status: 500 }) }
}
export async function POST(req: NextRequest) {
  const auth = await requireAdmin(req); if (!auth.ok) return auth.response
  try {
    const body = await req.json() as { action?: 'sync' | 'transfer'; rows?: StabilityPlanInput[]; ids?: string[] }
    if (body.action === 'sync') {
      if (!body.rows?.length) return Response.json({ error: '시트 응답이 비어 있어 동기화를 중단했습니다.' }, { status: 400 })
      return Response.json({ rows: await syncStabilityPlans(body.rows) })
    }
    if (body.action === 'transfer') return Response.json({ results: await transferStabilityPlans(body.ids ?? [], auth.payload.sub ?? null) })
    return Response.json({ error: 'action은 sync 또는 transfer여야 합니다.' }, { status: 400 })
  } catch (e) { return Response.json({ error: e instanceof Error ? e.message : '시험계획 처리 오류' }, { status: 400 }) }
}
