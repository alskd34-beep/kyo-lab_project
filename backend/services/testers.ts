import { supabaseAdmin as supabase } from '@backend/lib/supabase'
import { selectAll } from '@backend/lib/supabasePage'
import { hashPassword } from '@backend/lib/auth'

/** 시험자 계정 최초 자동 생성 시 기본 비밀번호 */
const DEFAULT_TESTER_PASSWORD = 'qc1234'

export interface TesterRow {
  id: string
  employeeNo: string
  name: string
  avatarUrl: string | null
  canSolo: boolean
  canDuo: boolean
  isActive: boolean
  /** 1:1 연결된 사용자 계정 (로그인 ID = 사번) */
  userId: string | null
  username: string | null
  customerNo: number | null
}

export interface CapabilityRow {
  id: string
  code: string
  name: string
  sortOrder: number
}

export type ProficiencyLevel = 'Y' | 'N' | 'X' | 'O'

export interface CapabilityMatrixRow {
  testerId: string
  capabilityId: string
  proficiencyLevel: ProficiencyLevel
}

function mapTester(r: Record<string, unknown>, link?: { userId: string; username: string; customerNo: number | null; avatarUrl: string | null }): TesterRow {
  return {
    id:         r.id as string,
    employeeNo: r.employee_no as string,
    name:       r.name as string,
    avatarUrl:  link?.avatarUrl ?? null,
    canSolo:    r.can_solo as boolean,
    canDuo:     r.can_duo as boolean,
    isActive:   r.is_active as boolean,
    userId:     link?.userId ?? null,
    username:   link?.username ?? null,
    customerNo: link?.customerNo ?? null,
  }
}

/**
 * 설정 > 사용자에서 역할이 "시험자"(admin 이 아님)인데 아직 testers 레코드가 없는 계정을
 * 위해 시험자 레코드를 찾거나 새로 만들어 연결한다(사번=username 매칭 우선).
 * 원래 시험자 계정은 testers 레코드 생성(`ensureLinkedUser`) 또는 역할 전환
 * (`users.ensureLinkedTester`) 시 자동 연결되지만, 마이그레이션/시드로 users 만
 * 직접 생성된 계정은 연결이 비어 있을 수 있어 조회 시점에 보정한다.
 */
async function backfillTesterLinks(): Promise<void> {
  const { data: unlinked } = await supabase
    .from('users')
    .select('id, username, display_name')
    .is('tester_id', null)
    .neq('role', 'admin')
  for (const u of (unlinked ?? []) as Record<string, unknown>[]) {
    const userId = u.id as string
    const username = u.username as string
    const displayName = (u.display_name as string | null) || username

    const { data: existing } = await supabase
      .from('testers')
      .select('id')
      .eq('employee_no', username)
      .maybeSingle()

    let testerId: string
    if (existing) {
      testerId = (existing as Record<string, unknown>).id as string
      // 다른 사용자가 이 시험자를 이미 점유하고 있으면 먼저 해제 (1:1 유니크 제약)
      await supabase.from('users').update({ tester_id: null }).eq('tester_id', testerId).neq('id', userId)
    } else {
      const { data: created, error } = await supabase
        .from('testers')
        .insert({ employee_no: username, name: displayName, can_solo: true, can_duo: false, is_active: true })
        .select('id')
        .single()
      if (error || !created) continue
      testerId = (created as Record<string, unknown>).id as string
    }
    await supabase.from('users').update({ tester_id: testerId }).eq('id', userId)
  }
}

/**
 * 시험자 목록.
 * @param opts.activeOnly true 면 비활성(is_active=false) 시험자를 제외한다.
 *   배정 후보·담당자 선택 목록처럼 "일할 사람"만 필요한 곳은 반드시 true 로 호출한다.
 *   시험자 관리 화면처럼 비활성자도 편집해야 하는 곳은 기본값(전체)을 쓴다.
 * @param opts.onlyTesterRole true 면 설정 > 사용자에서 역할이 "시험자"(admin 이 아님)인
 *   계정과 연결된 시험자만 반환한다(연결이 없으면 `backfillTesterLinks`로 보정 후 반환).
 *   시험자 관리 화면 전용 — 배정 엔진 등 다른 호출부는 기존 동작(연결 여부와 무관하게 전체)을
 *   유지하기 위해 기본값 false 를 쓴다.
 */
export async function listTesters(opts: { activeOnly?: boolean; onlyTesterRole?: boolean } = {}): Promise<TesterRow[]> {
  if (opts.onlyTesterRole) await backfillTesterLinks()

  let query = supabase
    .from('testers')
    .select('id, employee_no, name, can_solo, can_duo, is_active')
    .order('employee_no', { ascending: true })
  if (opts.activeOnly) query = query.eq('is_active', true)
  const { data, error } = await query
  if (error) throw error
  const rows = (data ?? []) as Record<string, unknown>[]

  // 연결된 사용자 계정(1:1) 매핑
  let userQuery = supabase
    .from('users')
    .select('id, username, tester_id, customer_no, avatar_url')
    .not('tester_id', 'is', null)
  if (opts.onlyTesterRole) userQuery = userQuery.neq('role', 'admin')
  const { data: users } = await userQuery
  const linkByTester = new Map<string, { userId: string; username: string; customerNo: number | null; avatarUrl: string | null }>()
  for (const u of (users ?? []) as Record<string, unknown>[]) {
    linkByTester.set(u.tester_id as string, {
      userId:     u.id as string,
      username:   u.username as string,
      customerNo: (u.customer_no as number) ?? null,
      avatarUrl:  (u.avatar_url as string | null) ?? null,
    })
  }

  const scopedRows = opts.onlyTesterRole ? rows.filter(r => linkByTester.has(r.id as string)) : rows
  return scopedRows.map(r => mapTester(r, linkByTester.get(r.id as string)))
}

/**
 * 사번(employee_no)을 로그인 ID(username)로 하는 사용자 계정을 보장하고 시험자에 1:1 연결.
 * - 이미 같은 사번 계정이 있으면 tester_id 만 연결.
 * - 없으면 기본 비밀번호로 신규 계정 생성.
 */
async function ensureLinkedUser(testerId: string, employeeNo: string, name: string): Promise<void> {
  const { data: existing } = await supabase
    .from('users')
    .select('id, tester_id')
    .eq('username', employeeNo)
    .maybeSingle()

  if (existing) {
    if ((existing as Record<string, unknown>).tester_id !== testerId) {
      await supabase.from('users').update({ tester_id: testerId }).eq('id', (existing as Record<string, unknown>).id as string)
    }
    return
  }
  const passwordHash = await hashPassword(DEFAULT_TESTER_PASSWORD)
  await supabase.from('users').insert({
    username:      employeeNo,
    password_hash: passwordHash,
    display_name:  name,
    role:          'tester',
    is_active:     true,
    tester_id:     testerId,
  })
}

export async function createTester(input: {
  employeeNo: string
  name: string
  canSolo: boolean
  canDuo: boolean
}): Promise<TesterRow> {
  const { data, error } = await supabase
    .from('testers')
    .insert({
      employee_no: input.employeeNo,
      name:        input.name,
      can_solo:    input.canSolo,
      can_duo:     input.canDuo,
    })
    .select('id, employee_no, name, can_solo, can_duo, is_active')
    .single()
  if (error) throw error
  const row = data as Record<string, unknown>
  // 1:1 사용자 계정 자동 생성·연결 (로그인 ID = 사번)
  await ensureLinkedUser(row.id as string, input.employeeNo, input.name)
  return mapTester(row)
}

export async function updateTester(
  id: string,
  input: Partial<{ employeeNo: string; name: string; canSolo: boolean; canDuo: boolean; isActive: boolean }>
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (input.employeeNo !== undefined) patch.employee_no = input.employeeNo
  if (input.name       !== undefined) patch.name        = input.name
  if (input.canSolo    !== undefined) patch.can_solo     = input.canSolo
  if (input.canDuo     !== undefined) patch.can_duo      = input.canDuo
  if (input.isActive   !== undefined) patch.is_active    = input.isActive
  const { error } = await supabase.from('testers').update(patch).eq('id', id)
  if (error) throw error

  // 연결된 사용자 계정 동기화
  // - 사번 변경 시 로그인 ID(username)도 함께 변경
  // - 활성/비활성은 users.is_active 와 항상 같은 값을 유지한다(계정 정지 ↔ 배정 제외 일원화)
  const userPatch: Record<string, unknown> = {}
  if (input.employeeNo !== undefined) userPatch.username = input.employeeNo
  if (input.name       !== undefined) userPatch.display_name = input.name
  if (input.isActive   !== undefined) userPatch.is_active = input.isActive
  if (Object.keys(userPatch).length > 0) {
    await supabase.from('users').update(userPatch).eq('tester_id', id)
  }
  // 사번이 바뀌었는데 아직 연결 계정이 없으면 새로 보장
  if (input.employeeNo !== undefined) {
    const { data: linked } = await supabase.from('users').select('id').eq('tester_id', id).maybeSingle()
    if (!linked) {
      const { data: t } = await supabase.from('testers').select('name').eq('id', id).maybeSingle()
      await ensureLinkedUser(id, input.employeeNo, (t as Record<string, unknown> | null)?.name as string ?? '')
    }
  }
}

export async function deleteTester(id: string): Promise<void> {
  const { error } = await supabase.from('testers').delete().eq('id', id)
  if (error) {
    // 담당자 슬롯(pct_order_assignees, 0049)의 FK 는 on delete restrict 다 — 시험자 하드 삭제로
    // 배정이 조용히 사라지지 않게 막는다. 1인·병렬 배정 공통 문구(F3-6).
    if ((error as { code?: string }).code === '23503' && /pct_order_assignees/.test(error.message ?? '')) {
      throw new Error('배정된 오더가 있어 삭제할 수 없습니다. 비활성화하세요.')
    }
    throw error
  }
}

/**
 * 배정 대상 시험자가 활성 상태인지 검증한다. 비활성이면 에러를 던진다.
 * UI 에서 목록을 걸러도 직접 API 호출·오래된 화면 상태로 비활성자가 넘어올 수 있으므로
 * 담당자를 실제로 기록하는 서버 경로에서 마지막 방어선으로 호출한다.
 */
export async function assertTesterAssignable(testerId: string | null | undefined): Promise<void> {
  if (!testerId) return
  const { data, error } = await supabase
    .from('testers')
    .select('name, is_active')
    .eq('id', testerId)
    .maybeSingle()
  if (error) throw error
  if (!data) throw new Error('존재하지 않는 시험자입니다.')
  if (!(data as Record<string, unknown>).is_active) {
    throw new Error(`비활성 시험자(${(data as Record<string, unknown>).name})에게는 배정할 수 없습니다.`)
  }
}

export async function listCapabilities(): Promise<CapabilityRow[]> {
  const { data, error } = await supabase
    .from('test_capabilities')
    .select('id, code, name, sort_order')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data ?? []).map(r => ({
    id:        (r as Record<string, unknown>).id as string,
    code:      (r as Record<string, unknown>).code as string,
    name:      (r as Record<string, unknown>).name as string,
    sortOrder: (r as Record<string, unknown>).sort_order as number,
  }))
}

export async function listCapabilityMatrix(): Promise<CapabilityMatrixRow[]> {
  // 시험자 x 역량 조합이라 행 수가 빠르게 늘어난다 → 1000행 절단 방지
  const { data, error } = await selectAll(supabase, 'tester_capability_matrix', 'tester_id, capability_id, proficiency_level', { orderBy: ['tester_id', 'capability_id'] })
  if (error) throw new Error(error.message)
  return (data ?? []).map(r => ({
    testerId:         (r as Record<string, unknown>).tester_id as string,
    capabilityId:     (r as Record<string, unknown>).capability_id as string,
    proficiencyLevel: (r as Record<string, unknown>).proficiency_level as ProficiencyLevel,
  }))
}

export async function upsertCapabilityLevel(
  testerId: string,
  capabilityId: string,
  proficiencyLevel: ProficiencyLevel
): Promise<void> {
  const { error } = await supabase
    .from('tester_capability_matrix')
    .upsert({ tester_id: testerId, capability_id: capabilityId, proficiency_level: proficiencyLevel })
  if (error) throw error
}

// ─── 역량 마스터(test_capabilities) 관리 ─────────────────────────────────────
// 이 표의 한 행이 시험자 역량 매트릭스의 컬럼 하나가 된다.

/** 마스터 목록 + 각 역량이 매트릭스에서 실제로 몇 건 평가됐는지 */
export interface CapabilityMasterRow extends CapabilityRow {
  /** 이 역량에 숙련도가 기록된 시험자 수 ('X' 미평가 포함) */
  ratedCount: number
}

const CODE_PATTERN = /^[A-Z0-9_]+$/

/**
 * 코드는 마이그레이션 시드·외부 연동이 참조하는 키라 형식을 강제한다.
 * (기존 값이 전부 APPEARANCE / LCMS_TQ 같은 대문자 스네이크라 같은 규칙을 유지)
 */
function normalizeCapabilityInput(input: { code?: unknown; name?: unknown; sortOrder?: unknown }) {
  const out: { code?: string; name?: string; sort_order?: number } = {}
  if (input.code !== undefined) {
    const code = String(input.code).trim().toUpperCase()
    if (!code) throw new Error('코드를 입력하세요.')
    if (!CODE_PATTERN.test(code)) throw new Error('코드는 영문 대문자·숫자·밑줄(_)만 쓸 수 있습니다.')
    out.code = code
  }
  if (input.name !== undefined) {
    const name = String(input.name).trim()
    if (!name) throw new Error('역량명을 입력하세요.')
    out.name = name
  }
  if (input.sortOrder !== undefined) {
    const n = Number(input.sortOrder)
    if (!Number.isFinite(n)) throw new Error('표시 순서는 숫자여야 합니다.')
    out.sort_order = Math.trunc(n)
  }
  return out
}

/** 코드 unique 제약 위반을 사용자가 읽을 수 있는 문장으로 바꾼다 */
function rethrowCapabilityError(err: { code?: string; message?: string } | null, code?: string): never {
  if (err?.code === '23505') throw new Error(`이미 쓰고 있는 코드입니다${code ? ` (${code})` : ''}.`)
  throw new Error(err?.message ?? '서버 오류')
}

export async function listCapabilityMaster(): Promise<CapabilityMasterRow[]> {
  const caps = await listCapabilities()
  // 역량 수 x 시험자 수라 1000행을 넘길 수 있다 → selectAll 로 전량 조회
  const { data, error } = await selectAll(supabase, 'tester_capability_matrix', 'capability_id', { orderBy: ['tester_id', 'capability_id'] })
  if (error) throw new Error(error.message)
  const countById = new Map<string, number>()
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const id = r.capability_id as string
    countById.set(id, (countById.get(id) ?? 0) + 1)
  }
  return caps.map(c => ({ ...c, ratedCount: countById.get(c.id) ?? 0 }))
}

export async function createCapability(input: {
  code: unknown; name: unknown; sortOrder?: unknown
}): Promise<CapabilityRow> {
  const values = normalizeCapabilityInput(input)
  // 순서를 안 주면 맨 뒤에 붙인다 — 10 단위로 띄워 두면 나중에 사이에 끼워 넣기 쉽다
  if (values.sort_order === undefined) {
    const caps = await listCapabilities()
    values.sort_order = caps.length === 0 ? 10 : Math.max(...caps.map(c => c.sortOrder)) + 10
  }
  const { data, error } = await supabase
    .from('test_capabilities')
    .insert(values)
    .select('id, code, name, sort_order')
    .single()
  if (error) rethrowCapabilityError(error, values.code)
  const r = data as Record<string, unknown>
  return { id: r.id as string, code: r.code as string, name: r.name as string, sortOrder: r.sort_order as number }
}

export async function updateCapability(id: string, input: {
  code?: unknown; name?: unknown; sortOrder?: unknown
}): Promise<void> {
  const values = normalizeCapabilityInput(input)
  if (Object.keys(values).length === 0) return
  const { error } = await supabase.from('test_capabilities').update(values).eq('id', id)
  if (error) rethrowCapabilityError(error, values.code)
}

/**
 * 역량 삭제.
 *
 * `tester_capability_matrix.capability_id` 가 `on delete cascade` 라, 지우면 그 역량에
 * 매겨 둔 시험자 숙련도가 **경고 없이 함께 사라진다.** 실수로 컬럼 하나를 지워 평가
 * 이력을 통째로 날리는 일이 없도록, 평가 기록이 있으면 기본적으로 막는다.
 * 정말 지우려면 화면에서 건수를 확인시킨 뒤 force 로 다시 부른다.
 */
export async function deleteCapability(id: string, opts: { force?: boolean } = {}): Promise<void> {
  if (!opts.force) {
    const { count, error: cErr } = await supabase
      .from('tester_capability_matrix')
      .select('capability_id', { count: 'exact', head: true })
      .eq('capability_id', id)
    if (cErr) throw cErr
    if ((count ?? 0) > 0) {
      throw new Error(`이 역량에 매겨 둔 시험자 숙련도 ${count}건이 함께 삭제됩니다. 확인 후 다시 시도하세요.`)
    }
  }
  const { error } = await supabase.from('test_capabilities').delete().eq('id', id)
  if (error) throw error
}
