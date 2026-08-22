/**
 * [BACKEND] 시험자 자격 인증 (qualification_categories / qualification_items / tester_qualifications)
 *
 * 사내 「Qualification List」를 데이터로 관리한다.
 *   카테고리(QC 완제품 고형제(정제1) …) → OJT 항목(함량/질량편차(HPLC) …) → 시험자별 자격 보유
 *
 * 기존 `tester_capability_matrix`(역량 Y/O/N)와 다른 개념이다 — 역량은 "할 수 있는가",
 * 자격은 "인증받아 유효기간 안에 있는가". 자동배정 후보 판정은 여전히 역량 쪽을 쓴다.
 *
 * 만료 상태는 저장하지 않고 `@shared/qualification` 의 판정 함수로 계산한다.
 *
 * 스키마: supabase/migrations/0031_tester_qualifications.sql
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { describeSchemaError } from '@backend/lib/schemaError'
import {
  CERT_METHODS,
  CERT_TYPES,
  QUALIFICATION_ROLES,
  calcExpiryDate,
  qualificationStatus,
  type QualificationStatus,
} from '@shared/qualification'

const FEATURE = '시험자 자격 인증'

// ─── 행 타입 ─────────────────────────────────────────────────────────────────

export interface QualCategoryRow {
  id: string
  name: string
  sortOrder: number
  isActive: boolean
}

export interface QualItemRow {
  id: string
  categoryId: string
  categoryName: string
  name: string
  validMonths: number
  note: string | null
  sortOrder: number
  isActive: boolean
}

export interface TesterQualRow {
  id: string
  testerId: string
  qualificationItemId: string
  qualificationRole: string
  grantedOn: string
  expiresOn: string | null
  certType: string
  certMethod: string
  note: string | null
  /** expires_on 기준 계산값 — 저장 컬럼이 아니다 */
  status: Exclude<QualificationStatus, 'none'>
}

export interface QualTesterRow {
  id: string
  employeeNo: string
  name: string
  isActive: boolean
}

/** 자격 현황 화면이 한 번에 받는 묶음 (매트릭스 = 시험자 × 자격항목) */
export interface QualificationOverview {
  categories: QualCategoryRow[]
  items: QualItemRow[]
  testers: QualTesterRow[]
  quals: TesterQualRow[]
}

// ─── 매핑 ────────────────────────────────────────────────────────────────────

function mapCategory(r: Record<string, unknown>): QualCategoryRow {
  return {
    id:        r.id as string,
    name:      r.name as string,
    sortOrder: (r.sort_order as number) ?? 0,
    isActive:  r.is_active !== false,
  }
}

function mapItem(r: Record<string, unknown>, categoryName: string): QualItemRow {
  return {
    id:          r.id as string,
    categoryId:  r.category_id as string,
    categoryName,
    name:        r.name as string,
    validMonths: (r.valid_months as number) ?? 24,
    note:        (r.note as string) ?? null,
    sortOrder:   (r.sort_order as number) ?? 0,
    isActive:    r.is_active !== false,
  }
}

function mapQual(r: Record<string, unknown>): TesterQualRow {
  const expiresOn = (r.expires_on as string) ?? null
  return {
    id:                  r.id as string,
    testerId:            r.tester_id as string,
    qualificationItemId: r.qualification_item_id as string,
    qualificationRole:   (r.qualification_role as string) ?? '시험자',
    grantedOn:           r.granted_on as string,
    expiresOn,
    certType:            r.cert_type as string,
    certMethod:          r.cert_method as string,
    note:                (r.note as string) ?? null,
    status:              qualificationStatus(expiresOn),
  }
}

// ─── 조회 ────────────────────────────────────────────────────────────────────

/**
 * 자격 현황 화면 전체 데이터.
 * 매트릭스를 그리려면 네 목록이 모두 필요해서 한 번에 내려준다(화면에서 4번 호출하지 않도록).
 * 비활성 카테고리·항목도 포함한다 — 이미 부여된 자격이 화면에서 사라지면 만료 관리가 끊긴다.
 */
export async function getQualificationOverview(): Promise<QualificationOverview> {
  const [catRes, itemRes, testerRes, qualRes] = await Promise.all([
    supabaseAdmin
      .from('qualification_categories')
      .select('id, name, sort_order, is_active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('qualification_items')
      .select('id, category_id, name, valid_months, note, sort_order, is_active')
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true }),
    supabaseAdmin
      .from('testers')
      .select('id, employee_no, name, is_active')
      .order('employee_no', { ascending: true }),
    supabaseAdmin
      .from('tester_qualifications')
      .select('id, tester_id, qualification_item_id, qualification_role, granted_on, expires_on, cert_type, cert_method, note'),
  ])
  if (catRes.error)    throw describeSchemaError(catRes.error, FEATURE)
  if (itemRes.error)   throw describeSchemaError(itemRes.error, FEATURE)
  if (testerRes.error) throw describeSchemaError(testerRes.error, '시험자')
  if (qualRes.error)   throw describeSchemaError(qualRes.error, FEATURE)

  const categories = (catRes.data ?? []).map(c => mapCategory(c as Record<string, unknown>))
  const catNameById = new Map(categories.map(c => [c.id, c.name]))

  // 카테고리 정렬 순서를 항목에도 물려준다 — 매트릭스 열이 카테고리별로 묶여야 한다.
  const catOrder = new Map(categories.map((c, idx) => [c.id, idx]))
  const items = (itemRes.data ?? [])
    .map(i => mapItem(i as Record<string, unknown>, catNameById.get((i as { category_id: string }).category_id) ?? ''))
    .sort((a, b) => {
      const ca = catOrder.get(a.categoryId) ?? 999
      const cb = catOrder.get(b.categoryId) ?? 999
      if (ca !== cb) return ca - cb
      if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder
      return a.name.localeCompare(b.name, 'ko')
    })

  return {
    categories,
    items,
    testers: (testerRes.data ?? []).map(t => ({
      id:         t.id as string,
      employeeNo: (t.employee_no as string) ?? '',
      name:       (t.name as string) ?? '',
      isActive:   t.is_active !== false,
    })),
    quals: (qualRes.data ?? []).map(q => mapQual(q as Record<string, unknown>)),
  }
}

// ─── 카테고리 CRUD ───────────────────────────────────────────────────────────

export async function createCategory(input: { name: string; sortOrder?: number }): Promise<QualCategoryRow> {
  const name = (input.name ?? '').trim()
  if (!name) throw new Error('카테고리 이름은 필수입니다.')

  const { data, error } = await supabaseAdmin
    .from('qualification_categories')
    .insert({ name, sort_order: input.sortOrder ?? 0 })
    .select('id, name, sort_order, is_active')
    .single()
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('같은 이름의 카테고리가 이미 있습니다.')
    throw new Error(`카테고리 생성 실패: ${error.message}`)
  }
  return mapCategory(data as Record<string, unknown>)
}

export async function updateCategory(
  id: string, input: { name?: string; sortOrder?: number; isActive?: boolean },
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new Error('카테고리 이름은 비울 수 없습니다.')
    patch.name = name
  }
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder
  if (input.isActive  !== undefined) patch.is_active  = input.isActive
  if (Object.keys(patch).length === 0) return

  const { error } = await supabaseAdmin.from('qualification_categories').update(patch).eq('id', id)
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('같은 이름의 카테고리가 이미 있습니다.')
    throw new Error(`카테고리 수정 실패: ${error.message}`)
  }
}

/** 카테고리 삭제 — 부여된 자격이 하나라도 있으면 막는다(인증 기록이 사라지면 안 된다). */
export async function deleteCategory(id: string): Promise<void> {
  const { data: items, error: itemErr } = await supabaseAdmin
    .from('qualification_items').select('id').eq('category_id', id)
  if (itemErr) throw new Error(`카테고리 조회 실패: ${itemErr.message}`)

  const itemIds = (items ?? []).map(i => i.id as string)
  if (itemIds.length > 0) {
    const { count, error: cntErr } = await supabaseAdmin
      .from('tester_qualifications')
      .select('id', { count: 'exact', head: true })
      .in('qualification_item_id', itemIds)
    if (cntErr) throw new Error(`자격 보유 조회 실패: ${cntErr.message}`)
    if ((count ?? 0) > 0) {
      throw new Error(`이 카테고리의 항목에 부여된 자격이 ${count}건 있습니다. 자격을 먼저 해제하거나 카테고리를 비활성으로 두세요.`)
    }
  }

  const { error } = await supabaseAdmin.from('qualification_categories').delete().eq('id', id)
  if (error) throw new Error(`카테고리 삭제 실패: ${error.message}`)
}

// ─── 자격 항목 CRUD ──────────────────────────────────────────────────────────

export interface CreateItemInput {
  categoryId: string
  name: string
  validMonths?: number
  note?: string | null
  sortOrder?: number
}

export async function createItem(input: CreateItemInput): Promise<void> {
  const name = (input.name ?? '').trim()
  if (!input.categoryId) throw new Error('카테고리는 필수입니다.')
  if (!name) throw new Error('OJT 항목 이름은 필수입니다.')
  const validMonths = input.validMonths ?? 24
  if (!Number.isInteger(validMonths) || validMonths <= 0) throw new Error('유효기간은 1개월 이상 정수여야 합니다.')

  const { error } = await supabaseAdmin.from('qualification_items').insert({
    category_id:  input.categoryId,
    name,
    valid_months: validMonths,
    note:         input.note?.trim() || null,
    sort_order:   input.sortOrder ?? 0,
  })
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('같은 카테고리에 같은 이름의 항목이 이미 있습니다.')
    throw new Error(`OJT 항목 생성 실패: ${error.message}`)
  }
}

export interface UpdateItemInput {
  categoryId?: string
  name?: string
  validMonths?: number
  note?: string | null
  sortOrder?: number
  isActive?: boolean
}

export async function updateItem(id: string, input: UpdateItemInput): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (input.categoryId !== undefined) patch.category_id = input.categoryId
  if (input.name !== undefined) {
    const name = input.name.trim()
    if (!name) throw new Error('OJT 항목 이름은 비울 수 없습니다.')
    patch.name = name
  }
  if (input.validMonths !== undefined) {
    if (!Number.isInteger(input.validMonths) || input.validMonths <= 0) {
      throw new Error('유효기간은 1개월 이상 정수여야 합니다.')
    }
    patch.valid_months = input.validMonths
  }
  if (input.note      !== undefined) patch.note       = input.note?.trim() || null
  if (input.sortOrder !== undefined) patch.sort_order = input.sortOrder
  if (input.isActive  !== undefined) patch.is_active  = input.isActive
  if (Object.keys(patch).length === 0) return

  const { error } = await supabaseAdmin.from('qualification_items').update(patch).eq('id', id)
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('같은 카테고리에 같은 이름의 항목이 이미 있습니다.')
    throw new Error(`OJT 항목 수정 실패: ${error.message}`)
  }
}

/** 항목 삭제 — 부여된 자격이 있으면 막는다. */
export async function deleteItem(id: string): Promise<void> {
  const { count, error: cntErr } = await supabaseAdmin
    .from('tester_qualifications')
    .select('id', { count: 'exact', head: true })
    .eq('qualification_item_id', id)
  if (cntErr) throw new Error(`자격 보유 조회 실패: ${cntErr.message}`)
  if ((count ?? 0) > 0) {
    throw new Error(`이 항목에 부여된 자격이 ${count}건 있습니다. 자격을 먼저 해제하거나 항목을 비활성으로 두세요.`)
  }

  const { error } = await supabaseAdmin.from('qualification_items').delete().eq('id', id)
  if (error) throw new Error(`OJT 항목 삭제 실패: ${error.message}`)
}

// ─── 시험자 자격 부여·수정·해제 ──────────────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

function assertChoice(value: string, allowed: readonly string[], label: string): void {
  if (!allowed.includes(value)) {
    throw new Error(`${label}은(는) ${allowed.join(' / ')} 중 하나여야 합니다.`)
  }
}

export interface GrantQualInput {
  testerId: string
  qualificationItemId: string
  qualificationRole?: string
  grantedOn: string
  /** 비우면 항목의 valid_months 로 계산한다. '' 를 명시하면 무기한(null) */
  expiresOn?: string | null
  certType: string
  certMethod: string
  note?: string | null
}

/**
 * 자격 부여. 같은 (시험자, 항목, 자격종류) 조합이 이미 있으면 그 행을 갱신한다 —
 * 재인증은 같은 자격의 갱신이므로 새 행을 쌓지 않는다.
 */
export async function grantQualification(input: GrantQualInput): Promise<void> {
  if (!input.testerId) throw new Error('시험자는 필수입니다.')
  if (!input.qualificationItemId) throw new Error('OJT 항목은 필수입니다.')
  if (!DATE_RE.test(input.grantedOn ?? '')) throw new Error('자격부여일은 YYYY-MM-DD 형식으로 입력하세요.')

  const role = (input.qualificationRole ?? '시험자').trim() || '시험자'
  assertChoice(role, QUALIFICATION_ROLES, '자격종류')
  assertChoice(input.certType, CERT_TYPES, '인증구분')
  assertChoice(input.certMethod, CERT_METHODS, '인증방법')

  const expiresOn = await resolveExpiry(input.qualificationItemId, input.grantedOn, input.expiresOn)
  if (expiresOn && expiresOn < input.grantedOn) {
    throw new Error('자격만료일이 자격부여일보다 앞설 수 없습니다.')
  }

  const { error } = await supabaseAdmin
    .from('tester_qualifications')
    .upsert({
      tester_id:             input.testerId,
      qualification_item_id: input.qualificationItemId,
      qualification_role:    role,
      granted_on:            input.grantedOn,
      expires_on:            expiresOn,
      cert_type:             input.certType,
      cert_method:           input.certMethod,
      note:                  input.note?.trim() || null,
    }, { onConflict: 'tester_id,qualification_item_id,qualification_role' })
  if (error) throw new Error(`자격 부여 실패: ${error.message}`)
}

/**
 * 만료일 확정.
 *  - undefined  : 항목의 valid_months 로 계산
 *  - '' 또는 null: 무기한(null)
 *  - 날짜 문자열 : 그대로
 */
async function resolveExpiry(
  itemId: string, grantedOn: string, given: string | null | undefined,
): Promise<string | null> {
  if (given === null || given === '') return null
  if (given !== undefined) {
    if (!DATE_RE.test(given)) throw new Error('자격만료일은 YYYY-MM-DD 형식으로 입력하세요.')
    return given
  }
  const { data, error } = await supabaseAdmin
    .from('qualification_items').select('valid_months').eq('id', itemId).maybeSingle()
  if (error) throw new Error(`OJT 항목 조회 실패: ${error.message}`)
  return calcExpiryDate(grantedOn, (data?.valid_months as number) ?? 24)
}

export interface UpdateQualInput {
  qualificationRole?: string
  grantedOn?: string
  expiresOn?: string | null
  certType?: string
  certMethod?: string
  note?: string | null
}

export async function updateQualification(id: string, input: UpdateQualInput): Promise<void> {
  const { data: current, error: readErr } = await supabaseAdmin
    .from('tester_qualifications')
    .select('granted_on, expires_on')
    .eq('id', id)
    .maybeSingle()
  if (readErr) throw new Error(`자격 조회 실패: ${readErr.message}`)
  if (!current) throw new Error('자격을 찾을 수 없습니다. 새로고침 후 다시 시도하세요.')

  const patch: Record<string, unknown> = {}
  if (input.qualificationRole !== undefined) {
    assertChoice(input.qualificationRole, QUALIFICATION_ROLES, '자격종류')
    patch.qualification_role = input.qualificationRole
  }
  if (input.grantedOn !== undefined) {
    if (!DATE_RE.test(input.grantedOn)) throw new Error('자격부여일은 YYYY-MM-DD 형식으로 입력하세요.')
    patch.granted_on = input.grantedOn
  }
  if (input.expiresOn !== undefined) {
    if (input.expiresOn === null || input.expiresOn === '') patch.expires_on = null
    else {
      if (!DATE_RE.test(input.expiresOn)) throw new Error('자격만료일은 YYYY-MM-DD 형식으로 입력하세요.')
      patch.expires_on = input.expiresOn
    }
  }
  if (input.certType !== undefined) {
    assertChoice(input.certType, CERT_TYPES, '인증구분')
    patch.cert_type = input.certType
  }
  if (input.certMethod !== undefined) {
    assertChoice(input.certMethod, CERT_METHODS, '인증방법')
    patch.cert_method = input.certMethod
  }
  if (input.note !== undefined) patch.note = input.note?.trim() || null
  if (Object.keys(patch).length === 0) return

  // 부여일·만료일 중 하나만 바꿔도 앞뒤가 뒤집히지 않도록 최종값끼리 비교한다.
  const finalGranted = (patch.granted_on as string) ?? (current.granted_on as string)
  const finalExpires = 'expires_on' in patch
    ? (patch.expires_on as string | null)
    : ((current.expires_on as string) ?? null)
  if (finalExpires && finalGranted && finalExpires < finalGranted) {
    throw new Error('자격만료일이 자격부여일보다 앞설 수 없습니다.')
  }

  const { error } = await supabaseAdmin.from('tester_qualifications').update(patch).eq('id', id)
  if (error) {
    if (/duplicate|unique/i.test(error.message)) throw new Error('같은 시험자에게 같은 항목·자격종류가 이미 있습니다.')
    throw new Error(`자격 수정 실패: ${error.message}`)
  }
}

/** 자격 해제 — 행을 지운다(미보유로 되돌린다). */
export async function revokeQualification(id: string): Promise<void> {
  const { error } = await supabaseAdmin.from('tester_qualifications').delete().eq('id', id)
  if (error) throw new Error(`자격 해제 실패: ${error.message}`)
}
