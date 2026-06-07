/**
 * 모든 품목에 '전항목' 시험항목을 일괄 추가하는 일회성 스크립트.
 *
 * 실행: npx tsx --env-file=.env.local scripts/bulk_add_jeonhangmok.ts
 *
 * 처리 순서:
 *  1. '전항목' test_items 존재 확인 → 없으면 생성
 *  2. 모든 활성 품목 조회
 *  3. 각 품목에 (product_id, test_item_id) 매핑 upsert (이미 있으면 스킵)
 *  4. 결과 출력
 */

import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

const TARGET_NAME = '전항목'

async function main() {
  console.log('=== "전항목" 일괄 추가 시작 ===\n')

  // 1. test_items에서 '전항목' 찾기 (or 생성)
  const { data: existing, error: e1 } = await supabase
    .from('test_items').select('id, name').eq('name', TARGET_NAME).maybeSingle()
  if (e1) throw new Error(`test_items 조회 실패: ${e1.message}`)

  let testItemId: string
  if (existing?.id) {
    testItemId = existing.id as string
    console.log(`✓ 기존 '전항목' 시험항목 발견 (id=${testItemId})`)
  } else {
    const { data: inserted, error: e2 } = await supabase
      .from('test_items')
      .insert({ name: TARGET_NAME, category: '기타', is_active: true, requires_duo: false })
      .select('id').single()
    if (e2 || !inserted) throw new Error(`test_items 생성 실패: ${e2?.message}`)
    testItemId = inserted.id as string
    console.log(`✓ '전항목' 시험항목 신규 생성 (id=${testItemId})`)
  }
  console.log()

  // 2. 모든 활성 품목 조회
  const { data: products, error: e3 } = await supabase
    .from('products')
    .select('id, product_code, name')
    .eq('is_active', true)
  if (e3) throw new Error(`products 조회 실패: ${e3.message}`)
  if (!products || products.length === 0) {
    console.log('활성 품목이 없습니다.')
    return
  }
  console.log(`✓ 활성 품목 ${products.length}개 조회 완료\n`)

  // 3. 이미 '전항목'이 매핑된 품목 조회 (스킵용)
  const { data: existingLinks, error: e4 } = await supabase
    .from('product_test_items')
    .select('product_id')
    .eq('test_item_id', testItemId)
  if (e4) throw new Error(`기존 매핑 조회 실패: ${e4.message}`)
  const alreadyHave = new Set((existingLinks ?? []).map(l => l.product_id as string))
  console.log(`✓ 이미 '전항목' 매핑된 품목: ${alreadyHave.size}개 (스킵)\n`)

  // 4. 각 품목에 대해 매핑 추가 (기존 sequence_order의 max+1 위치에 추가)
  const targets = products.filter(p => !alreadyHave.has(p.id as string))
  console.log(`✓ 추가 대상 품목: ${targets.length}개\n`)

  // 품목별 현재 max(sequence_order) 조회 (한 번에)
  const { data: allLinks, error: e5 } = await supabase
    .from('product_test_items')
    .select('product_id, sequence_order')
  if (e5) throw new Error(`전체 매핑 조회 실패: ${e5.message}`)
  const maxOrderByProduct = new Map<string, number>()
  for (const l of allLinks ?? []) {
    const pid = l.product_id as string
    const so  = (l.sequence_order as number) ?? -1
    const cur = maxOrderByProduct.get(pid) ?? -1
    if (so > cur) maxOrderByProduct.set(pid, so)
  }

  // 5. 일괄 insert (50개 단위 batch)
  const rows = targets.map(p => ({
    product_id: p.id as string,
    test_item_id: testItemId,
    sequence_order: (maxOrderByProduct.get(p.id as string) ?? -1) + 1,
    is_mandatory: false,
  }))

  const BATCH = 50
  let inserted = 0
  let failed = 0
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH)
    const { error } = await supabase.from('product_test_items').insert(chunk)
    if (error) {
      failed += chunk.length
      console.error(`  ✗ 배치 ${i / BATCH + 1} 실패: ${error.message}`)
    } else {
      inserted += chunk.length
      if (inserted % 100 === 0 || i + BATCH >= rows.length) {
        console.log(`  ${inserted}/${rows.length} 추가 완료`)
      }
    }
  }

  console.log()
  console.log('=== 결과 ===')
  console.log(`  전체 활성 품목 : ${products.length}개`)
  console.log(`  기존 매핑      : ${alreadyHave.size}개 (스킵)`)
  console.log(`  신규 추가      : ${inserted}개`)
  console.log(`  실패           : ${failed}개`)
  console.log(`  최종 매핑      : ${alreadyHave.size + inserted}개`)
  console.log()
  console.log('✓ 완료')
}

main().catch(e => { console.error(e); process.exit(1) })
