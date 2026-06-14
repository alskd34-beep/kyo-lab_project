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

  const hasConflict = (conflicts ?? []).length > 0

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

  const { data, error } = await supabaseAdmin
    .from('equipment_reservation')
    .insert({
      equipment_id: input.equipmentId,
      user_id:      input.userId,
      start_date:   input.startDate,
      end_date:     input.endDate,
      status,
      wait_order:   waitOrder,
    })
    .select(SELECT)
    .single()
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

  // 가장 앞 WAITING 1건(wait_order 오름차순, 동률이면 created_at)
  const { data: nextRows, error: nErr } = await supabaseAdmin
    .from('equipment_reservation')
    .select('id, user_id, start_date, end_date')
    .eq('equipment_id', equipmentId)
    .eq('status', 'WAITING')
    .order('wait_order', { ascending: true, nullsFirst: true })
    .order('created_at', { ascending: true })
    .limit(1)
  if (nErr) throw nErr

  const next = nextRows?.[0] as Record<string, unknown> | undefined
  if (!next) return

  const { error: promoteErr } = await supabaseAdmin
    .from('equipment_reservation')
    .update({ status: 'RESERVED', wait_order: null })
    .eq('id', next.id as string)
  if (promoteErr) throw promoteErr

  const nextUserId = next.user_id as string | undefined
  if (nextUserId) {
    await createNotification({
      type: 'status_changed',
      title: '장비 예약 확정',
      body: `대기 중이던 장비 '${equipmentId}' 예약(${next.start_date} ~ ${next.end_date})이 확정되었습니다.`,
      targetUserId: nextUserId,
      severity: 'info',
    }).catch(() => {})
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
  const { data, error } = await supabaseAdmin
    .from('equipment_reservation')
    .select('equipment_id')
    .order('equipment_id', { ascending: true })
  if (error) throw error
  const ids = new Set<string>()
  for (const r of data ?? []) {
    const eid = (r as Record<string, unknown>).equipment_id as string | undefined
    if (eid) ids.add(eid)
  }
  return [...ids]
}
