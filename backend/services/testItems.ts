import { supabase } from '@backend/lib/supabase'

export interface TestItemRow {
  id: string
  name: string
  category: string
  estimatedHours: number | null
  requiresDuo: boolean
  isActive: boolean
  createdAt: string
}

export const TEST_ITEM_CATEGORIES = [
  '성상·포장', '이화학', '함량시험', '확인시험', '기기분석', '안전성', '기타',
] as const
export type TestItemCategory = typeof TEST_ITEM_CATEGORIES[number]

function mapRow(r: Record<string, unknown>): TestItemRow {
  return {
    id:             r.id as string,
    name:           r.name as string,
    category:       (r.category as string) ?? '기타',
    estimatedHours: r.estimated_hours != null ? Number(r.estimated_hours) : null,
    requiresDuo:    r.requires_duo as boolean,
    isActive:       r.is_active as boolean,
    createdAt:      r.created_at as string,
  }
}

export async function listTestItems(): Promise<TestItemRow[]> {
  const { data, error } = await supabase
    .from('test_items')
    .select('id, name, category, estimated_hours, requires_duo, is_active, created_at')
    .order('category', { ascending: true })
    .order('name',     { ascending: true })
  if (error) {
    // category 컬럼 미적용 DB에 대한 fallback (마이그레이션 0007 미실행 환경)
    const code = (error as { code?: string }).code
    const msg = (error as { message?: string }).message ?? ''
    if (code === '42703' || /category/i.test(msg)) {
      const { data: data2, error: error2 } = await supabase
        .from('test_items')
        .select('id, name, estimated_hours, requires_duo, is_active, created_at')
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
  estimatedHours?: number
  requiresDuo?: boolean
}): Promise<TestItemRow> {
  const { data, error } = await supabase
    .from('test_items')
    .insert({
      name:           input.name,
      category:       input.category ?? '기타',
      estimated_hours: input.estimatedHours ?? null,
      requires_duo:   input.requiresDuo ?? false,
    })
    .select('id, name, category, estimated_hours, requires_duo, is_active, created_at')
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
    estimatedHours: number | null
    requiresDuo: boolean
    isActive: boolean
  }>
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (input.name            !== undefined) patch.name            = input.name
  if (input.category        !== undefined) patch.category        = input.category
  if (input.estimatedHours  !== undefined) patch.estimated_hours = input.estimatedHours
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
