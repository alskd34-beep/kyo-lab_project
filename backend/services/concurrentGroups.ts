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
 *   단, 품목코드가 N/A(수동 오더 대체값)인 오더는 자동으로 묶지 않는다(단독 그룹).
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
import { selectAll } from '@backend/lib/supabasePage'
import { DELETED_STATUS } from '@shared/qc-status'
import { isNaProductCode } from '@shared/order-na'

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
  /** 'auto'=규칙 자동 생성 · 'manual'=관리자가 직접 묶음 */
  source: 'auto' | 'manual'
  /** 왜 이렇게 묶었는지 (수동 그룹) */
  note: string | null
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
 *
 * @param familyByCode 품목코드 → 동시분석 품목군 id (기준설정 마스터).
 *   같은 품목군의 오더는 무조건 같은 그룹으로 강제 병합한다(마스터 우선).
 *   마스터에 없는 품목은 기존 유사도 규칙(sameGroup)으로 보완 병합한다.
 */
export function buildGroupsFromOrders(
  orders: OrderForGrouping[],
  familyByCode?: Map<string, string>,
): BuiltGroup[] {
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

  // [N/A 제외] 품목코드가 N/A(수동 오더 대체값, @shared/order-na)인 오더는 품목을 알 수 없으므로
  // 어떤 규칙(품목군·품목코드·품목명 동일/유사)으로도 다른 오더와 자동으로 묶지 않는다 — 단독 그룹으로 남는다.
  // 같은 시험을 함께 하려면 관리자가 수동 그룹으로 묶는다.
  const naCode = orders.map(o => isNaProductCode(o.productCode))

  // [마스터 우선] 동일 품목군(family)에 속한 오더끼리 먼저 강제 병합
  if (familyByCode && familyByCode.size > 0) {
    const firstIdxByFamily = new Map<string, number>()
    for (let i = 0; i < n; i++) {
      if (naCode[i]) continue
      const fam = familyByCode.get(orders[i].productCode)
      if (!fam) continue
      const prev = firstIdxByFamily.get(fam)
      if (prev == null) firstIdxByFamily.set(fam, i)
      else union(prev, i)
    }
  }

  // [규칙 보완] 마스터로 묶이지 않은 나머지는 유사도 규칙으로 병합
  for (let i = 0; i < n; i++) {
    if (naCode[i]) continue
    for (let j = i + 1; j < n; j++) {
      if (naCode[j]) continue
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

/**
 * 동시분석 품목군(기준설정 마스터) 품목코드 → family id 매핑.
 * 테이블 미적용(0020 미실행) 환경에서도 안전하게 빈 맵을 반환한다.
 * (concurrentProductFamilies 서비스와의 순환 import 를 피하려고 직접 조회)
 */
async function loadFamilyByCodeRaw(): Promise<Map<string, string>> {
  const m = new Map<string, string>()
  try {
    const { data, error } = await selectAll(supabaseAdmin, 'concurrent_product_family_members', 'family_id, product_code')
    if (error) return m
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      m.set(r.product_code as string, r.family_id as string)
    }
  } catch {
    /* 테이블 없음 등 — 무시하고 빈 맵 */
  }
  return m
}

// ─── 조회 ────────────────────────────────────────────────────────────────────
/** 그룹 + 멤버 조인 반환 (시험 시작일 오름차순) */
export async function listGroups(): Promise<GroupRow[]> {
  const { data: groups, error } = await supabaseAdmin
    .from('concurrent_analysis_groups')
    // select('*') 로 읽는다. source·note 는 0044 에서 붙는 컬럼이라, 이름을 명시하면
    // 마이그레이션 적용 전에는 42703 으로 목록 전체가 500 이 된다(AI 스케줄 화면이 깨진다).
    // '*' 면 없는 컬럼은 그냥 빠지고 아래 ?? 기본값이 받는다.
    .select('*')
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
    // 0044 미적용 DB 에서는 키가 없다 — 자동으로 취급해 화면이 깨지지 않게 한다.
    source:        (g.source as 'auto' | 'manual') ?? 'auto',
    note:          (g.note as string) ?? null,
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
    .neq('status', DELETED_STATUS)
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

  // [마스터 우선] 동시분석 품목군(기준설정) → 품목코드 매핑 로드
  const familyByCode = await loadFamilyByCodeRaw()
  const built = buildGroupsFromOrders(candidates, familyByCode)
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

// ─── 관리자 수동 그룹 (0044) ──────────────────────────────────────────────────
/**
 * 개별로 들어온 의뢰를 관리자가 직접 묶는다.
 *
 * 자동 규칙은 품목코드·품목명 유사도로만 판단해서, "같은 품목인데 포장일이 하루 달라
 * 갈라진" 경우를 사람이 다시 합칠 방법이 없었다. 그 판단을 시스템에 담는다.
 *
 * ⚠️ 그룹은 **함께 수행한다** 는 실행 단위일 뿐이다. 제조번호마다 시험 기록·성적서는
 *    그대로 분리된다(GMP 추적성) — qc_jobs / qc_job_items 는 오더별로 남는다.
 *
 * 보존은 group_lock=true 로 한다. rebuildGroups 가 잠긴 그룹과 그 멤버를 재구성
 * 대상에서 이미 빼므로, 새 보존 장치를 만들지 않는다(같은 뜻을 두 곳에 두지 않는다).
 */

/** 묶기 전 경고 — 막지는 않는다. 관리자의 판단이 규칙보다 우선한다는 것이 이 기능의 취지다. */
export interface GroupWarning {
  level: 'warn' | 'block'
  message: string
}

export interface GroupCandidate {
  orderId: string
  productCode: string
  productName: string
  batchNo: string
  packagingDate: string | null
  dueDate: string | null
  status: string
  /** 이미 다른 그룹에 속해 있으면 그 그룹 id */
  currentGroupId: string | null
  /** QC 작업이 이미 시작됐는가 */
  hasJob: boolean
}

/** 그룹 후보 오더들의 현재 상태를 한 번에 읽는다(검증·생성 공용). */
async function loadCandidates(orderIds: string[]): Promise<GroupCandidate[]> {
  if (orderIds.length === 0) return []
  const [ordersRes, itemsRes, jobsRes] = await Promise.all([
    supabaseAdmin.from('pct_orders')
      .select('id, product_code, product_name, batch_no, packaging_date, due_date, status')
      .in('id', orderIds),
    supabaseAdmin.from('concurrent_analysis_group_items').select('order_id, group_id').in('order_id', orderIds),
    supabaseAdmin.from('qc_jobs').select('order_id').in('order_id', orderIds),
  ])
  if (ordersRes.error) throw ordersRes.error
  if (itemsRes.error) throw itemsRes.error
  if (jobsRes.error) throw jobsRes.error

  const groupOf = new Map((itemsRes.data ?? []).map(i => [i.order_id as string, i.group_id as string]))
  const withJob = new Set((jobsRes.data ?? []).map(j => j.order_id as string))
  return (ordersRes.data ?? []).map(o => ({
    orderId:       o.id as string,
    productCode:   (o.product_code as string) ?? '',
    productName:   (o.product_name as string) ?? '',
    batchNo:       (o.batch_no as string) ?? '',
    packagingDate: (o.packaging_date as string) ?? null,
    dueDate:       (o.due_date as string) ?? null,
    status:        o.status as string,
    currentGroupId: groupOf.get(o.id as string) ?? null,
    hasJob:        withJob.has(o.id as string),
  }))
}

/**
 * 묶기 검증. 관리자 판단을 막지 않는 것이 원칙이라 대부분 'warn' 이다.
 * 'block' 은 데이터가 성립하지 않는 경우뿐 — 오더가 없거나, 삭제됐거나, 2건 미만.
 */
export function validateGrouping(candidates: GroupCandidate[], requestedIds: string[]): GroupWarning[] {
  const out: GroupWarning[] = []
  const missing = requestedIds.filter(id => !candidates.some(c => c.orderId === id))
  if (missing.length > 0) out.push({ level: 'block', message: `오더 ${missing.length}건을 찾을 수 없습니다.` })

  const alive = candidates.filter(c => c.status !== DELETED_STATUS)
  const deleted = candidates.length - alive.length
  if (deleted > 0) out.push({ level: 'block', message: `삭제된 오더 ${deleted}건은 묶을 수 없습니다.` })
  if (alive.length < 2) out.push({ level: 'block', message: '동시분석 그룹은 오더 2건 이상이어야 합니다.' })
  if (out.some(w => w.level === 'block')) return out

  // 품목코드가 섞이면 알린다. 막지는 않는다 — 같은 품목군(예: 경옥고 25001/25008/25009)을
  // 코드가 다르다는 이유로 못 묶으면 이 기능이 쓸모가 없다.
  const codes = [...new Set(alive.map(c => c.productCode))]
  if (codes.length > 1) {
    out.push({ level: 'warn', message: `품목코드가 ${codes.length}종 섞여 있습니다 (${codes.join(', ')}). 함께 시험할 수 있는지 확인하세요.` })
  }
  const names = [...new Set(alive.map(c => c.productName))]
  if (names.length > 1) {
    out.push({ level: 'warn', message: `품목명이 ${names.length}종 섞여 있습니다 (${names.slice(0, 3).join(', ')}${names.length > 3 ? ' 외' : ''}).` })
  }

  // 포장일이 크게 벌어지면 "함께 시험" 이 성립하지 않는다. 하루 이틀 차이는 이 기능이
  // 노리는 정상 상황이라 조용히 통과시키고, 그 이상만 알린다.
  const packs = alive.map(c => c.packagingDate).filter(Boolean).sort() as string[]
  if (packs.length >= 2) {
    const gap = Math.round(
      (new Date(packs[packs.length - 1]).getTime() - new Date(packs[0]).getTime()) / 86400000,
    )
    if (gap > 3) out.push({ level: 'warn', message: `포장일이 ${gap}일 벌어져 있습니다 (${packs[0]} ~ ${packs[packs.length - 1]}).` })
  }
  const noPack = alive.filter(c => !c.packagingDate).length
  if (noPack > 0) out.push({ level: 'warn', message: `포장일이 없는 오더 ${noPack}건이 있어 시험 시작일 계산에서 빠집니다.` })

  const started = alive.filter(c => c.hasJob)
  if (started.length > 0) {
    out.push({
      level: 'warn',
      message: `이미 시험이 시작된 오더 ${started.length}건이 포함됩니다 (${started.map(c => c.batchNo).join(', ')}). 지금 묶어도 이미 진행된 부분은 합쳐지지 않습니다.`,
    })
  }
  const moved = alive.filter(c => c.currentGroupId)
  if (moved.length > 0) {
    out.push({ level: 'warn', message: `다른 그룹에 속한 오더 ${moved.length}건을 옮겨 옵니다.` })
  }
  return out
}

/** 검증만 수행(쓰기 없음) — 화면이 묶기 전에 보여준다 */
export async function previewGrouping(orderIds: string[]): Promise<{
  candidates: GroupCandidate[]; warnings: GroupWarning[]
}> {
  const candidates = await loadCandidates(orderIds)
  return { candidates, warnings: validateGrouping(candidates, orderIds) }
}

/** 시험 시작일 = 그룹 내 최대 포장일 + 1일 (자동 그룹과 같은 규칙) */
function startDateOf(candidates: GroupCandidate[]): string | null {
  const packs = candidates.map(c => c.packagingDate).filter(Boolean).sort() as string[]
  if (packs.length === 0) return null
  const d = new Date(packs[packs.length - 1] + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** 오더를 기존 그룹에서 떼어낸다. unique(order_id) 때문에 옮기기 전에 반드시 필요하다. */
async function detachOrders(orderIds: string[]): Promise<void> {
  if (orderIds.length === 0) return
  const { error } = await supabaseAdmin
    .from('concurrent_analysis_group_items').delete().in('order_id', orderIds)
  if (error) throw error
}

/** 멤버가 0건이 된 그룹은 남겨 두지 않는다 — 빈 그룹은 화면에서 유령 행이 된다. */
async function purgeEmptyGroups(): Promise<void> {
  const { data: groups } = await supabaseAdmin.from('concurrent_analysis_groups').select('id')
  const { data: items } = await supabaseAdmin.from('concurrent_analysis_group_items').select('group_id')
  const used = new Set((items ?? []).map(i => i.group_id as string))
  const empty = (groups ?? []).map(g => g.id as string).filter(id => !used.has(id))
  if (empty.length === 0) return
  await supabaseAdmin.from('concurrent_analysis_groups').delete().in('id', empty)
}

export async function createManualGroup(
  orderIds: string[], opts: { label?: string | null; note?: string | null }, userId: string | null,
): Promise<{ groupId: string; warnings: GroupWarning[] }> {
  const candidates = await loadCandidates(orderIds)
  const warnings = validateGrouping(candidates, orderIds)
  const blocked = warnings.filter(w => w.level === 'block')
  if (blocked.length > 0) throw new Error(blocked.map(b => b.message).join(' '))

  const alive = candidates.filter(c => c.status !== DELETED_STATUS)
  await detachOrders(alive.map(c => c.orderId))

  // 키는 결정적으로: 그룹 내 최소 order_id 앞 8자리. 자동 그룹과 구분되게 접두사를 다르게 둔다.
  const minId = alive.map(c => c.orderId).sort()[0]
  const { data: groupRow, error: insErr } = await supabaseAdmin
    .from('concurrent_analysis_groups')
    .insert({
      group_key:       `mgrp-${minId.slice(0, 8)}`,
      label:           opts.label?.trim() || null,
      note:            opts.note?.trim() || null,
      test_start_date: startDateOf(alive),
      // 수동 그룹은 자동 재생성이 지우면 안 된다. 잠금이 그 역할을 이미 한다.
      group_lock:      true,
      source:          'manual',
      created_by:      userId,
    })
    .select('id').single()
  if (insErr) throw insErr
  const groupId = (groupRow as Record<string, unknown>).id as string

  const { error: itemErr } = await supabaseAdmin
    .from('concurrent_analysis_group_items')
    .insert(alive.map(c => ({ group_id: groupId, order_id: c.orderId, packaging_complete_date: c.packagingDate })))
  if (itemErr) throw itemErr

  await purgeEmptyGroups()
  return { groupId, warnings: warnings.filter(w => w.level === 'warn') }
}

/** 기존 그룹에 오더를 더한다(다른 그룹에 있었으면 옮겨 온다). */
export async function addGroupMembers(groupId: string, orderIds: string[]): Promise<number> {
  const candidates = (await loadCandidates(orderIds)).filter(c => c.status !== DELETED_STATUS)
  if (candidates.length === 0) return 0
  await detachOrders(candidates.map(c => c.orderId))
  const { error } = await supabaseAdmin
    .from('concurrent_analysis_group_items')
    .insert(candidates.map(c => ({ group_id: groupId, order_id: c.orderId, packaging_complete_date: c.packagingDate })))
  if (error) throw error
  await refreshGroupStartDate(groupId)
  await purgeEmptyGroups()
  return candidates.length
}

/** 그룹에서 오더를 뺀다. 남은 멤버가 1건 이하가 되면 그룹을 해체한다(1건짜리 동시분석은 뜻이 없다). */
export async function removeGroupMembers(groupId: string, orderIds: string[]): Promise<{ removed: number; dissolved: boolean }> {
  const { error } = await supabaseAdmin
    .from('concurrent_analysis_group_items').delete().eq('group_id', groupId).in('order_id', orderIds)
  if (error) throw error
  const { count } = await supabaseAdmin
    .from('concurrent_analysis_group_items').select('id', { count: 'exact', head: true }).eq('group_id', groupId)
  if ((count ?? 0) <= 1) {
    await supabaseAdmin.from('concurrent_analysis_groups').delete().eq('id', groupId)
    return { removed: orderIds.length, dissolved: true }
  }
  await refreshGroupStartDate(groupId)
  return { removed: orderIds.length, dissolved: false }
}

/** 그룹 해체 — 멤버는 on delete cascade 로 함께 사라진다(오더 자체는 그대로). */
export async function dissolveGroup(groupId: string): Promise<void> {
  const { error } = await supabaseAdmin.from('concurrent_analysis_groups').delete().eq('id', groupId)
  if (error) throw error
}

/** 멤버가 바뀌면 시험 시작일도 다시 잡는다 — 안 하면 화면이 옛 날짜를 계속 말한다. */
async function refreshGroupStartDate(groupId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from('concurrent_analysis_group_items').select('order_id').eq('group_id', groupId)
  const ids = (data ?? []).map(i => i.order_id as string)
  if (ids.length === 0) return
  const candidates = await loadCandidates(ids)
  await supabaseAdmin.from('concurrent_analysis_groups')
    .update({ test_start_date: startDateOf(candidates) }).eq('id', groupId)
}
