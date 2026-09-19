import { supabaseAdmin } from '@backend/lib/supabase'
import { getHolidaySet } from '@backend/services/holidays'
import { listJobDelaySpans } from '@backend/services/jobDelaySpans'
import { getTesterEvaluation } from '@backend/services/testerEvaluation'
import { getOperationReport } from '@backend/services/operationReport'
import { listGroupSavings } from '@backend/services/concurrentSavings'
import { isNonWorkingDay } from '@backend/lib/workdays'
import { selectAll } from '@backend/lib/supabasePage'
import type { DelayReasonAttribution } from '@shared/delay-reason'
import type { TesterPerformanceResponse, TesterPerformanceRow } from '@shared/tester-performance'

const round = (n: number) => Math.round(n * 10) / 10
const IN_CHUNK = 150
const kstDate = (value: string) => new Date(new Date(value).getTime() + 9 * 3600000).toISOString().slice(0, 10)
const holiday = (date: string, set: Set<string>) => { const d = new Date(`${date}T00:00:00Z`).getUTCDay(); return d === 0 || d === 6 || set.has(date) }
const emptyBuckets = () => ({ compliant: 0, oneDay: 0, twoToThreeDays: 0, fourPlusDays: 0, missing: 0 })
/** 기간 상한(GUARD_DAYS)에 걸리지 않도록 장기간 보고서도 전부 펼친다. */
function dateRange(from: string, to: string): string[] {
  const out: string[] = []
  const cursor = new Date(`${from}T00:00:00Z`)
  const end = new Date(`${to}T00:00:00Z`)
  while (cursor <= end) { out.push(cursor.toISOString().slice(0, 10)); cursor.setUTCDate(cursor.getUTCDate() + 1) }
  return out
}
function blank(id: string, name: string): TesterPerformanceRow { return { testerId: id, name, completed: 0, dueEligible: 0, dueOnTime: 0, dueComplianceRate: null, overrunDays: null, overrunBuckets: emptyBuckets(), delayJobs: 0, delayCount: 0, avgDelayDays: null, ongoingDelayCount: 0, declaredDelayCount: 0, autoOverdueCount: 0, externalDelayCount: 0, internalDelayCount: 0, unknownAttributionCount: 0, recoveryRate: null, holidayItems: 0, holidayMinutes: 0, holidaySideWorkCount: 0, holidaySideWorkMinutes: 0, sideWorkRatio: null, sideToTestRatio: null, sideFragmentation: null, availableDayUtilization: null, reassignedIn: 0, reassignedOut: 0, reopenCount: 0, concurrentSavingsDays: 0 } }

async function loadDelayedJobs(ids: string[]) {
  const all: Record<string, unknown>[] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) {
    const result = await selectAll(supabaseAdmin, 'qc_jobs', 'id, order_id, assignee_tester_id, status, work_end_date', { orderBy: 'id', filters: [{ column: 'id', operator: 'in', value: ids.slice(i, i + IN_CHUNK) }] })
    if (result.error) return { data: null, error: result.error }
    all.push(...((result.data ?? []) as unknown as Record<string, unknown>[]))
  }
  return { data: all, error: null }
}

export async function getTesterPerformance(params: { from: string; to: string }): Promise<TesterPerformanceResponse> {
  const { from, to } = params
  const [holidays, evalData, operation, savings, delayResult] = await Promise.all([getHolidaySet(), getTesterEvaluation(params), getOperationReport(params), listGroupSavings(params), listJobDelaySpans(params)])
  const { spans, reasonColumnsAvailable } = delayResult
  const delayJobIds = [...new Set(spans.map(s => s.jobId))]
  const [jobsRes, sideRes, reassignmentRes, reviewRes, itemRes, absenceRes, delayedJobsRes] = await Promise.all([
    selectAll(supabaseAdmin, 'qc_jobs', 'id, order_id, assignee_tester_id, work_start_date, work_end_date', { orderBy: 'id', filters: [{ column: 'status', operator: 'eq', value: '승인완료' }, { column: 'work_end_date', operator: 'gte', value: from }, { column: 'work_end_date', operator: 'lte', value: to }] }),
    selectAll(supabaseAdmin, 'side_work_logs', 'id, tester_id, work_date, minutes, created_at', { orderBy: ['work_date', 'id'], filters: [{ column: 'work_date', operator: 'gte', value: from }, { column: 'work_date', operator: 'lte', value: to }] }),
    selectAll(supabaseAdmin, 'reassignment_history', 'id, before_user, after_user, changed_at', { orderBy: ['changed_at', 'id'], filters: [{ column: 'changed_at', operator: 'gte', value: `${from}T00:00:00+09:00` }, { column: 'changed_at', operator: 'lte', value: `${to}T23:59:59.999+09:00` }] }),
    selectAll(supabaseAdmin, 'qc_job_item_review_history', 'id, qc_job_id, action, created_at', { orderBy: ['created_at', 'id'], filters: [{ column: 'action', operator: 'eq', value: 'reopen' }, { column: 'created_at', operator: 'gte', value: `${from}T00:00:00+09:00` }, { column: 'created_at', operator: 'lte', value: `${to}T23:59:59.999+09:00` }] }),
    selectAll(supabaseAdmin, 'qc_job_items', 'id, qc_job_id, elapsed_minutes, cleared_at', { orderBy: ['cleared_at', 'id'], filters: [{ column: 'cleared_at', operator: 'not', value: null }, { column: 'cleared_at', operator: 'gte', value: `${from}T00:00:00+09:00` }, { column: 'cleared_at', operator: 'lte', value: `${to}T23:59:59.999+09:00` }] }),
    selectAll(supabaseAdmin, 'operator_schedule', 'id, start_date, end_date, type, users(tester_id)', { orderBy: ['start_date', 'id'], filters: [{ column: 'start_date', operator: 'lte', value: to }, { column: 'end_date', operator: 'gte', value: from }] }),
    loadDelayedJobs(delayJobIds),
  ])
  for (const result of [jobsRes, sideRes, reassignmentRes, reviewRes, itemRes, absenceRes, delayedJobsRes]) if (result.error && !['42P01', 'PGRST205'].includes(result.error.code ?? '')) throw result.error
  const jobs = jobsRes.data ?? []
  const orderIds = [...new Set([...jobs, ...(delayedJobsRes.data ?? [])].map(j => j.order_id as string | null).filter(Boolean) as string[])]
  const orderRows: Record<string, unknown>[] = []
  for (let i = 0; i < orderIds.length; i += IN_CHUNK) {
    const ordersRes = await selectAll(supabaseAdmin, 'pct_orders', 'id, due_date, product_code', { orderBy: 'id', filters: [{ column: 'id', operator: 'in', value: orderIds.slice(i, i + IN_CHUNK) }] })
    if (ordersRes.error) throw ordersRes.error
    orderRows.push(...((ordersRes.data ?? []) as unknown as Record<string, unknown>[]))
  }
  const due = new Map(orderRows.map(o => [o.id as string, o.due_date as string]))
  const productByOrder = new Map(orderRows.map(o => [o.id as string, o.product_code as string]))
  const productCodes = [...new Set(productByOrder.values())].filter(Boolean)
  const workloadRes = productCodes.length === 0
    ? { data: [], error: null }
    : await selectAll(supabaseAdmin, 'product_workload', 'product_code, avg_workdays', { orderBy: 'product_code', filters: [{ column: 'product_code', operator: 'in', value: productCodes }] })
  if (workloadRes.error && !['42P01', 'PGRST205'].includes(workloadRes.error.code ?? '')) throw workloadRes.error
  const workload = new Map((workloadRes.data ?? []).map(w => [w.product_code as string, Number(w.avg_workdays)]))
  const jobById = new Map(jobs.map(j => [j.id as string, j]))
  const delayedJobById = new Map((delayedJobsRes.data ?? []).map(j => [j.id as string, j]))
  const testersRes = await selectAll(supabaseAdmin, 'testers', 'id, name', { orderBy: 'id' })
  if (testersRes.error && !['42P01', 'PGRST205'].includes((testersRes.error as { code?: string }).code ?? '')) throw testersRes.error
  const testerNames = new Map((testersRes.data ?? []).map(t => [t.id as string, t.name as string]))
  const opBy = new Map(operation.byTester.map(t => [t.testerId, t])); const names = new Map([...evalData.byTester, ...operation.byTester].map(t => [t.testerId, t.name])); for (const [id, name] of testerNames) names.set(id, name)
  const namesToIds = new Map<string, string[]>(); for (const [id, name] of names) { const ids = namesToIds.get(name) ?? []; ids.push(id); namesToIds.set(name, ids) }
  const rows = new Map<string, TesterPerformanceRow>()
  const ensure = (id: string) => { let row = rows.get(id); if (!row) { row = blank(id, names.get(id) ?? '(미상)'); rows.set(id, row) } return row }
  for (const job of jobs) { const id = job.assignee_tester_id as string | null; if (!id) continue; const row = ensure(id); row.completed++; const dueDate = due.get(job.order_id as string); if (dueDate) { row.dueEligible++; if ((job.work_end_date as string) <= dueDate) row.dueOnTime++ } }
  const spanByTester = new Map<string, typeof spans>(); for (const span of spans) if (span.testerId) { const list = spanByTester.get(span.testerId) ?? []; list.push(span); spanByTester.set(span.testerId, list) }
  const reasons = new Map<string, { label: string; attribution: DelayReasonAttribution | null; count: number }>()
  for (const span of spans) { if (!span.testerId) continue; const row = ensure(span.testerId); row.delayCount++; row.delayJobs++; row.avgDelayDays = (row.avgDelayDays ?? 0) + span.workdays; if (span.ongoing) row.ongoingDelayCount++; if (span.attribution === 'external') row.externalDelayCount++; else if (span.attribution === 'internal') row.internalDelayCount++; else row.unknownAttributionCount++; const key = span.reasonCategoryId ?? 'unrecorded'; const item = reasons.get(key) ?? { label: span.reasonCategoryName ?? '사유 미기록', attribution: span.attribution, count: 0 }; item.count++; reasons.set(key, item) }
  for (const t of [...evalData.byTester, ...operation.byTester]) { const row = ensure(t.testerId); const op = opBy.get(t.testerId); row.sideWorkRatio = op?.sideRatio ?? null; row.sideToTestRatio = op && op.testMinutes > 0 ? round(op.sideMinutes / op.testMinutes) : null }
  for (const log of sideRes.data ?? []) { const row = ensure(log.tester_id as string); if (holiday(log.work_date as string, holidays)) { row.holidaySideWorkCount++; row.holidaySideWorkMinutes += Number(log.minutes ?? 0) } }
  const sideDays = new Map<string, Set<string>>(); for (const log of sideRes.data ?? []) { const days = sideDays.get(log.tester_id as string) ?? new Set<string>(); days.add(log.work_date as string); sideDays.set(log.tester_id as string, days) }
  for (const item of itemRes.data ?? []) { const job = jobById.get(item.qc_job_id as string); if (job?.assignee_tester_id && holiday(kstDate(item.cleared_at as string), holidays)) { const row = ensure(job.assignee_tester_id as string); row.holidayItems++; row.holidayMinutes += Number(item.elapsed_minutes ?? 0) } }
  for (const r of reassignmentRes.data ?? []) { if (r.after_user) ensure(r.after_user as string).reassignedIn++; if (r.before_user) ensure(r.before_user as string).reassignedOut++ }
  for (const r of reviewRes.data ?? []) { const job = jobById.get(r.qc_job_id as string); if (job?.assignee_tester_id) ensure(job.assignee_tester_id as string).reopenCount++ }
  for (const saving of savings) { if (!saving.realizable) continue; for (const member of saving.members) { const ids = member.testerName ? namesToIds.get(member.testerName) ?? [] : []; const tester = ids.length === 1 ? ids[0] : null; if (tester) ensure(tester).concurrentSavingsDays += saving.savedDays / saving.members.length } }
  const workingDays = dateRange(from, to).filter(d => !isNonWorkingDay(d, holidays)).length
  for (const row of rows.values()) {
    const ownSpans = spanByTester.get(row.testerId) ?? []
    row.delayJobs = new Set(ownSpans.map(s => s.jobId)).size
    row.avgDelayDays = row.delayJobs ? round((row.avgDelayDays ?? 0) / row.delayJobs) : null
    row.dueComplianceRate = row.dueEligible ? round(row.dueOnTime / row.dueEligible * 100) : null
    const sideDaySet = sideDays.get(row.testerId)
    const sideCount = (sideRes.data ?? []).filter(log => log.tester_id === row.testerId).length
    row.sideFragmentation = sideDaySet?.size ? round(sideCount / sideDaySet.size) : null
    const absentDays = (absenceRes.data ?? []).reduce((sum, item) => {
      const userValue = item.users as Record<string, unknown> | Array<Record<string, unknown>> | null
      const user = Array.isArray(userValue) ? userValue[0] : userValue
      if (user?.tester_id !== row.testerId) return sum
      const startDate = String(item.start_date) < from ? from : String(item.start_date)
      const endDate = String(item.end_date) > to ? to : String(item.end_date)
      const days = dateRange(startDate, endDate).filter(d => !isNonWorkingDay(d, holidays)).length
      return sum + (item.type === 'HALF_DAY' ? days * 0.5 : days)
    }, 0)
    const availableDays = Math.max(0, workingDays - absentDays)
    const op = opBy.get(row.testerId)
    row.availableDayUtilization = op && availableDays > 0 && op.testMinutes + op.sideMinutes > 0 ? round((op.testMinutes + op.sideMinutes) / (availableDays * 480) * 100) : null
    row.declaredDelayCount = ownSpans.filter(span => span.declaredBy === 'tester').length
    row.autoOverdueCount = Math.max(0, row.dueEligible - row.dueOnTime)
    for (const job of jobs.filter(j => j.assignee_tester_id === row.testerId)) {
      const standard = workload.get(productByOrder.get(job.order_id as string) ?? '')
      const actual = job.work_start_date && job.work_end_date ? Math.max(0, dateRange(job.work_start_date as string, job.work_end_date as string).filter(d => !isNonWorkingDay(d, holidays)).length) : null
      if (standard == null || actual == null) row.overrunBuckets.missing++
      else { const over = Math.max(0, actual - standard); if (over === 0) row.overrunBuckets.compliant++; else if (over === 1) row.overrunBuckets.oneDay++; else if (over <= 3) row.overrunBuckets.twoToThreeDays++; else row.overrunBuckets.fourPlusDays++; row.overrunDays = round((row.overrunDays ?? 0) + over) }
    }
    const completedDelayedJobs = new Set(ownSpans.map(s => s.jobId).filter(id => {
      const job = delayedJobById.get(id)
      return job?.status === '승인완료' && due.get(job.order_id as string)
    }))
    const recoveredDelayedJobs = new Set([...completedDelayedJobs].filter(id => {
      const job = delayedJobById.get(id)
      return (job?.work_end_date as string) <= due.get(job?.order_id as string)! 
    }))
    row.recoveryRate = completedDelayedJobs.size ? round(recoveredDelayedJobs.size / completedDelayedJobs.size * 100) : null
  }
  const byTester = [...rows.values()].sort((a, b) => b.completed - a.completed)
  const assignedSpans = spans.filter(s => s.testerId)
  const totalDelay = assignedSpans.length
  const totalDelayJobs = new Set(assignedSpans.map(s => s.jobId)).size
  // totals는 비율을 행별로 더하지 않고 원자료 합계에서 다시 산출한다.
  const totals: Omit<TesterPerformanceRow, 'testerId' | 'name'> = {
    completed: byTester.reduce((n, r) => n + r.completed, 0), dueEligible: byTester.reduce((n, r) => n + r.dueEligible, 0), dueOnTime: byTester.reduce((n, r) => n + r.dueOnTime, 0), dueComplianceRate: null,
    overrunDays: byTester.some(r => r.overrunDays != null) ? round(byTester.reduce((n, r) => n + (r.overrunDays ?? 0), 0)) : null,
    overrunBuckets: { compliant: 0, oneDay: 0, twoToThreeDays: 0, fourPlusDays: 0, missing: 0 }, delayJobs: byTester.reduce((n, r) => n + r.delayJobs, 0),
    delayCount: byTester.reduce((n, r) => n + r.delayCount, 0), avgDelayDays: totalDelayJobs ? round(assignedSpans.reduce((n, s) => n + s.workdays, 0) / totalDelayJobs) : null,
    ongoingDelayCount: byTester.reduce((n, r) => n + r.ongoingDelayCount, 0), declaredDelayCount: byTester.reduce((n, r) => n + r.declaredDelayCount, 0), autoOverdueCount: byTester.reduce((n, r) => n + r.autoOverdueCount, 0),
    externalDelayCount: byTester.reduce((n, r) => n + r.externalDelayCount, 0), internalDelayCount: byTester.reduce((n, r) => n + r.internalDelayCount, 0), unknownAttributionCount: byTester.reduce((n, r) => n + r.unknownAttributionCount, 0), recoveryRate: null,
    holidayItems: byTester.reduce((n, r) => n + r.holidayItems, 0), holidayMinutes: byTester.reduce((n, r) => n + r.holidayMinutes, 0), holidaySideWorkCount: byTester.reduce((n, r) => n + r.holidaySideWorkCount, 0), holidaySideWorkMinutes: byTester.reduce((n, r) => n + r.holidaySideWorkMinutes, 0),
    sideWorkRatio: null, sideToTestRatio: null, sideFragmentation: null, availableDayUtilization: null, reassignedIn: byTester.reduce((n, r) => n + r.reassignedIn, 0), reassignedOut: byTester.reduce((n, r) => n + r.reassignedOut, 0), reopenCount: byTester.reduce((n, r) => n + r.reopenCount, 0), concurrentSavingsDays: round(byTester.reduce((n, r) => n + r.concurrentSavingsDays, 0)),
  }
  totals.dueComplianceRate = totals.dueEligible ? round(totals.dueOnTime / totals.dueEligible * 100) : null
  totals.recoveryRate = (() => { const eligible = byTester.filter(r => r.recoveryRate != null).reduce((n, r) => n + r.delayJobs, 0); return eligible ? round(byTester.reduce((n, r) => n + (r.recoveryRate ?? 0) * r.delayJobs, 0) / eligible) : null })()
  for (const row of byTester) for (const key of Object.keys(totals.overrunBuckets) as Array<keyof typeof totals.overrunBuckets>) totals.overrunBuckets[key] += row.overrunBuckets[key]
  const sideTotal = byTester.reduce((n, r) => n + (opBy.get(r.testerId)?.sideMinutes ?? 0), 0); const testTotal = byTester.reduce((n, r) => n + (opBy.get(r.testerId)?.testMinutes ?? 0), 0)
  totals.sideWorkRatio = sideTotal + testTotal ? round(sideTotal / (sideTotal + testTotal) * 100) : null; totals.sideToTestRatio = testTotal ? round(sideTotal / testTotal) : null
  const avgDefined = (key: 'sideFragmentation' | 'availableDayUtilization') => { const values = byTester.map(r => r[key]).filter((value): value is number => value != null); return values.length ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : null }
  totals.sideFragmentation = avgDefined('sideFragmentation'); totals.availableDayUtilization = avgDefined('availableDayUtilization')
  const completedJobIds = new Set(jobs.map(j => j.id as string))
  const delayedCompletedJobs = new Set(spans.filter(s => completedJobIds.has(s.jobId) && !s.ongoing).map(s => s.jobId)).size
  return { period: { from, to, workingDays }, totals, byTester, delayReasonCoverage: reasonColumnsAvailable ? 'recorded' : 'unrecorded', delayReasons: [...reasons.entries()].map(([categoryId, r]) => ({ categoryId: categoryId === 'unrecorded' ? null : categoryId, label: r.label, attribution: r.attribution, count: r.count, ratio: totalDelay ? round(r.count / totalDelay * 100) : null })), delaySpans: spans, fairness: { totalDelayJobs: new Set(spans.map(s => s.jobId)).size, externalDelayJobs: new Set(spans.filter(s => s.attribution === 'external').map(s => s.jobId)).size, sampleSize: jobs.length, insufficientSample: jobs.length < 3, completedJobs: jobs.length, delayedCompletedJobs } }
}
