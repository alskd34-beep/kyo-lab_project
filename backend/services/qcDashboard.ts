/**
 * [BACKEND] QC 관리자 대시보드 집계 (qc_dashboard)
 *
 * 기존 테이블만 읽어 JS에서 집계한다.
 *  - pct_orders      : 상태/배정/품목/긴급/동기화 카운트
 *  - product_workload: product_code → avg_workdays(공수 DAY, 절대값)
 *  - products        : product_code → difficulty(난이도) 매핑
 *  - reassignment_history : 재배정 총건수 + 시험자(after_user)별 집계
 *  - testers         : id → name
 *
 * "보유 DAY"는 현재 미완료(대기/진행중/검토전/검토중/승인전/지연) 배정 오더의 공수(DAY) 합이며,
 * 공수는 자동배정과 동일하게 product_workload.avg_workdays(DAY 단위, PRD 절대값)를 쓴다.
 * 공수 미등록 품목은 1일로 간주하는 근사치다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { selectAll } from '@backend/lib/supabasePage'
import { loadAssigneesByOrder } from '@backend/services/orderAssignees'
import {
  CLOSED_STAGE,
  DELAYED_STATUS,
  DELETED_STATUS,
  IN_PROGRESS_STATUS,
  OPEN_STATUSES as SHARED_OPEN_STATUSES,
  PENDING_STATUS,
} from '@shared/qc-status'

export interface QcDashboard {
  counts: {
    total: number
    inProgress: number
    completed: number
    delayed: number
    unassigned: number
  }
  psychotropic: number    // 향정신성(자이렌정/아디펙스정) 오더 수
  newProducts: number     // 신규 품목(product_synced=false 또는 ingest_state='new')
  reassignTotal: number   // 재배정 총건수
  byTesterDays: { testerId: string; name: string; days: number }[]
  byTesterDifficulty: { testerId: string; name: string; high: number; medium: number; low: number }[]
}

// 미완료(보유 중) 상태 — 보유 DAY / 난이도 분포 산정 대상
// 미완료(진행 중) 상태 집합 — 단계 정의는 @shared/qc-status 가 단일 기준
const OPEN_STATUSES = SHARED_OPEN_STATUSES
const PSYCHOTROPIC_NAMES = new Set(['자이렌정', '아디펙스정'])
// 공수(DAY) 미등록 품목 근사치
const DEFAULT_WORKDAYS = 1

export async function getQcDashboard(): Promise<QcDashboard> {
  // 1) 오더 (삭제 제외)
  const { data: orderData, error: orderErr } = await supabaseAdmin
    .from('pct_orders')
    .select('id, status, assignee_tester_id, product_code, product_name, is_urgent, product_synced, ingest_state')
    .neq('status', DELETED_STATUS)
  if (orderErr) throw orderErr
  const orders = (orderData ?? []) as Record<string, unknown>[]
  // 담당자 구성(0049) — 보유 DAY·난이도 분포를 담당자 N명에게 나눈다. 미적용이면 설치 안내 오류.
  const assigneeMap = await loadAssigneesByOrder()

  // 2) 매핑: product_workload(공수 DAY) + products(난이도)
  const codes = [...new Set(orders.map(o => o.product_code as string).filter(Boolean))]
  const workdaysByCode = new Map<string, number>()
  const difficultyByCode = new Map<string, string>()
  if (codes.length > 0) {
    const [wlRes, prodRes] = await Promise.all([
      supabaseAdmin.from('product_workload').select('product_code, avg_workdays').in('product_code', codes),
      supabaseAdmin.from('products').select('product_code, difficulty').in('product_code', codes),
    ])
    if (wlRes.error) throw wlRes.error
    if (prodRes.error) throw prodRes.error
    for (const w of wlRes.data ?? []) {
      const days = Number(w.avg_workdays)
      if (days > 0) workdaysByCode.set(w.product_code as string, days)
    }
    for (const p of prodRes.data ?? []) {
      const diff = (p.difficulty as string | null)?.toUpperCase()
      if (diff) difficultyByCode.set(p.product_code as string, diff)
    }
  }

  // 3) 시험자 이름
  const { data: testerData, error: testerErr } = await selectAll(supabaseAdmin, 'testers', 'id, name', { orderBy: 'id' })
  if (testerErr) throw testerErr
  const nameByTester = new Map<string, string>()
  for (const t of testerData ?? []) nameByTester.set(t.id as string, t.name as string)

  // 4) 재배정 이력 (after_user 별)
  // 누적 테이블 — 1000행 절단 시 재배정 건수가 조용히 틀려진다 → selectAll
  const { data: reassignData, error: reassignErr } =
    await selectAll(supabaseAdmin, 'reassignment_history', 'after_user', { orderBy: ['order_id', 'changed_at'] })
  if (reassignErr) throw new Error(reassignErr.message)
  const reassigns = (reassignData ?? []) as Record<string, unknown>[]

  // ─── 집계 ──────────────────────────────────────────────────────────────────
  const counts = { total: 0, inProgress: 0, completed: 0, delayed: 0, unassigned: 0 }
  let psychotropic = 0
  let newProducts = 0

  // 시험자별 누적
  const daysByTester = new Map<string, number>()
  const diffByTester = new Map<string, { high: number; medium: number; low: number }>()

  for (const o of orders) {
    const status = o.status as string
    // 미배정 판정은 대표 미러(assignee_tester_id = 슬롯 1)로 한다
    const assignee = (o.assignee_tester_id as string) ?? null
    const code = o.product_code as string
    const name = o.product_name as string

    counts.total += 1
    if (status === IN_PROGRESS_STATUS) counts.inProgress += 1
    if (status === CLOSED_STAGE) counts.completed += 1
    if (status === DELAYED_STATUS) counts.delayed += 1
    if (!assignee && status === PENDING_STATUS) counts.unassigned += 1

    if (PSYCHOTROPIC_NAMES.has(name)) psychotropic += 1
    if (o.product_synced === false || o.ingest_state === 'new') newProducts += 1

    // 미완료 배정 오더만 보유 DAY / 난이도 분포 산정
    //
    // [병렬 배정] 담당자 1~5 몫을 각자의 보유량으로 잡는다 — 대표만 보면
    // 병렬 담당자로 여러 건을 들고 있어도 화면에 0으로 보인다.
    // 공수(DAY)는 N명이 나눠 수행하므로 인원수로 균등 분할한다(품목 전체 공수를 모두에게 온전히
    // 더하면 조직 전체 보유량이 실제의 N배로 부풀어 오른다). 월간 달력은 각자 전체 기간 — 기준 차이는 열린 질문.
    // 난이도 분포는 "지금 손에 든 HIGH 품목이 몇 건인가" 라서 담당자마다 1건씩 센다.
    const holders = (assigneeMap.get(o.id as string) ?? []).map(a => a.testerId)
    if (holders.length > 0 && OPEN_STATUSES.has(status)) {
      const days = workdaysByCode.get(code) ?? DEFAULT_WORKDAYS // 공수 미등록 → 1일(근사치)
      const sharePerHolder = days / holders.length
      for (const holder of holders) {
        daysByTester.set(holder, (daysByTester.get(holder) ?? 0) + sharePerHolder)

        const bucket = diffByTester.get(holder) ?? { high: 0, medium: 0, low: 0 }
        const diff = difficultyByCode.get(code)
        if (diff === 'HIGH') bucket.high += 1
        else if (diff === 'MEDIUM') bucket.medium += 1
        else if (diff === 'LOW') bucket.low += 1
        diffByTester.set(holder, bucket)
      }
    }
  }

  // 재배정: 총건수 + (현재 보고서에서는 총합만 사용하나 후속 확장 위해 카운트 보존)
  const reassignTotal = reassigns.length

  const byTesterDays = [...daysByTester.entries()]
    .map(([testerId, days]) => ({
      testerId,
      name: nameByTester.get(testerId) ?? '(미상)',
      days: Math.round(days * 10) / 10,
    }))
    .sort((a, b) => b.days - a.days)

  const byTesterDifficulty = [...diffByTester.entries()]
    .map(([testerId, b]) => ({
      testerId,
      name: nameByTester.get(testerId) ?? '(미상)',
      high: b.high,
      medium: b.medium,
      low: b.low,
    }))
    .sort((a, b) => (b.high + b.medium + b.low) - (a.high + a.medium + a.low))

  return {
    counts,
    psychotropic,
    newProducts,
    reassignTotal,
    byTesterDays,
    byTesterDifficulty,
  }
}
