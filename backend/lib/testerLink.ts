/**
 * [BACKEND] 로그인 사용자(users) ↔ 시험자(testers) 연결 해석.
 *
 * 이 앱의 "내 것"은 전부 tester_id 기준이다 — 내 작업(qc_jobs.assignee_tester_id),
 * 월간 그리드의 내 행, 내 부업무 기록(side_work_logs.tester_id). 그래서 세션의
 * user id 를 tester id 로 바꾸는 이 한 걸음이 여러 서비스에 필요하다.
 *
 * qcJobs.ts 안에 사유화돼 있던 것을 꺼냈다. 자가복구 규칙(아래)에는 2026-08-23
 * 보안 수정이 들어 있어, 복사본이 생기면 한쪽만 고쳐지는 사고가 난다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'

/**
 * 로그인 사용자의 tester_id 조회.
 * 사용자·시험자 통합 모델에서 로그인 ID(username) = 시험자 사번(employee_no) 이므로,
 * users.tester_id 가 비어 있어도 사번이 같은 시험자를 찾아 즉시 연결(자가복구)한다.
 * (재시드·수동 편집 등으로 1:1 링크가 끊긴 계정도 다음 접근 시 자동 복구)
 */
export async function getTesterId(userSub: string): Promise<string | null> {
  const { data: user } = await supabaseAdmin
    .from('users').select('tester_id, username').eq('id', userSub).maybeSingle()
  if (!user) return null
  if (user.tester_id) return user.tester_id as string

  // 링크 누락 — 사번(=username)이 동일한 시험자로 자가복구
  const username = user.username as string | undefined
  if (!username) return null
  const { data: tester } = await supabaseAdmin
    .from('testers').select('id').eq('employee_no', username).maybeSingle()
  if (!tester?.id) return null

  const testerId = tester.id as string

  // 2026-08-23 수정: 예전에는 "사번이 같다"는 이유만으로 이 시험자를 점유 중인
  // **다른 사용자의 링크를 조용히 끊고** 가져왔다. 링크가 끊긴 쪽은 이후
  // getTesterId 가 null 을 반환해 본인 작업 화면이 비고, testerAbsences 가 그 사람의
  // 휴가를 배정 엔진에 전달하지 못한다(operatorSchedule: `if (!testerId) continue`).
  // 남의 링크는 건드리지 않고, 비어 있을 때만 연결한다.
  const { data: holder } = await supabaseAdmin
    .from('users').select('id').eq('tester_id', testerId).maybeSingle()
  if (holder && holder.id !== userSub) {
    console.warn(
      `[testerLink] 시험자 ${testerId} 는 이미 사용자 ${holder.id} 에 연결돼 있어 자가복구를 건너뜁니다 ` +
      `(요청자 ${userSub}). 관리자 화면에서 연결을 정리하세요.`,
    )
    return null
  }

  const { error: linkErr } = await supabaseAdmin
    .from('users').update({ tester_id: testerId }).eq('id', userSub)
  if (linkErr) {
    console.error('[testerLink] 시험자 자가복구 연결 실패:', linkErr)
    return null
  }
  return testerId
}
