/**
 * [BACKEND] "이 시험자에게 배정된 오더" PostgREST 필터 (병렬 배정 0049)
 *
 * 오더의 담당자는 pct_order_assignees 의 슬롯 1~5 행이다(슬롯 1 = 대표, 미러 pct_orders.assignee_tester_id).
 * `.eq('assignee_tester_id', testerId)` 만 쓰면 담당자 2~5 에게는 자기 오더가 **아예 보이지 않는다** —
 * 작업 화면·챗봇·에이전트가 각자 이 필터를 손으로 적다 보면 한 곳만 빠뜨려도 그 사람의 일이
 * 조용히 사라지므로, 필터 문자열을 여기 한 곳에서만 만든다.
 *
 * 방식: order_id 목록을 먼저 읽어 `.in('id', ids)` 로 거는 대신 **inner 임베드**로 한 쿼리에 건다.
 *   담당 오더가 수백 건이면 id 목록이 URL 길이 한계를 넘기 때문이다(count·limit 쿼리에도 그대로 쓸 수 있다).
 *
 *   supabaseAdmin.from('pct_orders')
 *     .select(withAssignedTesterEmbed('id, product_name', testerId))
 *     .eq(ASSIGNED_TESTER_FILTER_COLUMN, testerId)   // testerId 가 있을 때만
 *
 * testerId 는 users.tester_id 에서 읽은 UUID 다(사용자 입력이면 호출부가 UUID 형식을 먼저 검사한다).
 * 0049 미적용이면 임베드 관계가 없어 PGRST200 이 난다 — 호출부가 describeSchemaError 로 감싼다.
 */

/** pct_orders 조회에 붙이는 담당자 inner 임베드 */
export const ASSIGNED_TESTER_EMBED = 'pct_order_assignees!inner(tester_id)'

/** inner 임베드에 거는 필터 컬럼 — `.eq(ASSIGNED_TESTER_FILTER_COLUMN, testerId)` */
export const ASSIGNED_TESTER_FILTER_COLUMN = 'pct_order_assignees.tester_id'

/**
 * select 컬럼 문자열에 담당자 inner 임베드를 붙인다. testerId 가 없으면(전체 조회) 그대로 돌려준다 —
 * 필터 없이 inner 임베드만 붙이면 미배정 오더가 결과에서 빠진다.
 */
export function withAssignedTesterEmbed(columns: string, testerId: string | null | undefined): string {
  return testerId ? `${columns}, ${ASSIGNED_TESTER_EMBED}` : columns
}
