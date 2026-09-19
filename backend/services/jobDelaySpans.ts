import { supabaseAdmin } from '@backend/lib/supabase'
import { selectAll } from '@backend/lib/supabasePage'
import { getHolidaySet } from '@backend/services/holidays'
import { getDelayReasonCategory } from '@shared/delay-reason'
import { JOB_STATUSES } from '@shared/qc-status'
import type { DelaySpan } from '@shared/tester-performance'

const DAY = 86400000
const IN_CHUNK = 150
const kstDate = (value: string) => new Date(new Date(value).getTime() + 9 * 3600000).toISOString().slice(0, 10)
const isWeekend = (date: string) => { const d = new Date(`${date}T00:00:00Z`).getUTCDay(); return d === 0 || d === 6 }
function workdays(from: string, to: string, holidays: Set<string>): number {
  if (to < from) return 0
  let count = 0
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) {
    const date = new Date(t).toISOString().slice(0, 10)
    if (!isWeekend(date) && !holidays.has(date)) count++
  }
  return count
}
function schemaMissing(error: { code?: string; message?: string } | null): boolean {
  return !!error && (error.code === '42P01' || error.code === 'PGRST205' || error.code === 'PGRST204' || error.code === '42703' || /reason_category_id|attribution/.test(error.message ?? ''))
}

export async function listJobDelaySpans(params: { from: string; to: string }): Promise<{ spans: DelaySpan[]; reasonColumnsAvailable: boolean }> {
  const start = `${params.from}T00:00:00+09:00`
  const end = `${params.to}T23:59:59.999+09:00`
  let reasonColumnsAvailable = true
  const historyFilters = [{ column: 'created_at', operator: 'gte' as const, value: start }, { column: 'created_at', operator: 'lte' as const, value: end }]
  let result = await selectAll(supabaseAdmin, 'qc_job_status_history', 'id, qc_job_id, to_status, source, note, reason_category_id, attribution, changed_by, created_at', { orderBy: ['created_at', 'id'], filters: historyFilters })
  if (result.error && schemaMissing(result.error)) {
    reasonColumnsAvailable = false
    result = await selectAll(supabaseAdmin, 'qc_job_status_history', 'id, qc_job_id, to_status, source, note, changed_by, created_at', { orderBy: ['created_at', 'id'], filters: historyFilters })
  }
  if (result.error) {
    if (result.error.code === '42P01' || result.error.code === 'PGRST205') return { spans: [], reasonColumnsAvailable: false }
    throw new Error(result.error.message)
  }
  const rows = (result.data ?? []) as Array<Record<string, unknown>>
  const jobIds = [...new Set(rows.map(r => r.qc_job_id as string).filter(Boolean))]
  const testerByJob = new Map<string, string | null>()
  for (let i = 0; i < jobIds.length; i += IN_CHUNK) {
    const jobsResult = await selectAll(supabaseAdmin, 'qc_jobs', 'id, assignee_tester_id', { orderBy: 'id', filters: [{ column: 'id', operator: 'in', value: jobIds.slice(i, i + IN_CHUNK) }] })
    if (jobsResult.error) throw jobsResult.error
    for (const job of jobsResult.data ?? []) testerByJob.set(job.id as string, job.assignee_tester_id as string | null)
  }
  const changedByIds = [...new Set(rows.map(r => r.changed_by as string | null).filter(Boolean) as string[])]
  const adminByUser = new Set<string>()
  for (let i = 0; i < changedByIds.length; i += IN_CHUNK) {
    const usersResult = await selectAll(supabaseAdmin, 'users', 'id, role', { orderBy: 'id', filters: [{ column: 'id', operator: 'in', value: changedByIds.slice(i, i + IN_CHUNK) }] })
    if (!usersResult.error) for (const user of usersResult.data ?? []) if (user.role === 'admin') adminByUser.add(user.id as string)
  }
  const holidays = await getHolidaySet()
  const spans: DelaySpan[] = []
  const byJob = new Map<string, Array<Record<string, unknown>>>()
  for (const row of rows) {
    if (row.source === 'backfill') continue
    const id = row.qc_job_id as string
    const list = byJob.get(id) ?? []
    list.push(row)
    byJob.set(id, list)
  }
  for (const [jobId, history] of byJob) {
    for (let i = 0; i < history.length; i++) {
      const row = history[i]
      if (row.to_status !== '지연') continue
      const startedAt = String(row.created_at)
      // attribution 수정 감사 행은 상태 전이가 아니므로 지연 구간을 종료시키지 않는다.
      // 동일 시각의 실제 해제도 이력 정렬 순서상 다음 행이면 종료점으로 인정한다.
      const next = history.slice(i + 1).find(r => JOB_STATUSES.includes(String(r.to_status)) && String(r.created_at) >= startedAt)
      const endedAt = next ? String(next.created_at) : null
      const effectiveEnd = endedAt && endedAt < end ? endedAt : end
      const from = kstDate(startedAt)
      const to = kstDate(effectiveEnd)
      const category = getDelayReasonCategory(String(row.reason_category_id ?? ''), 'delay')
      const declaredBy: DelaySpan['declaredBy'] = row.source === 'auto'
        ? 'automatic'
        : adminByUser.has(String(row.changed_by)) ? 'admin' : 'tester'
      spans.push({ jobId, testerId: testerByJob.get(jobId) ?? null, startedAt, endedAt, workdays: workdays(from, to, holidays), ongoing: !endedAt || endedAt >= end, declared: declaredBy === 'tester', declaredBy, reasonCategoryId: (row.reason_category_id as string) ?? null, reasonCategoryName: category?.label ?? null, attribution: (row.attribution as DelaySpan['attribution']) ?? category?.attribution ?? null, note: typeof row.note === 'string' ? row.note.slice(0, 500) : null })
    }
  }
  return { spans: spans.filter(s => s.startedAt <= end && (!s.endedAt || s.endedAt >= start)), reasonColumnsAvailable }
}
