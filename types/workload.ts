/**
 * [SHARED] 품목별 시험공수 표준 (Workload Standard)
 *
 * 품목(Product) → 시험항목(TestItem) → 작업단계(WorkStep) 3계층으로
 * 인적·기기·대기·검토 공수를 관리한다. 향후 시험자/기기 자동배정의 기준 데이터.
 *
 * ⚠️ 개념 구분 (매우 중요)
 *   - 공수(minutes): 인적 / 기기 / 대기 / 검토 — 각각 독립. 서로 더하지 않는다.
 *   - 표준 소요일(days): 위 공수 합계와 무관한 별도 관리값.
 *     기기 가동 중 시험자는 다른 업무를 하고, 대기시간은 사람이 일하는 시간이 아니므로
 *     "인적+기기+대기+검토 = 소요일" 로 환산하면 안 된다.
 *
 * ⚠️ 이름 주의: 기존 `product_workload` 테이블(공수 '일' 단일값, PCT 자동배정용)과 다른 개념이다.
 *   이 모듈의 DB 테이블은 `workload_product` / `workload_test_item` / `workload_step`.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

/** 공수 구분 */
export type WorkloadType = 'HUMAN' | 'EQUIPMENT' | 'WAITING' | 'REVIEW'

/** 난이도 */
export type Difficulty = 'LOW' | 'NORMAL' | 'HIGH' | 'VERY_HIGH'

/** 공수 표준 상태 */
export type WorkloadStatus = 'DRAFT' | 'ACTIVE' | 'INACTIVE'

// ─── 데이터 모델 ──────────────────────────────────────────────────────────────

/** 작업단계 — 공수를 실제로 입력하는 최소 단위 */
export interface TestWorkStep {
  id: string
  testItemId: string

  stepCode: string | null
  stepName: string
  sequence: number

  workloadType: WorkloadType
  /** 소요시간(분). DB 내부 계산 단위는 항상 분으로 통일한다. */
  durationMinutes: number

  /** 향후 Equipment Master 연결용 예약 필드 (현재는 name 만 사용) */
  equipmentTypeId: string | null
  equipmentTypeName: string | null

  requiredSkill: string | null
  parallelAllowed: boolean
  predecessorStepId: string | null
  memo: string | null

  createdAt: string
  updatedAt: string
}

/** 시험항목 — 공수는 하위 작업단계 합계로 자동 계산된다 */
export interface ProductTestItem {
  id: string
  productWorkloadId: string

  testCode: string | null
  testName: string
  sequence: number

  /** 아래 4개는 steps 합계(자동 계산). 직접 입력하지 않는다. */
  humanMinutes: number
  equipmentMinutes: number
  waitingMinutes: number
  reviewMinutes: number

  parallelAllowed: boolean
  simultaneousAnalysisAllowed: boolean
  /** 동시분석 확장 필드 — 동시분석 시 공수를 단순히 건수만큼 곱할 수 없어 별도 관리 */
  simultaneousMaxCount: number | null
  simultaneousAdditionalHumanMinutes: number | null
  simultaneousAdditionalEquipmentMinutes: number | null

  requiredSkill: string | null
  difficulty: Difficulty
  memo: string | null

  steps: TestWorkStep[]

  createdAt: string
  updatedAt: string
}

/** 품목 공수 표준 — 공수는 하위 시험항목 합계로 자동 계산된다 */
export interface ProductWorkload {
  id: string

  productCode: string
  productName: string
  dosageForm: string | null

  /** 표준 소요일(일). 공수 합계로 계산하지 않는 별도 관리값. */
  standardLeadTimeDays: number

  /** 아래 4개는 testItems 합계(자동 계산). 직접 입력하지 않는다. */
  totalHumanMinutes: number
  totalEquipmentMinutes: number
  totalWaitingMinutes: number
  totalReviewMinutes: number

  testItemCount: number
  stepCount: number

  version: number
  effectiveFrom: string | null
  effectiveTo: string | null
  status: WorkloadStatus

  testItems: ProductTestItem[]

  createdAt: string
  createdBy: string | null
  updatedAt: string
  updatedBy: string | null
}

/** 버전 변경이력 */
export interface WorkloadVersion {
  id: string
  productWorkloadId: string
  version: number
  effectiveFrom: string | null
  changedBy: string | null
  changeNote: string | null
  createdAt: string
}

/** 실적 공수 — 표준공수 개선을 위한 실측 데이터 (현재는 수집 전) */
export interface WorkloadActual {
  id: string
  productWorkloadId: string | null
  testItemId: string | null
  workStepId: string | null

  workerId: string | null
  equipmentId: string | null

  startedAt: string | null
  completedAt: string | null

  actualMinutes: number
  standardMinutes: number
  varianceMinutes: number
  varianceRate: number | null

  productionLotNo: string | null
  recordedAt: string
}

/** 표준 vs 실제 비교 행 (집계 결과) */
export interface WorkloadVarianceRow {
  key: string
  label: string
  sampleCount: number
  standardMinutes: number
  actualAvgMinutes: number
  varianceMinutes: number
  varianceRate: number | null
}

// ─── 라벨 ────────────────────────────────────────────────────────────────────

export const WORKLOAD_TYPE_LABEL: Record<WorkloadType, string> = {
  HUMAN: '인적공수',
  EQUIPMENT: '기기공수',
  WAITING: '대기시간',
  REVIEW: '검토공수',
}

/** 표/칩처럼 좁은 자리에서 쓰는 짧은 라벨 */
export const WORKLOAD_TYPE_SHORT: Record<WorkloadType, string> = {
  HUMAN: '인적',
  EQUIPMENT: '기기',
  WAITING: '대기',
  REVIEW: '검토',
}

export const WORKLOAD_TYPES: WorkloadType[] = ['HUMAN', 'EQUIPMENT', 'WAITING', 'REVIEW']

export const DIFFICULTY_LABEL: Record<Difficulty, string> = {
  LOW: '낮음',
  NORMAL: '보통',
  HIGH: '높음',
  VERY_HIGH: '매우 높음',
}

export const DIFFICULTIES: Difficulty[] = ['LOW', 'NORMAL', 'HIGH', 'VERY_HIGH']

export const WORKLOAD_STATUS_LABEL: Record<WorkloadStatus, string> = {
  DRAFT: '작성중',
  ACTIVE: '사용중',
  INACTIVE: '미사용',
}

export const WORKLOAD_STATUSES: WorkloadStatus[] = ['DRAFT', 'ACTIVE', 'INACTIVE']

// ─── 상수 (향후 변경 가능하도록 분리) ─────────────────────────────────────────

/**
 * 표준 대비 실제 공수 편차 판정 임계값(%).
 * ±warn 이내 = 정상 / warn~danger = 주의 / danger 초과 = 위험.
 */
export const VARIANCE_THRESHOLD = { warn: 10, danger: 30 } as const

export type VarianceLevel = 'normal' | 'caution' | 'risk'

export const VARIANCE_LEVEL_LABEL: Record<VarianceLevel, string> = {
  normal: '정상',
  caution: '주의',
  risk: '위험',
}

/** 편차율(%) → 판정 등급 */
export function varianceLevel(rate: number | null): VarianceLevel | null {
  if (rate == null) return null
  const abs = Math.abs(rate)
  if (abs <= VARIANCE_THRESHOLD.warn) return 'normal'
  if (abs <= VARIANCE_THRESHOLD.danger) return 'caution'
  return 'risk'
}

/** 실적 비교 조회 기간 옵션 */
export const ACTUAL_PERIODS = [
  { id: '1m', label: '최근 1개월', months: 1 },
  { id: '3m', label: '최근 3개월', months: 3 },
  { id: '6m', label: '최근 6개월', months: 6 },
  { id: '1y', label: '최근 1년', months: 12 },
] as const

export type ActualPeriodId = (typeof ACTUAL_PERIODS)[number]['id']

/** 기기 종류 기본 후보 (DB 에 이미 쓰인 값과 합쳐서 제시) */
export const EQUIPMENT_TYPE_PRESETS = [
  'HPLC', 'GC', 'UV', 'IR', 'ICP', 'AAS', 'Dissolution', '경도계', '저울', 'pH Meter', '항온수조', '건조기',
]

/** 작업단계명 기본 후보 */
export const STEP_NAME_PRESETS = [
  '검체준비', '전처리', '시험수행', '기기세팅', '기기분석', '반응대기', '건조', '방냉', '결과처리', '시험검토', 'QA검토',
]

/** 필요 역량 기본 후보 — 향후 시험자 역량매트릭스와 연결 */
export const SKILL_PRESETS = ['HPLC', 'GC', 'ICP', 'UV', '중금속', '미생물', '이화학', '관능']
