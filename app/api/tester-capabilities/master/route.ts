import { NextRequest } from 'next/server'
import { requireAdmin, requireAuth } from '@backend/lib/guard'
import { createCapability, listCapabilityMaster } from '@backend/services/testers'

export const runtime = 'nodejs'

/**
 * 시험 역량 마스터(test_capabilities) — 시험자 역량 매트릭스의 **컬럼**을 관리한다.
 * 매트릭스의 셀(숙련도)은 상위 경로 `/api/tester-capabilities` 가 담당한다.
 */

/** GET /api/tester-capabilities/master — 마스터 목록 + 역량별 평가 건수 */
export async function GET(req: NextRequest) {
  const g = await requireAuth(req)
  if (!g.ok) return g.response
  try {
    return Response.json({ rows: await listCapabilityMaster() })
  } catch (err) {
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 500 })
  }
}

/** POST /api/tester-capabilities/master — 역량 추가 */
export async function POST(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    const body = await req.json()
    const row = await createCapability({ code: body.code, name: body.name, sortOrder: body.sortOrder })
    return Response.json({ row }, { status: 201 })
  } catch (err) {
    // 입력값 문제(코드 형식·중복)는 400 — 화면이 그대로 문구를 띄운다
    return Response.json({ error: err instanceof Error ? err.message : '서버 오류' }, { status: 400 })
  }
}
