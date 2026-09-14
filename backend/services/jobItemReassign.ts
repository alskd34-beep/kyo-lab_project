/**
 * [BACKEND] 진행 중 시험항목 담당자 변경(F2) — "같은 그룹" = 같은 오더의 병렬 배정 담당자
 *
 * 규칙 전문: intent/2026-09-15-in-progress-item-reassign-spec.md (감독 결정 F2-1~F2-8)
 *
 * 쓰기: 판정·항목 행 이동/삭제/추가·스냅샷 슬롯·감사(pct_order_edits)·A·B 작업 단계 재도출은 전부
 *   DB 함수 reassign_job_item(0050)이 **한 트랜잭션**으로 한다. 이 서비스는
 *     사유 검사 → rpc → 오류 번역 → (커밋 뒤) 오더 상태 동기화·단계 전환 알림(F1 재사용)·받는 사람 알림(F2-3)
 *   만 한다.
 *   ⚠️ 함수가 없을 때(0050 미적용) 여러 호출로 나눈 비원자 경로로 폴백하지 않는다 — 설치 안내로 거절한다.
 *
 * 읽기: 관리자 서랍·할 일 모달이 [담당자 변경]/[넘기기] 를 그릴 때 쓰는 현재 상태(담당자·작업·항목 흔적).
 *   화면 보조 판정일 뿐이다 — 최종 판정은 함수가 잠금 아래에서 다시 한다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { rpcWithDeadlockRetry } from '@backend/lib/rpcRetry'
import { getTesterId } from '@backend/lib/testerLink'
import { createNotification } from '@backend/services/notifications'
import { assigneesOfOrder } from '@backend/services/orderAssignees'
import {
  loadJobItems,
  notifyStageRecomputed,
  syncOrderStatusFromJobs,
  type JobItemRow,
} from '@backend/services/qcJobs'
import { isAssigneeSlot, isParallelAssignment } from '@shared/assignment'
import {
  CLOSED_STAGE,
  DELETED_STATUS,
  ITEM_CLEARED,
  ITEM_EDITABLE_JOB_STATUSES,
  ITEM_IN_PROGRESS,
  ITEM_PENDING,
  hasReviewTrace,
} from '@shared/qc-status'
import {
  ITEM_REASSIGN_REASON_MIN,
  type ItemReassignAssignee,
  type ItemReassignContext,
  type ItemReassignItemState,
  type ItemReassignResult,
  type ItemReassignStage,
} from '@shared/item-reassign'

/** 0050 미적용 안내 — spec §3 설치 문구 */
export const ITEM_REASSIGN_INSTALL_MESSAGE =
  '시험항목 담당자 변경 기능의 DB 설치(0050 마이그레이션)가 아직 적용되지 않았습니다. 관리자에게 문의하세요.'

/** 조회 권한이 없을 때 — 라우트가 403 으로 돌려준다 */
export class ItemReassignForbiddenError extends Error {
  constructor(message = '같은 오더에 병렬 배정된 담당자만 볼 수 있습니다.') {
    super(message)
    this.name = 'ItemReassignForbiddenError'
  }
}

// 함수(0050)와 같은 거절 문구 — 화면 보조 판정이 서버 응답과 같은 말을 하게
const MSG = {
  deleted: '삭제된 오더의 시험항목은 담당자를 변경할 수 없습니다.',
  closed: '승인완료된 오더의 시험항목은 담당자를 변경할 수 없습니다.',
  noJobs: '작업이 시작되지 않은 오더는 오더 수정의 시험항목 배분에서 담당자를 바꾸세요.',
  excluded: '제외된 시험항목은 담당자를 바꿀 수 없습니다.',
  noAssignee: '담당자 정보가 없는 배분입니다. 관리자에게 확인을 요청하세요.',
  duplicated: '같은 이름의 시험항목이 여러 담당자 작업에 있어 변경할 수 없습니다. 관리자에게 확인을 요청하세요.',
  missingInJob: '보내는 담당자의 작업에 이 시험항목이 없어 변경할 수 없습니다. 관리자에게 확인을 요청하세요.',
  inProgress: '진행 중인 시험항목은 넘길 수 없습니다. 시작 취소 후 다시 시도해 주세요.',
  cleared: '이미 완료된 시험항목은 넘길 수 없습니다.',
  traced: '시작·완료 기록이 남아 있는 시험항목은 넘길 수 없습니다. 관리자에게 확인을 요청하세요.',
  reviewed: '검토 기록이 있는 시험항목은 넘길 수 없습니다.',
  lastItem: '마지막 항목은 넘길 수 없습니다. 작업 시작 취소 후 배분하세요.',
  notMine: '본인 시험항목만 넘길 수 있습니다.',
  noReceiver: '넘겨받을 수 있는 담당자가 없습니다.',
} as const

/**
 * DB 함수 호출 오류를 사용자에게 보일 Error 로 바꾼다.
 *  - P0001: 함수가 던진 업무 거절(한국어 메시지 그대로)
 *  - 함수 없음(PGRST202/42883): 설치 안내 — 비원자 폴백은 하지 않는다
 *  - 잘못된 uuid(22P02): "오더를 찾을 수 없습니다"
 *  - 그 밖(함수 본문의 실제 버그 등): 원인을 붙인 한국어 메시지 — 설치 안내로 가리지 않는다
 */
export function translateItemReassignRpcError(error: { code?: string; message?: string }): Error {
  if (error.code === 'P0001') return new Error(error.message ?? '요청을 처리할 수 없습니다.')
  if (error.code === 'PGRST202' || error.code === '42883') return new Error(ITEM_REASSIGN_INSTALL_MESSAGE)
  if (error.code === '22P02') return new Error('오더를 찾을 수 없습니다.')
  return new Error(`시험항목 담당자 변경 중 DB 오류가 발생했습니다. 관리자에게 문의하세요. (원인: ${error.message || error.code || '알 수 없음'})`)
}

/** 사유 검사 — spec §3 조건 0 (함수도 같은 검사를 한 번 더 한다) */
function checkReason(reason: unknown): string {
  if (typeof reason !== 'string') throw new Error('담당자 변경 사유를 입력해 주세요.')
  const trimmed = reason.trim()
  if (trimmed.length < ITEM_REASSIGN_REASON_MIN) throw new Error('담당자 변경 사유를 2자 이상 입력해 주세요.')
  return trimmed
}

/** 실행 흔적이 하나라도 있는가 (0047·0050 과 같은 기준) */
function hasExecTrace(it: JobItemRow): boolean {
  return it.status !== ITEM_PENDING
    || it.startedAt != null || it.clearedAt != null
    || it.elapsedMinutes != null || it.elapsedTotalMinutes != null
}

/**
 * 진행 중 담당자 변경 화면용 현재 상태.
 *
 * @param role 로그인 토큰의 역할. 관리자는 모든 오더, 시험자는 **자기가 병렬 배정된 오더**만 볼 수 있다.
 */
export async function getItemReassignContext(
  orderId: string, userSub: string, role: string,
): Promise<ItemReassignContext> {
  // 토큰 역할만 믿지 않는다(리뷰 L5) — 강등·비활성 계정이 토큰 만료 전까지 관리자 조회를 하지 않게 users 를 다시 읽는다.
  const { data: viewer, error: vErr } = await supabaseAdmin
    .from('users').select('role, is_active').eq('id', userSub).maybeSingle()
  if (vErr) throw vErr
  if (!viewer || viewer.is_active === false) throw new ItemReassignForbiddenError('로그인 사용자를 확인할 수 없습니다. 다시 로그인해 주세요.')
  const viewerIsAdmin = role === 'admin' && (viewer.role as string) === 'admin'

  const { data: order, error: orderErr } = await supabaseAdmin
    .from('pct_orders').select('id, product_name, batch_no, status').eq('id', orderId).maybeSingle()
  if (orderErr) {
    if (orderErr.code === '22P02') throw new Error('오더를 찾을 수 없습니다.')
    throw orderErr
  }
  if (!order) throw new Error('오더를 찾을 수 없습니다.')

  // 담당자 구성(0049) — 미적용이면 설치 안내 오류
  const slots = await assigneesOfOrder(orderId)
  const viewerTesterId = viewerIsAdmin ? null : await getTesterId(userSub)
  // "같은 그룹" 판정 — 시험자는 이 오더의 병렬 담당자여야 한다(isOrderCoAssignee 와 같은 기준, 이미 읽은 슬롯으로)
  if (!viewerIsAdmin) {
    if (!viewerTesterId || !isParallelAssignment(slots) || !slots.some(a => a.testerId === viewerTesterId)) {
      throw new ItemReassignForbiddenError()
    }
  }
  const viewerSlot = viewerTesterId ? (slots.find(a => a.testerId === viewerTesterId)?.slot ?? null) : null

  const testerIds = slots.map(a => a.testerId)
  const [{ data: testerRows, error: tErr }, { data: jobRows, error: jErr }, { data: snapRows, error: sErr }] = await Promise.all([
    testerIds.length
      ? supabaseAdmin.from('testers').select('id, name, is_active').in('id', testerIds)
      : Promise.resolve({ data: [] as Record<string, unknown>[], error: null }),
    supabaseAdmin.from('qc_jobs').select('id, qc_no, status, assignee_tester_id').eq('order_id', orderId),
    supabaseAdmin.from('pct_order_test_items')
      .select('test_item_name, sequence_order, is_excluded, assignee_slot')
      .eq('order_id', orderId)
      .order('sequence_order', { ascending: true }),
  ])
  if (tErr) throw tErr
  if (jErr) throw jErr
  if (sErr) throw sErr

  const testerById = new Map((testerRows ?? []).map(t => [t.id as string, t]))
  const jobs = (jobRows ?? []).map(j => ({
    id: j.id as string, qcNo: j.qc_no as string, status: j.status as string,
    testerId: (j.assignee_tester_id as string | null) ?? null,
  }))
  const jobByTester = new Map(jobs.filter(j => j.testerId).map(j => [j.testerId as string, j]))
  // 항목 조회는 0048 미적용이면 검토 컬럼 없이 다시 읽는다 — 이 화면은 쓰기 전 판정이라 그대로 쓴다
  const { byJob } = await loadJobItems(jobs.map(j => j.id))

  const assignees: ItemReassignAssignee[] = slots.map(a => {
    const t = testerById.get(a.testerId)
    const job = jobByTester.get(a.testerId) ?? null
    const isActive = t?.is_active === true
    let receiveBlockReason: string | null = null
    if (!isActive) receiveBlockReason = `비활성 시험자(${(t?.name as string) ?? '이름 없음'})에게는 배정할 수 없습니다.`
    else if (job && !ITEM_EDITABLE_JOB_STATUSES.has(job.status)) {
      receiveBlockReason = `받는 담당자의 작업(QC ${job.qcNo})이 "${job.status}" 단계라 시험항목을 받을 수 없습니다.`
    }
    return {
      slot: a.slot,
      testerId: a.testerId,
      testerName: (t?.name as string) ?? null,
      isActive,
      isMe: viewerTesterId !== null && a.testerId === viewerTesterId,
      jobId: job?.id ?? null,
      qcNo: job?.qcNo ?? null,
      jobStatus: job?.status ?? null,
      receiveBlockReason,
    }
  })
  const assigneeBySlot = new Map(assignees.map(a => [a.slot, a]))
  const hasJobs = jobs.length > 0
  const orderStatus = order.status as string

  const items: ItemReassignItemState[] = (snapRows ?? []).map(r => {
    const name = r.test_item_name as string
    const slot = Number(r.assignee_slot) || 1
    const isExcluded = r.is_excluded === true
    const from = assigneeBySlot.get(slot) ?? null
    const fromJob = from?.jobId ? jobs.find(j => j.id === from.jobId) ?? null : null
    const rowsByJob = jobs.map(j => ({ job: j, rows: (byJob.get(j.id) ?? []).filter(it => it.testItemName === name) }))
    const inFrom = fromJob ? (rowsByJob.find(x => x.job.id === fromJob.id)?.rows ?? []) : []
    const elsewhere = rowsByJob.filter(x => x.job.id !== fromJob?.id).reduce((n, x) => n + x.rows.length, 0)
    const item = inFrom[0] ?? null

    const block = ((): string | null => {
      if (orderStatus === DELETED_STATUS) return MSG.deleted
      if (orderStatus === CLOSED_STAGE) return MSG.closed
      if (!hasJobs) return MSG.noJobs
      if (isExcluded) return MSG.excluded
      if (!from) return MSG.noAssignee
      if (!viewerIsAdmin && viewerSlot !== slot) return MSG.notMine
      if (fromJob && !ITEM_EDITABLE_JOB_STATUSES.has(fromJob.status)) {
        return `"${fromJob.status}" 단계의 작업은 시험항목을 변경할 수 없습니다.`
      }
      if (inFrom.length > 1) return MSG.duplicated
      // 받는 쪽 작업에 같은 이름이 있는 경우는 받는 사람을 고른 뒤 서버가 판정한다 — 여기서는 제3의 작업만 본다
      if (fromJob && !item) return elsewhere > 0 ? MSG.duplicated : MSG.missingInJob
      if (item) {
        if (item.status === ITEM_IN_PROGRESS) return MSG.inProgress
        if (item.status === ITEM_CLEARED) return MSG.cleared
        if (hasExecTrace(item)) return MSG.traced
        if (hasReviewTrace(item.reviewStatus)) return MSG.reviewed
        if ((byJob.get(fromJob!.id) ?? []).length <= 1) return MSG.lastItem
      }
      const receivers = assignees.filter(a => a.slot !== slot && !a.receiveBlockReason)
      if (receivers.length === 0) return MSG.noReceiver
      return null
    })()

    return {
      testItemName: name,
      sequenceOrder: (r.sequence_order as number) ?? 0,
      slot,
      isExcluded,
      itemStatus: item?.status ?? null,
      blockReason: block,
    }
  })

  return {
    orderId,
    productName: (order.product_name as string) ?? '',
    batchNo: (order.batch_no as string) ?? '',
    orderStatus,
    hasJobs,
    viewerIsAdmin,
    viewerSlot,
    assignees,
    items,
  }
}

/** 담당자 변경 결과 + 커밋 뒤 부가 처리 경고 */
export type ReassignJobItemResponse = ItemReassignResult & { warning?: string }

/**
 * 시험항목 하나를 같은 오더의 다른 담당자(슬롯)에게 넘긴다 — DB 함수 reassign_job_item(0050) 한 트랜잭션.
 *
 * @param expectedFromSlot 화면이 보고 있던 현재 담당자 번호(F2-7). 잠금 뒤 다르면 함수가 거절한다.
 * @param userSub 로그인 토큰의 사용자 id — 함수가 users 에서 역할·시험자 연결을 다시 읽어 권한을 판정한다.
 */
export async function reassignJobItem(input: {
  orderId: string
  testItemName: unknown
  expectedFromSlot: unknown
  toSlot: unknown
  userSub: string
  reason: unknown
}): Promise<ReassignJobItemResponse> {
  const reason = checkReason(input.reason)
  const name = typeof input.testItemName === 'string' ? input.testItemName : ''
  if (!name.trim()) throw new Error('시험항목을 찾을 수 없습니다.')
  if (!isAssigneeSlot(input.expectedFromSlot) || !isAssigneeSlot(input.toSlot)) {
    throw new Error('담당자 번호는 1~5 사이여야 합니다.')
  }

  const { data, error } = await rpcWithDeadlockRetry('reassign_job_item', {
    p_order_id: input.orderId,
    p_test_item_name: name,
    p_expected_from_slot: input.expectedFromSlot,
    p_to_slot: input.toSlot,
    p_user_id: input.userSub,
    p_reason: reason,
  })
  if (error) throw translateItemReassignRpcError(error)
  const res = data as ItemReassignResult

  // ── 여기부터는 커밋 뒤다. 실패해도 이동은 되돌리지 않는다(서버 로그·경고만) ──
  // 오더 상태: 단계가 바뀐 작업이 있으면 notifyStageRecomputed 가 동기화까지 한다. 없어도 **항상** 한 번 맞춘다 —
  // 받는 사람이 미시작이면 그 슬롯에 활성 항목이 생겨 '진행중' 상한이 걸릴 수 있다(spec §2.4).
  const changed = [res.stages?.from, res.stages?.to].filter((s): s is ItemReassignStage => !!s?.changed)
  if (changed.length === 0) {
    try {
      await syncOrderStatusFromJobs(res.orderId)
    } catch (err) {
      console.error('[jobItemReassign] 오더 상태 동기화 실패 — 담당자 변경은 반영됨:', res.orderId, err)
    }
  }
  for (const stage of changed) await notifyStageRecomputed(stage)

  // 받는 사람 앱 알림(F2-3) — 시험자 계정이 연결된 경우만. 관리자 알림은 없다.
  let warning: string | undefined
  if (res.to.userId) {
    try {
      await createNotification({
        type: 'status_changed',
        title: '시험항목 인계',
        body: `${res.productName ?? ''} / ${res.batchNo ?? ''} — "${res.testItemName}" 이(가) ${res.from.testerName ?? '담당자'}님에게서 넘어왔습니다. (사유: ${reason})`,
        targetUserId: res.to.userId,
        relatedOrderId: res.orderId,
        relatedQcJobId: res.to.jobId,
        severity: 'info',
      })
    } catch (err) {
      console.error('[jobItemReassign] 받는 사람 알림 생성 실패 — 담당자 변경은 반영됨:', res.orderId, err)
      warning = '담당자는 변경됐지만 받는 담당자 알림 생성에 실패했습니다.'
    }
  }

  return { ...res, ...(warning ? { warning } : {}) }
}
