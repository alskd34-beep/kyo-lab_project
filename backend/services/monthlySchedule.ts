/**
 * [BACKEND] 월간 스케줄 조회
 *
 * 정본은 `pct_orders`(오더) + `qc_jobs`(실제 작업)다.
 *
 * 예전에는 레거시 `schedules` 테이블을 읽었다. 그 테이블은 2026-04 에 적재된 65행에서
 * 멈춰 있어(마지막 날짜 2026-05-01) 그 뒤로는 어느 달을 열어도 0건이었고, 월간 화면이
 * 늘 "이 달에 배정된 스케줄이 없습니다"만 띄웠다. 주간 배정이 `pct_orders` 로 통합된
 * 2026-08-22 이후로 그 테이블에 새로 쓰는 곳도 없다.
 * (배경: docs/system-audit-2026-08-22.md 5번 항목)
 *
 * 한 배정이 달력의 **어느 날짜들**을 차지하는가:
 *   1. QC 작업이 시작됐으면 `qc_jobs.work_start_date` 부터 (실제 착수일이 가장 정확하다)
 *   2. 아니면 `packaging_date` **다음** 근무일부터 (시험은 포장이 끝나야 시작한다)
 *   3. 포장일이 없으면 `due_date` 에서 거꾸로 (납기를 맞추는 최소 일정)
 * 길이는 `product_workload.avg_workdays`(공수, DAY)이고 주말·공휴일은 건너뛴다.
 *
 * 2인 배정(`is_dual_assignment`)은 담당자1·담당자2 **양쪽 행**에 각각 놓는다.
 * 한 명한테만 놓으면 나머지 한 명의 그 기간 부하가 달력에서 사라진다.
 *
 * ⚠️ 반환 필드가 snake_case 인 것은 의도적 예외다. 월간 화면이 이 응답과
 *    PCT 브릿지(`frontend/lib/pct-schedule-bridge.ts`)의 행을 같은 배열에서 병합하므로
 *    두 소스의 키가 같아야 한다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { selectAll } from '@backend/lib/supabasePage'
import { listOrders, type PctOrderRow } from '@backend/services/pctOrders'
import { getHolidaySet } from '@backend/services/holidays'
import { DELETED_STATUS } from '@shared/qc-status'
import { workingDaysAfter, workingDaysBefore, workingDaysFromInclusive } from '@backend/lib/workdays'

export interface MonthlyScheduleRow {
  /** `${orderId}:${슬롯}` — 2인 배정은 담당자별로 행이 갈리므로 오더 id 만으로는 겹친다 */
  id: string
  /** 담당자 없는 오더는 달력에 놓을 자리가 없어 애초에 행을 만들지 않는다 */
  tester_id: string
  batch_id: string
  /** 제조번호(시트 원본 값) */
  batch_no: string
  product_code: string
  product_name: string
  test_items: string[]
  /** 배정 시작일 = dates[0] */
  scheduled_date: string
  workdays: number
  /** 실제로 차지하는 근무일 목록(주말·공휴일 제외). 화면은 이 날짜들에만 셀을 놓는다 */
  dates: string[]
  is_urgent: boolean
  is_duo: boolean
  duo_partner_id: string | null
  status: string
  note: string | null
  /** 관리자 확정(LOCK) 여부 */
  locked: boolean
  /** QC 작업이 시작돼 실제 착수일을 아는 행인지 */
  has_job: boolean
}

export interface MonthlyTester {
  id: string
  name: string
  employee_no: string
}

export interface MonthlyScheduleResult {
  month: string
  monthStart: string
  monthEnd: string
  schedules: MonthlyScheduleRow[]
  testers: MonthlyTester[]
}

/** 공수가 등록되지 않은 품목의 기본값(일). 0일짜리 배정은 달력에서 사라진다 */
const DEFAULT_WORKDAYS = 1

/**
 * 달력에 올리지 않는 오더 상태 — 소프트 삭제뿐이다.
 * 승인완료(끝난 일)는 남긴다. 이 달에 실제로 그 사람이 한 일이라 지난 달을 열어 보면
 * 보여야 하고, 빼 버리면 완료할수록 달력이 비어 가는 이상한 화면이 된다.
 */
const EXCLUDED_ORDER_STATUSES = new Set([DELETED_STATUS])

/** 'YYYY-MM' → 해당 월의 첫날·마지막날 ISO 문자열 */
export function monthRange(month: string): { monthStart: string; monthEnd: string } {
  const [yearStr, monthStr] = month.split('-')
  const year = Number(yearStr)
  const monthIdx = Number(monthStr) - 1
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  return {
    monthStart: fmt(new Date(Date.UTC(year, monthIdx, 1))),
    monthEnd:   fmt(new Date(Date.UTC(year, monthIdx + 1, 0))),
  }
}

/** 해당 오더·담당자가 차지하는 근무일 목록. 근거 날짜가 하나도 없으면 빈 배열 */
function assignedDates(
  order: PctOrderRow, jobStartDate: string | null, holidays: Set<string>,
): string[] {
  const workdays = Math.max(1, order.workdays ?? DEFAULT_WORKDAYS)
  if (jobStartDate) return workingDaysFromInclusive(jobStartDate, workdays, holidays)
  if (order.packagingDate) return workingDaysAfter(order.packagingDate, workdays, holidays)
  if (order.dueDate) return workingDaysBefore(order.dueDate, workdays, holidays)
  return []
}

export async function getMonthlySchedule(month: string): Promise<MonthlyScheduleResult> {
  const { monthStart, monthEnd } = monthRange(month)

  const [orders, testerRes, holidays] = await Promise.all([
    listOrders(),
    selectAll(supabaseAdmin, 'testers', 'id, name, employee_no'),
    getHolidaySet(),
  ])
  if (testerRes.error) throw new Error(`시험자 조회 실패: ${testerRes.error.message}`)

  const liveOrders = orders.filter(o => !EXCLUDED_ORDER_STATUSES.has(o.status))
  const orderIds = liveOrders.map(o => o.id)

  // QC 작업(실제 착수일·현재 단계)과 담당자별 시험항목을 오더 단위로 끌어온다.
  // 오더가 없으면 in() 에 빈 배열이 들어가 무의미한 왕복이 되므로 건너뛴다.
  const [jobRes, itemRes] = orderIds.length === 0
    ? [{ data: [] }, { data: [] }]
    : await Promise.all([
      supabaseAdmin
        .from('qc_jobs')
        .select('order_id, assignee_tester_id, work_start_date, status')
        .in('order_id', orderIds),
      supabaseAdmin
        .from('pct_order_test_items')
        .select('order_id, test_item_name, assignee_slot, is_excluded, sequence_order')
        .in('order_id', orderIds)
        .order('sequence_order', { ascending: true }),
    ])

  /** `${orderId}::${testerId}` → 그 사람의 작업. 2인 배정은 사람마다 작업이 따로 선다 */
  const jobByOrderTester = new Map<string, { workStartDate: string | null; status: string }>()
  for (const j of (jobRes.data ?? []) as Record<string, unknown>[]) {
    jobByOrderTester.set(`${j.order_id as string}::${(j.assignee_tester_id as string) ?? ''}`, {
      workStartDate: (j.work_start_date as string) ?? null,
      status:        j.status as string,
    })
  }

  /** `${orderId}::${슬롯}` → 시험항목명 목록 (제외 항목은 뺀다) */
  const itemsByOrderSlot = new Map<string, string[]>()
  for (const it of (itemRes.data ?? []) as Record<string, unknown>[]) {
    if (it.is_excluded) continue
    const key = `${it.order_id as string}::${(it.assignee_slot as number) ?? 1}`
    const list = itemsByOrderSlot.get(key) ?? []
    list.push(it.test_item_name as string)
    itemsByOrderSlot.set(key, list)
  }

  const schedules: MonthlyScheduleRow[] = []
  for (const order of liveOrders) {
    // 2인 배정일 때만 담당자2 슬롯을 편다. 담당자가 아직 없는 오더는 달력에 놓을 자리가 없다.
    const slots: { slot: 1 | 2; testerId: string | null; partnerId: string | null }[] = [
      { slot: 1, testerId: order.assigneeTesterId, partnerId: order.isDualAssignment ? order.assigneeTesterId2 : null },
    ]
    // 담당자1과 담당자2가 같은 사람이면 슬롯을 펴지 않는다 — 한 사람의 같은 일이
    // 셀에 두 번 쌓여 그 사람 부하가 두 배로 보인다.
    if (order.isDualAssignment && order.assigneeTesterId2 && order.assigneeTesterId2 !== order.assigneeTesterId) {
      slots.push({ slot: 2, testerId: order.assigneeTesterId2, partnerId: order.assigneeTesterId })
    }

    for (const { slot, testerId, partnerId } of slots) {
      if (!testerId) continue

      const job = jobByOrderTester.get(`${order.id}::${testerId}`)
      const dates = assignedDates(order, job?.workStartDate ?? null, holidays)
      // 이 달에 걸치는 날이 하나도 없으면 이 화면의 관심 밖이다.
      const inMonth = dates.filter(d => d >= monthStart && d <= monthEnd)
      if (inMonth.length === 0) continue

      // 담당자별 시험항목. 2인 배정이 아니면 슬롯 구분 없이 오더의 전체 항목을 쓴다.
      const items = order.isDualAssignment
        ? (itemsByOrderSlot.get(`${order.id}::${slot}`) ?? [])
        : [...(itemsByOrderSlot.get(`${order.id}::1`) ?? []), ...(itemsByOrderSlot.get(`${order.id}::2`) ?? [])]

      schedules.push({
        id:             `${order.id}:${slot}`,
        tester_id:      testerId,
        batch_id:       order.id,
        batch_no:       order.batchNo,
        product_code:   order.productCode,
        product_name:   order.productName,
        test_items:     items,
        scheduled_date: dates[0],
        workdays:       dates.length,
        dates,
        is_urgent:      order.isUrgent,
        is_duo:         order.isDualAssignment,
        duo_partner_id: partnerId,
        // 작업이 섰으면 작업 단계가, 아직이면 오더 상태가 지금 상태다.
        status:         job?.status ?? order.status,
        note:           [
          order.validationType ? `구분: ${order.validationType}` : '',
          order.method ? `진행방법: ${order.method}` : '',
          order.dueDate ? `납기: ${order.dueDate}` : '',
          order.note ?? '',
        ].filter(Boolean).join('\n') || null,
        locked:         order.locked,
        has_job:        !!job,
      })
    }
  }

  schedules.sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date))

  return {
    month,
    monthStart,
    monthEnd,
    schedules,
    testers: (testerRes.data ?? []) as unknown as MonthlyTester[],
  }
}
