import { supabase } from '@backend/lib/supabase'
import { hashPassword } from '@backend/lib/auth'

/** 시험자 계정 최초 자동 생성 시 기본 비밀번호 */
const DEFAULT_TESTER_PASSWORD = 'qc1234'

export interface TesterRow {
  id: string
  employeeNo: string
  name: string
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

function mapTester(r: Record<string, unknown>, link?: { userId: string; username: string; customerNo: number | null }): TesterRow {
  return {
    id:         r.id as string,
    employeeNo: r.employee_no as string,
    name:       r.name as string,
    canSolo:    r.can_solo as boolean,
    canDuo:     r.can_duo as boolean,
    isActive:   r.is_active as boolean,
    userId:     link?.userId ?? null,
    username:   link?.username ?? null,
    customerNo: link?.customerNo ?? null,
  }
}

export async function listTesters(): Promise<TesterRow[]> {
  const { data, error } = await supabase
    .from('testers')
    .select('id, employee_no, name, can_solo, can_duo, is_active')
    .order('employee_no', { ascending: true })
  if (error) throw error
  const rows = (data ?? []) as Record<string, unknown>[]

  // 연결된 사용자 계정(1:1) 매핑
  const { data: users } = await supabase
    .from('users')
    .select('id, username, tester_id, customer_no')
    .not('tester_id', 'is', null)
  const linkByTester = new Map<string, { userId: string; username: string; customerNo: number | null }>()
  for (const u of (users ?? []) as Record<string, unknown>[]) {
    linkByTester.set(u.tester_id as string, {
      userId:     u.id as string,
      username:   u.username as string,
      customerNo: (u.customer_no as number) ?? null,
    })
  }

  return rows.map(r => mapTester(r, linkByTester.get(r.id as string)))
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

  // 연결된 사용자 계정 동기화 — 사번 변경 시 로그인 ID(username)도 함께 변경
  const userPatch: Record<string, unknown> = {}
  if (input.employeeNo !== undefined) userPatch.username = input.employeeNo
  if (input.name       !== undefined) userPatch.display_name = input.name
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
  if (error) throw error
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
  const { data, error } = await supabase
    .from('tester_capability_matrix')
    .select('tester_id, capability_id, proficiency_level')
  if (error) throw error
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
