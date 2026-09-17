/**
 * [SHARED] 동시분석 그룹 단계 일괄 진행 — 서버 응답·작업 상세의 그룹 요약 타입.
 * 규칙 전문: intent/2026-09-15-group-stage-progress-spec.md
 */

/** 그룹 조작에서 처리한 배치(검토는 항목마다 1원소, 승인은 작업마다 1원소) */
export interface GroupStageProcessed {
  jobId: string
  orderId: string
  qcNo: string
  batchNo: string
  itemId?: string
  testItemName?: string
  reviewStatusBefore?: string
  reviewStatusAfter?: string
}

/** 조건이 맞지 않아 건너뛴 배치와 사유(spec §3·§6 전문) */
export interface GroupStageSkipped {
  jobId: string
  qcNo: string | null
  batchNo: string | null
  testItemName?: string | null
  reason: string
}

export interface GroupReviewResult {
  groupId: string
  action: string
  /** 항목 단위면 항목명, 일괄이면 null */
  testItemName: string | null
  /** 처리한 시험항목 수 */
  count: number
  processed: GroupStageProcessed[]
  skipped: GroupStageSkipped[]
}

export interface GroupApproveResult {
  groupId: string
  processed: GroupStageProcessed[]
  skipped: GroupStageSkipped[]
}

/** 그룹 멤버 작업의 항목 검토 요약 — 확인 모달의 대상 배치 계산(보조 판정)에 쓴다 */
export interface GroupMemberItem {
  testItemName: string
  status: string
  reviewStatus: string
}

/** 작업 상세의 "동시분석 N건" 한 줄. 작업을 시작하지 않은 오더는 jobId·qcNo 가 null */
export interface GroupMember {
  orderId: string
  jobId: string | null
  qcNo: string | null
  productName: string
  batchNo: string
  /** 작업 단계. 미시작 오더는 오더 상태 */
  status: string
  testerName: string | null
  items: GroupMemberItem[]
}

export interface JobGroupSummary {
  groupId: string
  groupLabel: string | null
  /** 그룹의 오더 수(= "동시분석 N건") */
  orderCount: number
  /** 시작된 그룹 작업들의 시험항목 집합이 완전히 같은지(전파의 서버 보조 표시) */
  sameTestItemSet: boolean
  members: GroupMember[]
}
