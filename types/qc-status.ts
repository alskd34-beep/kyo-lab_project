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

/** 각 단계의 이름 있는 상수 — 서비스·화면에서 문자열을 직접 적지 말고 이 상수를 쓴다. */
export const IN_PROGRESS_STATUS:     JobStage = '진행중'
export const REVIEW_READY_STATUS:    JobStage = '검토전'
export const REVIEWING_STATUS:       JobStage = '검토중'
export const APPROVAL_READY_STATUS:  JobStage = '승인전'
export const APPROVED_STATUS:        JobStage = '승인완료'

/** 단계가 아닌 부가 상태 — 납기 경과 표시 */
export const DELAYED_STATUS = '지연'
/** 작업 시작 전(오더 전용) */
export const PENDING_STATUS = '대기'
/** 오더 삭제(소프트) */
export const DELETED_STATUS = '삭제'

/**
 * 담당자가 없을 때 화면에 쓰는 라벨. **상태값이 아니다** — 미배정 여부는
 * `assignee_tester_id IS NULL` 로 판단하고, status 에는 저장하지 않는다.
 */
export const UNASSIGNED_LABEL = '미배정'

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
 * 단계별 배지 색 — 브랜드 파랑 한 계열의 **램프**.
 *
 * 예전에는 단계마다 다른 색조(보라·앰버·파랑·틸·초록)를 썼다. 색이 다 다르니
 * 어느 쪽이 더 진행된 단계인지 색만 보고는 알 수 없었고, 화면은 알록달록했다.
 * 이제 진행할수록 진해지는 파랑 하나로 두어 **색의 농도 = 진척도** 가 되게 한다.
 * (단계 막대 JobStageTrack 이 같은 램프를 CSS 그라데이션으로 잇는다)
 *
 * 단계가 아닌 상태는 램프 밖에 둔다 — 지연은 경고라 빨강, 대기·삭제는 회색.
 */
export interface StageStyle { dot: string; cls: string }

/*
 * `cls` 는 밝은 테마의 연한 칩(옅은 배경 + 진한 글자)이라 다크에서 그대로 두면
 * 어두운 바탕 위에 흰 알약처럼 떠 보인다. 그래서 각 단계마다 `dark:` 짝을 함께 둔다.
 * 규칙은 명도를 뒤집는 것뿐이다 — 배경 50->950 / 100->900, 글자 600~700->300,
 * 800~900->200, 테두리 200->800 / 300->700 / 400->600. 색상(hue)은 건드리지 않는다.
 * `dot` 은 솔리드(500대)라 두 테마에서 그대로 읽힌다.
 * 중립인 대기·삭제는 파랑이 아니므로 시맨틱 토큰을 쓴다.
 */
export const STAGE_STYLE: Record<string, StageStyle> = {
  진행중:   { dot: 'bg-blue-400',  cls: 'border-blue-200 text-blue-600 bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:bg-blue-950' },
  검토전:   { dot: 'bg-blue-500',  cls: 'border-blue-200 text-blue-700 bg-blue-50 dark:border-blue-800 dark:text-blue-300 dark:bg-blue-950' },
  검토중:   { dot: 'bg-blue-600',  cls: 'border-blue-300 text-blue-700 bg-blue-50 dark:border-blue-700 dark:text-blue-300 dark:bg-blue-950' },
  승인전:   { dot: 'bg-blue-700',  cls: 'border-blue-300 text-blue-800 bg-blue-100/60 dark:border-blue-700 dark:text-blue-200 dark:bg-blue-900/40' },
  승인완료: { dot: 'bg-blue-800',  cls: 'border-blue-400 text-blue-900 bg-blue-100 dark:border-blue-600 dark:text-blue-200 dark:bg-blue-900/60' },
  지연:     { dot: 'bg-red-500',     cls: 'border-red-200 text-red-700 bg-red-50 dark:border-red-800 dark:text-red-300 dark:bg-red-950' },
  대기:     { dot: 'bg-slate-400',   cls: 'border-slate-200 text-slate-600 bg-slate-50 dark:border-border dark:text-muted-foreground dark:bg-muted' },
  삭제:     { dot: 'bg-slate-300',   cls: 'border-slate-200 text-slate-400 bg-slate-50 dark:border-border dark:text-muted-foreground/70 dark:bg-muted/60' },
}

export function stageStyle(status: string): StageStyle {
  return STAGE_STYLE[status] ?? { dot: 'bg-muted-foreground', cls: '' }
}
