/**
 * [BACKEND] 시험항목 그룹 (test_item_groups / test_item_group_items)
 *
 * '전공정' 처럼 여러 시험항목을 **순서대로 묶은 템플릿**이다.
 * 품목별 시험항목(`product_test_items`)에 통째로 넣기 위한 것이며,
 * `test_items.category`(대분류: 안전성·기기분석 …)와는 다른 개념이다 —
 * 대분류는 분류·색상용이고, 한 항목이 여러 그룹에 속할 수 있다.
 *
 * 스키마: supabase/migrations/0029_test_item_groups.sql
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { selectAll } from '@backend/lib/supabasePage'
import { describeSchemaError } from '@backend/lib/schemaError'

export interface GroupRow {
  id: string
  name: string
  description: string | null
  sortOrder: number
  isActive: boolean
  /** 그룹에 속한 시험항목 수 */
  itemCount: number
}

export interface GroupItemRow {
  testItemId: string
  testItemName: string
  category: string
  sequenceOrder: number
}

function mapGroup(r: Record<string, unknown>, itemCount: number): GroupRow {
  return {
    id:          r.id as string,
    name:        r.name as string,
    description: (r.description as string) ?? null,
    sortOrder:   (r.sort_order as number) ?? 0,
    isActive:    r.is_active !== false,
    itemCount,
  }
}

/** 그룹 목록 (정렬순 → 이름순). 각 그룹의 항목 수 포함. */
export async function listGroups(): Promise<GroupRow[]> {
  const [groupRes, memberRes] = await Promise.all([
    supabaseAdmin
      .from('test_item_groups')
      .select('id, name, description, sort_order, is_active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    selectAll(supabaseAdmin, 'test_item_group_items', 'group_id'),
  ])
  if (groupRes.error) throw describeSchemaError(groupRes.error, '시험항목 그룹')
  if (memberRes.error) throw describeSchemaError(memberRes.error, '시험항목 그룹')

  const count = new Map<string, number>()
  for (const m of memberRes.data ?? []) {
    const gid = m.group_id as string
    count.set(gid, (count.get(gid) ?? 0) + 1)
  }
  return (groupRes.data ?? []).map(g =>
    mapGroup(g as Record<string, unknown>, count.get((g as { id: string }).id) ?? 0))
}

/** 한 그룹의 시험항목 (순번 오름차순) */
export async function listGroupItems(groupId: string): Promise<GroupItemRow[]> {
  const { data, error } = await supabaseAdmin
    .from('test_item_group_items')
    .select('test_item_id, sequence_order, test_items!inner(name, category)')
    .eq('group_id', groupId)
    .order('sequence_order', { ascending: true })
  if (error) throw describeSchemaError(error, '시험항목 그룹')

  return (data ?? []).map(r => {
    const row = r as unknown as {
      test_item_id: string
      sequence_order: number
      test_items: { name: string; category: string }
    }
    return {
      testItemId:    row.test_item_id,
      testItemName:  row.test_items.name,
      category:      row.test_items.category ?? '기타',
      sequenceOrder: row.sequence_order ?? 0,
    }
  })
}

export interface CreateGroupInput {
  name: string
  description?: string | null
  sortOrder?: number
}

export async function createGroup(input: CreateGroupInput): Promise<GroupRow> {
  const name = (input.name ?? '').trim()
  if (!name) throw new Error('그룹 이름은 필수입니다.')

  const { data, error } = await supabaseAdmin
    .from('test_item_groups')
    .insert({
      name,
      description: input.description?.trim() || null,
      sort_order:  input.sortOrder ?? 0,
    })
    .select('id, name, description, sort_order, is_active')
    .single()
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('같은 이름의 그룹이 이미 있습니다.')
    throw new Error(`그룹 생성 실패: ${error.message}`)
  }
  return mapGroup(data as Record<string, unknown>, 0)
}

export interface UpdateGroupInput {
  name?: string
  description?: string | null
  sortOrder?: number
  isActive?: boolean
}

export async function updateGroup(id: string, input: UpdateGroupInput): Promise<void> {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new Error('그룹 이름은 비울 수 없습니다.')
    patch.name = name
  }
  if (input.description !== undefined) patch.description = input.description?.trim() || null
  if (input.sortOrder   !== undefined) patch.sort_order  = input.sortOrder
  if (input.isActive    !== undefined) patch.is_active   = input.isActive

  const { error } = await supabaseAdmin.from('test_item_groups').update(patch).eq('id', id)
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('같은 이름의 그룹이 이미 있습니다.')
    throw new Error(`그룹 수정 실패: ${error.message}`)
  }
}

export async function deleteGroup(id: string): Promise<void> {
  // 멤버는 on delete cascade 로 함께 지워진다. 품목에 이미 넣은 항목은 영향받지 않는다
  // (그룹은 "넣을 때 쓰는 템플릿"일 뿐 품목과 참조 관계가 없다).
  const { error } = await supabaseAdmin.from('test_item_groups').delete().eq('id', id)
  if (error) throw new Error(`그룹 삭제 실패: ${error.message}`)
}

/**
 * 그룹의 시험항목을 통째로 교체한다. 준 순서가 그대로 순번이 된다.
 * 빈 배열이면 전부 비운다.
 */
export async function replaceGroupItems(groupId: string, testItemIds: string[]): Promise<void> {
  const { error: delErr } = await supabaseAdmin
    .from('test_item_group_items')
    .delete()
    .eq('group_id', groupId)
  if (delErr) throw new Error(`그룹 항목 초기화 실패: ${delErr.message}`)

  const seen = new Set<string>()
  const rows = testItemIds
    .filter(id => id && !seen.has(id) && seen.add(id) !== undefined)
    .map((id, idx) => ({ group_id: groupId, test_item_id: id, sequence_order: idx }))
  if (rows.length === 0) return

  const { error } = await supabaseAdmin.from('test_item_group_items').insert(rows)
  if (error) throw new Error(`그룹 항목 저장 실패: ${error.message}`)
}

/**
 * 그룹을 품목별 시험항목에 붙여넣는다.
 *
 * 이미 있는 항목은 건너뛰고(순서 유지), 없는 항목만 품목 끝에 그룹 순서대로 덧붙인다.
 * 덮어쓰지 않으므로 여러 그룹을 이어서 넣어도 안전하다.
 *
 * @returns 실제로 추가된 항목 수
 */
export async function applyGroupToProduct(groupId: string, productId: string): Promise<number> {
  const [items, existingRes] = await Promise.all([
    listGroupItems(groupId),
    supabaseAdmin
      .from('product_test_items')
      .select('test_item_id, sequence_order')
      .eq('product_id', productId),
  ])
  if (existingRes.error) throw new Error(`품목 시험항목 조회 실패: ${existingRes.error.message}`)
  if (items.length === 0) return 0

  const existing = new Set((existingRes.data ?? []).map(r => r.test_item_id as string))
  let nextSeq = (existingRes.data ?? []).reduce(
    (max, r) => Math.max(max, (r.sequence_order as number) ?? 0), -1) + 1

  const rows = items
    .filter(i => !existing.has(i.testItemId))
    .map(i => ({
      product_id:     productId,
      test_item_id:   i.testItemId,
      sequence_order: nextSeq++,
      is_mandatory:   true,
    }))
  if (rows.length === 0) return 0

  const { error } = await supabaseAdmin.from('product_test_items').insert(rows)
  if (error) throw new Error(`품목에 그룹 적용 실패: ${error.message}`)
  return rows.length
}
