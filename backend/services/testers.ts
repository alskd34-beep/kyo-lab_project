import { supabase } from '@backend/lib/supabase'
import type { ProficiencyLevel, TesterCapabilityRow, TesterRecommendation } from '@shared/pqm'

interface TestersQuery {
  canSolo?: boolean
  isActive?: boolean
}

interface DbTester {
  id: string
  employee_no: string
  name: string
  can_solo: boolean
  can_duo: boolean
  is_active: boolean
  created_at: string
  updated_at: string
  tester_capability_matrix: Array<{
    capability_id: string
    proficiency_level: ProficiencyLevel
    test_capabilities: {
      code: string
      name: string
    } | null
  }>
}

export interface TesterWithCapabilities {
  id: string
  employeeNo: string
  name: string
  canSolo: boolean
  canDuo: boolean
  isActive: boolean
  capabilities: Record<string, ProficiencyLevel>
}

function toTesterRow(r: DbTester): TesterCapabilityRow {
  const capabilities: Record<string, ProficiencyLevel> = {}
  for (const c of r.tester_capability_matrix) {
    const code = c.test_capabilities?.code
    if (code) capabilities[code] = c.proficiency_level
  }
  return {
    tester_id:   r.id,
    employee_no: r.employee_no,
    tester_name: r.name,
    capabilities,
  }
}

export async function listTesters(q: TestersQuery = {}): Promise<TesterCapabilityRow[]> {
  let query = supabase
    .from('testers')
    .select(`
      id, employee_no, name, can_solo, can_duo, is_active, created_at, updated_at,
      tester_capability_matrix (
        capability_id,
        proficiency_level,
        test_capabilities ( code, name )
      )
    `)
    .order('name', { ascending: true })

  if (q.isActive !== undefined) query = query.eq('is_active', q.isActive)
  if (q.canSolo  !== undefined) query = query.eq('can_solo', q.canSolo)

  const { data, error } = await query
  if (error) throw error

  return ((data ?? []) as unknown as DbTester[]).map(toTesterRow)
}

function proficiencyScore(level: ProficiencyLevel): number {
  if (level === 'O') return 2
  if (level === 'Y') return 1
  return 0
}

export async function getTesterRecommendations(
  testItemId: string,
  dateFrom?: string,
  dateTo?: string,
): Promise<TesterRecommendation[]> {
  const { data: itemData, error: itemError } = await supabase
    .from('test_items')
    .select('id, name, requires_duo')
    .eq('id', testItemId)
    .single()

  if (itemError) throw itemError
  const requiresDuo = (itemData as { requires_duo: boolean }).requires_duo

  const capabilityFilter = requiresDuo ? 'can_duo.eq.true' : 'can_solo.eq.true'

  const { data: testerData, error: testerError } = await supabase
    .from('testers')
    .select(`
      id, employee_no, name, can_solo, can_duo,
      tester_capability_matrix (
        capability_id,
        proficiency_level,
        test_capabilities ( id, code, name )
      )
    `)
    .eq('is_active', true)
    .or(capabilityFilter)

  if (testerError) throw testerError

  interface RawTester {
    id: string
    employee_no: string
    name: string
    can_solo: boolean
    can_duo: boolean
    tester_capability_matrix: Array<{
      capability_id: string
      proficiency_level: ProficiencyLevel
      test_capabilities: { id: string; code: string; name: string } | null
    }>
  }

  const testers = (testerData ?? []) as unknown as RawTester[]

  const { data: assignData, error: assignError } = await supabase
    .from('batch_test_assignments')
    .select('primary_tester_id, secondary_tester_id, status, scheduled_start_at, scheduled_end_at, estimated_hours')
    .in('status', ['PLANNED', 'IN_PROGRESS'])

  if (assignError) throw assignError

  interface RawAssignment {
    primary_tester_id: string | null
    secondary_tester_id: string | null
    status: string
    scheduled_start_at: string | null
    scheduled_end_at: string | null
    estimated_hours: number | null
  }

  const assignments = (assignData ?? []) as RawAssignment[]

  function getScheduledHours(testerId: string): number {
    let total = 0
    const from = dateFrom ? new Date(dateFrom).getTime() : null
    const to   = dateTo   ? new Date(dateTo).getTime()   : null

    for (const a of assignments) {
      const isPrimary   = a.primary_tester_id === testerId
      const isSecondary = a.secondary_tester_id === testerId
      if (!isPrimary && !isSecondary) continue

      if (from !== null && to !== null && a.scheduled_start_at) {
        const start = new Date(a.scheduled_start_at).getTime()
        if (start < from || start > to) continue
      }

      total += a.estimated_hours ?? 0
    }
    return total
  }

  const recommendations: TesterRecommendation[] = []

  for (const tester of testers) {
    const matchedCaps: string[] = []
    let totalScore = 0
    let capCount = 0

    for (const cap of tester.tester_capability_matrix) {
      const level = cap.proficiency_level
      if (level === 'Y' || level === 'O') {
        const code = cap.test_capabilities?.code
        if (code) matchedCaps.push(code)
        totalScore += proficiencyScore(level)
        capCount++
      }
    }

    if (matchedCaps.length === 0) continue

    const avgProficiency = capCount > 0 ? totalScore / capCount : 0
    const scheduledLoad  = getScheduledHours(tester.id)
    const loadPenalty    = Math.min(scheduledLoad / 40, 1)
    const recommendScore = avgProficiency * (1 - loadPenalty * 0.5)

    const reasons: string[] = []
    if (avgProficiency >= 2)    reasons.push('우수 역량 보유')
    else if (avgProficiency >= 1) reasons.push('역량 보유')
    if (scheduledLoad === 0)    reasons.push('현재 배정 없음')
    else if (scheduledLoad < 20) reasons.push(`현재 ${scheduledLoad}h 배정`)

    recommendations.push({
      tester_id:            tester.id,
      employee_no:          tester.employee_no,
      name:                 tester.name,
      matched_capabilities: matchedCaps,
      proficiency_score:    avgProficiency,
      scheduled_load_hours: scheduledLoad,
      can_solo:             tester.can_solo,
      can_duo:              tester.can_duo,
      recommendation_score: recommendScore,
      reason:               reasons.join(', ') || '적합',
    })
  }

  recommendations.sort((a, b) => b.recommendation_score - a.recommendation_score)

  return recommendations
}
