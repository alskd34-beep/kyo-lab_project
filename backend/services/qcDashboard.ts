/**
 * [BACKEND] QC 관리자 대시보드 집계 (qc_dashboard)
 *
 * 기존 테이블만 읽어 JS에서 집계한다.
 *  - pct_orders      : 상태/배정/품목/긴급/동기화 카운트
 *  - products        : product_code → avg_hours(공수) / difficulty(난이도) 매핑
 *  - reassignment_history : 재배정 총건수 + 시험자(after_user)별 집계
 *  - testers         : id → name
 *
 * "보유 DAY"는 현재 미완료(대기/진행중/검토중/지연) 배정 오더의 공수 합이며,
 * 공수는 products.avg_hours(시간)을 8시간=1일로 환산한다.
 * avg_hours 미등록 품목은 1일로 간주하는 근사치다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'

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
const OPEN_STATUSES = new Set(['대기', '진행중', '검토중', '지연'])
const PSYCHOTROPIC_NAMES = new Set(['자이렌정', '아디펙스정'])
const HOURS_PER_DAY = 8

export async function getQcDashboard(): Promise<QcDashboard> {
  // 1) 오더 (삭제 제외)
  const { data: orderData, error: orderErr } = await supabaseAdmin
    .from('pct_orders')
    .select('id, status, assignee_tester_id, product_code, product_name, is_urgent, product_synced, ingest_state')
    .neq('status', '삭제')
  if (orderErr) throw orderErr
  const orders = (orderData ?? []) as Record<string, unknown>[]

  // 2) products 매핑 (product_code → avg_hours / difficulty)
  const codes = [...new Set(orders.map(o => o.product_code as string).filter(Boolean))]
  const avgHoursByCode = new Map<string, number>()
  const difficultyByCode = new Map<string, string>()
  if (codes.length > 0) {
    const { data: prods, error: prodErr } = await supabaseAdmin
      .from('products')
      .select('product_code, avg_hours, difficulty')
      .in('product_code', codes)
    if (prodErr) throw prodErr
    for (const p of prods ?? []) {
      const code = p.product_code as string
      const avg = Number(p.avg_hours)
      if (avg > 0) avgHoursByCode.set(code, avg)
      const diff = (p.difficulty as string | null)?.toUpperCase()
      if (diff) difficultyByCode.set(code, diff)
    }
  }

  // 3) 시험자 이름
  const { data: testerData, error: testerErr } = await supabaseAdmin
    .from('testers')
    .select('id, name')
  if (testerErr) throw testerErr
  const nameByTester = new Map<string, string>()
  for (const t of testerData ?? []) nameByTester.set(t.id as string, t.name as string)

  // 4) 재배정 이력 (after_user 별)
  const { data: reassignData, error: reassignErr } = await supabaseAdmin
    .from('reassignment_history')
    .select('after_user')
  if (reassignErr) throw reassignErr
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
    const assignee = (o.assignee_tester_id as string) ?? null
    const code = o.product_code as string
    const name = o.product_name as string

    counts.total += 1
    if (status === '진행중') counts.inProgress += 1
    if (status === '완료') counts.completed += 1
    if (status === '지연') counts.delayed += 1
    if (!assignee && status === '대기') counts.unassigned += 1

    if (PSYCHOTROPIC_NAMES.has(name)) psychotropic += 1
    if (o.product_synced === false || o.ingest_state === 'new') newProducts += 1

    // 미완료 배정 오더만 보유 DAY / 난이도 분포 산정
    if (assignee && OPEN_STATUSES.has(status)) {
      const hours = avgHoursByCode.get(code) ?? HOURS_PER_DAY // 미등록 → 1일(근사치)
      daysByTester.set(assignee, (daysByTester.get(assignee) ?? 0) + hours / HOURS_PER_DAY)

      const bucket = diffByTester.get(assignee) ?? { high: 0, medium: 0, low: 0 }
      const diff = difficultyByCode.get(code)
      if (diff === 'HIGH') bucket.high += 1
      else if (diff === 'MEDIUM') bucket.medium += 1
      else if (diff === 'LOW') bucket.low += 1
      diffByTester.set(assignee, bucket)
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
