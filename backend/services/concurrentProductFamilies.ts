/**
 * [BACKEND] 동시분석 품목군 (concurrent_product_families) — 기준설정 마스터
 *
 * 사용자가 "동시에 시험할 품목"을 직접 묶어 관리한다(품목코드 기준, 한 코드는 1개 군).
 * 자동배정 그룹핑에서 "마스터 우선 + 유사도 규칙 보완"으로 사용된다.
 *   → buildGroupsFromOrders(orders, familyByCode) 로 전달.
 *
 * seedFromProducts(): 현재 품목 마스터를 유사 품목명 규칙(isSimilarProductName)으로
 *   묶어 초기 품목군을 생성한다(멤버 2개 이상만, 이미 군에 속한 코드는 건너뜀).
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { isSimilarProductName } from '@backend/services/concurrentGroups'

export interface FamilyMember {
  productCode: string
  productName: string | null
}
export interface FamilyRow {
  id: string
  name: string
  note: string | null
  members: FamilyMember[]
}

// ─── 조회 ────────────────────────────────────────────────────────────────────
export async function listFamilies(): Promise<FamilyRow[]> {
  const { data: families, error } = await supabaseAdmin
    .from('concurrent_product_families')
    .select('id, name, note')
    .order('name', { ascending: true })
  if (error) throw error
  const rows = (families ?? []) as Record<string, unknown>[]
  if (rows.length === 0) return []

  const ids = rows.map(f => f.id as string)
  const { data: members, error: memErr } = await supabaseAdmin
    .from('concurrent_product_family_members')
    .select('family_id, product_code, product_name')
    .in('family_id', ids)
  if (memErr) throw memErr

  const byFamily = new Map<string, FamilyMember[]>()
  for (const m of (members ?? []) as Record<string, unknown>[]) {
    const arr = byFamily.get(m.family_id as string) ?? []
    arr.push({ productCode: m.product_code as string, productName: (m.product_name as string) ?? null })
    byFamily.set(m.family_id as string, arr)
  }

  return rows.map(f => ({
    id:      f.id as string,
    name:    f.name as string,
    note:    (f.note as string) ?? null,
    members: (byFamily.get(f.id as string) ?? []).sort((a, b) => a.productCode.localeCompare(b.productCode)),
  }))
}

/** 품목코드 → 품목군 id 매핑 (그룹핑 통합용) */
export async function loadFamilyByCode(): Promise<Map<string, string>> {
  const { data, error } = await supabaseAdmin
    .from('concurrent_product_family_members')
    .select('family_id, product_code')
  if (error) throw error
  const m = new Map<string, string>()
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    m.set(r.product_code as string, r.family_id as string)
  }
  return m
}

// ─── 멤버 동기화 (전체 교체) ──────────────────────────────────────────────────
/**
 * 품목군의 멤버를 주어진 코드 목록으로 동기화한다.
 * 다른 품목군에 이미 속한 코드는 그쪽에서 제거(이동)한다(unique(product_code) 보장).
 */
async function syncMembers(familyId: string, codes: string[]): Promise<void> {
  const unique = Array.from(new Set(codes.map(c => c.trim()).filter(Boolean)))

  // 코드별 표시용 품목명 스냅샷
  const nameByCode = new Map<string, string | null>()
  if (unique.length > 0) {
    const { data: prods } = await supabaseAdmin
      .from('products')
      .select('product_code, name')
      .in('product_code', unique)
    for (const p of (prods ?? []) as Record<string, unknown>[]) {
      nameByCode.set(String(p.product_code), (p.name as string) ?? null)
    }
  }

  // 1) 이 군의 기존 멤버 전부 제거
  await supabaseAdmin.from('concurrent_product_family_members').delete().eq('family_id', familyId)
  // 2) 다른 군에 속한 코드는 이동(기존 매핑 제거)
  if (unique.length > 0) {
    await supabaseAdmin.from('concurrent_product_family_members').delete().in('product_code', unique)
  }
  // 3) 새 멤버 삽입
  if (unique.length > 0) {
    const { error } = await supabaseAdmin.from('concurrent_product_family_members').insert(
      unique.map(code => ({ family_id: familyId, product_code: code, product_name: nameByCode.get(code) ?? null })),
    )
    if (error) throw error
  }
}

// ─── CRUD ────────────────────────────────────────────────────────────────────
export async function createFamily(name: string, note: string | null, codes: string[]): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from('concurrent_product_families')
    .insert({ name: name.trim(), note: note?.trim() || null })
    .select('id')
    .single()
  if (error) throw error
  const id = (data as Record<string, unknown>).id as string
  await syncMembers(id, codes)
  return id
}

export async function updateFamily(
  id: string,
  patch: { name?: string; note?: string | null; codes?: string[] },
): Promise<void> {
  const update: Record<string, unknown> = {}
  if (patch.name != null) update.name = patch.name.trim()
  if (patch.note !== undefined) update.note = patch.note?.trim() || null
  if (Object.keys(update).length > 0) {
    const { error } = await supabaseAdmin.from('concurrent_product_families').update(update).eq('id', id)
    if (error) throw error
  }
  if (patch.codes) await syncMembers(id, patch.codes)
}

export async function deleteFamily(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from('concurrent_product_families').delete().eq('id', id)
  if (error) throw error
}

// ─── 현재 데이터 기준 자동 생성 (마이그레이션) ────────────────────────────────
/**
 * 현재 품목 마스터를 유사 품목명 규칙으로 묶어 초기 품목군을 생성한다.
 * - 이미 어떤 군에 속한 품목코드는 건너뛴다(기존 큐레이션 보존).
 * - 멤버가 2개 이상인 묶음만 생성한다.
 * @returns created 생성된 품목군 수, grouped 묶인 품목코드 수
 */
export async function seedFromProducts(): Promise<{ created: number; grouped: number }> {
  const [{ data: products, error }, existing] = await Promise.all([
    supabaseAdmin.from('products').select('product_code, name').eq('is_active', true),
    loadFamilyByCode(),
  ])
  if (error) throw error

  // 품목코드 단위(코드별 대표 품목명) — 이미 군에 속한 코드 제외
  const nameByCode = new Map<string, string>()
  for (const p of (products ?? []) as Record<string, unknown>[]) {
    const code = String(p.product_code ?? '').trim()
    if (!code || existing.has(code)) continue
    if (!nameByCode.has(code)) nameByCode.set(code, (p.name as string) ?? '')
  }
  const codes = Array.from(nameByCode.keys())
  const n = codes.length
  if (n === 0) return { created: 0, grouped: 0 }

  // union-find: 유사 품목명끼리 묶기
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x] } return x }
  const union = (x: number, y: number) => { const rx = find(x), ry = find(y); if (rx !== ry) parent[Math.max(rx, ry)] = Math.min(rx, ry) }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (isSimilarProductName(nameByCode.get(codes[i])!, nameByCode.get(codes[j])!)) union(i, j)
    }
  }
  const byRoot = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const arr = byRoot.get(r) ?? []; arr.push(i); byRoot.set(r, arr)
  }

  let created = 0, grouped = 0
  for (const idxs of byRoot.values()) {
    if (idxs.length < 2) continue // 단독 품목은 군 생성 안 함
    const memberCodes = idxs.map(i => codes[i])
    // 군 이름: 가장 짧은 품목명을 대표로 사용
    const repName = idxs
      .map(i => nameByCode.get(codes[i]) || codes[i])
      .reduce((a, b) => (a.length <= b.length ? a : b))
    await createFamily(`${repName} 계열`, null, memberCodes)
    created++
    grouped += memberCodes.length
  }
  return { created, grouped }
}
