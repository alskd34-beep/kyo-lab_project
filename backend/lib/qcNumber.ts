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
 * 같은 분(prefix) 내 **가장 큰 시퀀스 + 1** 로 2자리 시퀀스를 붙인다(없으면 01).
 *
 * 개수+1 이 아닌 이유: 작업 시작 취소로 중간 번호(예: 01)가 지워지면 개수+1 은 남은 번호(02)와
 * 충돌하고, 재시도해도 같은 값을 만든다. 최대값+1 은 재시도 때 새로 커밋된 번호를 다시 읽는다.
 * 동시성으로 인한 unique 충돌 시 호출부에서 재시도.
 */
export async function generateQcNo(): Promise<string> {
  const prefix = minutePrefix()
  const { data, error } = await supabaseAdmin
    .from('qc_jobs')
    .select('qc_no')
    .like('qc_no', `${prefix}%`)
    .order('qc_no', { ascending: false })
    .limit(1)
    .maybeSingle()
  // 조회 실패를 "기존 번호 없음" 으로 삼키면 01 을 만들어, 진짜 원인이 채번 충돌 뒤에 가려진다
  if (error) throw error
  const last = Number.parseInt(String(data?.qc_no ?? '').slice(prefix.length), 10)
  const seq = String((Number.isFinite(last) ? last : 0) + 1).padStart(2, '0')
  return `${prefix}${seq}`
}
