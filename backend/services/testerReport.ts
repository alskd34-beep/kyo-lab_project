import { supabaseAdmin } from '@backend/lib/supabase'
import { selectAll } from '@backend/lib/supabasePage'
import { getTesterPerformance } from '@backend/services/testerPerformance'
import type { TesterPerformanceRow } from '@shared/tester-performance'
import type { TesterReportDelaySpan, TesterReportResponse } from '@shared/tester-report'

const IN_CHUNK = 150

async function selectByIds(table: string, columns: string, ids: string[], orderBy: string | readonly string[]) {
  const rows: Record<string, unknown>[] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const result = await selectAll(supabaseAdmin, table, columns, { orderBy, filters: [{ column: 'id', operator: 'in', value: ids.slice(i, i + IN_CHUNK) }] })
    if (result.error) return { data: null, error: result.error }
    rows.push(...(result.data ?? []))
  }
  return { data: rows, error: null }
}

function average(rows: TesterPerformanceRow[]): TesterPerformanceRow {
  const first = rows[0]
  if (!first) {
    return {
      testerId: 'team-average', name: '팀 평균', completed: 0, dueEligible: 0,
      dueOnTime: 0, dueComplianceRate: null, overrunDays: null,
      overrunBuckets: { compliant: 0, oneDay: 0, twoToThreeDays: 0, fourPlusDays: 0, missing: 0 },
      delayJobs: 0, delayCount: 0, avgDelayDays: null, ongoingDelayCount: 0,
      declaredDelayCount: 0, autoOverdueCount: 0, externalDelayCount: 0,
      internalDelayCount: 0, unknownAttributionCount: 0, recoveryRate: null,
      holidayItems: 0, holidayMinutes: 0, holidaySideWorkCount: 0,
      holidaySideWorkMinutes: 0, sideWorkRatio: null, sideToTestRatio: null,
      sideFragmentation: null, availableDayUtilization: null, reassignedIn: 0,
      reassignedOut: 0, reopenCount: 0, concurrentSavingsDays: 0,
    }
  }
  const numeric = (key: keyof TesterPerformanceRow): number | null => {
    const values = rows.map(row => row[key]).filter((value): value is number => typeof value === 'number')
    return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : null
  }
  const required = (key: keyof TesterPerformanceRow) => numeric(key) ?? 0
  const result: TesterPerformanceRow = {
    testerId: 'team-average', name: '팀 평균',
    completed: required('completed'), dueEligible: required('dueEligible'), dueOnTime: required('dueOnTime'),
    dueComplianceRate: numeric('dueComplianceRate'), overrunDays: numeric('overrunDays'),
    overrunBuckets: {
      compliant: Math.round(rows.reduce((sum, row) => sum + row.overrunBuckets.compliant, 0) / rows.length * 10) / 10,
      oneDay: Math.round(rows.reduce((sum, row) => sum + row.overrunBuckets.oneDay, 0) / rows.length * 10) / 10,
      twoToThreeDays: Math.round(rows.reduce((sum, row) => sum + row.overrunBuckets.twoToThreeDays, 0) / rows.length * 10) / 10,
      fourPlusDays: Math.round(rows.reduce((sum, row) => sum + row.overrunBuckets.fourPlusDays, 0) / rows.length * 10) / 10,
      missing: Math.round(rows.reduce((sum, row) => sum + row.overrunBuckets.missing, 0) / rows.length * 10) / 10,
    },
    delayJobs: required('delayJobs'), delayCount: required('delayCount'), avgDelayDays: numeric('avgDelayDays'),
    ongoingDelayCount: required('ongoingDelayCount'), declaredDelayCount: required('declaredDelayCount'),
    autoOverdueCount: required('autoOverdueCount'), externalDelayCount: required('externalDelayCount'),
    internalDelayCount: required('internalDelayCount'), unknownAttributionCount: required('unknownAttributionCount'),
    recoveryRate: numeric('recoveryRate'), holidayItems: required('holidayItems'), holidayMinutes: required('holidayMinutes'),
    holidaySideWorkCount: required('holidaySideWorkCount'), holidaySideWorkMinutes: required('holidaySideWorkMinutes'),
    sideWorkRatio: numeric('sideWorkRatio'), sideToTestRatio: numeric('sideToTestRatio'),
    sideFragmentation: numeric('sideFragmentation'), availableDayUtilization: numeric('availableDayUtilization'),
    reassignedIn: required('reassignedIn'), reassignedOut: required('reassignedOut'), reopenCount: required('reopenCount'),
    concurrentSavingsDays: required('concurrentSavingsDays'),
  }
  const dueDenominator = rows.reduce((sum, row) => sum + row.dueEligible, 0)
  result.dueComplianceRate = dueDenominator
    ? Math.round(rows.reduce((sum, row) => sum + row.dueOnTime, 0) / dueDenominator * 1000) / 10
    : null
  const recoveryDenominator = rows.reduce((sum, row) => sum + (row.recoveryRate == null ? 0 : row.delayJobs), 0)
  result.recoveryRate = recoveryDenominator
    ? Math.round(rows.reduce((sum, row) => sum + (row.recoveryRate ?? 0) * row.delayJobs, 0) / recoveryDenominator * 10) / 10
    : null
  return result
}

function withoutRates(row: TesterPerformanceRow): TesterPerformanceRow {
  return row.completed < 3
    ? { ...row, dueComplianceRate: null, recoveryRate: null, sideWorkRatio: null }
    : row
}

function insufficientTeamAverage(): TesterPerformanceRow {
  return {
    testerId: 'team-average', name: '팀 평균', completed: 0, dueEligible: 0, dueOnTime: 0,
    dueComplianceRate: null, overrunDays: null,
    overrunBuckets: { compliant: 0, oneDay: 0, twoToThreeDays: 0, fourPlusDays: 0, missing: 0 },
    delayJobs: 0, delayCount: 0, avgDelayDays: null, ongoingDelayCount: 0,
    declaredDelayCount: 0, autoOverdueCount: 0, externalDelayCount: 0, internalDelayCount: 0,
    unknownAttributionCount: 0, recoveryRate: null, holidayItems: 0, holidayMinutes: 0,
    holidaySideWorkCount: 0, holidaySideWorkMinutes: 0, sideWorkRatio: null, sideToTestRatio: null,
    sideFragmentation: null, availableDayUtilization: null, reassignedIn: 0, reassignedOut: 0,
    reopenCount: 0, concurrentSavingsDays: 0,
  }
}

export async function getTesterReport(params: {
  from: string
  to: string
  actorUserId: string
  actorRole: 'admin' | 'tester'
  testerId?: string
}): Promise<TesterReportResponse> {
  const { data: actor, error: actorError } = await supabaseAdmin
    .from('users').select('tester_id').eq('id', params.actorUserId).maybeSingle()
  if (actorError) throw actorError
  const ownTesterId = (actor?.tester_id as string | null) ?? null
  let testerId = params.actorRole === 'admin' ? params.testerId : ownTesterId
  if (params.actorRole === 'admin' && !testerId) {
    const { data: firstTester, error: firstTesterError } = await supabaseAdmin
      .from('testers').select('id').eq('is_active', true).order('name').limit(1).maybeSingle()
    if (firstTesterError) throw firstTesterError
    testerId = (firstTester?.id as string | undefined)
  }
  if (!testerId) throw new Error('연결된 시험자 정보가 없습니다.')
  if (params.actorRole !== 'admin' && testerId !== ownTesterId) throw new Error('본인의 보고서만 조회할 수 있습니다.')

  const data = await getTesterPerformance({ from: params.from, to: params.to })
  const { data: testerMeta, error: testerMetaError } = await supabaseAdmin
    .from('testers').select('id, name').eq('id', testerId).maybeSingle()
  if (testerMetaError) throw testerMetaError
  if (!testerMeta) throw new Error('시험자 정보를 찾을 수 없습니다.')
  const tester = withoutRates(data.byTester.find(row => row.testerId === testerId) ?? {
    ...average([]), testerId, name: testerMeta.name as string,
  })
  const teamRows = data.byTester.filter(row => row.completed > 0)
  const teamAverage = teamRows.length < 3 ? insufficientTeamAverage() : average(teamRows)
  const ownSpans = data.delaySpans.filter(span => span.testerId === testerId)
  const jobIds = [...new Set(ownSpans.map(span => span.jobId))]
  const { data: jobs, error: jobsError } = jobIds.length
    ? await selectByIds('qc_jobs', 'id, order_id', jobIds, 'id')
    : { data: [], error: null }
  if (jobsError) throw jobsError
  const orderIds = (jobs ?? []).map(row => row.order_id as string).filter(Boolean)
  const { data: orders, error: ordersError } = orderIds.length
    ? await selectByIds('pct_orders', 'id, product_name, batch_no', orderIds, 'id')
    : { data: [], error: null }
  if (ordersError) throw ordersError
  const orderById = new Map((orders ?? []).map(row => [row.id as string, row]))
  const orderIdByJob = new Map((jobs ?? []).map(row => [row.id as string, row.order_id as string]))
  const delaySpans: TesterReportDelaySpan[] = ownSpans.map(span => {
    const order = orderById.get(orderIdByJob.get(span.jobId) ?? '')
    return { ...span, productName: (order?.product_name as string | null) ?? null, batchNo: (order?.batch_no as string | null) ?? null, result: span.endedAt ? '해소됨' : '진행 중' }
  })
  const response: TesterReportResponse = {
    period: data.period,
    tester,
    teamAverage,
    delaySpans,
    delayReasonCoverage: data.delayReasonCoverage,
    insufficientSample: tester.completed < 3,
    teamAverageSampleSize: teamRows.length,
  }
  if (params.actorRole === 'admin') {
    const { data: allTesters, error: allTestersError } = await selectAll(supabaseAdmin, 'testers', 'id, name', { orderBy: ['name', 'id'], filters: [{ column: 'is_active', operator: 'eq', value: true }] })
    if (allTestersError) throw allTestersError
    response.testers = (allTesters ?? []).map(row => ({ testerId: row.id as string, name: row.name as string }))
  }
  return response
}
