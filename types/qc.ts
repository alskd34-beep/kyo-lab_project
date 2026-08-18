/**
 * QC 시험 관리 시스템 - 공통 타입 정의
 * Frontend/Backend 양쪽에서 공유하는 타입을 여기서 관리합니다.
 */

// ─── 시험 상태 ────────────────────────────────────────────────────────────────
/**
 * 화면 표시용 진행상태 키.
 * DB 단계(types/qc-status.ts)와 1:1 로 대응한다 —
 * 서로 다른 단계를 한 키로 묶으면 라벨이 실제 상태를 잘못 말하게 된다.
 *   waiting(대기) / inprogress(진행중·지연) / prereview(검토전) /
 *   reviewing(검토중) / pending(승인전) / completed(승인완료) / fail(부적합)
 */
export type StatusKey =
  | 'waiting' | 'inprogress' | 'prereview' | 'reviewing' | 'pending' | 'completed' | 'fail'

// ─── 테이블 행 ────────────────────────────────────────────────────────────────
export interface TestRow {
  id: number
  category: string
  type: string
  product: string
  testNo: string
  items: string
  contractor: string
  manager: string
  managerInit: string
  receiveDate: string
  dueDate: string
  status: StatusKey
}

// ─── KPI 카드 ─────────────────────────────────────────────────────────────────
export interface KpiItem {
  label: string
  value: string
  unit: string
  sub: string
  accent: string
  bg: string
  border: string
}
