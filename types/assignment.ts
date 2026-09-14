/**
 * 병렬 배정(최대 5인) — 서버·화면이 함께 쓰는 상수·타입·라벨.
 *
 * 규칙 전문: intent/2026-09-15-parallel-assignment-spec.md
 *
 * 한 오더(품목·제조번호)를 담당자 여러 명이 시험항목을 나눠 맡는다. 담당자는 오더마다
 * **슬롯 번호(1~5)** 로 저장된다(pct_order_assignees). 슬롯 1 이 대표 담당자이며
 * pct_orders.assignee_tester_id 에 미러된다. 병렬 여부는 플래그 없이 슬롯 행 수(≥ 2)로 파생한다.
 *
 * 슬롯 번호는 안정 식별자다 — 사람을 빼도 번호를 당기지 않는다(구멍 허용). 시험항목 배분
 * (pct_order_test_items.assignee_slot)과 감사 이력이 번호를 가리키기 때문이다.
 *
 * ⚠️ MAX_PARALLEL_ASSIGNEES 는 supabase/migrations/0049_parallel_assignment.sql 의
 *    `check (slot between 1 and 5)`·`check (assignee_slot between 1 and 5)`·함수 안의 숫자 5 와
 *    반드시 같은 값이어야 한다. 값을 바꾸면 그 SQL 도 함께 바꾼다.
 *
 * `can_duo`(2인 시험 가능)·`requires_duo`(2인시험 필요)·규칙엔진의 듀오 조는 **다른 개념**이다 — 여기와 무관하다.
 */

/** 한 오더에 배정할 수 있는 최대 담당자 수 (SQL 0049 의 숫자 5 와 짝) */
export const MAX_PARALLEL_ASSIGNEES = 5

/** 담당자 슬롯 번호 1~5 */
export type AssigneeSlot = 1 | 2 | 3 | 4 | 5

/** 대표 담당자 슬롯 번호 */
export const PRIMARY_ASSIGNEE_SLOT: AssigneeSlot = 1

/** 1~5 슬롯 번호 목록(오름차순) */
export const ASSIGNEE_SLOTS: readonly AssigneeSlot[] = [1, 2, 3, 4, 5]

/** 값이 유효한 슬롯 번호(1~MAX_PARALLEL_ASSIGNEES 정수)인가 */
export function isAssigneeSlot(v: unknown): v is AssigneeSlot {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_PARALLEL_ASSIGNEES
}

/** 화면·감사 이력의 담당자 번호 라벨 — `담당자 1` … `담당자 5` */
export function assigneeSlotLabel(slot: number): string {
  return `담당자 ${slot}`
}

/** 병렬 배정 배지 문구 */
export const PARALLEL_BADGE_LABEL = '병렬'

/** 오더에 배정된 담당자 1명(슬롯 1행) — 서버 응답 형태 */
export interface OrderAssignee {
  slot: AssigneeSlot
  testerId: string
  /** 시험자 이름 (조회 실패 시 null) */
  name: string | null
  /** 이 담당자가 이 오더에서 이미 작업을 시작했으면 그 QC번호, 아니면 null */
  startedQcNo: string | null
}

/** 담당자 구성 변경 요청의 한 원소 (PATCH /api/pct-orders 의 assignees) */
export interface OrderAssigneeInput {
  slot: AssigneeSlot
  testerId: string
}

/** 담당자 목록이 병렬 배정인가 (행 2개 이상) */
export function isParallelAssignment(assignees: readonly unknown[] | null | undefined): boolean {
  return (assignees?.length ?? 0) >= 2
}

/** 비어 있는 가장 작은 슬롯 번호(2~5). 없으면 null — 추가 시 번호 부여 규칙 */
export function nextFreeSlot(used: readonly number[]): AssigneeSlot | null {
  for (const s of ASSIGNEE_SLOTS) {
    if (s === PRIMARY_ASSIGNEE_SLOT) continue
    if (!used.includes(s)) return s
  }
  return null
}
