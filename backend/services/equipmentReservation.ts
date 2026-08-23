/**
 * [BACKEND] 장비 예약 (equipment_reservation)
 *
 * 선착순 예약. equipment_id 는 자유 텍스트 키.
 * - 같은 장비의 [start_date, end_date] 가 겹치는 RESERVED 예약이 있으면 신규는 WAITING.
 * - 겹침 없으면 RESERVED.
 * - 취소 시 같은 장비의 가장 앞 WAITING 1건을 RESERVED 로 승격.
 * - WAITING 이 24시간 초과하면 크론(autoCancelStaleWaiting)에서 CANCELLED 처리.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { selectAll } from '@backend/lib/supabasePage'
import { createNotification } from '@backend/services/notifications'

export type ReservationStatus = 'RESERVED' | 'WAITING' | 'CANCELLED' | 'COMPLETED'

export interface EquipmentReservationRow {
  id: string
  equipmentId: string
  userId: string
  userName: string | null
  startDate: string
  endDate: string
  status: ReservationStatus
  waitOrder: number | null
  createdAt: string
}

export interface CreateReservationInput {
  equipmentId: string
  userId: string
  startDate: string
  endDate: string
}

function mapRow(r: Record<string, unknown>): EquipmentReservationRow {
  const user = r.users as Record<string, unknown> | null | undefined
  return {
    id:          r.id as string,
    equipmentId: r.equipment_id as string,
    userId:      r.user_id as string,
    userName:    (user?.display_name as string) ?? (user?.username as string) ?? null,
    startDate:   r.start_date as string,
    endDate:     r.end_date as string,
    status:      (r.status as ReservationStatus) ?? 'RESERVED',
    waitOrder:   (r.wait_order as number) ?? null,
    createdAt:   r.created_at as string,
  }
}

const SELECT = 'id, equipment_id, user_id, start_date, end_date, status, wait_order, created_at, users(username, display_name)'

/**
 * 예약 목록.
 * @param opts.equipmentId 지정 시 해당 장비만.
 * @param opts.userId      지정 시 해당 사용자만(담당자 본인 조회).
 * @param opts.from/to     기간과 겹치는 예약만(start<=to AND end>=from).
 */
export async function listReservations(opts: {
  equipmentId?: string
  from?: string
  to?: string
  userId?: string
} = {}): Promise<EquipmentReservationRow[]> {
  let q = supabaseAdmin
    .from('equipment_reservation')
    .select(SELECT)
    .order('start_date', { ascending: false })

  if (opts.equipmentId) q = q.eq('equipment_id', opts.equipmentId)
  if (opts.userId)      q = q.eq('user_id', opts.userId)
  // 범위 겹침: start_date <= to AND end_date >= from
  if (opts.to)   q = q.lte('start_date', opts.to)
  if (opts.from) q = q.gte('end_date', opts.from)

  const { data, error } = await q
  if (error) throw error
  return (data ?? []).map(r => mapRow(r as Record<string, unknown>))
}

/**
 * 예약 생성(선착순).
 * 같은 장비에 기간이 겹치는 RESERVED 가 있으면 WAITING(wait_order = max+1),
 * 없으면 RESERVED 로 생성. WAITING 일 경우 현재 RESERVED 사용자에게 대기 알림.
 */
export async function createReservation(input: CreateReservationInput): Promise<EquipmentReservationRow> {
  // 1) 기간 겹치는 RESERVED 조회
  const { data: conflicts, error: confErr } = await supabaseAdmin
    .from('equipment_reservation')
    .select('id, user_id')
    .eq('equipment_id', input.equipmentId)
    .eq('status', 'RESERVED')
    .lte('start_date', input.endDate)
    .gte('end_date', input.startDate)
  if (confErr) throw confErr

  let hasConflict = (conflicts ?? []).length > 0

  let status: ReservationStatus = 'RESERVED'
  let waitOrder: number | null = null

  if (hasConflict) {
    status = 'WAITING'
    // 해당 장비 현재 max(wait_order) + 1
    const { data: maxRows, error: maxErr } = await supabaseAdmin
      .from('equipment_reservation')
      .select('wait_order')
      .eq('equipment_id', input.equipmentId)
      .eq('status', 'WAITING')
      .order('wait_order', { ascending: false })
      .limit(1)
    if (maxErr) throw maxErr
    const currentMax = (maxRows?.[0]?.wait_order as number) ?? 0
    waitOrder = currentMax + 1
  }

  const insertRow = async (s: ReservationStatus, w: number | null) =>
    supabaseAdmin
      .from('equipment_reservation')
      .insert({
        equipment_id: input.equipmentId,
        user_id:      input.userId,
        start_date:   input.startDate,
        end_date:     input.endDate,
        status:       s,
        wait_order:   w,
      })
      .select(SELECT)
      .single()

  let { data, error } = await insertRow(status, waitOrder)

  // 겹침 조회(1)와 insert 사이에 다른 요청이 먼저 RESERVED 를 잡았을 수 있다(TOCTOU).
  // 마이그레이션 0031 의 배제 제약이 그 경우를 23P01 로 거절하므로, 여기서 WAITING 으로 강등해
  // 재시도한다. 애플리케이션 재검사로는 이 경쟁을 없앨 수 없어 DB 가 유일한 직렬화 지점이다.
  if (error && (error as { code?: string }).code === '23P01') {
    const { data: maxRows } = await supabaseAdmin
      .from('equipment_reservation')
      .select('wait_order')
      .eq('equipment_id', input.equipmentId)
      .eq('status', 'WAITING')
      .order('wait_order', { ascending: false })
      .limit(1)
    const retryOrder = ((maxRows?.[0]?.wait_order as number) ?? 0) + 1
    status = 'WAITING'
    hasConflict = true
    ;({ data, error } = await insertRow('WAITING', retryOrder))
  }
  if (error) throw error

  // WAITING 이면 현재 RESERVED 사용자에게 대기 등록 알림
  if (hasConflict) {
    const targets = new Set<string>()
    for (const c of conflicts ?? []) {
      const uid = (c as Record<string, unknown>).user_id as string | undefined
      if (uid) targets.add(uid)
    }
    for (const uid of targets) {
      await createNotification({
        type: 'status_changed',
        title: '장비 예약 대기 등록',
        body: `장비 '${input.equipmentId}' 의 예약 기간(${input.startDate} ~ ${input.endDate})에 대기 예약이 등록되었습니다.`,
        targetUserId: uid,
        severity: 'warning',
      }).catch(() => {})
    }
  }

  return mapRow(data as Record<string, unknown>)
}

/**
 * 예약 취소.
 * status=CANCELLED 처리 후, 같은 장비의 가장 앞 WAITING 1건을 RESERVED 로 승격하고
 * 그 사용자에게 알림.
 */
export async function cancelReservation(id: string): Promise<void> {
  // 취소 대상 조회(승계 판단을 위해 equipment_id, status 필요)
  const { data: target, error: tErr } = await supabaseAdmin
    .from('equipment_reservation')
    .select('equipment_id, status')
    .eq('id', id)
    .single()
  if (tErr) throw tErr

  const { error } = await supabaseAdmin
    .from('equipment_reservation')
    .update({ status: 'CANCELLED' })
    .eq('id', id)
  if (error) throw error

  // 취소된 것이 RESERVED 였을 때만 대기열 승계
  if ((target?.status as string) !== 'RESERVED') return
  const equipmentId = target?.equipment_id as string

  // 대기열 앞에서부터 승격을 시도한다.
  //
  // 예전에는 맨 앞 1건을 무조건 RESERVED 로 올렸는데, 그 대기 예약이 **다른** RESERVED 와도
  // 겹치는 경우(취소된 건 말고 제3의 예약)에는 이중 예약이 만들어졌다.
  // 이제 0031 의 배제 제약이 그런 승격을 23P01 로 거절하므로, 거절되면 다음 대기자를 시도한다.
  const { data: waitingRows, error: nErr } = await supabaseAdmin
    .from('equipment_reservation')
    .select('id, user_id, start_date, end_date')
    .eq('equipment_id', equipmentId)
    .eq('status', 'WAITING')
    .order('wait_order', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(10)
  if (nErr) throw nErr

  for (const row of (waitingRows ?? []) as Record<string, unknown>[]) {
    const { error: promoteErr } = await supabaseAdmin
      .from('equipment_reservation')
      .update({ status: 'RESERVED', wait_order: null })
      .eq('id', row.id as string)
      .eq('status', 'WAITING')      // 낙관적 잠금 — 그 사이 취소/승격됐으면 건너뜀
    if (promoteErr) {
      // 여전히 다른 RESERVED 와 겹치는 대기자 → 다음 순번 시도
      if ((promoteErr as { code?: string }).code === '23P01') continue
      throw promoteErr
    }

    const nextUserId = row.user_id as string | undefined
    if (nextUserId) {
      await createNotification({
        type: 'status_changed',
        title: '장비 예약 확정',
        body: `대기 중이던 장비 '${equipmentId}' 예약(${row.start_date} ~ ${row.end_date})이 확정되었습니다.`,
        targetUserId: nextUserId,
        severity: 'info',
      }).catch(() => {})
    }
    return
  }
}

/** 예약 완료. status=COMPLETED. */
export async function completeReservation(id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('equipment_reservation')
    .update({ status: 'COMPLETED' })
    .eq('id', id)
  if (error) throw error
}

/**
 * WAITING 상태가 created_at 기준 24시간을 초과한 건을 CANCELLED 로 일괄 전환.
 * 크론에서 호출. 전환된 건수를 반환한다.
 */
export async function autoCancelStaleWaiting(): Promise<number> {
  const cutoff = new Date(Date.now() - 24 * 3600 * 1000).toISOString()
  const { data, error } = await supabaseAdmin
    .from('equipment_reservation')
    .update({ status: 'CANCELLED' })
    .eq('status', 'WAITING')
    .lt('created_at', cutoff)
    .select('id')
  if (error) throw error
  return (data ?? []).length
}

/** 기존 예약의 distinct equipment_id 목록(화면 datalist 용). */
export async function listEquipmentIds(): Promise<string[]> {
  // 예약은 계속 쌓이는 테이블 — 1000행 절단 시 장비 목록이 누락된다 → selectAll
  const { data, error } = await selectAll(supabaseAdmin, 'equipment_reservation', 'equipment_id')
  if (error) throw new Error(error.message)
  const ids = new Set<string>()
  for (const r of data ?? []) {
    const eid = (r as Record<string, unknown>).equipment_id as string | undefined
    if (eid) ids.add(eid)
  }
  return [...ids]
}

/** 예약 소유자 user_id 조회 (권한 확인용). 없으면 null. */
export async function reservationOwnerId(id: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('equipment_reservation')
    .select('user_id')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data?.user_id as string) ?? null
}

/** 예약 완전 삭제 (관리자 전용). 취소는 cancelReservation 을 쓴다. */
export async function deleteReservation(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from('equipment_reservation').delete().eq('id', id)
  if (error) throw error
}
