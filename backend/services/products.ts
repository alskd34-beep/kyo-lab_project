import { supabase } from '@backend/lib/supabase'

export interface ProductRow {
  id: string
  productCode: string
  name: string
  nameAlt: string | null
  productType: string | null
  unit: string | null
  packageSpec: string | null
  isActive: boolean
  sortOrder: number
}

function mapRow(r: Record<string, unknown>): ProductRow {
  return {
    id: r.id as string,
    productCode: r.product_code as string,
    name: r.name as string,
    nameAlt: (r.name_alt as string) ?? null,
    productType: (r.product_type as string) ?? null,
    unit: (r.unit as string) ?? null,
    packageSpec: (r.package_spec as string) ?? null,
    isActive: r.is_active as boolean,
    sortOrder: r.sort_order as number,
  }
}

export async function listProducts(q: { search?: string; limit?: number } = {}): Promise<ProductRow[]> {
  let query = supabase
    .from('products')
    .select('id, product_code, name, name_alt, product_type, unit, package_spec, is_active, sort_order')
    .order('sort_order', { ascending: true })
  if (q.search) query = query.or(`name.ilike.%${q.search}%,product_code.ilike.%${q.search}%`)
  if (q.limit) query = query.limit(q.limit)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(r => mapRow(r as Record<string, unknown>))
}

export async function createProduct(input: {
  productCode: string
  name: string
  nameAlt?: string
  unit?: string
  productType?: string
  packageSpec?: string
}): Promise<ProductRow> {
  const { data, error } = await supabase
    .from('products')
    .insert({
      product_code: input.productCode,
      name: input.name,
      name_alt: input.nameAlt ?? null,
      unit: input.unit ?? null,
      product_type: input.productType ?? null,
      package_spec: input.packageSpec ?? null,
    })
    .select('id, product_code, name, name_alt, product_type, unit, package_spec, is_active, sort_order')
    .single()
  if (error) throw error
  return mapRow(data as Record<string, unknown>)
}

export async function updateProduct(
  id: string,
  input: Partial<{
    productCode: string
    name: string
    nameAlt: string | null
    unit: string | null
    productType: string | null
    packageSpec: string | null
    isActive: boolean
    sortOrder: number
  }>
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (input.productCode !== undefined) patch.product_code = input.productCode
  if (input.name !== undefined) patch.name = input.name
  if (input.nameAlt !== undefined) patch.name_alt = input.nameAlt
  if (input.unit !== undefined) patch.unit = input.unit
  if (input.productType !== undefined) patch.product_type = input.productType
  if (input.packageSpec !== undefined) patch.package_spec = input.packageSpec
  if (input.isActive !== undefined) patch.is_active = input.isActive
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder

  const { error } = await supabase.from('products').update(patch).eq('id', id)
  if (error) throw error
}

export async function deleteProduct(id: string): Promise<void> {
  const { error } = await supabase.from('products').delete().eq('id', id)
  if (error) throw error
}

export async function getProductTestItems(productId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('product_test_items')
    .select('test_items!inner(name)')
    .eq('product_id', productId)
    .order('sequence_order', { ascending: true })
  if (error) throw error
  return (data ?? []).map(r => (r as { test_items: { name: string } }).test_items.name)
}
