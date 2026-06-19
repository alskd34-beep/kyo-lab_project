/**
 * [BACKEND] PCT 월간 스케줄 스냅샷 서버 영속화
 *
 * AI 스케줄(규칙엔진) 배정 결과를 기기/브라우저 무관하게 공유하기 위해
 * 단일 JSON 스냅샷을 app_settings(key='pct_monthly_snapshot', value text)에 저장한다.
 * 기존 localStorage 캐시를 대체/보강하는 서버 단일 소스.
 * (마이그레이션 불필요 — app_settings는 0010에서 생성됨)
 */

import { supabaseAdmin } from '@backend/lib/supabase'

const SNAPSHOT_KEY = 'pct_monthly_snapshot'

/** 스냅샷 JSON 문자열 저장 (덮어쓰기). */
export async function savePctSnapshot(value: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('app_settings')
    .upsert({ key: SNAPSHOT_KEY, value, updated_at: new Date().toISOString() }, { onConflict: 'key' })
  if (error) throw error
}

/** 저장된 스냅샷 JSON 문자열 반환 (없거나 테이블 부재 시 null). */
export async function loadPctSnapshot(): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('app_settings')
    .select('value')
    .eq('key', SNAPSHOT_KEY)
    .maybeSingle()
  if (error) {
    if ((error as { code?: string }).code === '42P01') return null // 테이블 미적용
    throw error
  }
  return (data?.value as string) ?? null
}

/** 저장된 스냅샷 삭제. */
export async function clearPctSnapshot(): Promise<void> {
  const { error } = await supabaseAdmin
    .from('app_settings')
    .delete()
    .eq('key', SNAPSHOT_KEY)
  if (error && (error as { code?: string }).code !== '42P01') throw error
}
