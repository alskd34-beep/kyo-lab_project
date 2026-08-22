import { NextRequest } from 'next/server'
import { requireAdmin, requireAuth } from '@backend/lib/guard'
import { listCapabilities, listCapabilityMatrix, upsertCapabilityLevel } from '@backend/services/testers'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const g = await requireAuth(req)
  if (!g.ok) return g.response
  try {
    const [capabilities, matrix] = await Promise.all([
      listCapabilities(),
      listCapabilityMatrix(),
    ])
    return Response.json({ capabilities, matrix })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const body = await req.json()
    const { testerId, capabilityId, proficiencyLevel } = body
    if (!testerId || !capabilityId || !proficiencyLevel)
      return Response.json({ error: 'testerId, capabilityId, proficiencyLevel 필수' }, { status: 400 })
    await upsertCapabilityLevel(testerId, capabilityId, proficiencyLevel)
    return Response.json({ ok: true })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}
