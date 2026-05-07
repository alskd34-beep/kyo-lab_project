import { supabase } from '@backend/lib/supabase'
import type { Product } from '@shared/pqm'

export async function listProducts(q: { search?: string; category?: string } = {}): Promise<Product[]> {
  let query = supabase.from('product_master').select('*').order('id')
  if (q.search) query = query.or(`product_name.ilike.%${q.search}%,product_code.ilike.%${q.search}%`)
  if (q.category) query = query.eq('category', q.category)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []) as Product[]
}

export async function getProductTestItems(productName: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('product_test_items')
    .select('test_item')
    .eq('product_name', productName)
    .order('id')
  if (error) throw error
  return (data ?? []).map(r => r.test_item as string)
}
