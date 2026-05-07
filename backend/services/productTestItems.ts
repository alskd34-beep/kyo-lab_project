import { supabase } from '@backend/lib/supabase'

export interface ProductTestItemRow {
  testItemId: string
  testItemName: string
  isMandatory: boolean
  sequenceOrder: number
}

function mapRow(r: Record<string, unknown>): ProductTestItemRow {
  const ti = r.test_items as { name: string } | null
  return {
    testItemId: r.test_item_id as string,
    testItemName: ti?.name ?? '',
    isMandatory: r.is_mandatory as boolean,
    sequenceOrder: r.sequence_order as number,
  }
}

export async function listByProduct(productId: string): Promise<ProductTestItemRow[]> {
  const { data, error } = await supabase
    .from('product_test_items')
    .select('test_item_id, is_mandatory, sequence_order, test_items!inner(name)')
    .eq('product_id', productId)
    .order('sequence_order', { ascending: true })
  if (error) throw error
  return (data ?? []).map(r => mapRow(r as Record<string, unknown>))
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
