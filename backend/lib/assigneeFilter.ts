/**
 * [BACKEND] "이 시험자에게 배정된 오더" PostgREST 필터
 *
 * 2인 배정(0037) 이후 오더의 담당자는 두 명일 수 있다(assignee_tester_id / assignee_tester_id_2).
 * `.eq('assignee_tester_id', testerId)` 만 쓰면 담당자2에게는 자기 오더가 **아예 보이지 않는다** —
 * 작업 화면·챗봇·에이전트가 각자 이 필터를 손으로 적다 보면 한 곳만 빠뜨려도 그 사람의 일이
 * 조용히 사라지므로, 문자열을 여기 한 곳에서만 만든다.
 *
 * testerId 는 users.tester_id 에서 읽은 UUID 다(사용자 입력이 아니다). 검색어처럼
 * sanitizeFilterTerm 으로 씻어야 하는 값이 아니므로 그대로 보간한다.
 */
export function assignedToTesterFilter(testerId: string): string {
  return `assignee_tester_id.eq.${testerId},and(is_dual_assignment.eq.true,assignee_tester_id_2.eq.${testerId})`
}
