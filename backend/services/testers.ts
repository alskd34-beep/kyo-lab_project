import { supabase } from '@backend/lib/supabase'
import type { Tester } from '@shared/pqm'

export async function listTesters(_q: { isActive?: boolean } = {}): Promise<Tester[]> {
  const { data, error } = await supabase.from('testers').select('*').order('seq')
  if (error) throw error
  return (data ?? []) as Tester[]
}

export function filterTestersByCapability(testers: Tester[], capability: keyof Tester): Tester[] {
  return testers.filter(t => t[capability] === true)
}
