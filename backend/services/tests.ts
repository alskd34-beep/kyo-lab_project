/**
 * [BACKEND] Tests 서비스 - 시험현황 목록
 *
 * 시험현황 화면 데이터를 "작업현황"의 실데이터에서 조립한다.
 *  - 기준 행 : pct_orders(삭제 제외) — 각 오더 = 한 건의 시험
 *  - 시험번호·진행상태 : 연결된 qc_jobs(order_id). 미착수 오더는 QC번호 '-' + 오더 상태 사용
 *  - 시험항목 : 작업이 있으면 qc_job_items(실제), 없으면 product_test_items(예정)
 *  - 구분 : products.product_type (없으면 제형 dosage_form)
 *  - 담당자 : assignee_tester_id → testers.name
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import type { TestRow, StatusKey } from '@shared/qc'

interface TestsQuery {
  from?: string          // YYYY-MM-DD (접수일=오더 적재일 기준)
  to?: string            // YYYY-MM-DD
  search?: string
  status?: StatusKey
  deviationOnly?: boolean
}

interface OrderLite {
  id: string
  product_code: string
  product_name: string
  batch_no: string
  dosage_form: string | null
  method: string | null
  due_date: string | null
  status: string
  assignee_tester_id: string | null
  created_at: string
}

const CONTRACTOR = '광동제약(주)'

/** pct_orders / qc_jobs 한글 상태 → 화면 StatusKey */
const STATUS_MAP: Record<string, StatusKey> = {
  대기:   'pending',
  진행중: 'inprogress',
  검토중: 'reviewing',
  지연:   'inprogress',
  완료:   'completed',
}
const toStatusKey = (ko: string): StatusKey => STATUS_MAP[ko] ?? 'pending'

/** 'YYYY-MM-DD…' → 'YYYY.MM.DD' (빈 값은 '') */
const fmtDate = (v: string | null | undefined): string => (v ? v.slice(0, 10).replaceAll('-', '.') : '')

interface ProductMeta {
  productType: string | null
  items: string[]
}

/** 품목코드 → { 구분(product_type), 예정 시험항목명 } 매핑. 미착수 오더 표시용. */
async function productMetaByCode(productCodes: string[]): Promise<Map<string, ProductMeta>> {
  const out = new Map<string, ProductMeta>()
  if (productCodes.length === 0) return out

  const { data: prods } = await supabaseAdmin
    .from('products')
    .select('id, product_code, product_type')
    .in('product_code', productCodes)
  const idToCode = new Map<string, string>()
  for (const p of prods ?? []) {
    const code = p.product_code as string
    idToCode.set(p.id as string, code)
    out.set(code, { productType: (p.product_type as string | null) ?? null, items: [] })
  }
  const productIds = [...idToCode.keys()]
  if (productIds.length === 0) return out

  const { data: links } = await supabaseAdmin
    .from('product_test_items')
    .select('product_id, test_item_id, sequence_order')
    .in('product_id', productIds)
    .order('sequence_order', { ascending: true })
  const itemIds = [...new Set((links ?? []).map(l => l.test_item_id as string))]
  const { data: items } = itemIds.length
    ? await supabaseAdmin.from('test_items').select('id, name').in('id', itemIds)
    : { data: [] as { id: string; name: string }[] }
  const nameById = new Map<string, string>((items ?? []).map(i => [i.id as string, i.name as string]))

  for (const l of links ?? []) {
    const code = idToCode.get(l.product_id as string)
    const name = nameById.get(l.test_item_id as string)
    if (!code || !name) continue
    out.get(code)?.items.push(name)
  }
  return out
}

export async function listTests(q: TestsQuery = {}): Promise<TestRow[]> {
  // 1) 오더 (작업현황 원본, 삭제 제외)
  const { data: orderData, error } = await supabaseAdmin
    .from('pct_orders')
    .select('id, product_code, product_name, batch_no, dosage_form, method, due_date, status, assignee_tester_id, created_at')
    .neq('status', '삭제')
    .order('created_at', { ascending: false })
  if (error) throw error
  const orders = (orderData ?? []) as OrderLite[]
  if (orders.length === 0) return []

  const orderIds = orders.map(o => o.id)

  // 2) 작업(QC번호·상태), 담당자명, 품목 메타(구분·예정항목) — 병렬
  const [jobsRes, testersRes, productMeta] = await Promise.all([
    supabaseAdmin.from('qc_jobs').select('id, order_id, qc_no, status').in('order_id', orderIds),
    supabaseAdmin.from('testers').select('id, name'),
    productMetaByCode([...new Set(orders.map(o => o.product_code))]),
  ])

  const jobByOrder = new Map<string, { id: string; qcNo: string; status: string }>()
  for (const j of jobsRes.data ?? []) {
    jobByOrder.set(j.order_id as string, { id: j.id as string, qcNo: j.qc_no as string, status: j.status as string })
  }
  const testerName = new Map<string, string>((testersRes.data ?? []).map(t => [t.id as string, t.name as string]))

  // 3) 작업 항목(실제) — 작업이 있는 오더에만
  const jobIds = [...jobByOrder.values()].map(j => j.id)
  const itemsByJob = new Map<string, string[]>()
  if (jobIds.length > 0) {
    const { data: jis } = await supabaseAdmin
      .from('qc_job_items')
      .select('qc_job_id, test_item_name, sequence_order')
      .in('qc_job_id', jobIds)
      .order('sequence_order', { ascending: true })
    for (const it of jis ?? []) {
      const arr = itemsByJob.get(it.qc_job_id as string) ?? []
      arr.push(it.test_item_name as string)
      itemsByJob.set(it.qc_job_id as string, arr)
    }
  }

  // 4) TestRow 매핑
  const mapped: TestRow[] = orders.map((o, i) => {
    const job  = jobByOrder.get(o.id)
    const meta = productMeta.get(o.product_code)
    const name = o.assignee_tester_id ? (testerName.get(o.assignee_tester_id) ?? '') : ''
    // 진행상태는 작업 상태 우선(시작했으면), 없으면 오더 상태
    const koStatus = job?.status ?? o.status
    const items = (job ? itemsByJob.get(job.id) : meta?.items) ?? []
    return {
      id:          i + 1,
      category:    meta?.productType ?? o.dosage_form ?? '-',
      type:        o.method ?? '-',
      product:     o.product_name,
      testNo:      job?.qcNo ?? '-',
      items:       items.join(', '),
      contractor:  CONTRACTOR,
      manager:     name,
      managerInit: name ? name.slice(0, 1) : '',
      receiveDate: fmtDate(o.created_at),
      dueDate:     fmtDate(o.due_date),
      status:      toStatusKey(koStatus),
    }
  })

  // 5) 필터 (접수일 범위 / 검색 / 상태 / 일탈) — 작은 데이터셋이라 메모리에서 처리
  const fromDot = q.from?.replaceAll('-', '.')
  const toDot   = q.to?.replaceAll('-', '.')
  const search  = q.search?.trim().toLowerCase()

  const filtered = mapped.filter(r => {
    if (fromDot && r.receiveDate && r.receiveDate < fromDot) return false
    if (toDot   && r.receiveDate && r.receiveDate > toDot)   return false
    if (q.status && r.status !== q.status) return false
    if (q.deviationOnly && r.status !== 'fail') return false   // 일탈(부적합)은 현재 데이터 소스에 없음
    if (search) {
      const hay = `${r.product} ${r.testNo} ${r.manager} ${r.items}`.toLowerCase()
      if (!hay.includes(search)) return false
    }
    return true
  })

  // 필터 후 행 번호 재부여
  return filtered.map((r, i) => ({ ...r, id: i + 1 }))
}
