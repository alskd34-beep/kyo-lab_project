/**
 * PQM 시드 데이터 실행 스크립트 (supabase-js 서비스 롤)
 * 전제조건: 0004_pqm_schema.sql 이 Supabase SQL 에디터에서 이미 실행되어 있어야 함
 *
 * 실행: npx tsx scripts/seed_pqm.ts
 */

import { createClient } from '@supabase/supabase-js'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
)

// ─── 시드 데이터 ──────────────────────────────────────────────────────────────

const CATEGORIES = ['외주','고형제','전제','환제','주사제','액제','의약외품'].map(c => ({ code: c, name: c }))
const CLASSIFICATIONS = ['일반의약품','전문의약품','의약외품','향정신성의약품','기타'].map(c => ({ code: c, name: c }))
const DOSAGE_FORMS = ['현탁제','내용고형제','전제','환제','액제','주사제'].map(c => ({ code: c, name: c }))

const CAPABILITIES = [
  { code: 'APPEARANCE',    name: '성상',         sort_order: 1 },
  { code: 'PACKAGE_CHECK', name: '포장확인',      sort_order: 2 },
  { code: 'HPLC',          name: 'HPLC',          sort_order: 3 },
  { code: 'GC',            name: 'GC',            sort_order: 4 },
  { code: 'GCMS',          name: 'GCMS',          sort_order: 5 },
  { code: 'LCMS_TQ',       name: 'LCMS_TQ',       sort_order: 6 },
  { code: 'UHPLC',         name: 'UHPLC',         sort_order: 7 },
  { code: 'SHIMADZU_HPLC', name: 'Shimadzu HPLC', sort_order: 8 },
  { code: 'GCMS_TQ',       name: 'GCMS_TQ',       sort_order: 9 },
  { code: 'FTIR',          name: 'FTIR',          sort_order: 10 },
  { code: 'UV_VIS',        name: 'UV-Vis',        sort_order: 11 },
  { code: 'TOC',           name: 'TOC',           sort_order: 12 },
  { code: 'DISSOLUTION',   name: '용출',          sort_order: 13 },
  { code: 'POTENTIOMETER', name: '전위차적정기',   sort_order: 14 },
  { code: 'MOISTURE',      name: '수분',          sort_order: 15 },
  { code: 'CONDUCTIVITY',  name: '전도도측정기',   sort_order: 16 },
  { code: 'TLC',           name: 'TLC',           sort_order: 17 },
  { code: 'PH',            name: 'pH',            sort_order: 18 },
  { code: 'FLUORESCENCE',  name: '형광분광도계',   sort_order: 19 },
  { code: 'PHYSICOCHEM',   name: '이화학',        sort_order: 20 },
]

const TESTERS = [
  { employee_no: '16242', name: '김태훈', can_solo: true,  can_duo: false },
  { employee_no: '17013', name: '박성호', can_solo: false, can_duo: true  },
  { employee_no: '21083', name: '권택균', can_solo: true,  can_duo: false },
  { employee_no: '16167', name: '장재훈', can_solo: true,  can_duo: true  },
  { employee_no: '16185', name: '지건희', can_solo: true,  can_duo: false },
  { employee_no: '16218', name: '김기호', can_solo: true,  can_duo: false },
  { employee_no: '20028', name: '이영남', can_solo: true,  can_duo: false },
  { employee_no: '20052', name: '안성은', can_solo: true,  can_duo: false },
  { employee_no: '20106', name: '임수민', can_solo: false, can_duo: false },
  { employee_no: '21084', name: '김태환', can_solo: true,  can_duo: false },
  { employee_no: '23018', name: '박윤진', can_solo: true,  can_duo: false },
  { employee_no: '26046', name: '정예찬', can_solo: true,  can_duo: false },
  { employee_no: '23040', name: '이원재', can_solo: true,  can_duo: false },
  { employee_no: '26055', name: '김정호', can_solo: false, can_duo: true  },
  { employee_no: '24084', name: '강지윤', can_solo: false, can_duo: true  },
]

// Excel 04_시험자 시트 Y/N/X/O 역량 매트릭스 (순서: CAPABILITIES 순)
const TESTER_MATRIX: Record<string, string[]> = {
  '16242': ['Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y'],
  '17013': ['Y','Y','Y','Y','N','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y'],
  '21083': ['Y','Y','Y','Y','Y','N','N','N','N','N','N','N','N','N','Y','N','N','N','N','Y'],
  '16167': ['Y','Y','Y','Y','Y','N','N','N','N','Y','Y','Y','N','N','Y','Y','Y','Y','Y','Y'],
  '16185': ['Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','N','Y','Y','Y','Y','Y','Y','Y'],
  '16218': ['Y','Y','Y','Y','N','Y','Y','Y','Y','Y','Y','Y','N','Y','Y','Y','Y','Y','Y','Y'],
  '20028': ['Y','Y','Y','Y','N','Y','X','Y','Y','Y','Y','Y','N','Y','Y','Y','Y','Y','Y','Y'],
  '20052': ['Y','Y','Y','Y','Y','N','Y','Y','N','N','N','N','Y','Y','Y','N','Y','Y','Y','Y'],
  '20106': ['Y','Y','Y','N','Y','N','Y','Y','Y','Y','Y','Y','Y','Y','N','X','Y','Y','Y','Y'],
  '21084': ['Y','Y','Y','Y','Y','N','N','Y','Y','X','Y','N','N','N','N','N','Y','Y','Y','Y'],
  '23018': ['Y','Y','Y','Y','Y','N','X','X','X','Y','Y','Y','O','O','O','O','N','Y','Y','Y'],
  '26046': ['Y','Y','Y','Y','Y','N','N','N','N','Y','Y','Y','O','O','O','O','N','Y','Y','Y'],
  '23040': ['Y','Y','Y','N','Y','N','Y','Y','Y','Y','Y','Y','Y','Y','Y','Y','N','Y','Y','Y'],
  '26055': ['Y','Y','Y','N','N','N','X','Y','X','X','Y','X','N','N','N','N','X','X','N','Y'],
  '24084': ['Y','Y','Y','N','N','N','X','Y','X','X','Y','X','Y','Y','X','X','X','X','N','Y'],
}

// ─── 유틸 ──────────────────────────────────────────────────────────────────────
async function upsert(table: string, data: object[], conflictCol: string) {
  if (data.length === 0) return
  const CHUNK = 200
  let inserted = 0
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK)
    const { error } = await supabase.from(table).upsert(chunk, { onConflict: conflictCol, ignoreDuplicates: true })
    if (error) console.error(`  ✗ ${table} 오류: ${error.message}`)
    else inserted += chunk.length
  }
  console.log(`  ✓ ${table}: ${inserted}행 삽입`)
}

// ─── 메인 ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== PQM 시드 데이터 삽입 ===\n')

  // 1. 마스터 테이블
  console.log('[1/7] 마스터 테이블')
  await upsert('product_categories',    CATEGORIES,      'code')
  await upsert('product_classifications', CLASSIFICATIONS, 'code')
  await upsert('dosage_forms',          DOSAGE_FORMS,    'code')
  await upsert('test_capabilities',     CAPABILITIES,    'code')

  // 2. 시험자
  console.log('\n[2/7] 시험자')
  await upsert('testers', TESTERS.map(t => ({ ...t, is_active: true })), 'employee_no')

  // 3. 시험자 역량 매트릭스
  console.log('\n[3/7] 시험자 역량 매트릭스')
  const { data: tRows } = await supabase.from('testers').select('id, employee_no')
  const { data: cRows } = await supabase.from('test_capabilities').select('id, code').order('sort_order')
  if (!tRows || !cRows) { console.error('시험자/역량 데이터 조회 실패'); return }

  const capabilityRows: object[] = []
  for (const tester of tRows) {
    const levels = TESTER_MATRIX[tester.employee_no] ?? []
    cRows.forEach((cap, idx) => {
      capabilityRows.push({
        tester_id: tester.id,
        capability_id: cap.id,
        proficiency_level: levels[idx] ?? 'N',
      })
    })
  }
  await upsert('tester_capability_matrix', capabilityRows, 'tester_id,capability_id')

  // 4. 시험항목 (고유 목록)
  console.log('\n[4/7] 시험항목')
  const TEST_ITEM_NAMES = [
    '성상,포장확인','용출','확인(정성)','에탄올','함량','확인,함량균일성',
    'GCMS함량','GCMS확인','이화학','HPLC함량','HPLC확인','붕해','pH',
    '미생물','TLC','수분','GC함량','GC확인','FTIR확인','UV함량','UV확인',
    'LCMS함량','LCMS확인','TOC','전도도','점도','비중','입도','용해도',
    '중금속','잔류용매','내용량','정량','확인,용출','함량균일성','붕해시험',
    '무균시험','발열성물질','불용성미립자','침강용량비','pH,점도','함량,이화학',
    'GCMS함량,확인','성상,pH','성상,이화학','포장확인,이화학','성상,함량',
    '성상,용출','함량,용출','확인,함량','성상,GCMS','HPLC확인,함량',
  ]
  await upsert('test_items', TEST_ITEM_NAMES.map(name => ({ name, is_active: true, requires_duo: false })), 'name')

  // 5. 품목마스터 (시드 데이터 일부 - 시험항목 있는 품목 우선)
  console.log('\n[5/7] 품목마스터 (핵심 품목)')
  const { data: catRows } = await supabase.from('product_categories').select('id, code')
  const { data: clsRows } = await supabase.from('product_classifications').select('id, code')
  const catMap = Object.fromEntries((catRows ?? []).map(r => [r.code, r.id]))
  const clsMap = Object.fromEntries((clsRows ?? []).map(r => [r.code, r.id]))

  const CORE_PRODUCTS = [
    { product_code: '21081', name: '(사향)광동우황청심원현탁액(신)',      product_type: '포장제품', difficulty: 'High',   cat: '전제',   cls: '일반의약품', package_spec: '50ML'  },
    { product_code: '21350', name: '슬라임캡슐',                          product_type: '포장제품', difficulty: 'Low',    cat: '고형제', cls: '의약외품',   package_spec: '120C'  },
    { product_code: '21391', name: '알도셉트정5mg',                       product_type: '포장제품', difficulty: 'Medium', cat: '고형제', cls: '전문의약품', package_spec: '30T'   },
    { product_code: '23263', name: '베니톨정',                            product_type: '포장제품', difficulty: 'Medium', cat: '고형제', cls: '일반의약품', package_spec: '500T'  },
    { product_code: '23262', name: '베니톨정',                            product_type: '포장제품', difficulty: 'Medium', cat: '고형제', cls: '일반의약품', package_spec: '90T'   },
    { product_code: '21125', name: '(수출용)광동원방우황청심원(영묘향)',   product_type: '포장제품', difficulty: 'High',   cat: '환제',   cls: '일반의약품', package_spec: '1환(丸)'},
    { product_code: '27045', name: '(베트남수출용)광동우황청심원(영묘향)', product_type: '포장제품', difficulty: 'High',   cat: '환제',   cls: '일반의약품', package_spec: '1환(丸)'},
    { product_code: '21080', name: '(사향)광동우황청심원(신)',             product_type: '포장제품', difficulty: 'High',   cat: '환제',   cls: '일반의약품', package_spec: '1환(丸)'},
    { product_code: '29971', name: '(몽골수출용)변방우황청심원(영묘향)',   product_type: '포장제품', difficulty: 'High',   cat: '환제',   cls: '일반의약품', package_spec: '10환(丸)'},
    { product_code: '29962', name: '(미국수출용)광동경옥고300g',          product_type: '포장제품', difficulty: 'Medium', cat: '전제',   cls: '일반의약품', package_spec: '300G'  },
  ]
  const productRows = CORE_PRODUCTS.map((p, i) => ({
    product_code: p.product_code,
    name: p.name,
    product_type: p.product_type,
    difficulty: p.difficulty,
    category_id: catMap[p.cat] ?? null,
    classification_id: clsMap[p.cls] ?? null,
    package_spec: p.package_spec,
    sort_order: i + 1,
    is_active: true,
  }))
  await upsert('products', productRows, 'product_code')

  // 6. product_test_items 매핑
  console.log('\n[6/7] 품목-시험항목 매핑')
  const { data: pRows } = await supabase.from('products').select('id, name')
  const { data: tiRows } = await supabase.from('test_items').select('id, name')
  const pMap  = Object.fromEntries((pRows  ?? []).map(r => [r.name, r.id]))
  const tiMap = Object.fromEntries((tiRows ?? []).map(r => [r.name, r.id]))

  const PRODUCT_TEST_MAPPING: Record<string, string[]> = {
    '(사향)광동우황청심원현탁액(신)': ['성상,포장확인','GCMS함량','GCMS확인','확인(정성)','함량','pH','이화학'],
    '슬라임캡슐':                    ['성상,포장확인','용출','붕해','함량','이화학'],
    '알도셉트정5mg':                  ['성상,포장확인','HPLC함량','용출','붕해','이화학'],
    '베니톨정':                       ['성상,포장확인','HPLC함량','HPLC확인','용출','이화학'],
    '(사향)광동우황청심원(신)':        ['성상,포장확인','GCMS함량','GCMS확인','확인(정성)','함량','pH','이화학'],
    '(수출용)광동원방우황청심원(영묘향)':['성상,포장확인','GCMS함량','GCMS확인','이화학'],
    '(베트남수출용)광동우황청심원(영묘향)':['성상,포장확인','GCMS함량','GCMS확인','이화학'],
  }

  const mappingRows: object[] = []
  for (const [prodName, items] of Object.entries(PRODUCT_TEST_MAPPING)) {
    const prodId = pMap[prodName]
    if (!prodId) continue
    items.forEach((itemName, idx) => {
      const tiId = tiMap[itemName]
      if (!tiId) return
      mappingRows.push({ product_id: prodId, test_item_id: tiId, is_mandatory: true, sequence_order: idx + 1 })
    })
  }
  await upsert('product_test_items', mappingRows, 'product_id,test_item_id')

  // 7. 생산배치
  console.log('\n[7/7] 생산배치')
  const { data: pAllRows } = await supabase.from('products').select('id, product_code')
  const { data: dfRows }   = await supabase.from('dosage_forms').select('id, code')
  const pCodeMap = Object.fromEntries((pAllRows ?? []).map(r => [r.product_code, r.id]))
  const dfMap    = Object.fromEntries((dfRows   ?? []).map(r => [r.code, r.id]))

  const BATCHES = [
    { code: '21081', spec: '50ML',  batch_no: '26002', dosage: '현탁제',   pkg: '2026-04-10', rec: '2026-04-24', qc: '2026-04-24', status: 'COMPLETED' },
    { code: '21350', spec: '120C',  batch_no: '26001', dosage: '내용고형제', pkg: '2026-03-30', rec: '2026-04-27', qc: '2026-04-27', status: 'COMPLETED' },
    { code: '21391', spec: '30T',   batch_no: '26001-A', dosage: '내용고형제', pkg: '2026-04-06', rec: '2026-04-30', qc: '2026-04-30', status: 'COMPLETED' },
    { code: '23263', spec: '500T',  batch_no: '26023', dosage: '내용고형제', pkg: '2026-04-16', rec: '2026-04-30', qc: '2026-04-30', status: 'IN_PROGRESS' },
    { code: '23263', spec: '500T',  batch_no: '26024', dosage: '내용고형제', pkg: '2026-04-16', rec: '2026-04-30', qc: '2026-04-30', status: 'IN_PROGRESS' },
    { code: '23263', spec: '500T',  batch_no: '26025', dosage: '내용고형제', pkg: '2026-04-17', rec: '2026-04-30', qc: '2026-04-30', status: 'IN_PROGRESS' },
    { code: '23263', spec: '500T',  batch_no: '26026', dosage: '내용고형제', pkg: '2026-04-17', rec: '2026-04-30', qc: '2026-04-30', status: 'PLANNED'     },
    { code: '23262', spec: '90T',   batch_no: '26027', dosage: '내용고형제', pkg: '2026-04-21', rec: '2026-04-30', qc: '2026-04-30', status: 'PLANNED'     },
    { code: '23262', spec: '90T',   batch_no: '26028', dosage: '내용고형제', pkg: '2026-04-21', rec: '2026-04-30', qc: '2026-04-30', status: 'PLANNED'     },
    { code: '23262', spec: '90T',   batch_no: '26029', dosage: '내용고형제', pkg: '2026-04-21', rec: '2026-05-06', qc: '2026-05-06', status: 'PLANNED'     },
    { code: '21080', spec: '1환',   batch_no: '26010', dosage: '환제',      pkg: '2026-04-25', rec: '2026-05-07', qc: '2026-05-07', status: 'PLANNED'     },
    { code: '27045', spec: '1환',   batch_no: '26011', dosage: '환제',      pkg: '2026-04-28', rec: '2026-05-10', qc: '2026-05-10', status: 'PLANNED'     },
    { code: '29962', spec: '300G',  batch_no: '26015', dosage: '전제',      pkg: '2026-04-20', rec: '2026-05-12', qc: '2026-05-12', status: 'IN_PROGRESS' },
  ]

  const batchRows = BATCHES
    .filter(b => pCodeMap[b.code])
    .map(b => ({
      product_id: pCodeMap[b.code],
      spec: b.spec,
      batch_no: b.batch_no,
      dosage_form_id: dfMap[b.dosage] ?? null,
      packaging_planned_date: b.pkg,
      record_review_deadline: b.rec,
      qc_planned_completion_date: b.qc,
      status: b.status,
    }))
  await upsert('production_batches', batchRows, 'batch_no')

  console.log('\n=== 시드 완료 ===')
}

main().catch(e => { console.error(e); process.exit(1) })
