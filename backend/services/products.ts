import { supabase } from '@backend/lib/supabase'

export interface ProductRow {
  id: string
  productCode: string
  name: string
  nameAlt: string | null
  abbreviation: string | null   // 약호
  difficulty: string | null     // 난이도
  categoryId: string | null     // 품목구분 ID
  categoryName: string | null   // 품목구분 이름
  classificationId: string | null   // 전문분류 ID
  classificationName: string | null // 전문분류 이름
  productType: string | null
  unit: string | null
  packageSpec: string | null
  isActive: boolean
  sortOrder: number
}

export interface ProductOptionRow {
  id: string
  code: string
  name: string
}

function mapRow(r: Record<string, unknown>): ProductRow {
  const cat = r.product_categories as Record<string, unknown> | null
  const cls = r.product_classifications as Record<string, unknown> | null
  return {
    id:                 r.id as string,
    productCode:        r.product_code as string,
    name:               r.name as string,
    nameAlt:            (r.name_alt as string) ?? null,
    abbreviation:       (r.abbreviation as string) ?? null,
    difficulty:         (r.difficulty as string) ?? null,
    categoryId:         (r.category_id as string) ?? null,
    categoryName:       (cat?.name as string) ?? null,
    classificationId:   (r.classification_id as string) ?? null,
    classificationName: (cls?.name as string) ?? null,
    productType:        (r.product_type as string) ?? null,
    unit:               (r.unit as string) ?? null,
    packageSpec:        (r.package_spec as string) ?? null,
    isActive:           r.is_active as boolean,
    sortOrder:          r.sort_order as number,
  }
}

const SELECT_COLS = `
  id, product_code, name, name_alt, abbreviation, difficulty,
  category_id, product_categories(name),
  classification_id, product_classifications(name),
  product_type, unit, package_spec, is_active, sort_order
`.trim()

export async function listProducts(q: { search?: string; limit?: number } = {}): Promise<ProductRow[]> {
  let query = supabase
    .from('products')
    .select(SELECT_COLS)
    .order('sort_order', { ascending: true })
  if (q.search) query = query.or(`name.ilike.%${q.search}%,product_code.ilike.%${q.search}%`)
  if (q.limit) query = query.limit(q.limit)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map(r => mapRow(r as Record<string, unknown>))
}

export async function listProductCategories(): Promise<ProductOptionRow[]> {
  const { data, error } = await supabase
    .from('product_categories')
    .select('id, code, name')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as ProductOptionRow[]
}

export async function listProductClassifications(): Promise<ProductOptionRow[]> {
  const { data, error } = await supabase
    .from('product_classifications')
    .select('id, code, name')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []) as ProductOptionRow[]
}

export async function createProduct(input: {
  productCode: string
  name: string
  nameAlt?: string | null
  abbreviation?: string | null
  difficulty?: string | null
  categoryId?: string | null
  classificationId?: string | null
  unit?: string | null
  productType?: string | null
  packageSpec?: string | null
}): Promise<ProductRow> {
  const { data, error } = await supabase
    .from('products')
    .insert({
      product_code:      input.productCode,
      name:              input.name,
      name_alt:          input.nameAlt ?? null,
      abbreviation:      input.abbreviation ?? null,
      difficulty:        input.difficulty ?? null,
      category_id:       input.categoryId ?? null,
      classification_id: input.classificationId ?? null,
      unit:              input.unit ?? null,
      product_type:      input.productType ?? null,
      package_spec:      input.packageSpec ?? null,
    })
    .select(SELECT_COLS)
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
    abbreviation: string | null
    difficulty: string | null
    categoryId: string | null
    classificationId: string | null
    unit: string | null
    productType: string | null
    packageSpec: string | null
    isActive: boolean
    sortOrder: number
  }>
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (input.productCode      !== undefined) patch.product_code      = input.productCode
  if (input.name             !== undefined) patch.name              = input.name
  if (input.nameAlt          !== undefined) patch.name_alt          = input.nameAlt
  if (input.abbreviation     !== undefined) patch.abbreviation      = input.abbreviation
  if (input.difficulty       !== undefined) patch.difficulty        = input.difficulty
  if (input.categoryId       !== undefined) patch.category_id       = input.categoryId
  if (input.classificationId !== undefined) patch.classification_id = input.classificationId
  if (input.unit             !== undefined) patch.unit              = input.unit
  if (input.productType      !== undefined) patch.product_type      = input.productType
  if (input.packageSpec      !== undefined) patch.package_spec      = input.packageSpec
  if (input.isActive         !== undefined) patch.is_active         = input.isActive
  if (input.sortOrder        !== undefined) patch.sort_order        = input.sortOrder

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
