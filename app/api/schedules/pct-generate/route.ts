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

    const year = body.year ?? new Date().getFullYear()
    const result = generatePctSchedule({
      rows, testers, capabilities,
      matrix: matrix.map(m => ({ testerId: m.testerId, capabilityId: m.capabilityId, level: m.proficiencyLevel })),
      productItems, equipment, workload, year,
    })

    return Response.json(result)
  } catch (err) {
    console.error('[api/schedules/pct-generate]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
