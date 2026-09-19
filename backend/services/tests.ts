/**
 * [BACKEND] Tests 서비스 - 시험현황 목록
 *
 * 시험현황 화면 데이터를 "작업현황"의 실데이터에서 조립한다.
 *  - 기준 행 : pct_orders(삭제 제외) — 각 오더 = 한 건의 시험
 *  - 시험번호·진행상태 : 연결된 qc_jobs(order_id). 미착수 오더는 QC번호 '-' + 오더 상태 사용
 *  - 시험항목 : 작업이 있으면 qc_job_items(실제), 없으면 product_test_items(예정)
 *  - 구분 : products.product_type (없으면 제형 dosage_form)
 *  - 담당자 : pct_order_assignees(담당자 1~5, 0049) → testers.name (병렬 배정이면 전원)
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { selectAll } from '@backend/lib/supabasePage'
import { DELETED_STATUS } from '@shared/qc-status'
import { METHOD_PARTIAL, mapByOrders } from '@backend/services/pctOrderTestItems'
import { loadAssigneesByOrder } from '@backend/services/orderAssignees'
import { loadGroupSizeByOrder } from '@backend/services/qcJobs'
import { isParallelAssignment } from '@shared/assignment'
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
  is_urgent: boolean | null
  assignee_tester_id: string | null
  created_at: string
}

const CONTRACTOR = '광동제약(주)'

/** pct_orders / qc_jobs 한글 상태 → 화면 StatusKey */
const STATUS_MAP: Record<string, StatusKey> = {
  대기:     'waiting',     // 배정만 되고 아직 시작 전 — 승인 대기와 다르다
  진행중:   'inprogress',
  지연:     'delayed',
  검토전:   'prereview',   // 시험 끝나고 검토 대기
  검토중:   'reviewing',
  승인전:   'pending',     // 검토 끝나고 승인 대기
  승인완료: 'completed',
}
// 알 수 없는 값을 '승인대기'로 단정하면 안 되므로 가장 이른 단계로 떨어뜨린다
const toStatusKey = (ko: string): StatusKey => STATUS_MAP[ko] ?? 'waiting'

/** 'YYYY-MM-DD…' → 'YYYY.MM.DD' (빈 값은 '') */
const fmtDate = (v: string | null | undefined): string => (v ? v.slice(0, 10).replaceAll('-', '.') : '')

interface ProductMeta {
  productType: string | null
  items: string[]
}

const IN_CHUNK = 150

/** 품목코드 → { 구분(product_type), 예정 시험항목명 } 매핑. 미착수 오더 표시용. */
async function productMetaByCode(productCodes: string[]): Promise<Map<string, ProductMeta>> {
  const out = new Map<string, ProductMeta>()
  if (productCodes.length === 0) return out

  const prods: Record<string, unknown>[] = []
  for (let i = 0; i < productCodes.length; i += IN_CHUNK) {
    const { data, error } = await supabaseAdmin
      .from('products')
      .select('id, product_code, product_type')
      .in('product_code', productCodes.slice(i, i + IN_CHUNK))
      .range(0, 9999)
    if (error) throw error
    prods.push(...((data ?? []) as Record<string, unknown>[]))
  }
  const idToCode = new Map<string, string>()
  for (const p of prods ?? []) {
    const code = p.product_code as string
    idToCode.set(p.id as string, code)
    out.set(code, { productType: (p.product_type as string | null) ?? null, items: [] })
  }
  const productIds = [...idToCode.keys()]
  if (productIds.length === 0) return out

  const links: Record<string, unknown>[] = []
  for (let i = 0; i < productIds.length; i += IN_CHUNK) {
    const { data, error } = await supabaseAdmin
      .from('product_test_items')
      .select('product_id, test_item_id, sequence_order')
      .in('product_id', productIds.slice(i, i + IN_CHUNK))
      .order('sequence_order', { ascending: true })
      .range(0, 9999)
    if (error) throw error
    links.push(...((data ?? []) as Record<string, unknown>[]))
  }
  links.sort((a, b) => Number(a.sequence_order ?? 0) - Number(b.sequence_order ?? 0))
  const itemIds = [...new Set((links ?? []).map(l => l.test_item_id as string))]
  const items: Record<string, unknown>[] = []
  for (let i = 0; i < itemIds.length; i += IN_CHUNK) {
    const { data, error } = await supabaseAdmin
      .from('test_items').select('id, name').in('id', itemIds.slice(i, i + IN_CHUNK)).range(0, 9999)
    if (error) throw error
    items.push(...((data ?? []) as Record<string, unknown>[]))
  }
  const nameById = new Map<string, string>(items.map(i => [i.id as string, i.name as string]))

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
    .select('id, product_code, product_name, batch_no, dosage_form, method, due_date, status, is_urgent, assignee_tester_id, created_at')
    .neq('status', DELETED_STATUS)
    .order('created_at', { ascending: false })
    // Supabase 기본 1000행 상한 회피. pct_orders는 소프트 삭제만 하므로 단조 증가한다.
    .range(0, 9999)
  if (error) throw error
  const orders = (orderData ?? []) as OrderLite[]
  if (orders.length === 0) return []

  const orderIds = orders.map(o => o.id)

  // 2) 작업(QC번호·상태), 담당자명, 품목 메타(구분·예정항목) — 병렬
  const jobResults = await Promise.all(Array.from({ length: Math.ceil(orderIds.length / IN_CHUNK) }, (_, i) =>
    supabaseAdmin.from('qc_jobs').select('id, order_id, qc_no, status').in('order_id', orderIds.slice(i * IN_CHUNK, (i + 1) * IN_CHUNK)).range(0, 9999)))
  const jobsError = jobResults.find(result => result.error)?.error
  if (jobsError) throw jobsError
  const jobsRes = { data: jobResults.flatMap(result => result.data ?? []), error: null }
  const [testersRes, productMeta, orderItems, assigneeMap, groupSizeByOrder] = await Promise.all([
    selectAll(supabaseAdmin, 'testers', 'id, name', { orderBy: 'id' }),
    productMetaByCode([...new Set(orders.map(o => o.product_code))]),
    // 개별항목 오더는 품목 전체가 아니라 오더에서 고른 항목만 보여준다
    mapByOrders(orders.filter(o => o.method === METHOD_PARTIAL).map(o => o.id)),
    // 담당자 구성(0049). 미적용이면 대표 미러로 1인 배정처럼 보인다(시험현황 조회를 막지 않는다)
    orderIds.length > 300 ? loadAssigneesByOrder(undefined, { mirror: orders }) : loadAssigneesByOrder(orderIds, { mirror: orders }),
    // 동시분석 그룹 크기 — 목록의 "동시 N" 배지(실패해도 빈 맵)
    loadGroupSizeByOrder(),
  ])

  // 병렬 배정 오더는 담당자별로 작업이 여러 건이다. 예전처럼 Map<orderId, job> 에 담으면
  // 나중에 온 행이 앞 행을 덮어써서 한 사람 몫(QC번호·항목)만 남고 나머지는 조용히 사라진다.
  // 시험현황의 한 줄은 어디까지나 "오더 한 건"이므로, 두 작업을 합쳐서 보여준다.
  const jobsByOrder = new Map<string, { id: string; qcNo: string; status: string }[]>()
  for (const j of jobsRes.data ?? []) {
    const arr = jobsByOrder.get(j.order_id as string) ?? []
    arr.push({ id: j.id as string, qcNo: j.qc_no as string, status: j.status as string })
    jobsByOrder.set(j.order_id as string, arr)
  }
  // QC번호 순으로 고정 — 조회할 때마다 순서가 바뀌면 화면이 흔들린다.
  for (const arr of jobsByOrder.values()) arr.sort((a, b) => a.qcNo.localeCompare(b.qcNo))
  const testerName = new Map<string, string>((testersRes.data ?? []).map(t => [t.id as string, t.name as string]))

  // 3) 작업 항목(실제) — 작업이 있는 오더에만
  const jobIds = [...jobsByOrder.values()].flat().map(j => j.id)
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
    const jobs = jobsByOrder.get(o.id) ?? []
    const job  = jobs[0]
    const meta = productMeta.get(o.product_code)
    // 병렬 배정이면 담당자 전원(담당자 1~5, 번호 순)을 함께 보여준다 — 대표만 쓰면 나머지가 화면에서 사라진다.
    const slots = assigneeMap.get(o.id) ?? []
    const parallel = isParallelAssignment(slots)
    const names = slots.map(a => testerName.get(a.testerId) ?? '').filter(Boolean)
    const name = names.join(', ')
    // 진행상태: 1인 배정은 예전 그대로 작업 상태 우선. 병렬 배정은 작업이 여러 건이라 어느 한쪽을
    // 고를 수 없고, 오더 상태가 이미 작업들 중 가장 뒤처진 단계로 동기화돼 있으므로 그것을 쓴다
    // (backend/services/qcJobs.ts 의 syncOrderStatusFromJobs).
    const koStatus = parallel ? o.status : (job?.status ?? o.status)
    // 시작한 작업이 있으면 실제 체크리스트, 없으면 예정 항목
    //  (개별항목 오더는 오더에서 고른 항목, 전항목 오더는 품목 전체)
    const planned = o.method === METHOD_PARTIAL ? orderItems.get(o.id) : meta?.items
    // 병렬 배정은 담당자들의 체크리스트를 합쳐야 그 제조번호의 전체 시험항목이 된다.
    const items = (jobs.length > 0
      ? [...new Set(jobs.flatMap(j => itemsByJob.get(j.id) ?? []))]
      : planned) ?? []
    return {
      id:          i + 1,
      orderId:     o.id,
      jobId:       job?.id ?? null,
      category:    meta?.productType ?? o.dosage_form ?? '-',
      type:        o.method ?? '-',
      product:     o.product_name,
      batchNo:     o.batch_no,
      // 병렬 배정이면 QC번호가 담당자별로 여러 개다 — 전부 보여야 어느 시험인지 추적된다.
      testNo:      jobs.length > 0 ? jobs.map(j => j.qcNo).join(', ') : '-',
      items:       items.join(', '),
      itemList:    items,
      contractor:  CONTRACTOR,
      manager:     name,
      managerInit: name ? name.slice(0, 1) : '',
      receiveDate: fmtDate(o.created_at),
      dueDate:     fmtDate(o.due_date),
      status:      toStatusKey(koStatus),
      rawStatus:   koStatus,
      isUrgent:    !!o.is_urgent,
      groupSize:   groupSizeByOrder.get(o.id) ?? 0,
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
      const hay = `${r.product} ${r.testNo} ${r.manager} ${r.items} ${r.batchNo}`.toLowerCase()
      if (!hay.includes(search)) return false
    }
    return true
  })

  // 필터 후 행 번호 재부여
  return filtered.map((r, i) => ({ ...r, id: i + 1 }))
}
