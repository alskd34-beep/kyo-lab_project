/**
 * [SHARED] 부업무(시험 외 업무) — 프런트·백엔드 공통 타입과 상수.
 *
 * 스키마: supabase/migrations/0041_side_work.sql
 *
 * 소요는 **분(minutes)** 하나로만 다룬다. 시험업무 실적(qc_job_items.elapsed_minutes)이
 * 분이라, 부업무를 '일'이나 '반일'로 재면 두 값을 나란히 놓는 순간 비교가 깨진다.
 * 사람이 쓰기 편하도록 프리셋 버튼을 두되, 저장되는 값은 언제나 분이다.
 */

// ─── 분류 ─────────────────────────────────────────────────────────────────────
export interface SideWorkCategory {
  id: string
  code: string
  name: string
  sortOrder: number
  isActive: boolean
}

// ─── 기록 ─────────────────────────────────────────────────────────────────────
export interface SideWorkLog {
  id: string
  testerId: string
  /** 시험자 이름 — 목록 표시용(서비스가 join 해서 채운다) */
  testerName: string | null
  /** 입력한 계정. 감사 추적용이며 집계 키가 아니다 */
  userId: string | null
  workDate: string
  categoryId: string
  categoryName: string
  title: string
  minutes: number
  note: string | null
  createdAt: string
}

export interface SideWorkLogInput {
  /** 관리자만 남을 지정할 수 있다. 시험자는 무시되고 본인으로 저장된다 */
  testerId?: string
  workDate: string
  categoryId: string
  title: string
  minutes: number
  note?: string | null
}

// ─── 입력 프리셋 ──────────────────────────────────────────────────────────────
/**
 * 한 번에 눌러 넣는 소요시간. 시험자가 하루에 여러 건을 남기는 화면이라
 * 숫자 입력을 매번 시키면 기록 자체를 안 하게 된다.
 * 반일(4시간)·종일(8시간)은 이 회사 근무시간(8시간) 기준이다.
 */
export const MINUTE_PRESETS: readonly { minutes: number; label: string }[] = [
  { minutes: 10,  label: '10분' },
  { minutes: 30,  label: '30분' },
  { minutes: 60,  label: '1시간' },
  { minutes: 120, label: '2시간' },
  { minutes: 240, label: '반일' },
  { minutes: 480, label: '종일' },
]

/** 하루 근무 분 — 가동률·부업무 비중을 '몇 일치'로 환산할 때의 분모 */
export const WORK_MINUTES_PER_DAY = 480

/** 한 건의 상한(하루). DB check 제약과 같은 값이라 화면에서 먼저 막는다 */
export const MAX_MINUTES_PER_LOG = 1440

// ─── 운영 결과 리포트 ─────────────────────────────────────────────────────────
/**
 * 시험업무와 부업무를 같은 기간·같은 자(분)로 나란히 놓은 집계.
 *
 * 시험업무 실적에는 두 얼굴이 있고 둘 다 필요하다.
 *   - testMinutes  : 실제로 시험항목에 쓴 시간(qc_job_items.elapsed_minutes 합).
 *                    "얼마나 걸렸나"에 답한다.
 *   - testItems    : 진행한 시험항목 수. "얼마나 많이 쳤나"에 답한다.
 * 시간만 보면 오래 걸리는 항목 하나가 여러 건을 이기고, 건수만 보면 그 반대다.
 */
export interface OperationReportTesterRow {
  testerId: string
  name: string
  /** 완료(승인완료)된 QC 작업 수 */
  completedJobs: number
  /** 진행(완료 처리)한 시험항목 수 */
  testItems: number
  /**
   * 이 시험자가 시험에 **실제로 쓴** 분.
   *
   * 항목 소요의 단순 합이 아니라 구간 합집합이다. 동시분석하면 여러 항목이 같은 시계
   * 시간을 공유하는데 항목마다 자기 구간을 재므로, 단순 합은 그 시간을 여러 번 센다
   * (실측: 3배치 동시 시 3.00배). 사람이 하루에 쓸 수 있는 시간은 하나뿐이다.
   */
  testMinutes: number
  /** 부업무 분 합계 */
  sideMinutes: number
  /** 부업무 기록 건수 */
  sideCount: number
  /** 전체(시험+부업무) 중 부업무 비중 % — 기록이 하나도 없으면 null */
  sideRatio: number | null
  /**
   * 기록 시간 합계 ÷ 기간 가용 근무시간 %.
   * 100%를 넘으면 초과근무이거나 기록이 겹친 것이다 — 숨기지 않고 그대로 보여준다.
   */
  coverage: number | null
}

export interface OperationReportCategoryRow {
  categoryId: string
  categoryName: string
  minutes: number
  count: number
  /** 부업무 총량 중 이 분류의 비중 % */
  ratio: number
}

export interface OperationReportItemRow {
  testItemName: string
  count: number
  minutes: number
  avgMinutes: number
}

export interface OperationReportDailyRow {
  date: string
  testMinutes: number
  sideMinutes: number
}

export interface OperationReport {
  period: { from: string; to: string; workingDays: number }
  totals: {
    testers: number
    completedJobs: number
    testItems: number
    testMinutes: number
    sideMinutes: number
    sideCount: number
    /** 전체 중 부업무 비중 % — 기록이 없으면 null */
    sideRatio: number | null
  }
  byTester: OperationReportTesterRow[]
  byCategory: OperationReportCategoryRow[]
  byTestItem: OperationReportItemRow[]
  daily: OperationReportDailyRow[]
  /**
   * 동시분석 효과 — 단일 분석 대비 얼마나 줄었는가.
   *
   * 계획(공수, 일)과 실적(소요, 분)을 따로 둔다. 한 축으로 뭉치면 "계획이 좋았는지" 와
   * "실행이 좋았는지" 를 구분할 수 없다. 절감은 저장하지 않고 매번 계산한다(파생값).
   */
  concurrent: {
    groups: number
    groupsWithActual: number
    /** 계획 — 따로 했을 때 총 공수(일) */
    soloDays: number
    /** 계획 — 함께 했을 때 공수(일) */
    concurrentDays: number
    savedDays: number
    savedDaysRatio: number
    /** 실적 — 항목 소요의 단순 합(분) */
    sumMinutes: number
    /** 실적 — 실제로 쓴 시간(분) */
    spanMinutes: number
    savedMinutes: number
    savedMinutesRatio: number
    /** 공수 미등록으로 계획 계산에서 빠진 멤버 수 — 값의 신뢰도를 함께 말한다 */
    workdaysMissing: number
    /** 절감이 큰 순 상위 그룹 */
    top: Array<{
      groupKey: string
      label: string | null
      source: 'auto' | 'manual'
      members: number
      productName: string
      batchNos: string[]
      testerNames: string[]
      savedDays: number
      savedMinutes: number
    }>
  }
}
