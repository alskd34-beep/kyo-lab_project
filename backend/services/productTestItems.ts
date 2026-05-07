import { supabase } from '@backend/lib/supabase'

export interface ProductTestItemRow {
  testItemId: string
  testItemName: string
  isMandatory: boolean
  sequenceOrder: number
}

export async function listByProduct(productId: string): Promise<ProductTestItemRow[]> {
  const { data: links, error: e1 } = await supabase
    .from('product_test_items')
    .select('test_item_id, is_mandatory, sequence_order')
    .eq('product_id', productId)
    .order('sequence_order', { ascending: true })
  if (e1) throw new Error(`product_test_items 조회 실패: ${e1.message}`)
  if (!links || links.length === 0) return []

  const ids = links.map(l => l.test_item_id as string)
  const { data: items, error: e2 } = await supabase
    .from('test_items')
    .select('id, name')
    .in('id', ids)
  if (e2) throw new Error(`test_items 조회 실패: ${e2.message}`)

  const nameById = new Map<string, string>(
    (items ?? []).map(i => [i.id as string, i.name as string]),
  )
  return links.map(l => ({
    testItemId: l.test_item_id as string,
    testItemName: nameById.get(l.test_item_id as string) ?? '',
    isMandatory: l.is_mandatory as boolean,
    sequenceOrder: l.sequence_order as number,
  }))
}

export async function addMapping(
  productId: string,
  testItemId: string,
  sequenceOrder?: number
): Promise<void> {
  const { error } = await supabase.from('product_test_items').insert({
    product_id: productId,
    test_item_id: testItemId,
    sequence_order: sequenceOrder ?? 0,
  })
  if (error) throw error
}

export async function removeMapping(productId: string, testItemId: string): Promise<void> {
  const { error } = await supabase
    .from('product_test_items')
    .delete()
    .eq('product_id', productId)
    .eq('test_item_id', testItemId)
  if (error) throw error
}
