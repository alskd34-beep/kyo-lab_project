/**
 * [BACKEND] 동시분석 그룹 단계 일괄 진행 (관리자)
 *
 * 물리적으로 한 번 수행하는 항목 진행만 짝 배치에 전파한다. 결과 판정·검토·승인은 배치별이다.
 * 규칙 전문: intent/2026-09-15-group-stage-progress-spec.md
 *
 *  - 그룹 검토(항목 단위·일괄): DB 함수(0051 group_item_review_action / group_item_review_bulk_action) 한 번 =
 *    한 트랜잭션. 조건이 맞지 않는 배치는 건너뛰고 사유를 돌려준다. 이 서비스는
 *      rpc → 오류 번역 → (커밋 뒤) 단계가 바뀐 작업마다 오더 동기화·슬랙·앱 알림
 *    만 한다. 함수가 없으면(0051 미적용) 비원자 폴백 없이 설치 안내로 거절한다.
 *  - 그룹 승인: **원자적이지 않다.** 작업마다 기존 승인 경로(advanceJobStage — 조건부 update, 전 항목 검토 완료 확인,
 *    오더 동기화·이력·알림)를 차례로 부른다. 조건 불충족 배치는 건너뛴다.
 *
 * 개별 경로에서 전파하지 않는 것: 결과 판정, 검토 시작·완료·취소·재실시, 승인 단계·승인,
 * 담당자 상태 변경, 관리자 직접 변경. 그룹 검토·그룹 승인 버튼은 명시적 일괄 조작으로 별도 유지한다.
 * GMP: 검토 이력·단계 이력은 배치(작업)·항목마다 따로 남는다. 묶이는 것은 조작뿐이다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { rpcWithDeadlockRetry, type RpcError } from '@backend/lib/rpcRetry'
import {
  APPROVAL_READY_STATUS, CLOSED_STAGE, isItemReviewBulkAction,
  ITEM_CLEARED, ITEM_IN_PROGRESS, ITEM_PENDING, ITEM_REVIEW_NONE,
  ITEM_EDITABLE_JOB_STATUSES,
  type ItemReviewBulkAction,
} from '@shared/qc-status'
import type {
  GroupApproveResult, GroupReviewResult, GroupStageProcessed, GroupStageSkipped,
} from '@shared/qc-group-stage'
import {
  advanceJobStage, notifyStageRecomputed, translateItemReviewRpcError, type StageRecomputeResult,
} from '@backend/services/qcJobs'
import { getGroupTestItemSetIdentity } from '@backend/services/concurrentGroups'

/** 0051 미적용 안내 — spec §4 */
export const GROUP_REVIEW_INSTALL_MESSAGE =
  '동시분석 그룹 검토 기능의 DB 설치(0051 마이그레이션)가 아직 적용되지 않았습니다. 관리자에게 문의하세요.'
const GROUP_NOT_FOUND_MESSAGE = '동시분석 그룹을 찾을 수 없습니다.'
const GROUP_TOO_SMALL_MESSAGE = '동시분석 그룹에 배치가 2건 이상일 때만 그룹으로 처리할 수 있습니다.'

export interface GroupPropagationSummary {
  applied: number
  skipped: number
  failed: number
  warnings: string[]
}

export type GroupPropagationTransition =
  | { kind: 'item_start'; itemName: string }
  | { kind: 'item_clear'; itemName: string }
  | { kind: 'item_cancel'; itemName: string }

/** 개별 전이 뒤 동일 항목 그룹의 짝 배치에만 재적용한다. 내부 호출은 전파를 끈다. */
export async function propagateToGroupMates(
  sourceJobId: string, actorSub: string, transition: GroupPropagationTransition,
): Promise<GroupPropagationSummary | undefined> {
  const result: GroupPropagationSummary = { applied: 0, skipped: 0, failed: 0, warnings: [] }
  try {
    const { data: source } = await supabaseAdmin.from('qc_jobs').select('order_id, qc_no').eq('id', sourceJobId).maybeSingle()
    if (!source) return undefined
    const { data: memberships, error: membershipError } = await supabaseAdmin
      .from('concurrent_analysis_group_items').select('group_id, order_id').eq('order_id', source.order_id as string)
    if (membershipError) throw membershipError
    const groupId = memberships?.[0]?.group_id as string | undefined
    if (!groupId || !await getGroupTestItemSetIdentity(groupId)) return undefined
    const orderIds = (await supabaseAdmin.from('concurrent_analysis_group_items').select('order_id').eq('group_id', groupId)).data
      ?.map(row => row.order_id as string) ?? []
    const { data: activeOrders } = await supabaseAdmin.from('pct_orders').select('id, status').in('id', orderIds)
    const activeOrderIds = (activeOrders ?? [])
      .filter(row => !['취소', '삭제', 'cancelled', 'deleted'].includes(String(row.status)))
      .map(row => row.id as string)
    const { data: mates, error: matesError } = await supabaseAdmin
      .from('qc_jobs').select('id, status, qc_no').in('order_id', activeOrderIds).neq('id', sourceJobId)
    if (matesError) throw matesError
    if (!mates || mates.length === 0) return undefined
    const { startItem, clearItem, cancelItemStart } = await import('@backend/services/qcJobs')
    for (const mate of mates ?? []) {
      try {
        const isItemTransition = transition.kind === 'item_start' || transition.kind === 'item_clear' || transition.kind === 'item_cancel'
        const { data: item } = isItemTransition
          ? await supabaseAdmin.from('qc_job_items').select('id, status, review_status').eq('qc_job_id', mate.id as string)
            .eq('test_item_name', transition.itemName.trim()).maybeSingle()
          : { data: null }
        if (isItemTransition && !item) { result.skipped++; continue }
        if (isItemTransition && !ITEM_EDITABLE_JOB_STATUSES.has(mate.status as string)) { result.skipped++; continue }
        if (transition.kind === 'item_start' && item!.status !== ITEM_PENDING) { result.skipped++; continue }
        if (transition.kind === 'item_clear' && (item!.status === ITEM_CLEARED || item!.review_status !== ITEM_REVIEW_NONE)) { result.skipped++; continue }
        if (transition.kind === 'item_cancel' && item!.status !== ITEM_IN_PROGRESS) { result.skipped++; continue }
        const propagatedOptions = { propagated: true, propagationSourceQcNo: source.qc_no as string }
        if (transition.kind === 'item_start') await startItem(mate.id as string, item!.id as string, actorSub, propagatedOptions)
        else if (transition.kind === 'item_clear') await clearItem(mate.id as string, item!.id as string, actorSub, propagatedOptions)
        else if (transition.kind === 'item_cancel') await cancelItemStart(mate.id as string, item!.id as string, actorSub, propagatedOptions)
        result.applied++
      } catch (error) {
        if (error instanceof Error && error.message.includes('상태가 바뀌었습니다')) result.skipped++
        else {
          result.failed++
          result.warnings.push(`QC ${mate.qc_no ?? mate.id}: ${error instanceof Error ? error.message : '전파 실패'}`)
        }
      }
    }
  } catch (error) {
    result.failed++
    result.warnings.push(error instanceof Error ? error.message : '그룹 전파 판정 실패')
  }
  return result
}

/** DB 함수 반환 — 공유 타입에 커밋 뒤 알림용 stages 를 더한다 */
interface GroupReviewRpcResult extends GroupReviewResult {
  stages: StageRecomputeResult[]
}

function translateGroupReviewError(error: RpcError): Error {
  // 0051 함수가 없을 때만 0051 안내 — 그 밖(0048 부분 적용 등)은 기존 번역기를 그대로 쓴다.
  if (error.code === 'PGRST202' || error.code === '42883') return new Error(GROUP_REVIEW_INSTALL_MESSAGE)
  return translateItemReviewRpcError(error, GROUP_NOT_FOUND_MESSAGE)
}

/** 커밋 뒤 후속 처리 — 단계가 실제로 바뀐 작업만(notifyStageRecomputed 가 changed 를 본다). 실패는 검토를 되돌리지 않는다 */
async function notifyStages(stages: StageRecomputeResult[] | null | undefined): Promise<void> {
  for (const stage of stages ?? []) await notifyStageRecomputed(stage)
}

/** 응답에서 알림 전용 필드를 뺀다(화면은 processed·skipped 만 쓴다) */
function toReviewResult(res: GroupReviewRpcResult): GroupReviewResult {
  return {
    groupId: res.groupId, action: res.action, testItemName: res.testItemName ?? null,
    count: res.count, processed: res.processed ?? [], skipped: res.skipped ?? [],
  }
}

/**
 * 그룹의 같은 이름 시험항목 검토 시작·완료.
 * @param userSub 로그인 토큰의 사용자 id — 함수가 역할을 users 에서 다시 확인한다.
 */
export async function reviewGroupItem(
  groupId: string, testItemName: unknown, userSub: string, action: unknown,
): Promise<GroupReviewResult> {
  if (!isItemReviewBulkAction(action)) throw new Error('알 수 없는 검토 동작입니다.')
  if (typeof testItemName !== 'string' || testItemName.trim() === '') throw new Error('시험항목명을 입력해 주세요.')
  const { data, error } = await rpcWithDeadlockRetry<GroupReviewRpcResult>('group_item_review_action', {
    p_group_id: groupId, p_test_item_name: testItemName, p_user_id: userSub, p_action: action,
  })
  if (error || !data) throw translateGroupReviewError(error ?? { message: '응답이 비었습니다.' })

  // ── 여기부터는 커밋 뒤다 ──
  await notifyStages(data.stages)
  return toReviewResult(data)
}

/** 그룹 일괄 검토 — 전 배치의 완료 항목 전체 검토 시작 / 검토 중 항목 전체 검토 완료 */
export async function bulkReviewGroup(
  groupId: string, userSub: string, action: unknown,
): Promise<GroupReviewResult> {
  if (!isItemReviewBulkAction(action)) throw new Error('알 수 없는 검토 동작입니다.')
  const bulkAction: ItemReviewBulkAction = action
  const { data, error } = await rpcWithDeadlockRetry<GroupReviewRpcResult>('group_item_review_bulk_action', {
    p_group_id: groupId, p_user_id: userSub, p_action: bulkAction,
  })
  if (error || !data) throw translateGroupReviewError(error ?? { message: '응답이 비었습니다.' })

  await notifyStages(data.stages)
  return toReviewResult(data)
}

/**
 * 그룹 승인 — 승인전 → 승인완료. **원자적이지 않다**(spec §6).
 *
 * 작업마다 advanceJobStage 를 부른다 — 오더 상태 동기화(syncOrderStatusFromJobs)·상태 이력·슬랙·앱 알림은
 * 그 함수가 작업마다 이미 하므로 여기서 다시 부르지 않는다.
 * 도중에 실패하면 앞 작업만 승인완료로 남는다. 다시 누르면 남은 작업만 처리된다.
 */
export async function approveGroup(groupId: string, adminSub: string): Promise<GroupApproveResult> {
  const { data: group, error: gErr } = await supabaseAdmin
    .from('concurrent_analysis_groups').select('id').eq('id', groupId).maybeSingle()
  if (gErr) {
    if (gErr.code === '22P02') throw new Error(GROUP_NOT_FOUND_MESSAGE)
    throw new Error(`동시분석 그룹을 읽지 못했습니다. (원인: ${gErr.message})`)
  }
  if (!group) throw new Error(GROUP_NOT_FOUND_MESSAGE)

  const { data: members, error: mErr } = await supabaseAdmin
    .from('concurrent_analysis_group_items').select('order_id').eq('group_id', groupId)
  if (mErr) throw new Error(`동시분석 그룹을 읽지 못했습니다. (원인: ${mErr.message})`)
  const orderIds = (members ?? []).map(m => m.order_id as string)
  if (orderIds.length < 2) throw new Error(GROUP_TOO_SMALL_MESSAGE)

  const [jobsRes, ordersRes] = await Promise.all([
    supabaseAdmin.from('qc_jobs').select('id, order_id, qc_no, status').in('order_id', orderIds),
    supabaseAdmin.from('pct_orders').select('id, batch_no').in('id', orderIds),
  ])
  if (jobsRes.error) throw new Error(`작업을 읽지 못했습니다. (원인: ${jobsRes.error.message})`)
  const batchOf = new Map((ordersRes.data ?? []).map(o => [o.id as string, (o.batch_no as string) ?? '']))
  const jobs = (jobsRes.data ?? [])
    .map(j => ({
      jobId: j.id as string, orderId: j.order_id as string,
      qcNo: j.qc_no as string, status: j.status as string,
    }))
    .sort((a, b) => a.qcNo.localeCompare(b.qcNo))

  const processed: GroupStageProcessed[] = []
  const skipped: GroupStageSkipped[] = []
  for (const job of jobs) {
    const base = { jobId: job.jobId, qcNo: job.qcNo, batchNo: batchOf.get(job.orderId) ?? '' }
    if (job.status === CLOSED_STAGE) { skipped.push({ ...base, reason: '이미 승인완료' }); continue }
    if (job.status !== APPROVAL_READY_STATUS) { skipped.push({ ...base, reason: `"${job.status}" 단계` }); continue }
    try {
      // expected 를 넘겨 그 사이 단계가 바뀐 작업은 조건부로 거절되게 한다(동시 클릭 방지).
      await advanceJobStage(job.jobId, APPROVAL_READY_STATUS, adminSub)
      processed.push({ ...base, orderId: job.orderId })
    } catch (err) {
      const message = err instanceof Error ? err.message : '승인 실패'
      // advanceJobStage 는 승인 update 커밋 **뒤** 오더 동기화에서 던질 수 있다 — 실제로 승인됐으면 처리로 센다.
      const { data: now } = await supabaseAdmin.from('qc_jobs').select('status').eq('id', job.jobId).maybeSingle()
      if (now?.status === CLOSED_STAGE) {
        processed.push({ ...base, orderId: job.orderId })
      } else {
        skipped.push({ ...base, reason: message })
      }
    }
  }

  if (processed.length === 0) {
    const detail = skipped.length > 0
      ? ` (건너뜀: ${skipped.map(s => `QC ${s.qcNo} ${s.reason}`).join(', ')})`
      : ''
    throw new Error(`승인할 배치가 없습니다.${detail}`)
  }
  return { groupId, processed, skipped }
}
