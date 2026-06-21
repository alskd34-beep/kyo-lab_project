/**
 * [BACKEND] 알림 서비스
 *
 * 알림은 우선 notifications 테이블에 적재한다.
 * SNS(텔레그램/카톡) 실제 전송은 홀드 — dispatch()에 스텁만 둔다.
 *
 * target_user_id = null  → 전체 감독관(admin)에게 보이는 알림.
 *                = uuid  → 특정 사용자(담당자) 전용.
 */

import { supabaseAdmin } from '@backend/lib/supabase'

export type NotificationType =
  | 'product_unsynced'   // 품목마스터 미동기화
  | 'item_cleared'       // 시험항목 클리어
  | 'status_changed'     // 상태 변경
  | 'deadline_due'       // 마감 임박(D-7)
  | 'ingest'             // 적재 요약

export type NotificationSeverity = 'info' | 'warning' | 'critical'

export interface CreateNotificationInput {
  type: NotificationType
  title: string
  body?: string
  targetUserId?: string | null
  relatedOrderId?: string | null
  relatedQcJobId?: string | null
  severity?: NotificationSeverity
  channel?: 'in_app' | 'telegram' | 'kakao'
}

export interface NotificationRow {
  id: string
  type: string
  title: string
  body: string | null
  targetUserId: string | null
  relatedOrderId: string | null
  relatedQcJobId: string | null
  channel: string
  severity: string
  isRead: boolean
  createdAt: string
}

function mapRow(r: Record<string, unknown>): NotificationRow {
  return {
    id: r.id as string,
    type: r.type as string,
    title: r.title as string,
    body: (r.body as string) ?? null,
    targetUserId: (r.target_user_id as string) ?? null,
    relatedOrderId: (r.related_order_id as string) ?? null,
    relatedQcJobId: (r.related_qc_job_id as string) ?? null,
    channel: r.channel as string,
    severity: r.severity as string,
    isRead: !!r.is_read,
    createdAt: r.created_at as string,
  }
}

/** 알림 생성 + 채널 디스패치 */
export async function createNotification(input: CreateNotificationInput): Promise<NotificationRow> {
  const channel = input.channel ?? 'in_app'
  const { data, error } = await supabaseAdmin
    .from('notifications')
    .insert({
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      target_user_id: input.targetUserId ?? null,
      related_order_id: input.relatedOrderId ?? null,
      related_qc_job_id: input.relatedQcJobId ?? null,
      channel,
      severity: input.severity ?? 'info',
    })
    .select('*')
    .single()
  if (error) throw error

  await dispatch(channel, input)
  return mapRow(data)
}

/**
 * 채널 전송. in_app 은 테이블 적재로 충분(no-op).
 * telegram/kakao 는 1차에서 홀드.
 */
async function dispatch(channel: string, input: CreateNotificationInput): Promise<void> {
  if (channel === 'in_app') return
  // HOLD: 텔레그램/카톡 전송은 1차 범위 외. 추후 여기에 input 으로 연동.
  void input
}

/**
 * 사용자별 알림 목록.
 * - 본인 대상(target_user_id = userId)
 * - admin 이면 전체 공지(target_user_id is null)도 포함
 */
export async function listForUser(
  userId: string,
  role: 'admin' | 'tester',
  opts: { unreadOnly?: boolean; limit?: number } = {},
): Promise<NotificationRow[]> {
  let query = supabaseAdmin
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(opts.limit ?? 50)

  if (role === 'admin') {
    query = query.or(`target_user_id.eq.${userId},target_user_id.is.null`)
  } else {
    query = query.eq('target_user_id', userId)
  }
  if (opts.unreadOnly) query = query.eq('is_read', false)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(mapRow)
}

/** 읽음 처리 (단건 또는 전체) */
export async function markRead(userId: string, role: 'admin' | 'tester', id?: string): Promise<void> {
  let query = supabaseAdmin.from('notifications').update({ is_read: true })
  if (id) {
    query = query.eq('id', id)
  } else if (role === 'admin') {
    query = query.or(`target_user_id.eq.${userId},target_user_id.is.null`)
  } else {
    query = query.eq('target_user_id', userId)
  }
  const { error } = await query
  if (error) throw error
}
