import { supabase } from '@backend/lib/supabase'

export interface TesterRow {
  id: string
  employeeNo: string
  name: string
  canSolo: boolean
  canDuo: boolean
  isActive: boolean
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

function mapTester(r: Record<string, unknown>): TesterRow {
  return {
    id:         r.id as string,
    employeeNo: r.employee_no as string,
    name:       r.name as string,
    canSolo:    r.can_solo as boolean,
    canDuo:     r.can_duo as boolean,
    isActive:   r.is_active as boolean,
  }
}

export async function listTesters(): Promise<TesterRow[]> {
  const { data, error } = await supabase
    .from('testers')
    .select('id, employee_no, name, can_solo, can_duo, is_active')
    .order('employee_no', { ascending: true })
  if (error) throw error
  return (data ?? []).map(r => mapTester(r as Record<string, unknown>))
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
  return mapTester(data as Record<string, unknown>)
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
