/**
 * QC 작업 진행 단계 — 단일 기준(single source of truth).
 *
 * qc_jobs.status / pct_orders.status 에 저장되는 한글 값을 여기서만 정의한다.
 * 화면·서비스마다 문자열을 따로 적지 말고 이 파일을 import 한다.
 *
 * 단계 흐름
 *   진행중 ─(자동: 전 시험항목 완료)─▶ 검토전 ─[검토 시작]─▶ 검토중 ─[검토 완료]─▶ 승인전 ─[승인]─▶ 승인완료
 *
 * - '검토 완료'와 '승인 대기'는 같은 시점이라 `승인전` 하나로 저장한다.
 * - 수동 전이([...] 버튼)는 관리자만 가능하다.
 * - '지연'은 단계가 아니라 납기 경과 표시라 이 흐름과 별개로 유지한다.
 */

// ─── 단계 ────────────────────────────────────────────────────────────────────
export const JOB_STAGES = ['진행중', '검토전', '검토중', '승인전', '승인완료'] as const
export type JobStage = (typeof JOB_STAGES)[number]

/** 단계가 아닌 부가 상태 — 납기 경과 표시 */
export const DELAYED_STATUS = '지연'
/** 작업 시작 전(오더 전용) */
export const PENDING_STATUS = '대기'
/** 오더 삭제(소프트) */
export const DELETED_STATUS = '삭제'

/** 작업(qc_jobs)에 올 수 있는 모든 상태 */
export const JOB_STATUSES: readonly string[] = [...JOB_STAGES, DELAYED_STATUS]
/** 오더(pct_orders)에 올 수 있는 모든 상태 */
export const ORDER_STATUSES: readonly string[] = [
  PENDING_STATUS, ...JOB_STAGES, DELAYED_STATUS, DELETED_STATUS,
]

export function isJobStage(v: string | null | undefined): v is JobStage {
  return v != null && (JOB_STAGES as readonly string[]).includes(v)
}

// ─── 전이 ────────────────────────────────────────────────────────────────────
/** 현재 단계 → 다음 단계 (마지막 단계는 null) */
export const NEXT_STAGE: Record<JobStage, JobStage | null> = {
  진행중:   '검토전',
  검토전:   '검토중',
  검토중:   '승인전',
  승인전:   '승인완료',
  승인완료: null,
}

/**
 * 다음 단계로 넘기는 버튼 라벨. null 이면 수동 전이가 없다.
 * '진행중 → 검토전'은 시험항목이 모두 완료될 때 서버가 자동으로 넘긴다.
 */
export const STAGE_ACTION_LABEL: Record<JobStage, string | null> = {
  진행중:   null,
  검토전:   '검토 시작',
  검토중:   '검토 완료',
  승인전:   '승인',
  승인완료: null,
}

/** 관리자가 버튼으로 넘길 수 있는 단계인가 */
export function canAdvanceByAdmin(stage: string): stage is JobStage {
  return isJobStage(stage) && STAGE_ACTION_LABEL[stage] !== null
}

/** 종결(더 진행할 것이 없는) 단계 */
export const CLOSED_STAGE: JobStage = '승인완료'

/** 아직 끝나지 않은 상태 — 공수/부하 집계에 포함한다 */
export const OPEN_STATUSES: ReadonlySet<string> = new Set<string>([
  PENDING_STATUS, '진행중', '검토전', '검토중', '승인전', DELAYED_STATUS,
])

/** 작업자가 손에 들고 있는(활성) 작업 상태 */
export const ACTIVE_JOB_STATUSES: ReadonlySet<string> = new Set<string>([
  '진행중', '검토전', '검토중', '승인전', DELAYED_STATUS,
])

/** 구글시트 재적재로 덮어쓰면 안 되는 상태 */
export const LOCKED_STATUSES: ReadonlySet<string> = new Set<string>([
  ...JOB_STAGES, DELAYED_STATUS, 'LOCKED', 'IN_PROGRESS', 'REVIEW', 'COMPLETED',
])

// ─── 표시 ────────────────────────────────────────────────────────────────────
/**
 * 단계별 배지 색.
 * 상태 팔레트는 "색 자체가 의미"인 곳이라 브랜드 indigo 통일 규칙의 예외다(AGENTS.md).
 * 대기 성격(검토전·승인전)은 따뜻한 색, 진행은 파랑, 종결은 초록으로 읽히게 둔다.
 */
export interface StageStyle { dot: string; cls: string }

export const STAGE_STYLE: Record<string, StageStyle> = {
  진행중:   { dot: 'bg-violet-500',  cls: 'border-violet-200 text-violet-700 bg-violet-50' },
  검토전:   { dot: 'bg-amber-500',   cls: 'border-amber-200 text-amber-700 bg-amber-50' },
  검토중:   { dot: 'bg-blue-500',    cls: 'border-blue-200 text-blue-700 bg-blue-50' },
  승인전:   { dot: 'bg-teal-500',    cls: 'border-teal-200 text-teal-700 bg-teal-50' },
  승인완료: { dot: 'bg-emerald-500', cls: 'border-emerald-200 text-emerald-700 bg-emerald-50' },
  지연:     { dot: 'bg-red-500',     cls: 'border-red-200 text-red-700 bg-red-50' },
  대기:     { dot: 'bg-slate-400',   cls: 'border-slate-200 text-slate-600 bg-slate-50' },
  삭제:     { dot: 'bg-slate-300',   cls: 'border-slate-200 text-slate-400 bg-slate-50' },
}

export function stageStyle(status: string): StageStyle {
  return STAGE_STYLE[status] ?? { dot: 'bg-muted-foreground', cls: '' }
}
