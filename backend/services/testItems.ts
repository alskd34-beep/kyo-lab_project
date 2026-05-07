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
  if (error) throw error
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
  if (error) throw error
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
  if (error) throw error
}

export async function deleteTestItem(id: string): Promise<void> {
  const { error } = await supabase.from('test_items').delete().eq('id', id)
  if (error) throw error
}
