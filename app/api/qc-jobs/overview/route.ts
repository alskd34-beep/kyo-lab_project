/**
 * [BACKEND] 작업자 현황
 *   GET /api/qc-jobs/overview — 작업자별 진행 현황 집계
 *
 *   관리자 : 전체 시험자
 *   시험자 : 본인 + 병렬 배정으로 같은 오더를 함께 맡은 동료 전원(공유 오더에 한정)
 *            남의 작업을 열어 주는 것이 아니라, 내 일과 내가 낀 협업만 보이게 좁힌다.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { listWorkerOverview, listWorkerOverviewForTester } from '@backend/services/qcJobs'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response
  try {
    const data = auth.payload.role === 'admin'
      ? await listWorkerOverview()
      : await listWorkerOverviewForTester(auth.payload.sub)
    return Response.json(data)
  } catch (err) {
    const msg = err instanceof Error ? err.message : '서버 오류'
    // 시험자 미연결은 서버 장애가 아니라 계정 설정 문제다 — 400 으로 구분해 돌려준다.
    const status = msg.includes('연결된 시험자가 없습니다') ? 400 : 500
    return Response.json({ error: msg }, { status })
  }
}
