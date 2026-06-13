/**
 * [BACKEND] QC 번호 채번 — YYYYMMDDHHMM + 2자리 시퀀스
 * 예: 2026-06-13 14:30 의 첫 작업 → 20260613143001
 */

import { supabaseAdmin } from '@backend/lib/supabase'

/** 현재 시각(Asia/Seoul)을 YYYYMMDDHHMM 문자열로 */
function minutePrefix(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date())
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? ''
  return `${get('year')}${get('month')}${get('day')}${get('hour')}${get('minute')}`
}

/**
 * 같은 분(prefix) 내 기존 채번 수 + 1 로 2자리 시퀀스를 붙인다.
 * 동시성으로 인한 unique 충돌 시 호출부에서 재시도.
 */
export async function generateQcNo(): Promise<string> {
  const prefix = minutePrefix()
  const { count } = await supabaseAdmin
    .from('qc_jobs')
    .select('id', { count: 'exact', head: true })
    .like('qc_no', `${prefix}%`)
  const seq = String((count ?? 0) + 1).padStart(2, '0')
  return `${prefix}${seq}`
}
