/**
 * [BACKEND] 시험항목 단위 검토 (관리자)
 *
 * 검토 시작·완료·취소·재실시와 일괄 검토 시작/완료. 규칙 전문: intent/2026-09-15-item-level-review-spec.md
 *
 * 검사·항목 갱신·검토 이력·작업 단계 재도출·상태 이력은 전부 DB 함수(0048
 * item_review_action / item_review_bulk_action)가 **한 트랜잭션**으로 한다. 검토 기록이 남지 않으면
 * 검토도 없어야 하기 때문이다(GMP/ALCOA+). 이 서비스는
 *   사유 검사 → rpc → 오류 번역 → (커밋 뒤, 단계가 바뀐 경우만) 오더 동기화·슬랙·앱 알림
 * 만 한다.
 *
 * ⚠️ 함수가 없을 때(0048 미적용) 여러 호출로 나눈 비원자 경로로 폴백하지 않는다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import {
  ITEM_REVIEW_ACTION_LABEL,
  isItemReviewAction,
  isItemReviewBulkAction,
  reviewActionNeedsReason,
  type ItemReviewAction,
  type ItemReviewBulkAction,
} from '@shared/qc-status'
import {
  notifyStageRecomputed,
  translateItemReviewRpcError,
  type StageRecomputeResult,
} from '@backend/services/qcJobs'

export interface ItemReviewStepResult {
  itemId: string
  testItemName: string
  action: ItemReviewAction
  reviewStatusBefore: string
  reviewStatusAfter: string
}

export interface ItemReviewResult extends ItemReviewStepResult {
  jobId: string
  /** 작업 단계 재도출 결과 — changed 가 true 면 작업 단계가 바뀌었다 */
  stage: StageRecomputeResult
}

export interface BulkReviewResult {
  jobId: string
  action: ItemReviewBulkAction
  /** 처리한 시험항목 수 */
  count: number
  items: ItemReviewStepResult[]
  stage: StageRecomputeResult
}

/** 사유 검사 — spec §3.2 조건 0 (함수도 같은 검사를 한 번 더 한다) */
function checkReason(action: ItemReviewAction, reason: unknown): string | null {
  if (!reviewActionNeedsReason(action)) return null
  const label = ITEM_REVIEW_ACTION_LABEL[action]
  if (typeof reason !== 'string') throw new Error(`${label} 사유를 입력해 주세요.`)
  const trimmed = reason.trim()
  if (trimmed.length < 2) throw new Error(`${label} 사유를 2자 이상 입력해 주세요.`)
  return trimmed
}

/**
 * 시험항목 1건 검토 동작.
 *
 * @param jobId  URL 의 작업 id. 항목이 그 작업에 속하지 않으면 거절한다(화면이 보던 작업과 다른 항목을 건드리지 않게).
 *               최종 판정(작업 잠금 뒤 항목의 작업이 그대로인지)은 함수가 한다.
 * @param userSub 로그인 토큰의 사용자 id — 함수가 이 값을 믿으므로 실행 권한은 service_role 뿐이다.
 */
export async function reviewJobItem(
  jobId: string, itemId: string, userSub: string, action: unknown, reason: unknown,
): Promise<ItemReviewResult> {
  if (!isItemReviewAction(action)) throw new Error('알 수 없는 검토 동작입니다.')
  const note = checkReason(action, reason)

  const { data: owner, error: ownerErr } = await supabaseAdmin
    .from('qc_job_items').select('qc_job_id').eq('id', itemId).maybeSingle()
  if (ownerErr) throw translateItemReviewRpcError(ownerErr)
  if (!owner || (owner.qc_job_id as string) !== jobId) throw new Error('시험항목을 찾을 수 없습니다.')

  const { data, error } = await supabaseAdmin.rpc('item_review_action', {
    p_item_id: itemId, p_user_id: userSub, p_action: action, p_reason: note,
  })
  if (error) throw translateItemReviewRpcError(error)

  const res = data as ItemReviewResult
  // ── 여기부터는 커밋 뒤다. 알림 실패는 검토를 되돌리지 않는다 ──
  await notifyStageRecomputed(res.stage)
  return res
}

/**
 * 일괄 검토 — 완료 항목 전체 검토 시작 / 검토 중 항목 전체 검토 완료.
 * 한 트랜잭션, 전부 성공 아니면 전부 실패(F1-4). 대상 0건이면 "처리할 시험항목이 없습니다."
 */
export async function bulkReviewJobItems(
  jobId: string, userSub: string, action: unknown,
): Promise<BulkReviewResult> {
  if (!isItemReviewBulkAction(action)) throw new Error('알 수 없는 검토 동작입니다.')

  const { data, error } = await supabaseAdmin.rpc('item_review_bulk_action', {
    p_job_id: jobId, p_user_id: userSub, p_action: action,
  })
  if (error) throw translateItemReviewRpcError(error, '작업을 찾을 수 없습니다.')

  const res = data as BulkReviewResult
  await notifyStageRecomputed(res.stage)
  return res
}
