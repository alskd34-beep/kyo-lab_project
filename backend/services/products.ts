import { supabase } from '@backend/lib/supabase'
import type { Product, TestItem, ProductTestItem } from '@shared/pqm'

interface ProductsQuery {
  search?: string
  category?: string
  difficulty?: string
  type?: string
  isActive?: boolean
}

interface DbProduct {
  id: string
  product_code: string
  name: string
  name_alt: string | null
  product_type: string | null
  difficulty: string | null
  category_id: string | null
  classification_id: string | null
  package_spec: string | null
  sort_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

interface DbProductTestItem {
  is_mandatory: boolean
  sequence_order: number
  test_items: {
    id: string
    name: string
    estimated_hours: number | null
    requires_duo: boolean
    is_active: boolean
    created_at: string
    updated_at: string
  }
}

function toProduct(r: DbProduct): Product {
  return {
    id:               r.id,
    product_code:     r.product_code,
    name:             r.name,
    name_alt:         r.name_alt,
    product_type:     r.product_type,
    unit:             null,
    abbreviation:     null,
    difficulty:       r.difficulty as Product['difficulty'],
    category_id:      r.category_id,
    classification_id: r.classification_id,
    package_spec:     r.package_spec,
    sort_order:       r.sort_order,
    is_active:        r.is_active,
    created_at:       r.created_at,
    updated_at:       r.updated_at,
  }
}

export async function listProducts(q: ProductsQuery = {}): Promise<Product[]> {
  let query = supabase
    .from('products')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })

  if (q.isActive !== undefined) query = query.eq('is_active', q.isActive)
  if (q.category)               query = query.eq('category_id', q.category)
  if (q.difficulty)             query = query.eq('difficulty', q.difficulty)
  if (q.type)                   query = query.eq('product_type', q.type)
  if (q.search) {
    query = query.or(
      `name.ilike.%${q.search}%,product_code.ilike.%${q.search}%,name_alt.ilike.%${q.search}%`,
    )
  }

  const { data, error } = await query
  if (error) throw error
  return ((data ?? []) as DbProduct[]).map(toProduct)
}

export async function getProduct(code: string): Promise<Product> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .eq('product_code', code)
    .single()
  if (error) throw error
  return toProduct(data as DbProduct)
}

export interface ProductTestItemRow {
  testItemId: string
  name: string
  estimatedHours: number | null
  requiresDuo: boolean
  isActive: boolean
  isMandatory: boolean
  sequenceOrder: number
}

export async function getProductTestItems(productId: string): Promise<ProductTestItemRow[]> {
  const { data, error } = await supabase
    .from('product_test_items')
    .select(`
      is_mandatory,
      sequence_order,
      test_items (
        id, name, estimated_hours, requires_duo, is_active, created_at, updated_at
      )
    `)
    .eq('product_id', productId)
    .order('sequence_order', { ascending: true })

  if (error) throw error

  const rows = (data ?? []) as unknown as DbProductTestItem[]
  return rows.map(r => ({
    testItemId:      r.test_items.id,
    name:            r.test_items.name,
    estimatedHours:  r.test_items.estimated_hours,
    requiresDuo:     r.test_items.requires_duo,
    isActive:        r.test_items.is_active,
    isMandatory:     r.is_mandatory,
    sequenceOrder:   r.sequence_order,
  }))
}
