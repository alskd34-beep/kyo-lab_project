import { supabaseAdmin as supabase } from '@backend/lib/supabase'

export interface TestItemRow {
  id: string
  name: string
  category: string
  /** 예상 소요 분 — 이 시스템 소요시간의 단일 기준(0045) */
  estimatedMinutes: number | null
  /** @deprecated 하위 호환용 파생값. 새 코드는 estimatedMinutes 를 쓴다 */
  estimatedHours: number | null
  requiresDuo: boolean
  isActive: boolean
  createdAt: string
}

export const TEST_ITEM_CATEGORIES = [
  '성상·포장', '이화학', '함량시험', '확인시험', '기기분석', '안전성', '밸리데이션', '기타',
] as const
export type TestItemCategory = typeof TEST_ITEM_CATEGORIES[number]

function mapRow(r: Record<string, unknown>): TestItemRow {
  return {
    id:             r.id as string,
    name:           r.name as string,
    category:       (r.category as string) ?? '기타',
    // 예상시간의 단일 기준은 **분**이다(0045). estimated_hours 는 하위 호환용 파생값이라
    // 분이 없을 때만 시간에서 되계산한다 — 0045 미적용 DB 에서도 화면이 비지 않는다.
    estimatedMinutes: r.estimated_minutes != null
      ? Number(r.estimated_minutes)
      : (r.estimated_hours != null ? Math.round(Number(r.estimated_hours) * 60) : null),
    estimatedHours: r.estimated_hours != null ? Number(r.estimated_hours) : null,
    requiresDuo:    r.requires_duo as boolean,
    isActive:       r.is_active as boolean,
    createdAt:      r.created_at as string,
  }
}


/**
 * 0045(estimated_minutes) 적용 여부. 미적용 DB 에서 그 컬럼을 patch 에 넣으면 PGRST204 로
 * **저장 자체가 실패한다** — 읽기는 select('*') 로 막았지만 쓰기는 컬럼명을 적어야 한다.
 * 프로세스당 한 번만 확인하고 기억한다(스키마가 도중에 바뀌면 재시작하면 된다).
 */
let hasMinutesColumn: boolean | null = null
async function supportsEstimatedMinutes(): Promise<boolean> {
  if (hasMinutesColumn !== null) return hasMinutesColumn
  const { error } = await supabase.from('test_items').select('estimated_minutes').limit(1)
  hasMinutesColumn = !error
  if (error) {
    console.warn('[test-items] estimated_minutes 컬럼이 없어 시간(h) 컬럼만 갱신합니다 — 0045 적용 필요')
  }
  return hasMinutesColumn
}

export async function listTestItems(): Promise<TestItemRow[]> {
  const { data, error } = await supabase
    .from('test_items')
    // 0045 의 estimated_minutes 를 이름으로 적으면 미적용 DB 에서 42703 이 나고
    // 목록 전체가 500 이 된다. '*' 면 없는 컬럼은 빠지고 mapRow 의 폴백이 받는다.
    .select('*')
    .order('category', { ascending: true })
    .order('name',     { ascending: true })
  if (error) {
    // category 컬럼 미적용 DB에 대한 fallback (마이그레이션 0007 미실행 환경)
    const code = (error as { code?: string }).code
    const msg = (error as { message?: string }).message ?? ''
    if (code === '42703' || /category/i.test(msg)) {
      const { data: data2, error: error2 } = await supabase
        .from('test_items')
        .select('*')
        .order('name', { ascending: true })
      if (error2) throw error2
      return (data2 ?? []).map(r => mapRow(r as Record<string, unknown>))
    }
    throw error
  }
  return (data ?? []).map(r => mapRow(r as Record<string, unknown>))
}

export async function createTestItem(input: {
  name: string
  category?: string
  /** 예상 소요 분 — 화면이 보내는 기준값 */
  estimatedMinutes?: number | null
  requiresDuo?: boolean
}): Promise<TestItemRow> {
  const { data, error } = await supabase
    .from('test_items')
    .insert({
      name:           input.name,
      category:       input.category ?? '기타',
      // 분이 기준이고 시간은 함께 채워 둔다 — 챗봇 컨텍스트(qthinkAgent·chat)가 아직
      // estimated_hours 를 읽는다. 한쪽만 갱신하면 그 조회가 조용히 빈다.
      // 0045 미적용 DB 에서는 분 컬럼을 빼고 보낸다(넣으면 저장 자체가 실패한다).
      ...(await supportsEstimatedMinutes() ? { estimated_minutes: input.estimatedMinutes ?? null } : {}),
      estimated_hours: input.estimatedMinutes != null
        ? Math.round((input.estimatedMinutes / 60) * 100) / 100
        : null,
      requires_duo:   input.requiresDuo ?? false,
    })
    // 0045 의 estimated_minutes 를 이름으로 적으면 미적용 DB 에서 42703 이 나고
    // 목록 전체가 500 이 된다. '*' 면 없는 컬럼은 빠지고 mapRow 의 폴백이 받는다.
    .select('*')
    .single()
  if (error) {
    // 23505: unique_violation — 시험항목명 중복
    if ((error as { code?: string }).code === '23505') {
      throw new Error(`이미 등록된 시험항목명입니다: "${input.name}"`)
    }
    throw error
  }
  return mapRow(data as Record<string, unknown>)
}

export async function updateTestItem(
  id: string,
  input: Partial<{
    name: string
    category: string
    estimatedMinutes: number | null
    requiresDuo: boolean
    isActive: boolean
  }>
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (input.name            !== undefined) patch.name            = input.name
  if (input.category        !== undefined) patch.category        = input.category
  if (input.estimatedMinutes !== undefined) {
    if (await supportsEstimatedMinutes()) patch.estimated_minutes = input.estimatedMinutes
    patch.estimated_hours = input.estimatedMinutes != null
      ? Math.round((input.estimatedMinutes / 60) * 100) / 100
      : null
  }
  if (input.requiresDuo     !== undefined) patch.requires_duo    = input.requiresDuo
  if (input.isActive        !== undefined) patch.is_active       = input.isActive

  const { error } = await supabase.from('test_items').update(patch).eq('id', id)
  if (error) {
    // 23505: unique_violation — 다른 시험항목과 이름 중복
    if ((error as { code?: string }).code === '23505') {
      throw new Error(
        input.name ? `이미 등록된 시험항목명입니다: "${input.name}"` : '이미 등록된 시험항목명입니다.'
      )
    }
    throw error
  }
}

export async function deleteTestItem(id: string): Promise<void> {
  const { error } = await supabase.from('test_items').delete().eq('id', id)
  if (error) throw error
}
