// ─────────────────────────────────────────────────────────────────────────────
// PQM (Product Quality Management) 도메인 타입
// supabase/migrations/0004_pqm_schema.sql 와 1:1 대응
// ─────────────────────────────────────────────────────────────────────────────

// ─── 공용 enum/유니온 ────────────────────────────────────────────────────────
export type Difficulty = 'Low' | 'Medium' | 'High'

export type BatchStatus =
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'ON_HOLD'
  | 'CANCELLED'

export type AssignmentStatus =
  | 'PLANNED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'ON_HOLD'
  | 'CANCELLED'
  | 'FAIL'

/** Y: 가능 · N: 불가 · X: 미평가 · O: 우수 */
export type ProficiencyLevel = 'Y' | 'N' | 'X' | 'O'

export type ProductType = '포장제품' | '상품' | '의약외품' | (string & {})

// ─── 마스터 테이블 ───────────────────────────────────────────────────────────
export interface ProductCategory {
  id: string
  code: string
  name: string
  sort_order: number
  created_at: string
}

export interface ProductClassification {
  id: string
  code: string
  name: string
  sort_order: number
  created_at: string
}

export interface DosageForm {
  id: string
  code: string
  name: string
  sort_order: number
  created_at: string
}

export interface TestCapability {
  id: string
  code: string
  name: string
  sort_order: number
  created_at: string
}

// ─── 품목 마스터 ─────────────────────────────────────────────────────────────
export interface Product {
  id: string
  product_code: string
  name: string
  name_alt: string | null
  product_type: ProductType | null
  unit: string | null
  abbreviation: string | null
  difficulty: Difficulty | null
  category_id: string | null
  classification_id: string | null
  package_spec: string | null
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

// ─── 생산 배치 ───────────────────────────────────────────────────────────────
export interface ProductionBatch {
  id: string
  product_id: string
  spec: string | null
  batch_no: string
  dosage_form_id: string | null
  packaging_planned_date: string | null     // ISO yyyy-mm-dd
  record_review_deadline: string | null
  qc_planned_completion_date: string | null
  qc_actual_completion_date: string | null
  status: BatchStatus
  notes: string | null
  created_at: string
  updated_at: string
}

// ─── 시험 항목 ───────────────────────────────────────────────────────────────
export interface TestItem {
  id: string
  name: string
  estimated_hours: number | null
  requires_duo: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface ProductTestItem {
  product_id: string
  test_item_id: string
  is_mandatory: boolean
  sequence_order: number
  created_at: string
}

// ─── 시험자 ──────────────────────────────────────────────────────────────────
export interface Tester {
  id: string
  employee_no: string
  name: string
  can_solo: boolean
  can_duo: boolean
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface TesterCapability {
  tester_id: string
  capability_id: string
  proficiency_level: ProficiencyLevel
  updated_at: string
}

// ─── 평균 공수 ───────────────────────────────────────────────────────────────
export interface ProductManhour {
  id: string
  product_id: string
  package_unit: string
  avg_hours: number
  created_at: string
  updated_at: string
}

// ─── 배치 시험 배정 ──────────────────────────────────────────────────────────
export interface BatchTestAssignment {
  id: string
  batch_id: string
  test_item_id: string
  primary_tester_id: string | null
  secondary_tester_id: string | null
  status: AssignmentStatus
  result: string | null
  scheduled_start_at: string | null         // ISO timestamptz
  scheduled_end_at: string | null
  actual_start_at: string | null
  actual_end_at: string | null
  estimated_hours: number | null
  notes: string | null
  created_at: string
  updated_at: string
}

// ─────────────────────────────────────────────────────────────────────────────
// API 응답용 파생 타입
// ─────────────────────────────────────────────────────────────────────────────

/** 배치 리스트/카드용 요약. 배치 + 품목 정보 + 진행률 + D-day */
export interface BatchSummary {
  id: string
  batch_no: string
  product_id: string
  product_code: string
  product_name: string
  spec: string | null
  dosage_form_name: string | null
  packaging_planned_date: string | null
  record_review_deadline: string | null
  qc_planned_completion_date: string | null
  qc_actual_completion_date: string | null
  status: BatchStatus
  total_assignments: number
  in_progress_count: number
  completed_count: number
  /** qc_planned_completion_date 기준 남은 일수. 음수면 지연 */
  d_day: number | null
  /** 0.0 ~ 1.0 */
  progress_ratio: number
}

/** 시험자 추천 응답 (배치 × 시험항목에 대해) */
export interface TesterRecommendation {
  tester_id: string
  employee_no: string
  name: string
  /** 매칭된 역량 코드 목록 */
  matched_capabilities: string[]
  /** 해당 역량 평균 숙련도 점수 (O=2, Y=1, X/N=0) */
  proficiency_score: number
  /** 향후 7일 내 배정 시간(시간 단위) */
  scheduled_load_hours: number
  /** Solo / Duo 가능 여부 */
  can_solo: boolean
  can_duo: boolean
  /** 추천 점수 (역량 + 부하 균형) */
  recommendation_score: number
  /** 추천 사유 텍스트 (UI 표시용) */
  reason: string
}

/** 시험자 역량 행렬을 한 줄로 펼친 형태 (UI 그리드용) */
export interface TesterCapabilityRow {
  tester_id: string
  employee_no: string
  tester_name: string
  capabilities: Record<string, ProficiencyLevel>  // key = capability.code
}
