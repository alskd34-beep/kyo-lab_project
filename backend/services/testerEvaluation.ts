/**
 * [BACKEND] 시험자 성과 집계 — 완료 작업 기준 (「시험자 운영 분석」의 '성과' 절반)
 *
 * 의약품 QC 시험자 평가 지표를 완료된 작업(qc_jobs)에서 집계한다.
 *   - 공수 준수율: 실소요 근무일(시작~종료, 주말·공휴일 제외) ≤ 품목 지정 공수(avg_workdays)면 준수
 *   - 평균 소요일
 *   - 처리량 / 난이도 가중 처리량 / **계획** 가동률(지정공수합 / 기간 가용 근무일)
 *
 * ⚠️ 여기의 가동률은 **계획** 기준이다(배정된 공수가 근무일 대비 얼마인가).
 *    실측 기준 가동률은 operationReport 의 `coverage` 이며 뜻이 다르다 —
 *    화면에서 두 값을 '계획'·'실적'으로 이름 갈라 나란히 보여준다.
 *
 * 시험항목별 소요시간은 여기서 재지 않는다. operationReport 의 `byTestItem` 이
 * 같은 값을 건수·총소요까지 포함해 내놓는 상위집합이라, 두 곳에서 재면 기준이 갈린다
 * (여기는 '완료 작업에 딸린 항목', 저기는 '이 기간에 완료된 항목'으로 모집단부터 달랐다).
 *
 * 공수는 일(day) 단위(product_workload.avg_workdays = 절대값).
 * 집계 기준키는 tester_id(qc_jobs.assignee_tester_id).
 * 데이터: qc_jobs(완료) → pct_orders(품목) → product_workload+products, public_holidays.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { CLOSED_STAGE } from '@shared/qc-status'
import { getHolidaySet } from '@backend/services/holidays'

// 난이도 가중치 (products.difficulty: 'High'|'Medium'|'Low'|null). null·미상은 기본 1.
const DIFFICULTY_WEIGHT: Record<string, number> = { High: 3, Medium: 2, Low: 1 }

export interface TesterEvalRow {
  testerId:           string
  name:               string
  completed:          number        // 완료 작업 수
  adherenceRate:      number | null // 공수 준수율 % (산정 가능 작업 없으면 null)
  avgActualDays:      number | null // 평균 실소요 근무일
  weightedThroughput: number        // 난이도 가중 처리량
  utilization:        number | null // 가동률 % (지정공수합 / 기간 가용 근무일)
}

export interface TesterEvaluation {
  period:   { from: string; to: string; workingDays: number }
  totals:   { completedJobs: number; adherenceRate: number | null; avgActualDays: number | null }
  byTester: TesterEvalRow[]
}

// ─── 근무일 계산 (주말 + 공휴일 제외). scheduleEngine 내부 로직과 동일 규칙. ──────
function isNonWorkingDay(iso: string, holidays: Set<string>): boolean {
  const dow = new Date(iso + 'T00:00:00Z').getUTCDay()
  return dow === 0 || dow === 6 || holidays.has(iso)
}

/** 시작~종료(둘 다 포함) 사이의 근무일 수(주말·공휴일 제외). */
function workingDaysBetween(startISO: string, endISO: string, holidays: Set<string>): number {
  if (!startISO || !endISO || endISO < startISO) return 0
  let count = 0
  const d = new Date(startISO + 'T00:00:00Z')
  const end = new Date(endISO + 'T00:00:00Z')
  while (d <= end) {
    const iso = d.toISOString().slice(0, 10)
    if (!isNonWorkingDay(iso, holidays)) count++
    d.setUTCDate(d.getUTCDate() + 1)
  }
  return count
}

// 빈 입력 시 .in([])를 피해 빈 배열 반환(전체조회 방지 + 타입 단순화).
async function loadIn(
  table: string, columns: string, col: string, vals: string[],
): Promise<Record<string, unknown>[]> {
  if (vals.length === 0) return []
  const { data, error } = await supabaseAdmin.from(table).select(columns).in(col, vals)
  if (error) throw error
  return (data ?? []) as unknown as Record<string, unknown>[]
}

export async function getTesterEvaluation(params: { from: string; to: string }): Promise<TesterEvaluation> {
  const { from, to } = params
  const holidays = await getHolidaySet()
  const periodWorkingDays = workingDaysBetween(from, to, holidays)

  // 1) 완료 작업 (종료일 기준 기간 필터)
  const { data: jobsRaw, error: jErr } = await supabaseAdmin
    .from('qc_jobs')
    .select('id, order_id, assignee_tester_id, work_start_date, work_end_date')
    .eq('status', CLOSED_STAGE)
    .gte('work_end_date', from)
    .lte('work_end_date', to)
  if (jErr) throw jErr
  const jobs = (jobsRaw ?? []) as unknown as Array<{
    id: string; order_id: string | null; assignee_tester_id: string | null
    work_start_date: string | null; work_end_date: string | null
  }>

  if (jobs.length === 0) {
    return {
      period: { from, to, workingDays: periodWorkingDays },
      totals: { completedJobs: 0, adherenceRate: null, avgActualDays: null },
      byTester: [],
    }
  }

  // 2) 참조 데이터
  const orderIds  = [...new Set(jobs.map(j => j.order_id).filter(Boolean) as string[])]
  const testerIds = [...new Set(jobs.map(j => j.assignee_tester_id).filter(Boolean) as string[])]

  const [orders, testers] = await Promise.all([
    loadIn('pct_orders', 'id, product_code', 'id', orderIds),
    loadIn('testers',    'id, name',         'id', testerIds),
  ])
  const orderToCode = new Map<string, string>()
  for (const o of orders) orderToCode.set(o.id as string, (o.product_code as string) ?? '')
  const codes = [...new Set([...orderToCode.values()].filter(Boolean))]

  const [workloads, products] = await Promise.all([
    loadIn('product_workload', 'product_code, avg_workdays', 'product_code', codes),
    loadIn('products',         'product_code, difficulty',   'product_code', codes),
  ])
  const workdaysByCode = new Map<string, number>()
  for (const w of workloads) { const d = Number(w.avg_workdays); if (d > 0) workdaysByCode.set(w.product_code as string, d) }
  const difficultyByCode = new Map<string, string>()
  for (const p of products) if (p.difficulty) difficultyByCode.set(p.product_code as string, p.difficulty as string)
  const testerName = new Map<string, string>()
  for (const t of testers) testerName.set(t.id as string, t.name as string)

  // 3) 시험자별 집계
  interface Acc { completed: number; onTime: number; eligible: number; actualSum: number; actualCnt: number; weighted: number; assignedSum: number }
  const acc = new Map<string, Acc>()
  const ensure = (id: string): Acc => {
    let a = acc.get(id)
    if (!a) { a = { completed: 0, onTime: 0, eligible: 0, actualSum: 0, actualCnt: 0, weighted: 0, assignedSum: 0 }; acc.set(id, a) }
    return a
  }

  for (const j of jobs) {
    const tid = j.assignee_tester_id
    if (!tid) continue
    const a = ensure(tid)
    a.completed++
    const code = orderToCode.get(j.order_id ?? '') ?? ''
    const assigned = workdaysByCode.get(code) ?? null
    a.weighted += DIFFICULTY_WEIGHT[difficultyByCode.get(code) ?? ''] ?? 1
    if (assigned != null) a.assignedSum += assigned
    if (j.work_start_date && j.work_end_date) {
      const actual = workingDaysBetween(j.work_start_date, j.work_end_date, holidays)
      a.actualSum += actual; a.actualCnt++
      if (assigned != null) { a.eligible++; if (actual <= assigned) a.onTime++ }
    }
  }

  const byTester: TesterEvalRow[] = [...acc.entries()].map(([id, a]) => ({
    testerId:           id,
    name:               testerName.get(id) ?? '(미상)',
    completed:          a.completed,
    adherenceRate:      a.eligible ? Math.round((a.onTime / a.eligible) * 1000) / 10 : null,
    avgActualDays:      a.actualCnt ? Math.round((a.actualSum / a.actualCnt) * 10) / 10 : null,
    weightedThroughput: a.weighted,
    utilization:        periodWorkingDays ? Math.round((a.assignedSum / periodWorkingDays) * 1000) / 10 : null,
  })).sort((x, y) => y.completed - x.completed)

  // 4) 전체 합계
  let totOnTime = 0, totEligible = 0, totActualSum = 0, totActualCnt = 0
  for (const a of acc.values()) { totOnTime += a.onTime; totEligible += a.eligible; totActualSum += a.actualSum; totActualCnt += a.actualCnt }

  return {
    period: { from, to, workingDays: periodWorkingDays },
    totals: {
      completedJobs: jobs.length,
      adherenceRate: totEligible  ? Math.round((totOnTime / totEligible) * 1000) / 10 : null,
      avgActualDays: totActualCnt ? Math.round((totActualSum / totActualCnt) * 10) / 10 : null,
    },
    byTester,
  }
}
