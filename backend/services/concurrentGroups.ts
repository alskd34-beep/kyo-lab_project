/**
 * [BACKEND] 동시분석 그룹 (concurrent_analysis_groups)
 *
 * 대기/미배정 성격의 PCT 오더(status != '삭제')를, 동시에 시험 가능한 묶음으로
 * 그룹핑한다. 아래 OR 조건 중 하나라도 충족하면 같은 그룹(union-find 로 전이 병합):
 *   1) 품목코드 동일 AND 완료요청일(due_date) 동일
 *   2) 품목명 동일
 *   3) 품목코드 다름 + 품목명 동일 (사실상 2에 포함)
 *   4) 품목코드 동일 + 품목명 다름
 *   5) 유사 품목명 — (a) 한쪽이 다른쪽의 substring 이거나,
 *      (b) 회사명 접두어 제거 후 공통 접두어가 MIN_PREFIX_LEN 이상
 *         (예: 베니톨정·베니톨에스정·베니톨플러스정 → 공통 접두어 '베니톨' → 동일 그룹)
 *
 * 그룹별:
 *   - test_start_date = MAX(그룹 내 packaging_date) + 1일 (없으면 무시, 전부 없으면 null)
 *   - group_key      = `grp-<그룹 내 최소 order_id 앞 8자리>` (결정적 키)
 *
 * 재생성 정책: group_lock=true 인 기존 그룹과 멤버는 보존(재생성 금지).
 *   그룹 일부 품목이 취소(status '삭제'/'취소')되어도 잠긴 그룹은 유지.
 *   rebuild 시 잠기지 않은 그룹만 삭제 후 재구성한다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'

export interface GroupItem {
  orderId: string
  productCode: string
  productName: string
  batchNo: string
  packagingDate: string | null
}

export interface GroupRow {
  id: string
  groupKey: string
  label: string | null
  testStartDate: string | null
  groupLock: boolean
  items: GroupItem[]
}

// ─── 순수 그룹핑 (테스트 용이하도록 분리) ────────────────────────────────────
export interface OrderForGrouping {
  id: string
  productCode: string
  productName: string
  batchNo: string
  packagingDate: string | null
  dueDate: string | null
}

export interface BuiltGroup {
  groupKey: string
  testStartDate: string | null
  items: GroupItem[]
}

/** packaging_date(yyyy-MM-dd) + 1일 → yyyy-MM-dd (UTC 기준) */
function addOneDay(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// ─── 유사 품목명(공통 접두어) 판정 ─────────────────────────────────────────────
/** 유사명으로 묶기 위한 공통 접두어 최소 길이(한글 글자 수) */
const MIN_PREFIX_LEN = 3
/**
 * 회사명 접두어 — 이 토큰만 공유하는 건 "유사"로 보지 않는다(과묶음 방지).
 * 예: '광동마음정액' vs '광동비타민' 은 '광동'만 공유하므로 그룹화하지 않는다.
 */
const COMPANY_PREFIXES = ['광동제약', '광동'] as const

/** 공백 제거 + trim 정규화 */
function normalizeName(s: string): string {
  return (s ?? '').replace(/\s+/g, '').trim()
}

/** 앞쪽 회사명 접두어 제거 (가장 긴 것 우선) */
function stripCompany(s: string): string {
  for (const c of COMPANY_PREFIXES) {
    if (s.startsWith(c)) return s.slice(c.length)
  }
  return s
}

/** 두 문자열의 공통 접두어 길이 */
function commonPrefixLen(a: string, b: string): number {
  const n = Math.min(a.length, b.length)
  let i = 0
  while (i < n && a[i] === b[i]) i++
  return i
}

/**
 * 유사 품목명 여부.
 * (a) 한쪽이 다른쪽의 substring 이거나,
 * (b) 회사명 접두어를 떼어낸 뒤 공통 접두어가 MIN_PREFIX_LEN 이상이면 유사로 본다.
 *     (베니톨정/베니톨에스정/베니톨플러스정 → '베니톨' 공유 → 유사)
 */
function similarName(an: string, bn: string): boolean {
  if (!an || !bn) return false
  // (a) 포함관계
  if (an.includes(bn) || bn.includes(an)) return true
  // (b) 회사명 제거 후 공통 접두어
  const sa = stripCompany(an)
  const sb = stripCompany(bn)
  if (!sa || !sb) return false
  return commonPrefixLen(sa, sb) >= MIN_PREFIX_LEN
}

/**
 * 외부(안정성 매칭 등)에서 재사용할 유사 품목명 판정.
 * 동시분석 그룹과 동일한 규칙(공백 정규화 후 포함관계/공통 접두어)을 적용한다.
 */
export function isSimilarProductName(a: string, b: string): boolean {
  return similarName(normalizeName(a), normalizeName(b))
}

/** 두 오더가 동일 그룹 조건(OR) 중 하나라도 충족하는가 */
function sameGroup(a: OrderForGrouping, b: OrderForGrouping): boolean {
  const an = normalizeName(a.productName)
  const bn = normalizeName(b.productName)
  // 1) 품목코드 동일 AND 완료요청일 동일
  if (a.productCode === b.productCode && a.dueDate && b.dueDate && a.dueDate === b.dueDate) return true
  // 2 & 3) 품목명 동일 (코드 동일/상이 무관)
  if (an && bn && an === bn) return true
  // 4) 품목코드 동일 + 품목명 다름
  if (a.productCode === b.productCode) return true
  // 5) 유사 품목명 (포함관계 또는 공통 접두어)
  if (similarName(an, bn)) return true
  return false
}

/**
 * union-find(disjoint set)로 모든 오더 쌍을 평가해 그룹을 구성한다.
 * 단일 멤버 그룹도 반환에 포함된다(저장 측에서 필요 시 필터 가능).
 */
export function buildGroupsFromOrders(orders: OrderForGrouping[]): BuiltGroup[] {
  const n = orders.length
  const parent = Array.from({ length: n }, (_, i) => i)

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  function union(x: number, y: number): void {
    const rx = find(x), ry = find(y)
    if (rx !== ry) parent[Math.max(rx, ry)] = Math.min(rx, ry)
  }

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (sameGroup(orders[i], orders[j])) union(i, j)
    }
  }

  // 루트 → 멤버 인덱스
  const byRoot = new Map<number, number[]>()
  for (let i = 0; i < n; i++) {
    const r = find(i)
    const arr = byRoot.get(r) ?? []
    arr.push(i)
    byRoot.set(r, arr)
  }

  const groups: BuiltGroup[] = []
  for (const idxs of byRoot.values()) {
    const members = idxs.map(i => orders[i])
    const items: GroupItem[] = members.map(o => ({
      orderId: o.id,
      productCode: o.productCode,
      productName: o.productName,
      batchNo: o.batchNo,
      packagingDate: o.packagingDate,
    }))
    // test_start_date = MAX(packaging_date) + 1일
    const dates = members.map(o => o.packagingDate).filter((d): d is string => !!d)
    const testStartDate = dates.length > 0 ? addOneDay(dates.reduce((a, b) => (a > b ? a : b))) : null
    // group_key: 그룹 내 최소 order_id 앞 8자리
    const minId = members.map(o => o.id).reduce((a, b) => (a < b ? a : b))
    groups.push({ groupKey: `grp-${minId.slice(0, 8)}`, testStartDate, items })
  }
  return groups
}

// ─── 조회 ────────────────────────────────────────────────────────────────────
/** 그룹 + 멤버 조인 반환 (시험 시작일 오름차순) */
export async function listGroups(): Promise<GroupRow[]> {
  const { data: groups, error } = await supabaseAdmin
    .from('concurrent_analysis_groups')
    .select('id, group_key, label, test_start_date, group_lock')
    .order('test_start_date', { ascending: true, nullsFirst: false })
  if (error) throw error
  const groupRows = (groups ?? []) as Record<string, unknown>[]
  if (groupRows.length === 0) return []

  const groupIds = groupRows.map(g => g.id as string)
  const { data: items, error: itemErr } = await supabaseAdmin
    .from('concurrent_analysis_group_items')
    .select('group_id, order_id, pct_orders(product_code, product_name, batch_no, packaging_date)')
    .in('group_id', groupIds)
  if (itemErr) throw itemErr

  const itemsByGroup = new Map<string, GroupItem[]>()
  for (const it of (items ?? []) as Record<string, unknown>[]) {
    const order = it.pct_orders as Record<string, unknown> | null
    const arr = itemsByGroup.get(it.group_id as string) ?? []
    arr.push({
      orderId:       it.order_id as string,
      productCode:   (order?.product_code as string) ?? '',
      productName:   (order?.product_name as string) ?? '',
      batchNo:       (order?.batch_no as string) ?? '',
      packagingDate: (order?.packaging_date as string) ?? null,
    })
    itemsByGroup.set(it.group_id as string, arr)
  }

  return groupRows.map(g => ({
    id:            g.id as string,
    groupKey:      g.group_key as string,
    label:         (g.label as string) ?? null,
    testStartDate: (g.test_start_date as string) ?? null,
    groupLock:     !!g.group_lock,
    items:         itemsByGroup.get(g.id as string) ?? [],
  }))
}

// ─── 재생성 ──────────────────────────────────────────────────────────────────
/**
 * 잠기지 않은 그룹을 규칙대로 재구성한다.
 * @returns created 신규 생성 그룹 수, kept 보존(잠금)된 그룹 수
 */
export async function rebuildGroups(): Promise<{ created: number; kept: number }> {
  // 1) 잠긴 그룹 보존: 잠긴 그룹의 멤버 order_id 는 재구성 대상에서 제외
  const { data: lockedGroups, error: lockErr } = await supabaseAdmin
    .from('concurrent_analysis_groups')
    .select('id')
    .eq('group_lock', true)
  if (lockErr) throw lockErr
  const lockedIds = (lockedGroups ?? []).map(g => g.id as string)
  const kept = lockedIds.length

  const lockedOrderIds = new Set<string>()
  if (lockedIds.length > 0) {
    const { data: lockedItems, error: liErr } = await supabaseAdmin
      .from('concurrent_analysis_group_items')
      .select('order_id')
      .in('group_id', lockedIds)
    if (liErr) throw liErr
    for (const it of lockedItems ?? []) lockedOrderIds.add(it.order_id as string)
  }

  // 2) 잠기지 않은 그룹 삭제 (멤버는 on delete cascade)
  const { error: delErr } = await supabaseAdmin
    .from('concurrent_analysis_groups')
    .delete()
    .eq('group_lock', false)
  if (delErr) throw delErr

  // 3) 대상 오더 로드 (status != '삭제'). 취소건도 제외.
  const { data: orders, error: ordErr } = await supabaseAdmin
    .from('pct_orders')
    .select('id, product_code, product_name, batch_no, packaging_date, due_date, status')
    .neq('status', '삭제')
    .neq('status', '취소')
  if (ordErr) throw ordErr

  const candidates: OrderForGrouping[] = ((orders ?? []) as Record<string, unknown>[])
    .filter(o => !lockedOrderIds.has(o.id as string))
    .map(o => ({
      id:            o.id as string,
      productCode:   (o.product_code as string) ?? '',
      productName:   (o.product_name as string) ?? '',
      batchNo:       (o.batch_no as string) ?? '',
      packagingDate: (o.packaging_date as string) ?? null,
      dueDate:       (o.due_date as string) ?? null,
    }))

  const built = buildGroupsFromOrders(candidates)
  let created = 0

  for (const g of built) {
    const { data: groupRow, error: insErr } = await supabaseAdmin
      .from('concurrent_analysis_groups')
      .insert({
        group_key:       g.groupKey,
        test_start_date: g.testStartDate,
        group_lock:      false,
      })
      .select('id')
      .single()
    if (insErr) throw insErr
    const groupId = (groupRow as Record<string, unknown>).id as string

    const { error: itemsErr } = await supabaseAdmin
      .from('concurrent_analysis_group_items')
      .insert(g.items.map(it => ({
        group_id:                groupId,
        order_id:                it.orderId,
        packaging_complete_date: it.packagingDate,
      })))
    if (itemsErr) throw itemsErr
    created++
  }

  return { created, kept }
}

// ─── 잠금 토글 ─────────────────────────────────────────────────────────────
export async function setGroupLock(id: string, lock: boolean): Promise<void> {
  const { error } = await supabaseAdmin
    .from('concurrent_analysis_groups')
    .update({ group_lock: lock })
    .eq('id', id)
  if (error) throw error
}
