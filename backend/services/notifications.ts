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
import { maskNaKeys } from '@shared/order-na'

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

// 알림 문구는 호출부(서비스·DB 함수)마다 제조번호·품목코드를 그대로 끼워 만든다. 수동 오더의 N/A 대체값
// (NA-P-…/NA-B-…)이 가짜 번호로 보이지 않게 **읽을 때 한 곳에서** "N/A" 로 바꾼다 — 저장값은 원문 유지.
function mapRow(r: Record<string, unknown>): NotificationRow {
  return {
    id: r.id as string,
    type: r.type as string,
    title: maskNaKeys(r.title as string),
    body: r.body == null ? null : maskNaKeys(r.body as string),
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
 *
 * 슬랙은 여기서 처리하지 않는다. 이 함수의 호출부 14곳이 전부 channel 을 넘기지 않아
 * 항상 'in_app' 으로 들어오는데, 그 조건을 풀면 item_cleared(시험항목 1개마다 1건)·
 * 적재 루프(시트 행마다)·개인 대상 알림까지 전부 슬랙으로 나가 rate limit(≈1/s)에 걸린다.
 * 단계 전이 슬랙 알림은 @backend/services/slackNotify 가 별도 경로로 담당한다.
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
/**
 * 조회 스코프를 요청자에게 한정한다.
 * - admin  : 본인 대상 + 전체 공지(target_user_id is null)
 * - tester : 본인 대상만
 *
 * userId 는 우리가 발급한 JWT 의 sub(UUID)라 현재는 공격자 제어가 아니지만,
 * PostgREST 필터 문자열에 값을 이어붙이는 자리이므로 UUID 형식을 강제해 둔다.
 */
function scopeToViewer<T extends { or: (f: string) => T; eq: (c: string, v: string) => T }>(
  query: T, userId: string, role: 'admin' | 'tester',
): T {
  if (!/^[0-9a-fA-F-]{36}$/.test(userId)) {
    throw new Error('잘못된 사용자 식별자입니다.')
  }
  return role === 'admin'
    ? query.or(`target_user_id.eq.${userId},target_user_id.is.null`)
    : query.eq('target_user_id', userId)
}

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

  query = scopeToViewer(query, userId, role)
  if (opts.unreadOnly) query = query.eq('is_read', false)

  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(mapRow)
}

/**
 * 읽음 처리 (단건 또는 전체).
 *
 * 2026-08-23 보안 수정: 단건(id 지정) 경로에만 소유자 조건이 빠져 있어
 * 임의 사용자가 타인의 미읽음 알림을 읽음 처리할 수 있었다. 마감 임박(D-7,
 * severity=critical) 알림이 대상자에게 도달하지 못한 채 사라질 수 있는 경로였다.
 * 이제 단건도 전체와 동일한 스코프를 적용한다.
 */
export async function markRead(userId: string, role: 'admin' | 'tester', id?: string): Promise<void> {
  let query = supabaseAdmin.from('notifications').update({ is_read: true })
  if (id) query = query.eq('id', id)
  // 스코프는 단건/전체 공통으로 적용한다.
  query = scopeToViewer(query, userId, role)
  const { error } = await query
  if (error) throw error
}
