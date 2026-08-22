/**
 * [BACKEND] 휴가/출장 충돌 감지 — 수동 배정 경로의 안전망.
 *
 * AI 자동배정은 휴가자를 후보에서 아예 제외하지만(pctAssign),
 * 수동 배정(오더 추가·수정·일괄배정)은 현장 예외를 막지 않기 위해 차단하지 않는다.
 * 대신 배정이 휴가 구간과 겹치면 관리자 알림을 남겨 사후 추적이 가능하게 한다.
 *
 * 판정 규칙은 화면과 어긋나면 안 되므로 @shared/leave 의 순수 함수를 그대로 쓴다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { createNotification } from '@backend/services/notifications'
import { testerAbsences } from '@backend/services/operatorSchedule'
import {
  describeConflicts,
  findAbsenceConflicts,
  hasHardConflict,
  orderTestWindow,
  todayIso,
  type OrderDates,
  type TesterAbsence,
} from '@shared/leave'

/** 오더 1건 + 담당자에 대한 휴가 충돌 조회. 실패는 삼키지 않는다(호출부에서 판단). */
export async function findConflictsForAssignment(input: {
  testerId: string | null
  order: OrderDates
}): Promise<TesterAbsence[]> {
  if (!input.testerId) return []
  const window = orderTestWindow(input.order, todayIso())
  const absences = await testerAbsences(window.from, window.to)
  return findAbsenceConflicts(input.testerId, window, absences)
}

/** 시험자 이름 조회 (알림 본문용). 실패하면 null. */
async function testerName(testerId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('testers').select('name').eq('id', testerId).maybeSingle()
  return (data?.name as string) ?? null
}

/**
 * 수동 배정이 휴가와 겹칠 때 관리자 알림 1건.
 *
 * 알림 적재 실패가 배정 자체를 되돌리게 하면 안 되므로 호출부에서 .catch 로 감싼다.
 * 연차·출장(하드)은 critical, 반차는 warning 으로 심각도를 나눈다.
 */
export async function notifyLeaveConflict(input: {
  orderId: string
  productName: string
  batchNo: string
  testerId: string
  conflicts: TesterAbsence[]
  /** 자동배정/수동배정 구분 등 맥락 */
  via: string
}): Promise<void> {
  if (input.conflicts.length === 0) return
  const name = (await testerName(input.testerId)) ?? '담당자'
  const hard = hasHardConflict(input.conflicts)

  await createNotification({
    type: 'status_changed',
    severity: hard ? 'critical' : 'warning',
    title: hard ? '휴가 기간 배정' : '반차 기간 배정',
    body:
      `${input.productName} (${input.batchNo}) → ${name} 배정. ` +
      `${describeConflicts(input.conflicts)} 와 겹칩니다. (${input.via}) 관리자 확인이 필요합니다.`,
    relatedOrderId: input.orderId,
  })
}

/**
 * 담당자 지정이 휴가와 겹치면 알림을 남긴다. 배정은 막지 않는다.
 * 오더 생성·수정·수동배정 경로가 공통으로 부르는 진입점.
 *
 * 알림·조회 실패로 본 작업(배정)이 깨지지 않게 여기서 전부 흡수한다.
 */
export async function warnIfAssigneeOnLeave(input: {
  orderId: string
  testerId: string | null
  order: OrderDates
  productName: string
  batchNo: string
  via: string
}): Promise<void> {
  if (!input.testerId) return
  try {
    const conflicts = await findConflictsForAssignment({ testerId: input.testerId, order: input.order })
    if (conflicts.length === 0) return
    await notifyLeaveConflict({
      orderId: input.orderId,
      productName: input.productName,
      batchNo: input.batchNo,
      testerId: input.testerId,
      conflicts,
      via: input.via,
    })
  } catch (err) {
    // 경고는 부가 기능이다 — 실패해도 배정 결과를 되돌리지 않는다.
    console.error('[leaveConflicts] 휴가 충돌 알림 실패:', err)
  }
}
