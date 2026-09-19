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
  | 'waiting' | 'inprogress' | 'delayed' | 'prereview' | 'reviewing' | 'pending' | 'completed' | 'fail'

// ─── 테이블 행 ────────────────────────────────────────────────────────────────
export interface TestRow {
  /** 화면 표시용 순번(1부터). 서버 조회 결과 안에서만 유효한 값이라 키로 쓰지 않는다. */
  id: number
  /** pct_orders.id — 미리보기·상태 변경의 실제 키 */
  orderId: string
  /** qc_jobs.id — 아직 시작되지 않은 오더는 null */
  jobId: string | null
  category: string
  type: string
  product: string
  batchNo: string
  testNo: string
  items: string
  /** items 를 쪼개지 않고 쓰도록 원본 배열도 함께 내려준다(미리보기 체크리스트) */
  itemList: string[]
  contractor: string
  manager: string
  managerInit: string
  receiveDate: string
  dueDate: string
  status: StatusKey
  /** DB 원본 한글 상태(진행중/검토전/…) — 단계 표시·상태 변경에 쓴다 */
  rawStatus: string
  isUrgent: boolean
  /** 이 오더가 속한 동시분석 그룹의 오더 수 — 2 이상이면 "동시 N" 배지. 그룹이 없거나 1건이면 0 */
  groupSize: number
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
