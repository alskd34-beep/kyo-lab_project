/**
 * [BACKEND] 클라이언트에 내려보내는 로그인 사용자 객체 — 단일 기준.
 *
 * 예전에는 /api/auth/me · /api/auth/refresh · /api/auth/login 이 각자 손으로 조립했다.
 * 필드를 하나 늘리려면 세 곳을 고쳐야 했고, 실제로 어긋나 있었다 —
 * refresh·login 에 testerId 가 없었고 login 에는 customerNo 도 없었다.
 *
 * 그 어긋남은 화면에서 이렇게 터졌다. auth-context 의 refresh() 는 응답으로 받은
 * user 를 **통째로 교체**한다(setUser). 그런데 refresh() 는 13분 타이머뿐 아니라
 * 창 포커스·탭 복귀에서도 돈다. 그래서 새로고침 직후 /me 가 채워 준 testerId 가
 * 곧이어 포커스 한 번에 지워졌고, 월간 그리드의 "나" 배지와 부업무 기록 [+] 버튼이
 * 나왔다가 사라졌다. 로컬은 HMR 이 /me 를 계속 다시 불러 증상이 감춰졌다.
 *
 * 세 라우트가 이 함수 하나만 쓰게 해서 다시 갈라지지 않게 한다.
 */

import { getTesterId } from '@backend/lib/testerLink'
import type { UserDTO } from '@backend/services/users'

/** 화면(auth-context)이 기대하는 사용자 객체 */
export interface AuthUserPayload {
  id: string
  username: string
  displayName: string | null
  avatarUrl: string | null
  role: string
  customerNo: number | null
  /**
   * 이 계정에 연결된 시험자(testers.id). 월간 그리드가 "내 행"을 찾는 키다 —
   * users.id 로는 tester 기준 데이터에 닿지 못한다.
   */
  testerId: string | null
}

/**
 * users.tester_id 가 비어 있으면 사번(=username)이 같은 시험자로 자가복구한다.
 * 이 값만 users 컬럼을 그대로 읽으면 서버와 답이 갈린다 — 링크가 끊긴 계정은 월간
 * 그리드에 "내 행"이 없어 부업무를 남길 칸조차 없는데, 정작 POST 는 같은 자가복구를
 * 거쳐 통과한다. 내 작업(qcJobs)이 이미 쓰는 그 규칙 하나로 맞춘다.
 */
export async function toAuthUser(user: UserDTO): Promise<AuthUserPayload> {
  return {
    id:          user.id,
    username:    user.username,
    displayName: user.displayName,
    avatarUrl:   user.avatarUrl,
    role:        user.role,
    customerNo:  user.customerNo,
    testerId:    user.testerId ?? await getTesterId(user.id),
  }
}
