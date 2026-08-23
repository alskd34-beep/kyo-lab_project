/**
 * [BACKEND] QC 작업 상태 변경 이력
 *
 * 상태 전이가 일어나는 곳(작업 시작·자동 전환·관리자 단계 전이·담당자 상태 변경)에서
 * `logJobStatusChange` 를 호출해 구조화된 이력을 남긴다.
 *
 * 원칙: **이력 적재 실패가 상태 전이 자체를 되돌리지 않는다.**
 * 상태는 이미 커밋됐는데 로깅 오류로 500을 내면 화면은 실패로 보이지만 DB는 바뀐 상태가 된다.
 * 실패는 서버 로그로만 남기고 호출부는 계속 진행한다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'

export type JobStatusSource = 'manual' | 'auto' | 'system' | 'backfill'

export interface JobStatusHistoryRow {
  id: string
  jobId: string
  orderId: string | null
  fromStatus: string | null
  toStatus: string
  changedById: string | null
  changedByName: string | null
  source: JobStatusSource
  note: string | null
  createdAt: string
}

interface LogInput {
  jobId: string
  orderId?: string | null
  /** 최초 생성(작업 시작)이면 null */
  fromStatus?: string | null
  toStatus: string
  /** 변경한 로그인 사용자 id. 서버 자동 전환이면 생략 */
  changedBy?: string | null
  source?: JobStatusSource
  note?: string | null
}

/** users.display_name ?? username — 사용자가 지워져도 이력에 남도록 스냅샷으로 저장한다. */
async function resolveUserName(userId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('users').select('display_name, username').eq('id', userId).maybeSingle()
  if (!data) return null
  return (data.display_name as string | null) ?? (data.username as string | null) ?? null
}

/** 상태 전이 1건 적재 (best effort — 실패해도 throw 하지 않는다) */
export async function logJobStatusChange(input: LogInput): Promise<void> {
  try {
    const changedByName = input.changedBy ? await resolveUserName(input.changedBy) : null
    const { error } = await supabaseAdmin.from('qc_job_status_history').insert({
      qc_job_id: input.jobId,
      order_id: input.orderId ?? null,
      from_status: input.fromStatus ?? null,
      to_status: input.toStatus,
      changed_by: input.changedBy ?? null,
      changed_by_name: changedByName,
      source: input.source ?? 'manual',
      note: input.note ?? null,
    })
    if (error) throw error
  } catch (err) {
    console.error('[qcJobStatusHistory] 이력 적재 실패 — 상태 전이는 그대로 유지됩니다:', input, err)
  }
}

/**
 * 이력 테이블이 아직 없는 환경(마이그레이션 0032 미적용)의 오류인가.
 * PostgREST 는 스키마 캐시에 없는 테이블을 PGRST205 로, Postgres 는 42P01 로 알린다.
 */
function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false
  return err.code === 'PGRST205' || err.code === '42P01'
    || /qc_job_status_history/.test(err.message ?? '') && /does not exist|not find/i.test(err.message ?? '')
}

/** 작업 1건의 상태 이력 (오래된 순 — 화면에서 위→아래로 흐름을 읽는다) */
export async function listJobStatusHistory(jobId: string): Promise<JobStatusHistoryRow[]> {
  const { data, error } = await supabaseAdmin
    .from('qc_job_status_history')
    .select('id, qc_job_id, order_id, from_status, to_status, changed_by, changed_by_name, source, note, created_at')
    .eq('qc_job_id', jobId)
    .order('created_at', { ascending: true })
  if (error) {
    if (isMissingTable(error)) {
      throw new Error('상태 이력 테이블이 아직 없습니다. supabase/migrations/0032_qc_job_status_history.sql 을 적용하세요.')
    }
    throw error
  }
  return (data ?? []).map(r => ({
    id: r.id as string,
    jobId: r.qc_job_id as string,
    orderId: (r.order_id as string) ?? null,
    fromStatus: (r.from_status as string) ?? null,
    toStatus: r.to_status as string,
    changedById: (r.changed_by as string) ?? null,
    changedByName: (r.changed_by_name as string) ?? null,
    source: ((r.source as string) ?? 'manual') as JobStatusSource,
    note: (r.note as string) ?? null,
    createdAt: r.created_at as string,
  }))
}
