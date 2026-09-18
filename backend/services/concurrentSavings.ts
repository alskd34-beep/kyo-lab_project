/**
 * [BACKEND] 동시분석 절감 계산 — 단일 분석 대비 얼마나 줄었는가
 *
 * 답해야 하는 질문
 *   1. 따로 했으면 며칠이었는데 묶어서 며칠이 됐나        → 계획 절감(일)
 *   2. 실제로 돌려 보니 시간이 얼마나 줄었나              → 실적 절감(분)
 *
 * ── 왜 두 축인가
 * 계획(공수, DAY)과 실적(소요, 분)은 단위도 출처도 다르다. 계획은 품목별 표준 공수
 * (product_workload.avg_workdays), 실적은 시험자가 실제로 누른 시각(qc_job_items)이다.
 * 한 축으로 뭉치면 "계획이 좋았는지" 와 "실행이 좋았는지" 를 구분할 수 없다.
 *
 * ── 계획 절감
 *   따로 수행: 멤버 공수의 **합**   (배치마다 처음부터 끝까지 다시 한다)
 *   동시 수행: 멤버 공수의 **최댓값** (한 시퀀스에 얹으므로 가장 긴 것에 맞춰진다)
 *   절감 = 합 − 최댓값
 * 최댓값을 쓰는 이유: 3배치를 함께 돌려도 가장 오래 걸리는 배치가 끝나야 끝난다.
 * 평균이나 대표값을 쓰면 실제보다 절감이 커 보인다.
 *
 * ── 실적 절감 — 이 계산이 리포트의 과대계상도 함께 푼다
 *   단순 합 : Σ elapsed_minutes           (지금 리포트가 쓰는 값)
 *   실점유   : 구간 [시작,완료] 의 **합집합**
 *   절감 = 단순 합 − 실점유
 * 동시에 돌린 항목들은 같은 시계 시간을 공유한다. 그런데 항목마다 자기 구간을 재므로
 * 단순 합은 그 시간을 여러 번 센다(실측: 3배치 동시 시 3.00배). 합집합이 실제로 쓴
 * 시간이고, 그 차이가 곧 동시분석으로 번 시간이다.
 *
 * ⚠️ 절감은 **파생 계산**이다. 어디에도 저장하지 않는다 — 저장하면 원본이 바뀔 때마다
 *    같이 고쳐야 하고, 언젠가 둘이 갈라진다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { selectAll } from '@backend/lib/supabasePage'
import { loadAssigneesByOrder } from '@backend/services/orderAssignees'
import { DELETED_STATUS } from '@shared/qc-status'

const IN_CHUNK = 150

function chunks<T>(values: readonly T[]): T[][] {
  const out: T[][] = []
  for (let i = 0; i < values.length; i += IN_CHUNK) out.push(values.slice(i, i + IN_CHUNK) as T[])
  return out
}

export interface SavingMember {
  orderId: string
  productCode: string
  productName: string
  batchNo: string
  status: string
  /** 품목 표준 공수(일). 미등록이면 null — 계획 절감에서 제외된다 */
  workdays: number | null
  testerName: string | null
}

export interface GroupSaving {
  groupId: string
  groupKey: string
  label: string | null
  source: 'auto' | 'manual'
  members: SavingMember[]

  /** 계획 — 따로 했을 때 총 공수(일) */
  soloDays: number
  /** 계획 — 함께 했을 때 공수(일) = 가장 긴 멤버 */
  concurrentDays: number
  /** 계획 절감(일). 공수 미등록 멤버가 있으면 그만큼 과소평가된다 */
  savedDays: number
  /** 공수가 등록되지 않아 계획 계산에서 빠진 멤버 수 */
  workdaysMissing: number

  /** 실적 — 항목 소요의 단순 합(분). 지금 리포트가 쓰는 값 */
  sumMinutes: number
  /** 실적 — 구간 합집합(분). 실제로 쓴 시간 */
  spanMinutes: number
  /** 실적 절감(분) */
  savedMinutes: number
  /** 완료된 항목이 있어 실적을 말할 수 있는가 */
  hasActual: boolean

  /**
   * 이 절감이 **실제로 실현될 수 있는가**.
   *
   * 동시분석은 한 사람이 한 시퀀스에 얹을 때 이득이 난다. 담당자가 갈렸으면 각자 따로
   * 돌리므로 계획 절감은 장부상 숫자일 뿐이다. 공수가 크게 다른 품목이 섞인 그룹도
   * 마찬가지다 — 5일짜리와 14일짜리를 함께 돌린다는 전제 자체가 성립하지 않는다.
   *
   * 실현 불가를 절감에 섞어 보고하면 "동시분석으로 81일 줄였다" 가 사실이 아니게 된다.
   */
  realizable: boolean
  /** 실현 불가 사유. 실현 가능하면 빈 배열 */
  atRisk: string[]
}

/** 구간 합집합(분). 겹치는 시간을 한 번만 센다. */
export function unionMinutes(intervals: Array<{ start: number; end: number }>): number {
  if (intervals.length === 0) return 0
  const sorted = [...intervals].sort((a, b) => a.start - b.start)
  let total = 0
  let curStart = sorted[0].start
  let curEnd = sorted[0].end
  for (const iv of sorted.slice(1)) {
    if (iv.start <= curEnd) { curEnd = Math.max(curEnd, iv.end); continue }
    total += curEnd - curStart
    curStart = iv.start; curEnd = iv.end
  }
  total += curEnd - curStart
  return Math.round(total / 60000)
}

/**
 * 전체 동시분석 그룹의 절감. 기간을 주면 그 기간에 **완료된 항목**만 실적에 넣는다.
 * (완료 시각 기준 — 그 시간을 그 기간에 썼다는 뜻. operationReport 와 같은 기준이다)
 */
export async function listGroupSavings(opts: { from?: string; to?: string } = {}): Promise<GroupSaving[]> {
  const [groupsRes, itemsRes] = await Promise.all([
    selectAll(supabaseAdmin, 'concurrent_analysis_groups', '*', { orderBy: 'id' }),
    selectAll(supabaseAdmin, 'concurrent_analysis_group_items', 'group_id, order_id', { orderBy: ['group_id', 'order_id'] }),
  ])
  if (groupsRes.error) throw groupsRes.error
  if (itemsRes.error) throw itemsRes.error
  const groups = (groupsRes.data ?? []) as Record<string, unknown>[]
  if (groups.length === 0) return []

  const memberIds = (itemsRes.data ?? []).map(i => i.order_id as string)
  if (memberIds.length === 0) return []

  const [orderResults, wlRes, jobResults, testersRes] = await Promise.all([
    Promise.all(chunks(memberIds).map(ids => supabaseAdmin.from('pct_orders')
      .select('id, product_code, product_name, batch_no, status, assignee_tester_id')
      .in('id', ids)
      .range(0, 9999))),
    selectAll(supabaseAdmin, 'product_workload', 'product_code, avg_workdays', { orderBy: 'product_code' }),
    Promise.all(chunks(memberIds).map(ids => supabaseAdmin.from('qc_jobs').select('id, order_id').in('order_id', ids).range(0, 9999))),
    selectAll(supabaseAdmin, 'testers', 'id, name', { orderBy: 'id' }),
  ])
  const ordersError = orderResults.find(result => result.error)?.error
  const jobsError = jobResults.find(result => result.error)?.error
  if (ordersError) throw ordersError
  if (jobsError) throw jobsError
  const orderRows = orderResults.flatMap(result => result.data ?? [])
  const jobRows = jobResults.flatMap(result => result.data ?? [])

  const orderById = new Map(orderRows.map(o => [o.id as string, o]))
  // 담당 표시는 담당자 N명 모두(병렬 배정, 0049) — 미적용이면 대표 미러만
  const assigneeMap = await loadAssigneesByOrder(memberIds, {
    mirror: orderRows.map(o => ({ id: o.id as string, assignee_tester_id: (o.assignee_tester_id as string | null) ?? null })),
  })
  const nameOf = new Map((testersRes.data ?? []).map(t => [t.id as string, t.name as string]))
  const workdaysOf = new Map<string, number>()
  for (const w of (wlRes.data ?? []) as Record<string, unknown>[]) {
    const d = Number(w.avg_workdays) || 0
    if (d > 0) workdaysOf.set(String(w.product_code), d)
  }

  // 작업 → 오더, 그리고 완료된 항목의 구간
  const jobToOrder = new Map(jobRows.map(j => [j.id as string, j.order_id as string]))
  const jobIds = [...jobToOrder.keys()]
  const itemsByOrder = new Map<string, Array<{ start: number; end: number; minutes: number }>>()
  if (jobIds.length > 0) {
    const { data: qItems, error: qErr } = await supabaseAdmin
      .from('qc_job_items')
      .select('qc_job_id, started_at, cleared_at, elapsed_minutes, status')
      .in('qc_job_id', jobIds)
      .eq('status', 'cleared')
    if (qErr) throw qErr
    for (const it of qItems ?? []) {
      const cleared = it.cleared_at as string | null
      if (!cleared) continue
      if (opts.from && cleared.slice(0, 10) < opts.from) continue
      if (opts.to && cleared.slice(0, 10) > opts.to) continue
      const orderId = jobToOrder.get(it.qc_job_id as string)
      if (!orderId) continue
      const minutes = Number(it.elapsed_minutes ?? 0)
      const end = new Date(cleared).getTime()
      // started_at 이 없는 옛 항목은 완료 시각에서 소요만큼 거슬러 올라간 구간으로 본다
      // (0040 backfill 과 같은 규칙 — 여기서 다른 가정을 쓰면 값이 갈린다).
      const start = it.started_at ? new Date(it.started_at as string).getTime() : end - minutes * 60000
      const arr = itemsByOrder.get(orderId) ?? []
      arr.push({ start, end, minutes })
      itemsByOrder.set(orderId, arr)
    }
  }

  const membersByGroup = new Map<string, string[]>()
  for (const i of itemsRes.data ?? []) {
    const a = membersByGroup.get(i.group_id as string) ?? []
    a.push(i.order_id as string)
    membersByGroup.set(i.group_id as string, a)
  }

  const out: GroupSaving[] = []
  for (const g of groups) {
    const gid = g.id as string
    const ids = (membersByGroup.get(gid) ?? [])
      .map(id => orderById.get(id))
      .filter((o): o is NonNullable<typeof o> => !!o && o.status !== DELETED_STATUS)
    // 1건짜리는 동시분석이 아니다 — 절감을 말할 수 없다.
    if (ids.length < 2) continue

    const members: SavingMember[] = ids.map(o => ({
      orderId:     o.id as string,
      productCode: (o.product_code as string) ?? '',
      productName: (o.product_name as string) ?? '',
      batchNo:     (o.batch_no as string) ?? '',
      status:      o.status as string,
      workdays:    workdaysOf.get(String(o.product_code)) ?? null,
      testerName:  (assigneeMap.get(o.id as string) ?? []).map(a => nameOf.get(a.testerId)).filter(Boolean).join(', ') || null,
    }))

    const days = members.map(m => m.workdays).filter((d): d is number => d != null)
    const soloDays = days.reduce((s, d) => s + d, 0)
    const concurrentDays = days.length > 0 ? Math.max(...days) : 0

    const intervals = members.flatMap(m => itemsByOrder.get(m.orderId) ?? [])
    const sumMinutes = intervals.reduce((s, i) => s + i.minutes, 0)
    const spanMinutes = unionMinutes(intervals)

    // ── 실현 가능성 판정 ────────────────────────────────────────────────────
    const assignees = [...new Set(members.map(m => m.testerName).filter((n): n is string => !!n))]
    const unassigned = members.filter(m => !m.testerName).length
    const atRisk: string[] = []
    if (assignees.length > 1) {
      atRisk.push(`담당자가 ${assignees.length}명으로 갈림 (${assignees.join(', ')})`)
    }
    if (unassigned > 0 && assignees.length > 0) {
      atRisk.push(`미배정 ${unassigned}건이 섞임`)
    }
    if (assignees.length === 0) {
      atRisk.push('전원 미배정 — 아직 누가 할지 정해지지 않음')
    }
    // 공수가 2배 넘게 벌어지면 "함께 돌린다" 는 전제가 흔들린다. 짧은 쪽이 끝나도
    // 긴 쪽을 기다려야 하므로, 묶어서 얻는 것보다 잃는 것이 커질 수 있다.
    if (days.length >= 2) {
      const lo = Math.min(...days), hi = Math.max(...days)
      if (lo > 0 && hi / lo >= 2) atRisk.push(`공수가 ${lo}일~${hi}일로 크게 다름`)
    }

    out.push({
      groupId: gid,
      groupKey: g.group_key as string,
      label: (g.label as string) ?? null,
      source: ((g.source as string) ?? 'auto') as 'auto' | 'manual',
      members,
      soloDays: Math.round(soloDays * 10) / 10,
      concurrentDays: Math.round(concurrentDays * 10) / 10,
      savedDays: Math.round((soloDays - concurrentDays) * 10) / 10,
      workdaysMissing: members.length - days.length,
      sumMinutes,
      spanMinutes,
      savedMinutes: Math.max(0, sumMinutes - spanMinutes),
      hasActual: intervals.length > 0,
      realizable: atRisk.length === 0,
      atRisk,
    })
  }
  // 절감이 큰 순 — 리포트에서 먼저 보여야 할 것이 위로 온다
  out.sort((a, b) => (b.savedDays - a.savedDays) || (b.savedMinutes - a.savedMinutes))
  return out
}

export interface SavingsSummary {
  groups: number
  /** 실적을 말할 수 있는 그룹 수 */
  groupsWithActual: number
  /** 실현 가능한 그룹 수 (담당자 하나 · 공수가 비슷) */
  realizableGroups: number
  /**
   * 실현 가능한 그룹만의 계획 절감(일). 대표 지표는 이 값이다.
   * savedDays 는 전체 합이라 실현 불가까지 포함한다 — 둘을 함께 줘야 오해가 없다.
   */
  realizableSavedDays: number
  /** 실현되지 않는 계획 절감(일) — 장부에만 있는 숫자 */
  atRiskSavedDays: number
  soloDays: number
  concurrentDays: number
  savedDays: number
  /** 절감률(%) — 따로 했을 때 대비 */
  savedDaysRatio: number
  sumMinutes: number
  spanMinutes: number
  savedMinutes: number
  savedMinutesRatio: number
  /** 공수 미등록으로 계획 계산에서 빠진 멤버 수 — 값의 신뢰도를 함께 말한다 */
  workdaysMissing: number
}

export function summarizeSavings(rows: readonly GroupSaving[]): SavingsSummary {
  const solo = rows.reduce((s, r) => s + r.soloDays, 0)
  const conc = rows.reduce((s, r) => s + r.concurrentDays, 0)
  const sum = rows.reduce((s, r) => s + r.sumMinutes, 0)
  const span = rows.reduce((s, r) => s + r.spanMinutes, 0)
  const r1 = (n: number) => Math.round(n * 10) / 10
  const realizable = rows.filter(r => r.realizable)
  return {
    groups: rows.length,
    groupsWithActual: rows.filter(r => r.hasActual).length,
    realizableGroups: realizable.length,
    realizableSavedDays: r1(realizable.reduce((s2, r) => s2 + r.savedDays, 0)),
    atRiskSavedDays: r1(rows.filter(r => !r.realizable).reduce((s2, r) => s2 + r.savedDays, 0)),
    soloDays: r1(solo),
    concurrentDays: r1(conc),
    savedDays: r1(solo - conc),
    savedDaysRatio: solo > 0 ? r1(((solo - conc) / solo) * 100) : 0,
    sumMinutes: sum,
    spanMinutes: span,
    savedMinutes: Math.max(0, sum - span),
    savedMinutesRatio: sum > 0 ? r1(((sum - span) / sum) * 100) : 0,
    workdaysMissing: rows.reduce((s, r) => s + r.workdaysMissing, 0),
  }
}
