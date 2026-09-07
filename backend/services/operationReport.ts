/**
 * [BACKEND] 운영 결과 리포트 — 시험업무 vs 부업무
 *
 * 답해야 하는 질문(요구사항)
 *   1. 시험자가 시험 외 부업무를 **얼마나** 하는가        → sideCount / sideMinutes
 *   2. 그게 **얼마나 걸리는가**                          → 분류별 소요·평균
 *   3. 시험업무와 부업무의 **차이는 어느 정도**인가       → sideRatio(비중), 나란한 막대
 *   4. 시험 진행 항목도 함께 본다                        → byTestItem(항목별 건수·소요)
 *
 * ── 왜 '분' 하나로만 재는가
 * 시험업무 실적은 이미 분 단위로 쌓인다(`qc_job_items.elapsed_minutes` = 항목 시작→완료).
 * 부업무도 분으로 받으므로(0041) 두 값을 그대로 더하고 나눌 수 있다. 공수(DAY)는
 * '계획'의 단위라 여기 섞지 않는다 — 계획과 실적을 한 축에 놓으면 둘 다 못 읽는다.
 *
 * ── 기간에 넣는 기준
 *   시험업무: **항목을 완료한 시각**(cleared_at)이 기간 안. 그 시간을 그 기간에 썼다는 뜻.
 *   부업무  : work_date 가 기간 안.
 *   완료 작업 수: 승인완료 + work_end_date 가 기간 안(운영평가 화면과 같은 기준).
 * cleared_at 은 timestamptz 라 KST 하루 경계(+09:00)로 자른다 — UTC 로 자르면
 * 오전 9시 이전에 끝낸 항목이 전날로 밀린다(kstDate.ts 헤더 참조).
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { getHolidaySet } from '@backend/services/holidays'
import { aggregateSideWork } from '@backend/services/sideWork'
import { expandRange, isNonWorkingDay } from '@backend/lib/workdays'
import { CLOSED_STAGE } from '@shared/qc-status'
import {
  WORK_MINUTES_PER_DAY,
  type OperationReport,
  type OperationReportCategoryRow,
  type OperationReportDailyRow,
  type OperationReportItemRow,
  type OperationReportTesterRow,
} from '@shared/side-work'

/** 소수 1자리 반올림. 비율은 0.1% 단위면 충분하고, 그 아래는 노이즈다 */
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/** 'YYYY-MM-DD' + KST 하루 경계 → timestamptz 비교용 문자열 */
function kstDayStart(iso: string): string { return `${iso}T00:00:00+09:00` }
function kstDayEnd(iso: string): string   { return `${iso}T23:59:59.999+09:00` }

/** timestamptz → KST 기준 'YYYY-MM-DD' */
function toKstDate(ts: string): string {
  return new Date(new Date(ts).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** 빈 배열로 .in() 을 치지 않는다(전체 조회가 되어 버린다) */
async function loadIn(
  table: string, columns: string, col: string, vals: string[],
): Promise<Record<string, unknown>[]> {
  if (vals.length === 0) return []
  const { data, error } = await supabaseAdmin.from(table).select(columns).in(col, vals)
  if (error) throw error
  return (data ?? []) as unknown as Record<string, unknown>[]
}

export async function getOperationReport(params: { from: string; to: string }): Promise<OperationReport> {
  const { from, to } = params

  const [holidays, side] = await Promise.all([
    getHolidaySet(),
    aggregateSideWork(from, to),
  ])
  const workingDays = expandRange(from, to).filter(d => !isNonWorkingDay(d, holidays)).length

  // ── 시험업무 실적: 이 기간에 완료된 시험항목 ───────────────────────────────
  const { data: itemsRaw, error: itemErr } = await supabaseAdmin
    .from('qc_job_items')
    .select('qc_job_id, test_item_name, elapsed_minutes, cleared_at')
    .gte('cleared_at', kstDayStart(from))
    .lte('cleared_at', kstDayEnd(to))
  if (itemErr) throw itemErr
  const items = (itemsRaw ?? []) as unknown as Array<{
    qc_job_id: string; test_item_name: string
    elapsed_minutes: number | null; cleared_at: string
  }>

  // ── 완료 작업 수: 운영평가 화면과 같은 기준(승인완료 + 종료일이 기간 안) ────
  const { data: closedRaw, error: closedErr } = await supabaseAdmin
    .from('qc_jobs')
    .select('id, assignee_tester_id')
    .eq('status', CLOSED_STAGE)
    .gte('work_end_date', from)
    .lte('work_end_date', to)
  if (closedErr) throw closedErr
  const closedJobs = (closedRaw ?? []) as unknown as Array<{ id: string; assignee_tester_id: string | null }>

  // 항목 → 담당 시험자. 항목 테이블에는 담당자가 없어 작업을 한 번 더 읽는다.
  const jobIds = [...new Set(items.map(i => i.qc_job_id).filter(Boolean))]
  const jobRows = await loadIn('qc_jobs', 'id, assignee_tester_id', 'id', jobIds)
  const testerByJob = new Map<string, string>()
  for (const j of jobRows) {
    const t = j.assignee_tester_id as string | null
    if (t) testerByJob.set(j.id as string, t)
  }

  // ── 집계 통 ────────────────────────────────────────────────────────────────
  const testStats = new Map<string, { items: number; minutes: number; completedJobs: number }>()
  const bump = (testerId: string) => {
    const cur = testStats.get(testerId) ?? { items: 0, minutes: 0, completedJobs: 0 }
    testStats.set(testerId, cur)
    return cur
  }

  const byTestItemMap = new Map<string, { count: number; minutes: number }>()
  const testMinutesByDate = new Map<string, number>()

  for (const it of items) {
    const testerId = testerByJob.get(it.qc_job_id)
    // 소요가 안 찍힌 항목(0030 이전 완료분)은 시간 합계에서는 빠지지만 '진행 항목 수'에는 남는다.
    // 건수까지 빼면 "일은 했는데 한 적 없는 사람"이 되어 두 지표가 서로를 부정한다.
    const minutes = it.elapsed_minutes ?? 0

    if (testerId) {
      const s = bump(testerId)
      s.items += 1
      s.minutes += minutes
    }

    const name = it.test_item_name || '(이름 없음)'
    const agg = byTestItemMap.get(name) ?? { count: 0, minutes: 0 }
    agg.count += 1
    agg.minutes += minutes
    byTestItemMap.set(name, agg)

    const d = toKstDate(it.cleared_at)
    testMinutesByDate.set(d, (testMinutesByDate.get(d) ?? 0) + minutes)
  }

  for (const j of closedJobs) {
    if (!j.assignee_tester_id) continue
    bump(j.assignee_tester_id).completedJobs += 1
  }

  // ── 시험자 이름 ────────────────────────────────────────────────────────────
  const testerIds = [...new Set([...testStats.keys(), ...side.byTester.keys()])]
  const testerRows = await loadIn('testers', 'id, name', 'id', testerIds)
  const nameById = new Map<string, string>()
  for (const t of testerRows) nameById.set(t.id as string, (t.name as string) ?? '—')

  // ── 시험자별 행 ────────────────────────────────────────────────────────────
  const availableMinutes = workingDays * WORK_MINUTES_PER_DAY
  const byTester: OperationReportTesterRow[] = testerIds.map(testerId => {
    const t = testStats.get(testerId) ?? { items: 0, minutes: 0, completedJobs: 0 }
    const s = side.byTester.get(testerId) ?? { minutes: 0, count: 0 }
    const total = t.minutes + s.minutes
    return {
      testerId,
      name:          nameById.get(testerId) ?? '—',
      completedJobs: t.completedJobs,
      testItems:     t.items,
      testMinutes:   t.minutes,
      sideMinutes:   s.minutes,
      sideCount:     s.count,
      sideRatio:     total > 0 ? round1((s.minutes / total) * 100) : null,
      coverage:      availableMinutes > 0 ? round1((total / availableMinutes) * 100) : null,
    }
  })
  // 기록이 많은 사람이 위로. 같으면 이름순이라 순서가 매번 흔들리지 않는다.
  byTester.sort((a, b) =>
    (b.testMinutes + b.sideMinutes) - (a.testMinutes + a.sideMinutes)
    || a.name.localeCompare(b.name, 'ko'))

  // ── 부업무 분류별 ──────────────────────────────────────────────────────────
  const byCategory: OperationReportCategoryRow[] = [...side.byCategory.entries()]
    .map(([categoryId, c]) => ({
      categoryId,
      categoryName: c.name,
      minutes:      c.minutes,
      count:        c.count,
      ratio:        side.totalMinutes > 0 ? round1((c.minutes / side.totalMinutes) * 100) : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes)

  // ── 시험항목별 ─────────────────────────────────────────────────────────────
  const byTestItem: OperationReportItemRow[] = [...byTestItemMap.entries()]
    .map(([testItemName, v]) => ({
      testItemName,
      count:      v.count,
      minutes:    v.minutes,
      avgMinutes: v.count > 0 ? Math.round(v.minutes / v.count) : 0,
    }))
    .sort((a, b) => b.minutes - a.minutes)

  // ── 날짜별(추이) ───────────────────────────────────────────────────────────
  const daily: OperationReportDailyRow[] = expandRange(from, to).map(date => ({
    date,
    testMinutes: testMinutesByDate.get(date) ?? 0,
    sideMinutes: side.byDate.get(date) ?? 0,
  }))

  const totalTestMinutes = byTester.reduce((s, r) => s + r.testMinutes, 0)
  const totalItems       = byTester.reduce((s, r) => s + r.testItems, 0)
  const totalJobs        = byTester.reduce((s, r) => s + r.completedJobs, 0)
  const grandTotal       = totalTestMinutes + side.totalMinutes

  return {
    period: { from, to, workingDays },
    totals: {
      testers:       byTester.length,
      completedJobs: totalJobs,
      testItems:     totalItems,
      testMinutes:   totalTestMinutes,
      sideMinutes:   side.totalMinutes,
      sideCount:     side.totalCount,
      sideRatio:     grandTotal > 0 ? round1((side.totalMinutes / grandTotal) * 100) : null,
    },
    byTester,
    byCategory,
    byTestItem,
    daily,
  }
}
