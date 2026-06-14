/**
 * [BACKEND] PCT → 시험 스케줄 생성 (규칙 기반)
 *
 * 클라이언트가 보낸 PCT 행 + DB 마스터데이터(시험자/역량/품목별 시험항목/장비/공수)를
 * 규칙 엔진(@backend/services/scheduleEngine)에 넘겨 배정 결과를 반환한다.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'
import { supabase } from '@backend/lib/supabase'
import { listTesters, listCapabilities, listCapabilityMatrix } from '@backend/services/testers'
import {
  generatePctSchedule,
  type EnginePctRow,
  type EngineProductItems,
  type EngineEquip,
  type EngineWorkload,
} from '@backend/services/scheduleEngine'
import { buildGroupsFromOrders, type OrderForGrouping } from '@backend/services/concurrentGroups'

export const runtime = 'nodejs'

interface ClientRow {
  품목코드?: string
  품목명?: string
  제조번호?: string
  포장일?: string
  긴급?: string        // '일반' | '긴급'
  진행방법?: string    // '전항목' | '개별항목'
  담당자?: string
}

export async function POST(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  try {
    const body = await req.json() as { rows?: ClientRow[]; year?: number }
    const clientRows = body.rows ?? []
    if (clientRows.length === 0) {
      return Response.json({ error: '배정할 행이 없습니다.' }, { status: 400 })
    }

    // ── 마스터 데이터 병렬 조회 ──────────────────────────────────────────────
    const [
      testers, capabilities, matrix,
      productsRes, ptiRes, testItemsRes, equipRes, workloadRes,
    ] = await Promise.all([
      listTesters(),
      listCapabilities(),
      listCapabilityMatrix(),
      supabase.from('products').select('id, product_code'),
      supabase.from('product_test_items').select('product_id, test_item_id'),
      supabase.from('test_items').select('id, name, requires_duo'),
      supabase.from('test_item_equipment').select('test_item, required_equipment, is_universal'),
      supabase.from('product_workload').select('product_code, avg_workdays'),
    ])

    const firstErr = [productsRes, ptiRes, testItemsRes, equipRes, workloadRes].find(r => r.error)
    if (firstErr?.error) throw new Error(`마스터 조회 실패: ${firstErr.error.message}`)

    // 품목코드 → 시험항목명 목록
    const codeById = new Map<string, string>()
    for (const p of productsRes.data ?? []) codeById.set(p.id as string, String(p.product_code))
    const itemNameById = new Map<string, string>()
    const requiresDuoByName = new Map<string, boolean>()
    for (const t of testItemsRes.data ?? []) {
      itemNameById.set(t.id as string, t.name as string)
      requiresDuoByName.set(t.name as string, !!t.requires_duo)
    }
    const itemsByCode = new Map<string, string[]>()
    for (const link of ptiRes.data ?? []) {
      const code = codeById.get(link.product_id as string)
      const name = itemNameById.get(link.test_item_id as string)
      if (!code || !name) continue
      const arr = itemsByCode.get(code) ?? []
      arr.push(name)
      itemsByCode.set(code, arr)
    }
    const productItems: EngineProductItems[] = [...itemsByCode].map(([productCode, testItems]) => ({ productCode, testItems }))

    const equipment: EngineEquip[] = (equipRes.data ?? []).map(e => ({
      testItem: e.test_item as string,
      requiredEquipment: (e.required_equipment as string) ?? '',
      isUniversal: !!e.is_universal,
      requiresDuo: requiresDuoByName.get(e.test_item as string) ?? false,
    }))

    const workload: EngineWorkload[] = (workloadRes.data ?? []).map(w => ({
      productCode: String(w.product_code),
      avgWorkdays: Number(w.avg_workdays) || 0,
    }))

    // ── 클라이언트 행 → 엔진 입력 ────────────────────────────────────────────
    const rows: EnginePctRow[] = clientRows.map(r => ({
      품목코드: (r.품목코드 ?? '').trim(),
      품목명:   r.품목명 ?? '',
      제조번호: r.제조번호 ?? '',
      포장일:   r.포장일 ?? '',
      긴급:     r.긴급 === '긴급',
      진행방법: r.진행방법 === '개별항목' ? '개별항목' : '전항목',
      담당자:   r.담당자 || undefined,
    }))

    // ── 동시분석 그룹 인지: 그룹 대표만 엔진에 투입, 결과를 멤버에게 전파 ────────
    // 행 인덱스를 id로 사용해 순수 그룹핑 (DB 오더 불필요)
    const forGrouping: OrderForGrouping[] = rows.map((r, i) => ({
      id: String(i),
      productCode: r.품목코드,
      productName: r.품목명,
      batchNo:     r.제조번호,
      packagingDate: r.포장일 || null,
      dueDate:     null,  // 클라이언트 페이로드 미포함 — 조건4(동코드)로 커버
    }))

    const builtGroups = buildGroupsFromOrders(forGrouping)

    // 그룹별 최소 인덱스를 대표로 선정
    const repIdxSet = new Set<number>()
    const memberToRepIdx = new Map<number, number>()

    for (const group of builtGroups) {
      const indices = group.items.map(item => Number(item.orderId))
      const repIdx = Math.min(...indices)
      repIdxSet.add(repIdx)
      for (const idx of indices) {
        if (idx !== repIdx) memberToRepIdx.set(idx, repIdx)
      }
    }

    // 대표 행만 엔진에 전달 (그룹당 공수 1회, PRD 원칙4)
    const repRows = rows.filter((_, i) => repIdxSet.has(i))
    const year = body.year ?? new Date().getFullYear()

    const result = generatePctSchedule({
      rows: repRows, testers, capabilities,
      matrix: matrix.map(m => ({ testerId: m.testerId, capabilityId: m.capabilityId, level: m.proficiencyLevel })),
      productItems, equipment, workload, year,
    })

    // 대표 배정 결과를 키(코드|제조번호)로 인덱싱
    const repAssignsByKey = new Map<string, typeof result.assignments>()
    for (const a of result.assignments) {
      const k = `${a.productCode}|${a.batchNo}`
      const arr = repAssignsByKey.get(k) ?? []
      arr.push(a)
      repAssignsByKey.set(k, arr)
    }

    // 비대표 멤버에게 대표의 배정 전파 (or 대표 미배정 시 멤버도 미배정 추가)
    const extraAssignments: typeof result.assignments = []
    const extraUnassigned: typeof result.unassigned = []

    for (const [memberIdx, repIdx] of memberToRepIdx) {
      const mRow = rows[memberIdx]
      const rRow = rows[repIdx]
      const repAssigns = repAssignsByKey.get(`${rRow.품목코드}|${rRow.제조번호}`)

      if (repAssigns && repAssigns.length > 0) {
        // H1 fix: 멤버 자신의 시험항목 조회 (대표 testItems 오염 방지)
        const memberTestItems = itemsByCode.get(mRow.품목코드) ?? repAssigns[0]?.testItems ?? []
        for (const ra of repAssigns) {
          // H2 fix: 개별항목 복수 전파 시 key 충돌 방지 — 시험항목명 포함
          const itemSuffix = ra.testItems.join('+') || 'all'
          extraAssignments.push({
            ...ra,
            key:         `${mRow.품목코드}|${mRow.제조번호}|${ra.testerName}|${itemSuffix}|concurrent`,
            productCode: mRow.품목코드,
            productName: mRow.품목명,
            batchNo:     mRow.제조번호,
            testItems:   memberTestItems,
          })
        }
      } else {
        extraUnassigned.push({
          productCode: mRow.품목코드,
          productName: mRow.품목명,
          batchNo:     mRow.제조번호,
          testItems:   itemsByCode.get(mRow.품목코드) ?? [],
          reason:      '동시분석 그룹 대표 미배정',
        })
      }
    }

    const finalAssignments = [...result.assignments, ...extraAssignments]
    const finalUnassigned  = [...result.unassigned,  ...extraUnassigned]

    return Response.json({
      ...result,
      assignments: finalAssignments,
      unassigned:  finalUnassigned,
      stats: { ...result.stats, assigned: finalAssignments.length },
    })
  } catch (err) {
    console.error('[api/schedules/pct-generate]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
