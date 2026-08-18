/**
 * [BACKEND] 시험자 휴가/출장 일정 (operator_schedule)
 *
 * AI 자동배정 시 휴가 기간에 걸치는 시험자를 제외하기 위한 데이터.
 * - 관리자(admin): 전체 등록/수정/삭제, manager_checked 토글.
 * - 담당자(user):  본인 일정만 등록/조회.
 *
 * user(로그인) ↔ tester(배정 대상) 연결은 users.tester_id 로 이뤄진다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'

export type ScheduleType = 'ANNUAL' | 'HALF_DAY' | 'BUSINESS_TRIP'

export interface OperatorScheduleRow {
  id: string
  userId: string
  userName: string | null
  startDate: string
  endDate: string
  type: ScheduleType
  managerChecked: boolean
  memo: string | null
  createdAt: string
}

export interface CreateScheduleInput {
  userId: string
  startDate: string
  endDate: string
  type?: ScheduleType
  memo?: string | null
}

export interface UpdateScheduleInput {
  startDate?: string
  endDate?: string
  type?: ScheduleType
  managerChecked?: boolean
  memo?: string | null
}

function mapRow(r: Record<string, unknown>): OperatorScheduleRow {
  const user = r.users as Record<string, unknown> | null | undefined
  return {
    id:             r.id as string,
    userId:         r.user_id as string,
    userName:       (user?.display_name as string) ?? (user?.username as string) ?? null,
    startDate:      r.start_date as string,
    endDate:        r.end_date as string,
    type:           (r.type as ScheduleType) ?? 'ANNUAL',
    managerChecked: !!r.manager_checked,
    memo:           (r.memo as string) ?? null,
    createdAt:      r.created_at as string,
  }
}

const SELECT = 'id, user_id, start_date, end_date, type, manager_checked, memo, created_at, users(username, display_name)'

/**
 * 휴가 목록.
 * @param opts.userId 지정 시 해당 사용자 일정만(담당자 본인 조회).
 * @param opts.from / opts.to 기간과 겹치는 일정만(캘린더 범위).
 */
export async function listSchedules(opts: {
  userId?: string
  from?: string
  to?: string
} = {}): Promise<OperatorScheduleRow[]> {
  let q = supabaseAdmin
    .from('operator_schedule')
    .select(SELECT)
    .order('start_date', { ascending: false })

  if (opts.userId) q = q.eq('user_id', opts.userId)
  // 범위 겹침: start_date <= to AND end_date >= from
  if (opts.to)   q = q.lte('start_date', opts.to)
  if (opts.from) q = q.gte('end_date', opts.from)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map(r => mapRow(r as Record<string, unknown>))
}

export async function createSchedule(input: CreateScheduleInput): Promise<OperatorScheduleRow> {
  const { data, error } = await supabaseAdmin
    .from('operator_schedule')
    .insert({
      user_id:    input.userId,
      start_date: input.startDate,
      end_date:   input.endDate,
      type:       input.type ?? 'ANNUAL',
      memo:       input.memo ?? null,
    })
    .select(SELECT)
    .single()
  if (error) throw error
  return mapRow(data as Record<string, unknown>)
}

export async function updateSchedule(id: string, input: UpdateScheduleInput): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (input.startDate      !== undefined) patch.start_date      = input.startDate
  if (input.endDate        !== undefined) patch.end_date        = input.endDate
  if (input.type           !== undefined) patch.type            = input.type
  if (input.managerChecked !== undefined) patch.manager_checked = input.managerChecked
  if (input.memo           !== undefined) patch.memo            = input.memo
  if (Object.keys(patch).length === 0) return
  const { error } = await supabaseAdmin.from('operator_schedule').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteSchedule(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from('operator_schedule').delete().eq('id', id)
  if (error) throw error
}

/**
 * 지정 기간 [from, to] 에 걸치는 시험자 부재 구간 목록.
 * 배정 엔진이 유형별로 다르게 처리한다 —
 *   연차(ANNUAL)·출장(BUSINESS_TRIP): 그 날은 근무일에서 제외(하드)
 *   반차(HALF_DAY)               : 근무는 하되 가용 공수 0.5일 차감(소프트)
 * users.tester_id 가 연결된 사용자만 포함한다(시험자가 아닌 계정의 휴가는 배정과 무관).
 */
export async function testerAbsences(
  from: string, to: string,
): Promise<Array<{ testerId: string; from: string; to: string; type: string }>> {
  const { data, error } = await supabaseAdmin
    .from('operator_schedule')
    .select('start_date, end_date, type, users(tester_id)')
    .lte('start_date', to)
    .gte('end_date', from)
  if (error) throw error
  const out: Array<{ testerId: string; from: string; to: string; type: string }> = []
  for (const r of data ?? []) {
    const row = r as Record<string, unknown>
    const user = row.users as Record<string, unknown> | null
    const testerId = user?.tester_id as string | undefined
    if (!testerId) continue
    out.push({
      testerId,
      from: row.start_date as string,
      to: row.end_date as string,
      type: (row.type as string) ?? 'ANNUAL',
    })
  }
  return out
}

/**
 * 지정 기간 [from, to] 에 휴가/출장이 걸치는 tester_id 집합.
 * AI 자동배정에서 후보 제외용. users.tester_id 가 연결된 사용자만 포함.
 */
export async function testersOnLeave(from: string, to: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin
    .from('operator_schedule')
    .select('start_date, end_date, users(tester_id)')
    .lte('start_date', to)
    .gte('end_date', from)
  if (error) throw error
  const ids = new Set<string>()
  for (const r of data ?? []) {
    const user = (r as Record<string, unknown>).users as Record<string, unknown> | null
    const testerId = user?.tester_id as string | undefined
    if (testerId) ids.add(testerId)
  }
  return ids
}
