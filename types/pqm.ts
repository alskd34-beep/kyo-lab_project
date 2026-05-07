export interface Product {
  id: number
  product_code: string
  product_name: string
  product_name2: string | null
  unit: string | null
  category: string | null
  drug_class: string | null
  package_spec: string | null
  created_at: string
}

export interface Tester {
  id: number
  seq: number
  name: string
  employee_no: string
  solo: boolean
  duo: boolean
  hplc: boolean
  gc: boolean
  gcms: boolean
  lcms_tq: boolean
  uhplc: boolean
  shimadzu_hplc: boolean
  gcms_tq: boolean
  ftir: boolean
  uv_vis: boolean
  toc: boolean
  dissolution_34: boolean
  dissolution_5: boolean
  potentiometric: boolean
  karl_fischer: boolean
  conductivity: boolean
  hptlc: boolean
  rdp: boolean
  fluorescence: boolean
  icp_ms: boolean
  gc_hss: boolean
  created_at: string
}

export interface ProductTestItem {
  id: number
  product_name: string
  test_item: string
  created_at: string
}

export type BatchStatus = 'pending' | 'in_progress' | 'completed' | 'on_hold' | 'cancelled'

export interface ProductionBatch {
  id: number
  product_code: string
  product_name: string
  spec: string | null
  batch_no: string
  dosage_form: string | null
  process_order: string | null
  validation_type: string | null
  packaging_date: string | null
  record_review_deadline: string | null
  qc_completion_deadline: string | null
  is_urgent: boolean
  note: string | null
  status: BatchStatus
  created_at: string
}

export interface BatchSummary extends ProductionBatch {
  dDayRecord: number | null
  dDayQc: number | null
}

export interface DashboardStats {
  totalBatches: number
  pending: number
  inProgress: number
  completed: number
  dueSoon7: number
  dueSoon3: number
  overdueCount: number
}

export interface TesterWithLoad extends Tester {
  todayAssignments?: number
}
