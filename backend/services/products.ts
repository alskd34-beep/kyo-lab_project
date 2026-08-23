import { supabaseAdmin, supabaseAdmin as supabase } from '@backend/lib/supabase'
import { sanitizeFilterTerm } from '@backend/lib/postgrestFilter'

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
  /** @deprecated 공수 정본은 DAY(`avgWorkdays` = product_workload.avg_workdays).
   *  운영 DB 의 products.avg_hours 는 전 행이 null 이다(2026-08-22 확인). */
  avgHours: number | null
  avgHoursPackageUnit: string | null
  /** 공수(일, DAY) — product_workload.avg_workdays. 스케줄·대시보드와 동일 단일 소스. */
  avgWorkdays: number | null
  isActive: boolean
  sortOrder: number
  testItemCount: number  // 등록된 시험항목 수
}

export interface ProductOptionRow {
  id: string
  code: string
  name: string
}

function mapRow(
  r: Record<string, unknown>,
  testItemCount = 0,
  avgWorkdays: number | null = null,
): ProductRow {
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
    avgHours:           r.avg_hours != null ? Number(r.avg_hours) : null,
    avgHoursPackageUnit: (r.unit as string) ?? (r.package_spec as string) ?? null,
    avgWorkdays,
    isActive:           r.is_active as boolean,
    sortOrder:          r.sort_order as number,
    testItemCount,
  }
}

/** 공수(일) 전량. 품목 목록과 병렬로 한 번에 읽는다. */
async function listWorkdaysMap(): Promise<Map<string, number>> {
  const { data, error } = await supabaseAdmin
    .from('product_workload')
    .select('product_code, avg_workdays')
    .limit(5000)
  if (error) throw error
  const map = new Map<string, number>()
  for (const w of data ?? []) {
    const d = Number(w.avg_workdays)
    if (d > 0) map.set(String(w.product_code), d)
  }
  return map
}

/**
 * 공수(일) upsert — product_code 기준. avgWorkdays null 이면 무시.
 * 과거 이중적재로 동일 product_code 가 복수 존재할 수 있어, 단건 가정 없이
 * product_code 의 모든 행을 일괄 갱신한다(없으면 1건 insert).
 */
async function upsertWorkload(productCode: string, productName: string | null, avgWorkdays: number | null): Promise<void> {
  if (avgWorkdays == null || !productCode) return
  const { data: existing } = await supabaseAdmin
    .from('product_workload')
    .select('id')
    .eq('product_code', productCode)
    .limit(1)
  if (existing && existing.length > 0) {
    await supabaseAdmin.from('product_workload').update({ avg_workdays: avgWorkdays }).eq('product_code', productCode)
  } else {
    await supabaseAdmin.from('product_workload').insert({
      product_code: productCode, product_name: productName, avg_workdays: avgWorkdays,
    })
  }
}

const SELECT_COLS = `
  id, product_code, name, name_alt, abbreviation, difficulty,
  category_id, product_categories(name),
  classification_id, product_classifications(name),
  product_type, unit, package_spec, avg_hours, is_active, sort_order
`.trim()

export async function listProducts(q: { search?: string; limit?: number } = {}): Promise<ProductRow[]> {
  let query = supabase
    .from('products')
    .select(SELECT_COLS)
    .order('sort_order', { ascending: true })
  // 검색어는 PostgREST 필터 DSL 에 문자열로 삽입되므로 문법 문자를 제거한다(필터 인젝션 방지).
  const search = sanitizeFilterTerm(q.search)
  if (search) query = query.or(`name.ilike.%${search}%,product_code.ilike.%${search}%`)
  if (q.limit) query = query.limit(q.limit)
  else query = query.limit(2000)

  // 시험항목 건수는 이 목록에서 쓰지 않는다. 예전엔 product_test_items 전량을
  // 읽어 세느라 품목 700건에서 수 초가 걸렸다. 공수는 별도 소량 테이블이라 함께 읽는다.
  const [prodResult, workdaysMap] = await Promise.all([query, listWorkdaysMap()])
  if (prodResult.error) throw prodResult.error

  const rows = (prodResult.data ?? []) as unknown as Record<string, unknown>[]
  return rows.map(r =>
    mapRow(r, 0, workdaysMap.get(r.product_code as string) ?? null)
  )
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
  avgHours?: number | null
  avgWorkdays?: number | null
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
      avg_hours:         input.avgHours ?? null,
    })
    .select(SELECT_COLS)
    .single()
  if (error) throw error
  // 공수(일)은 product_workload 에 저장 (단일 소스)
  await upsertWorkload(input.productCode, input.name, input.avgWorkdays ?? null)
  return mapRow(data as unknown as Record<string, unknown>, 0, input.avgWorkdays ?? null)
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
    avgHours: number | null
    avgWorkdays: number | null
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
  if (input.avgHours         !== undefined) patch.avg_hours         = input.avgHours
  if (input.isActive         !== undefined) patch.is_active         = input.isActive
  if (input.sortOrder        !== undefined) patch.sort_order        = input.sortOrder

  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from('products').update(patch).eq('id', id)
    if (error) throw error
  }

  // 공수(일)은 product_workload 에 저장 (단일 소스). product_code 가 필요해 조회.
  if (input.avgWorkdays !== undefined) {
    const { data: prod } = await supabase
      .from('products')
      .select('product_code, name')
      .eq('id', id)
      .maybeSingle()
    if (prod?.product_code) {
      await upsertWorkload(prod.product_code as string, (prod.name as string) ?? null, input.avgWorkdays)
    }
  }
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
  return (data ?? []).map(r => (r as unknown as { test_items: { name: string } }).test_items.name)
}
