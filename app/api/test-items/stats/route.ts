import { NextRequest } from 'next/server'
import { requireAdmin } from '@backend/lib/guard'
import { getTestItemStats } from '@backend/services/testItemStats'

export const runtime = 'nodejs'

/**
 * 시험항목별 실적 소요시간과 예상시간 조정 제안.
 *
 * 관리자 전용이다 — 예상시간은 일정·부하의 기준값이고, 이 응답은 곧 "무엇을 바꾸면
 * 좋은가" 의 목록이라 시험자 화면에서 쓸 일이 없다.
 *
 * 반영은 이 라우트가 하지 않는다. 사람이 확인한 뒤 PATCH /api/test-items 로 값과
 * 출처(estimateSource='measured')를 함께 저장한다 — 시스템이 몰래 덮어쓰지 않는다.
 */
export async function GET(req: NextRequest) {
  const g = await requireAdmin(req)
  if (!g.ok) return g.response
  try {
    return Response.json(await getTestItemStats())
  } catch (err) {
    console.error('[api/test-items/stats GET]', err)
    // 실적 통계는 부가 정보다. 여기서 500 을 내면 시험항목 마스터 화면 전체가
    // 못 쓰게 되므로, 화면이 조용히 넘어갈 수 있는 형태로 돌려준다.
    return Response.json(
      { actuals: [], suggestions: [], coverage: null, error: '실적 통계를 불러오지 못했습니다.' },
      { status: 200 },
    )
  }
}
