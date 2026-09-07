import { NextRequest } from 'next/server'
import { verifyAccessToken } from '@backend/lib/auth'
import { ACCESS_COOKIE } from '@backend/lib/auth-cookies'
import { findUserById } from '@backend/services/users'
import { getTesterId } from '@backend/lib/testerLink'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const access = req.cookies.get(ACCESS_COOKIE)?.value
  if (!access) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const payload = await verifyAccessToken(access).catch(() => null)
  if (!payload) return Response.json({ error: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' }, { status: 401 })

  const user = await findUserById(payload.sub)
  if (!user) return Response.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 })

  // users.tester_id 가 비어 있으면 사번(=username)이 같은 시험자로 자가복구한다.
  // 이 화면 값만 users 컬럼을 그대로 읽으면 서버와 답이 갈린다 — 링크가 끊긴 계정은
  // 월간 그리드에 "내 행"이 없어 부업무를 남길 칸조차 없는데, 정작 POST 는 같은
  // 자가복구를 거쳐 통과한다. 내 작업(qcJobs)이 이미 쓰는 그 규칙 하나로 맞춘다.
  const testerId = user.testerId ?? await getTesterId(user.id)

  return Response.json({
    user: {
      id:          user.id,
      username:    user.username,
      displayName: user.displayName,
      avatarUrl:   user.avatarUrl,
      role:        user.role,
      customerNo:  user.customerNo,
      // 월간 그리드가 "내 행"을 찾는 키. users.id 로는 tester 기준 데이터에 닿지 못한다.
      testerId,
    },
  })
}
