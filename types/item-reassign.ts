/**
 * 진행 중 시험항목 담당자 변경(F2) — 서버·화면이 함께 쓰는 상수·타입·문구.
 *
 * 규칙 전문: intent/2026-09-15-in-progress-item-reassign-spec.md (감독 결정 F2-1~F2-8)
 *
 * 병렬 배정 오더에서 아직 손대지 않은(시작·완료·검토 기록이 없는) 시험항목 하나를 같은 오더의 다른
 * 담당자(슬롯)에게 넘긴다. 최종 판정은 DB 함수 reassign_job_item(0050)이 한다 — 여기의 값은 화면 보조 판정용이다.
 */

import { assigneeSlotLabel } from '@shared/assignment'

/** 사유 선택지(F2-8) — 시작 취소 모달과 같은 형식. 마지막 `기타` 는 직접 입력(2자 이상) */
export const ITEM_REASSIGN_REASON_OTHER = '기타'
export const ITEM_REASSIGN_REASONS: readonly string[] = ['업무 분담 조정', '담당자 부재', ITEM_REASSIGN_REASON_OTHER]

/** 사유 최소 길이(앞뒤 공백 제외) — SQL 함수의 2 와 짝 */
export const ITEM_REASSIGN_REASON_MIN = 2

/**
 * 이동 방식(F2-1) — A = 보내는 슬롯, B = 받는 슬롯, "작업" = 그 담당자의 이 오더 qc_jobs 행
 *  - moved    : A 작업 有 · B 작업 有 → 항목 행을 B 작업으로 이동
 *  - released : A 작업 有 · B 작업 無 → A 작업에서 항목 행 삭제(B 가 작업 시작 때 포함)
 *  - attached : A 작업 無 · B 작업 有 → B 작업에 대기 항목 추가
 *  - snapshot : A 작업 無 · B 작업 無 → 배분(스냅샷)만 변경
 */
export type ItemReassignMode = 'moved' | 'released' | 'attached' | 'snapshot'

/** recompute_job_stage(0048) 반환 — 작업 단계 재도출 결과 */
export interface ItemReassignStage {
  jobId: string
  orderId: string
  qcNo: string
  from: string
  to: string
  changed: boolean
  note?: string
}

/** 보내는 쪽·받는 쪽 한 명 */
export interface ItemReassignParty {
  slot: number
  testerId: string
  testerName: string | null
  /** 이 오더에서 그 담당자의 작업 — 아직 시작 전이면 null */
  jobId: string | null
  qcNo: string | null
}

/** reassign_job_item 반환값 */
export interface ItemReassignResult {
  orderId: string
  productName: string | null
  batchNo: string | null
  testItemName: string
  mode: ItemReassignMode
  from: ItemReassignParty
  to: ItemReassignParty & { /** 받는 사람 알림 대상 계정(없으면 null) */ userId: string | null }
  stages: { from: ItemReassignStage | null; to: ItemReassignStage | null }
}

/** 조회 응답 — 받는 사람 후보 한 명 */
export interface ItemReassignAssignee {
  slot: number
  testerId: string
  testerName: string | null
  isActive: boolean
  /** 조회한 시험자 본인인가(관리자 화면에서는 항상 false) */
  isMe: boolean
  jobId: string | null
  qcNo: string | null
  jobStatus: string | null
  /** 이 사람이 항목을 받을 수 없는 이유 — 받을 수 있으면 null */
  receiveBlockReason: string | null
}

/** 조회 응답 — 시험항목 한 줄의 현재 상태 */
export interface ItemReassignItemState {
  testItemName: string
  sequenceOrder: number
  /** 배분(스냅샷)상 담당자 번호 */
  slot: number
  isExcluded: boolean
  /** 체크리스트 행의 시험 상태 — 담당자 작업에 행이 없으면 null */
  itemStatus: string | null
  /** 이 항목을 넘길 수 없는 이유 — 넘길 수 있으면 null (받는 사람별 사유는 assignees 쪽) */
  blockReason: string | null
}

/** GET /api/pct-orders/[id]/test-items/reassign 응답 */
export interface ItemReassignContext {
  orderId: string
  productName: string
  batchNo: string
  orderStatus: string
  /** 오더에 작업이 1건이라도 있는가 — 없으면 이 경로가 아니라 일괄 배분을 쓴다 */
  hasJobs: boolean
  /** 조회자가 관리자인가 */
  viewerIsAdmin: boolean
  /** 조회한 시험자의 슬롯 — 관리자이거나 담당자가 아니면 null */
  viewerSlot: number | null
  assignees: ItemReassignAssignee[]
  items: ItemReassignItemState[]
}

/** `담당자 N · 이름` */
export function reassignPartyLabel(p: { slot: number; testerName: string | null }): string {
  return p.testerName ? `${assigneeSlotLabel(p.slot)} · ${p.testerName}` : assigneeSlotLabel(p.slot)
}

/**
 * 성공 문구(spec §8). viewerSlot 을 주면(시험자) 내 작업 단계가 바뀐 경우 한 문장을 덧붙인다.
 */
export function reassignSuccessMessage(res: ItemReassignResult, viewerSlot: number | null = null): string {
  const to = res.to.testerName ?? assigneeSlotLabel(res.to.slot)
  const head = res.to.jobId
    ? `"${res.testItemName}" 을(를) ${to}님(QC ${res.to.qcNo})에게 넘겼습니다.`
    : `"${res.testItemName}" 을(를) ${to}님에게 넘겼습니다. ${to}님이 작업을 시작할 때 포함됩니다.`
  const mine = viewerSlot === res.from.slot ? res.stages.from : null
  if (mine?.changed) return `${head} 내 작업이 "${mine.to}" 단계로 바뀌었습니다.`
  const changed = [res.stages.from, res.stages.to].filter((s): s is ItemReassignStage => !!s?.changed)
  if (viewerSlot === null && changed.length > 0) {
    return `${head} ${changed.map(s => `QC ${s.qcNo} 작업이 "${s.to}" 단계로 바뀌었습니다.`).join(' ')}`
  }
  return head
}
