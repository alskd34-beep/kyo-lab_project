/**
 * [BACKEND] 병렬 배정(최대 5인) — 오더 담당자 슬롯 읽기·쓰기의 단일 창구
 *
 * 규칙 전문: intent/2026-09-15-parallel-assignment-spec.md (감독 결정 F3-1~F3-7)
 *
 * 담당자는 pct_order_assignees(order_id, slot 1~5, tester_id) 에 있다. 슬롯 1 이 대표이며
 * pct_orders.assignee_tester_id 에 미러된다. 병렬 여부는 행 수(≥ 2)로 파생한다.
 *
 * 쓰기: 담당자 구성·미러·구 컬럼(is_dual_assignment·assignee_tester_id_2)·감사 기록은 **반드시** DB 함수
 *   (0049 set_order_assignees / set_order_primary_assignee) 한 트랜잭션으로만 바꾼다.
 *   ⚠️ pct_orders.assignee_tester_id 를 직접 UPDATE 하는 경로를 새로 만들지 마라 — 미러가 갈라진다.
 *   ⚠️ 함수가 없을 때(0049 미적용) 여러 호출로 나눈 비원자 경로로 폴백하지 않는다.
 *
 * 읽기: 새 코드의 담당자 읽기는 전부 이 테이블에서 한다. 구 2인 컬럼은 읽지 않는다.
 *   테이블이 없으면(0049 미적용) 핵심 화면은 설치 안내 오류를 던지고, 부가 기능(챗봇·슬랙 등)은
 *   대표 미러(assignee_tester_id)만으로 1인 배정처럼 동작한다(mirror 옵션).
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { selectAll } from '@backend/lib/supabasePage'
import { describeSchemaError } from '@backend/lib/schemaError'
import {
  MAX_PARALLEL_ASSIGNEES,
  PRIMARY_ASSIGNEE_SLOT,
  isAssigneeSlot,
  type AssigneeSlot,
  type OrderAssigneeInput,
} from '@shared/assignment'

/** 0049 미적용 안내에 쓰는 기능 이름·마이그레이션 파일 */
export const PARALLEL_ASSIGN_FEATURE = '병렬 배정'
export const PARALLEL_ASSIGN_MIGRATION = '0049_parallel_assignment.sql'
/** 0049 의 DB 함수·테이블이 없을 때 쓰기 동작을 거절하는 문구 — spec §3.3 */
export const PARALLEL_ASSIGN_INSTALL_MESSAGE =
  '병렬 배정 기능의 DB 설치(0049 마이그레이션)가 아직 적용되지 않았습니다. 관리자에게 문의하세요.'

/** 슬롯 1행 */
export interface AssigneeSlotRow {
  slot: AssigneeSlot
  testerId: string
}

/** 대표 미러만으로 담당자를 만들 때 쓰는 오더 행(0049 미적용 부가 기능용) */
export interface MirrorOrderRow {
  id: string
  assignee_tester_id: string | null
}

type DbError = { code?: string; message?: string } | null | undefined

/**
 * 담당자 테이블(0049)이 없는 오류인가 — 테이블 없음·관계 없음이고 **메시지에 pct_order_assignees 가 있을 때만**.
 * 컬럼 오타(42703·PGRST204) 같은 실제 버그를 미러 폴백·설치 안내로 조용히 가리지 않게 좁힌다.
 */
export function isMissingAssigneeSchema(err: unknown): boolean {
  const e = err as DbError
  const msg = e?.message ?? ''
  if (!/pct_order_assignees/.test(msg)) return false
  return e?.code === 'PGRST205' || e?.code === 'PGRST200' || e?.code === '42P01'
    || /does not exist|Could not find/i.test(msg)
}

/** 담당자 슬롯 조회 오류 → 설치 안내가 붙은 Error */
export function describeAssigneeReadError(err: unknown): Error {
  return describeSchemaError(err, PARALLEL_ASSIGN_FEATURE, PARALLEL_ASSIGN_MIGRATION)
}

function toSlotRow(r: Record<string, unknown>): AssigneeSlotRow | null {
  const slot = Number(r.slot)
  const testerId = r.tester_id as string | null
  if (!isAssigneeSlot(slot) || !testerId) return null
  return { slot, testerId }
}

function mirrorMap(rows: readonly MirrorOrderRow[]): Map<string, AssigneeSlotRow[]> {
  const out = new Map<string, AssigneeSlotRow[]>()
  for (const o of rows) {
    if (o.assignee_tester_id) out.set(o.id, [{ slot: PRIMARY_ASSIGNEE_SLOT, testerId: o.assignee_tester_id }])
  }
  return out
}

/** in() 한 번에 넣는 id 수 — URL 길이 한계를 넘지 않게 나눈다 */
const IN_CHUNK = 150

/**
 * 오더별 담당자 슬롯(슬롯 오름차순).
 *
 * @param orderIds 없으면 테이블 전체를 읽는다(페이지네이션). 있으면 그 오더들만.
 * @param opts.mirror 주면 0049 미적용일 때 오류 대신 대표 미러로 1인 배정 맵을 만든다(부가 기능용).
 *                    주지 않으면 설치 안내 오류를 던진다(핵심 화면).
 * 맵에 없는 오더 = 담당자 없음.
 */
export async function loadAssigneesByOrder(
  orderIds?: readonly string[],
  opts: { mirror?: readonly MirrorOrderRow[] } = {},
): Promise<Map<string, AssigneeSlotRow[]>> {
  const out = new Map<string, AssigneeSlotRow[]>()
  const push = (r: Record<string, unknown>) => {
    const row = toSlotRow(r)
    if (!row) return
    const orderId = r.order_id as string
    const arr = out.get(orderId) ?? []
    arr.push(row)
    out.set(orderId, arr)
  }
  const fail = (err: unknown): Map<string, AssigneeSlotRow[]> => {
    if (opts.mirror && isMissingAssigneeSchema(err)) return mirrorMap(opts.mirror)
    throw describeAssigneeReadError(err)
  }

  if (orderIds === undefined) {
    const { data, error } = await selectAll(supabaseAdmin, 'pct_order_assignees', 'order_id, slot, tester_id')
    if (error) return fail(error)
    for (const r of data ?? []) push(r)
  } else {
    const ids = [...new Set(orderIds)]
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      const chunk = ids.slice(i, i + IN_CHUNK)
      const { data, error } = await supabaseAdmin
        .from('pct_order_assignees')
        .select('order_id, slot, tester_id')
        .in('order_id', chunk)
      if (error) return fail(error)
      for (const r of data ?? []) push(r as Record<string, unknown>)
    }
  }
  for (const arr of out.values()) arr.sort((a, b) => a.slot - b.slot)
  return out
}

/** 한 오더의 담당자 슬롯(슬롯 오름차순). 0049 미적용이면 설치 안내 오류 */
export async function assigneesOfOrder(orderId: string): Promise<AssigneeSlotRow[]> {
  const map = await loadAssigneesByOrder([orderId])
  return map.get(orderId) ?? []
}

/**
 * 쓰기 경로용 — 한 오더의 담당자 슬롯. 0049 미적용이면 설치 안내 문구로 거절한다(비원자 폴백 없음).
 */
export async function assigneesOfOrderForWrite(orderId: string): Promise<AssigneeSlotRow[]> {
  const { data, error } = await supabaseAdmin
    .from('pct_order_assignees')
    .select('order_id, slot, tester_id')
    .eq('order_id', orderId)
  if (error) {
    if (isMissingAssigneeSchema(error)) throw new Error(PARALLEL_ASSIGN_INSTALL_MESSAGE)
    throw error
  }
  return (data ?? [])
    .map(r => toSlotRow(r as Record<string, unknown>))
    .filter((r): r is AssigneeSlotRow => !!r)
    .sort((a, b) => a.slot - b.slot)
}

/**
 * 같은 오더의 병렬 담당자인가 — 두 시험자가 모두 그 오더의 슬롯에 있고 오더가 병렬 배정(행 ≥ 2)이다.
 * 열람 권한(canViewJob)과 F2 "같은 그룹" 판정의 기준. 수정 권한으로 쓰지 않는다.
 */
export async function isOrderCoAssignee(orderId: string, viewerTesterId: string, otherTesterId?: string | null): Promise<boolean> {
  const rows = await assigneesOfOrder(orderId)
  if (rows.length < 2) return false
  const ids = new Set(rows.map(r => r.testerId))
  if (!ids.has(viewerTesterId)) return false
  return otherTesterId ? ids.has(otherTesterId) : true
}

// ─── 쓰기 (0049 DB 함수) ──────────────────────────────────────────────────────

/**
 * DB 함수가 업무 규칙으로 거절한 오류(P0001) — 메시지는 한국어 그대로 화면에 보인다.
 * 일괄 경로(AI 자동배정)는 이 오류만 오더별 실패로 모으고 계속 진행한다. 설치·DB 오류는 일반 Error 로 멈춘다.
 */
export class AssignmentRejectedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AssignmentRejectedError'
  }
}

/**
 * DB 함수 호출 오류를 사용자에게 보일 Error 로 바꾼다.
 *  - P0001: 함수가 던진 업무 거절(한국어 메시지 그대로)
 *  - 함수·테이블 없음(PGRST202/42883/42P01/PGRST205): 설치 안내 — 비원자 폴백은 하지 않는다
 *  - 잘못된 uuid(22P02): "찾을 수 없습니다"
 *  - 그 밖: 원인을 붙인 한국어 메시지 — 설치 안내로 가리지 않는다
 */
export function translateAssignmentRpcError(error: { code?: string; message?: string }): Error {
  if (error.code === 'P0001') return new AssignmentRejectedError(error.message ?? '요청을 처리할 수 없습니다.')
  if (error.code === 'PGRST202' || error.code === '42883' || error.code === '42P01' || error.code === 'PGRST205') {
    return new Error(PARALLEL_ASSIGN_INSTALL_MESSAGE)
  }
  if (error.code === '22P02') return new Error('오더 또는 시험자를 찾을 수 없습니다.')
  if (error.code === '23505') return new Error('같은 담당자를 두 번 배정할 수 없습니다.')
  return new Error(`담당자 배정 처리 중 DB 오류가 발생했습니다. 관리자에게 문의하세요. (원인: ${error.message || error.code || '알 수 없음'})`)
}

/** set_order_assignees 반환의 슬롯 1행 */
export interface AssigneeSnapshot {
  slot: AssigneeSlot
  testerId: string
  testerName: string | null
}

/** set_order_assignees 반환값 */
export interface SetOrderAssigneesResult {
  orderId: string
  changed: boolean
  hasJobs: boolean
  before: AssigneeSnapshot[]
  after: AssigneeSnapshot[]
  addedSlots: AssigneeSlot[]
  removedSlots: AssigneeSlot[]
  replacedSlots: AssigneeSlot[]
}

/** set_order_primary_assignee 반환값 */
export interface SetPrimaryAssigneeResult {
  orderId: string
  changed: boolean
  beforeTesterId: string | null
  afterTesterId: string | null
}

function requireReason(reason: unknown): string {
  const trimmed = typeof reason === 'string' ? reason.trim() : ''
  if (!trimmed) throw new Error('수정 사유는 필수입니다.')
  return trimmed
}

/**
 * API 요청 본문의 assignees 를 검증·정규화한다(서비스 선검증 — 최종 판정은 DB 함수).
 * 형식: [{ slot: 1~5, testerId: string }]
 */
export function normalizeAssigneeInput(raw: unknown): OrderAssigneeInput[] {
  if (!Array.isArray(raw)) throw new Error('담당자 구성 형식이 올바르지 않습니다.')
  if (raw.length === 0) throw new Error('담당자를 1명 이상 지정해야 합니다.')
  if (raw.length > MAX_PARALLEL_ASSIGNEES) throw new Error(`병렬 배정은 최대 ${MAX_PARALLEL_ASSIGNEES}명까지입니다.`)
  const out: OrderAssigneeInput[] = []
  const slots = new Set<number>()
  const testers = new Set<string>()
  for (const el of raw) {
    const e = el as { slot?: unknown; testerId?: unknown } | null
    if (!e || typeof e !== 'object') throw new Error('담당자 구성 형식이 올바르지 않습니다.')
    if (!isAssigneeSlot(e.slot)) throw new Error(`담당자 번호는 1~${MAX_PARALLEL_ASSIGNEES} 사이여야 합니다.`)
    const testerId = typeof e.testerId === 'string' ? e.testerId.trim() : ''
    if (!testerId) throw new Error('담당자를 선택하지 않은 자리가 있습니다.')
    if (slots.has(e.slot)) throw new Error('같은 담당자 번호가 두 번 들어 있습니다.')
    if (testers.has(testerId)) throw new Error('같은 담당자를 두 번 배정할 수 없습니다.')
    slots.add(e.slot)
    testers.add(testerId)
    out.push({ slot: e.slot, testerId })
  }
  return out.sort((a, b) => a.slot - b.slot)
}

/**
 * 담당자 구성 변경 — DB 함수 set_order_assignees(0049) 한 트랜잭션.
 * 커밋 뒤 재배정 이력·휴가 겹침 알림은 호출자(pctOrders.updateOrderWithReason)가 반환값으로 한다.
 */
export async function setOrderAssignees(
  orderId: string,
  assignees: readonly OrderAssigneeInput[],
  userId: string | null,
  reason: string,
): Promise<SetOrderAssigneesResult> {
  const note = requireReason(reason)
  const payload = normalizeAssigneeInput(assignees)
  const { data, error } = await supabaseAdmin.rpc('set_order_assignees', {
    p_order_id: orderId,
    p_assignees: payload.map(a => ({ slot: a.slot, testerId: a.testerId })),
    p_user_id: userId,
    p_reason: note,
  })
  if (error) throw translateAssignmentRpcError(error)
  return data as SetOrderAssigneesResult
}

/**
 * 대표 담당자(슬롯 1)만 배정·교체·해제 — DB 함수 set_order_primary_assignee(0049) 한 트랜잭션.
 * AI 자동배정·수동 배정·해제·시트 적재 복구·그룹 전파·수동 오더 생성·1인 배정 수정이 모두 이 함수를 쓴다(F3-2).
 */
export async function setOrderPrimaryAssignee(
  orderId: string,
  testerId: string | null,
  userId: string | null,
  reason: string,
): Promise<SetPrimaryAssigneeResult> {
  const note = requireReason(reason)
  const { data, error } = await supabaseAdmin.rpc('set_order_primary_assignee', {
    p_order_id: orderId,
    p_tester_id: testerId,
    p_user_id: userId,
    p_reason: note,
  })
  if (error) throw translateAssignmentRpcError(error)
  return data as SetPrimaryAssigneeResult
}
