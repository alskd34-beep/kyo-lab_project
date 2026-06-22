/**
 * [BACKEND] 품목별 시험 전 확인사항 (product_pretest_notes)
 *
 * 품목(product_id) 기준으로 시험 전 점검/주의사항·이슈를 항목 단위로 적재한다.
 * 일시(occurred_at)·작성자(created_by/created_by_name)·특이사항(remark)·이슈 로트(issue_lot) 포함.
 * 테이블 미적용(0019 미실행) 환경에서도 앱이 죽지 않도록 graceful 폴백한다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'

export interface PretestNoteRow {
  id: string
  content: string
  occurredAt: string | null
  remark: string | null
  issueLot: string | null
  createdBy: string | null
  createdByName: string | null
  createdAt: string
}

export interface AddNoteInput {
  productId: string
  content: string
  occurredAt?: string | null
  remark?: string | null
  issueLot?: string | null
  createdBy?: string | null
  createdByName?: string | null
}

const SELECT =
  'id, content, occurred_at, remark, issue_lot, created_by, created_by_name, created_at'

function mapRow(r: Record<string, unknown>): PretestNoteRow {
  return {
    id:            r.id as string,
    content:       r.content as string,
    occurredAt:    (r.occurred_at as string) ?? null,
    remark:        (r.remark as string) ?? null,
    issueLot:      (r.issue_lot as string) ?? null,
    createdBy:     (r.created_by as string) ?? null,
    createdByName: (r.created_by_name as string) ?? null,
    createdAt:     r.created_at as string,
  }
}

export async function listByProduct(productId: string): Promise<PretestNoteRow[]> {
  try {
    const { data, error } = await supabaseAdmin
      .from('product_pretest_notes')
      .select(SELECT)
      .eq('product_id', productId)
      .order('created_at', { ascending: false })
    if (error) {
      if ((error as { code?: string }).code === '42P01') return [] // 테이블 미적용
      throw error
    }
    return (data ?? []).map(r => mapRow(r as Record<string, unknown>))
  } catch {
    return []
  }
}

export async function addNote(input: AddNoteInput): Promise<PretestNoteRow> {
  const { data, error } = await supabaseAdmin
    .from('product_pretest_notes')
    .insert({
      product_id:      input.productId,
      content:         input.content,
      occurred_at:     input.occurredAt || null,
      remark:          input.remark || null,
      issue_lot:       input.issueLot || null,
      created_by:      input.createdBy || null,
      created_by_name: input.createdByName || null,
    })
    .select(SELECT)
    .single()
  if (error) throw error
  return mapRow(data as Record<string, unknown>)
}

/**
 * 여러 품목에 동일한 확인사항을 한 번에 적재한다(유사 품목 복사 등록).
 * @returns 실제 적재된 건수
 */
export async function addNoteToProducts(
  productIds: string[],
  data: Omit<AddNoteInput, 'productId'>,
): Promise<number> {
  const ids = [...new Set(productIds.filter(Boolean))]
  if (ids.length === 0) return 0
  const rows = ids.map(productId => ({
    product_id:      productId,
    content:         data.content,
    occurred_at:     data.occurredAt || null,
    remark:          data.remark || null,
    issue_lot:       data.issueLot || null,
    created_by:      data.createdBy || null,
    created_by_name: data.createdByName || null,
  }))
  const { data: inserted, error } = await supabaseAdmin
    .from('product_pretest_notes')
    .insert(rows)
    .select('id')
  if (error) throw error
  return inserted?.length ?? 0
}

export async function updateNote(
  id: string,
  patch: Partial<{ content: string; occurredAt: string | null; remark: string | null; issueLot: string | null }>,
): Promise<void> {
  const dbPatch: Record<string, unknown> = {}
  if (patch.content    !== undefined) dbPatch.content     = patch.content
  if (patch.occurredAt !== undefined) dbPatch.occurred_at = patch.occurredAt || null
  if (patch.remark     !== undefined) dbPatch.remark      = patch.remark || null
  if (patch.issueLot   !== undefined) dbPatch.issue_lot   = patch.issueLot || null
  if (Object.keys(dbPatch).length === 0) return
  const { error } = await supabaseAdmin
    .from('product_pretest_notes')
    .update(dbPatch)
    .eq('id', id)
  if (error) throw error
}

export async function removeNote(id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('product_pretest_notes')
    .delete()
    .eq('id', id)
  if (error) throw error
}
