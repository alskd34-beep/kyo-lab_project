/**
 * [BACKEND] 동시분석 품목군 (concurrent_product_families) — 기준설정 마스터
 *
 * 사용자가 "동시에 시험할 품목"을 직접 묶어 관리한다(품목코드 기준, 한 코드는 1개 군).
 * 자동배정 그룹핑에서 "마스터 우선 + 유사도 규칙 보완"으로 사용된다.
 *   → buildGroupsFromOrders(orders, familyByCode) 로 전달.
 *
 * seedFromProducts(): 현재 품목 마스터를 "기준명(용량·규격 제거)" 일치로
 *   묶어 초기 품목군을 생성한다(멤버 2개 이상만, 이미 군에 속한 코드는 건너뜀).
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { codexAssignEnabled, runCodexJson } from '@backend/lib/codexCli'
import { selectAll } from '@backend/lib/supabasePage'

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
  const { data, error } = await selectAll(
    supabaseAdmin, 'concurrent_product_family_members', 'family_id, product_code', { orderBy: ['family_id', 'product_code'] },
  )
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

/**
 * 품목명에서 용량·규격·괄호·시험구분 등을 떼어낸 "기준명".
 * 예) "네비레트엠정2.5밀리그램(네비보롤염산염)" → "네비레트엠정"
 *     "네비레트엠정5밀리그램"                → "네비레트엠정"
 *     "네비레트 5mg_임상시험"                → "네비레트"  (단일제 → 별도)
 *     "베니톨에스정"                         → "베니톨에스정"
 * 기준명이 같은 품목끼리만 한 군으로 묶어 단일제/원료 오병합을 방지한다.
 */
/**
 * 품목군 이름 정리 — 어디에 있든 용량/규격 토큰을 제거하고 "○○ 계열"로 통일.
 * 예) "광동엔테카비르정0.5밀리그램 계열" → "광동엔테카비르정 계열"
 *     "네비레트엠정2.5mg"               → "네비레트엠정 계열"
 * (그룹에 여러 용량이 섞이므로 이름에 특정 용량을 넣지 않는다)
 */
export function cleanFamilyName(raw: string): string {
  let s = (raw ?? '').trim()
  s = s.replace(/계열\s*$/, '').trim()                                   // 끝의 "계열" 제거(중복 방지)
  s = s.replace(/\(.*?\)/g, '')                                          // 괄호 내용 제거
  s = s.replace(/[\d.]+\s*(밀리그램|밀리그람|mg|㎎|g|ml|㎖|%)/gi, '')      // 용량 토큰(위치 무관) 제거
  s = s.replace(/\s{2,}/g, ' ').trim()
  return s ? `${s} 계열` : (raw ?? '').trim()
}

export function baseProductName(raw: string): string {
  let s = (raw ?? '').replace(/\s+/g, '')
  s = s.replace(/\(.*?\)/g, '')              // 괄호 내용 제거
  s = s.replace(/[_/].*$/, '')               // _ 또는 / 이후(임상시험·생동포장용 등) 제거
  // 끝쪽 용량/규격(숫자+단위) 반복 제거: 2.5밀리그램, 5mg, 500T, 50ML, 120C, 1환 ...
  s = s.replace(/[\d.]+(밀리그램|밀리그람|mg|㎎|g|ml|㎖|t|c|환|%|정|캡슐)*$/gi, '')
  return s.trim()
}

// ─── 현재 데이터 기준 자동 생성 (마이그레이션) ────────────────────────────────
/**
 * 현재 품목 마스터를 "기준명(용량·규격 제거)" 일치로 묶어 초기 품목군을 생성한다.
 * - 이미 어떤 군에 속한 품목코드는 건너뛴다(기존 큐레이션 보존).
 * - 멤버가 2개 이상인 묶음만 생성한다.
 * @returns created 생성된 품목군 수, grouped 묶인 품목코드 수
 */
export async function seedFromProducts(reset = false): Promise<{ created: number; grouped: number }> {
  // reset=true: 기존 군을 모두 지우고 기준명으로 처음부터 다시 정리
  if (reset) await deleteAllFamilies()
  const [{ data: products, error }, existing] = await Promise.all([
    supabaseAdmin.from('products').select('product_code, name').eq('is_active', true),
    reset ? Promise.resolve(new Map<string, string>()) : loadFamilyByCode(),
  ])
  if (error) throw error

  // 품목코드 단위(코드별 대표 품목명) — 이미 군에 속한 코드 제외
  const nameByCode = new Map<string, string>()
  for (const p of (products ?? []) as Record<string, unknown>[]) {
    const code = String(p.product_code ?? '').trim()
    if (!code || existing.has(code)) continue
    if (!nameByCode.has(code)) nameByCode.set(code, (p.name as string) ?? '')
  }
  if (nameByCode.size === 0) return { created: 0, grouped: 0 }

  // 기준명 버킷 — 기준명이 같은 품목끼리 묶는다
  const buckets = new Map<string, { codes: string[]; names: string[] }>()
  for (const [code, name] of nameByCode) {
    const base = baseProductName(name)
    if (!base) continue
    const b = buckets.get(base) ?? { codes: [], names: [] }
    b.codes.push(code); b.names.push(name)
    buckets.set(base, b)
  }

  let created = 0, grouped = 0
  for (const [base, b] of buckets) {
    if (b.codes.length < 2) continue // 단독 품목은 군 생성 안 함
    await createFamily(cleanFamilyName(base), null, b.codes)
    created++
    grouped += b.codes.length
  }
  return { created, grouped }
}

/** 모든 품목군 삭제 (재마이그레이션용) */
export async function deleteAllFamilies(): Promise<void> {
  const { error } = await supabaseAdmin
    .from('concurrent_product_families')
    .delete()
    .not('id', 'is', null)
  if (error) throw error
}

interface LLMGroupResponse {
  groups: Array<{ name?: string; codes: string[] }>
}

/**
 * LLM(Codex)으로 동시분석 품목군을 재생성한다.
 * - reset=true(기본): 기존 품목군을 모두 삭제 후 새로 마이그레이션.
 * - Codex 미사용/실패 시 규칙 기반(seedFromProducts)으로 폴백.
 * @returns mode 사용 엔진, created 생성 군 수, grouped 묶인 품목 수
 */
export async function seedFromProductsLLM(reset = true): Promise<{ mode: 'llm' | 'rule'; created: number; grouped: number }> {
  if (reset) await deleteAllFamilies()

  // Codex 비활성 → 규칙 기반 폴백
  if (!codexAssignEnabled()) {
    const r = await seedFromProducts()
    return { mode: 'rule', ...r }
  }

  // 활성 품목(코드별 대표 품목명)
  const { data: products, error } = await supabaseAdmin
    .from('products')
    .select('product_code, name')
    .eq('is_active', true)
  if (error) throw error
  const nameByCode = new Map<string, string>()
  for (const p of (products ?? []) as Record<string, unknown>[]) {
    const code = String(p.product_code ?? '').trim()
    if (!code) continue
    if (!nameByCode.has(code)) nameByCode.set(code, (p.name as string) ?? '')
  }
  const items = Array.from(nameByCode, ([code, name]) => ({ code, name }))
  if (items.length === 0) return { mode: 'llm', created: 0, grouped: 0 }

  const system = [
    '너는 제약 QC 시험 기준정보 담당이다.',
    '아래 품목 목록을 "동시에 시험 가능한(동시분석)" 묶음으로 그룹핑한다.',
    '동일 제품의 함량/규격 변형(예: 네비레트엠정2.5mg·1.25mg), 같은 제품군(에스/플러스/현탁액 등) 처럼',
    '시험 항목이 사실상 동일해 한 사람이 함께 시험하는 게 합리적인 품목들을 같은 그룹으로 묶는다.',
    '규칙:',
    '1) 한 품목코드는 최대 한 그룹에만 속한다.',
    '2) 2개 이상 품목이 묶이는 경우만 그룹으로 만든다(단독 품목은 제외).',
    '3) 회사명만 같은(예: 광동 접두어만 공유) 무관한 품목은 묶지 않는다.',
    '4) 같은 브랜드의 라인 변형(예: 평위천액·평위천프라임액, 베니톨정·베니톨에스정·베니톨플러스정)은',
    '   시험 항목이 사실상 같으면 한 계열로 묶어라(접미어 프라임/에스/플러스/큐/디 차이는 같은 계열로 본다).',
    '5) group name 은 용량·규격을 뗀 기준 품목명 + " 계열"(예: "네비레트엠정 계열", "평위천 계열"). 용량(2.5밀리그램 등)을 이름에 넣지 마라.',
    '   단일제(예: 네비레트 5mg)·원료/생동용/반제품은 복합제·완제(네비레트엠정)와 다른 그룹으로 분리하라.',
    '반드시 아래 JSON 형식으로만 답한다: {"groups":[{"name":"...","codes":["코드1","코드2"]}]}',
  ].join('\n')
  const user = JSON.stringify({ products: items })

  let resp: LLMGroupResponse
  try {
    resp = await runCodexJson<LLMGroupResponse>(`${system}\n\n입력:\n${user}`, 120_000)
  } catch {
    // LLM 실패 → 규칙 기반 폴백
    const r = await seedFromProducts()
    return { mode: 'rule', ...r }
  }

  const validCodes = new Set(nameByCode.keys())
  const used = new Set<string>()
  let created = 0, grouped = 0
  for (const g of resp.groups ?? []) {
    // 실재하는 코드만, 중복 제거, 아직 사용되지 않은 코드만
    const codes = Array.from(new Set((g.codes ?? []).filter(c => validCodes.has(c) && !used.has(c))))
    if (codes.length < 2) continue
    codes.forEach(c => used.add(c))
    const fallbackName = codes.map(c => nameByCode.get(c) || c).reduce((a, b) => (a.length <= b.length ? a : b))
    await createFamily(cleanFamilyName(g.name?.trim() || fallbackName), null, codes)
    created++
    grouped += codes.length
  }
  return { mode: 'llm', created, grouped }
}
