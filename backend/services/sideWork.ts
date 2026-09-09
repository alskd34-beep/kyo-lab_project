/**
 * [BACKEND] 부업무(시험 외 업무) 기록 — side_work_logs / side_work_categories
 *
 * 스키마: supabase/migrations/0041_side_work.sql
 *
 * 권한 규칙 (휴가(operator_schedule)와 같은 모양으로 맞췄다)
 *   - 시험자: **본인 기록만** 등록·수정·삭제. 팀 전체 기록은 읽기만 된다
 *             (월간 그리드가 남의 행도 그리므로 조회까지 막으면 화면이 반쪽이 된다).
 *   - 관리자: 전체 등록·수정·삭제 + 분류 마스터 관리.
 *
 * 집계 키는 tester_id 다. user_id 는 "누가 입력했는가"만 남긴다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { describeSchemaError } from '@backend/lib/schemaError'
import { getTesterId } from '@backend/lib/testerLink'
import { MAX_MINUTES_PER_LOG, type SideWorkCategory, type SideWorkLog } from '@shared/side-work'
import { getHolidaySet } from '@backend/services/holidays'
import { testerAbsences } from '@backend/services/operatorSchedule'
import { expandRange, isWeekend } from '@shared/workdays'
import { leaveTypeLabel } from '@shared/leave'

const FEATURE = '부업무 기록'
const MIGRATION = '0041_side_work.sql'

/** 스키마 미적용 안내를 이 서비스의 마이그레이션으로 고정한다 */
function schemaError(err: unknown): Error {
  return describeSchemaError(err, FEATURE, MIGRATION)
}

// ─── 요청자 신원 ──────────────────────────────────────────────────────────────
export interface SideWorkActor {
  userId: string
  role: 'admin' | 'tester'
  /** 이 계정에 연결된 시험자. 연결이 없으면 null — 시험자는 이때 아무것도 기록할 수 없다 */
  testerId: string | null
}

/** 세션(user id + role)으로부터 요청자 신원을 만든다 */
export async function resolveActor(
  userId: string, role: 'admin' | 'tester',
): Promise<SideWorkActor> {
  return { userId, role, testerId: await getTesterId(userId) }
}

// ─── 분류 마스터 ──────────────────────────────────────────────────────────────
function mapCategory(r: Record<string, unknown>): SideWorkCategory {
  return {
    id:        r.id as string,
    code:      r.code as string,
    name:      r.name as string,
    sortOrder: (r.sort_order as number) ?? 0,
    isActive:  r.is_active !== false,
  }
}

/**
 * 분류 목록(정렬순 → 이름순).
 * @param includeInactive 관리 화면은 꺼진 분류도 봐야 다시 켤 수 있다. 기록 화면은 켜진 것만.
 */
export async function listCategories(includeInactive = false): Promise<SideWorkCategory[]> {
  let q = supabaseAdmin
    .from('side_work_categories')
    .select('id, code, name, sort_order, is_active')
    .order('sort_order', { ascending: true })
    .order('name', { ascending: true })
  if (!includeInactive) q = q.eq('is_active', true)

  const { data, error } = await q
  if (error) throw schemaError(error)
  return (data ?? []).map(r => mapCategory(r as Record<string, unknown>))
}

export interface CategoryInput {
  code: string
  name: string
  sortOrder?: number
  isActive?: boolean
}

export async function createCategory(input: CategoryInput): Promise<SideWorkCategory> {
  const code = input.code.trim().toUpperCase()
  const name = input.name.trim()
  if (!code) throw new Error('분류 코드는 필수입니다.')
  if (!name) throw new Error('분류 이름은 필수입니다.')

  const { data, error } = await supabaseAdmin
    .from('side_work_categories')
    .insert({ code, name, sort_order: input.sortOrder ?? 0, is_active: input.isActive ?? true })
    .select('id, code, name, sort_order, is_active')
    .single()
  if (error) {
    if (error.code === '23505') throw new Error(`분류 코드 '${code}' 는 이미 있습니다.`)
    throw schemaError(error)
  }
  return mapCategory(data as Record<string, unknown>)
}

export async function updateCategory(id: string, patch: Partial<CategoryInput>): Promise<void> {
  const update: Record<string, unknown> = {}
  if (patch.code !== undefined) {
    const code = patch.code.trim().toUpperCase()
    if (!code) throw new Error('분류 코드는 비울 수 없습니다.')
    update.code = code
  }
  if (patch.name !== undefined) {
    const name = patch.name.trim()
    if (!name) throw new Error('분류 이름은 비울 수 없습니다.')
    update.name = name
  }
  if (patch.sortOrder !== undefined) update.sort_order = patch.sortOrder
  if (patch.isActive !== undefined)  update.is_active  = patch.isActive
  if (Object.keys(update).length === 0) return

  const { error } = await supabaseAdmin.from('side_work_categories').update(update).eq('id', id)
  if (error) {
    if (error.code === '23505') throw new Error('같은 분류 코드가 이미 있습니다.')
    throw schemaError(error)
  }
}

/**
 * 분류 삭제. 이미 기록이 달린 분류는 지우지 않는다 —
 * 지우면 그 분류로 쌓인 과거 기록을 리포트가 다시 읽을 수 없다(FK on delete restrict).
 */
export async function deleteCategory(id: string): Promise<void> {
  const { count, error: countErr } = await supabaseAdmin
    .from('side_work_logs')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', id)
  if (countErr) throw schemaError(countErr)
  if ((count ?? 0) > 0) {
    throw new Error(
      `이 분류로 기록된 부업무가 ${count}건 있어 삭제할 수 없습니다. ` +
      '대신 [사용 안 함]으로 꺼 두면 새 기록에는 나타나지 않고 과거 리포트는 그대로 읽힙니다.',
    )
  }
  const { error } = await supabaseAdmin.from('side_work_categories').delete().eq('id', id)
  if (error) throw schemaError(error)
}

// ─── 기록 ─────────────────────────────────────────────────────────────────────
const LOG_SELECT =
  'id, tester_id, user_id, work_date, category_id, title, minutes, note, created_at, ' +
  'testers(name), side_work_categories(name)'

function mapLog(r: Record<string, unknown>): SideWorkLog {
  const tester = r.testers as Record<string, unknown> | null | undefined
  const cat    = r.side_work_categories as Record<string, unknown> | null | undefined
  return {
    id:           r.id as string,
    testerId:     r.tester_id as string,
    testerName:   (tester?.name as string) ?? null,
    userId:       (r.user_id as string) ?? null,
    workDate:     r.work_date as string,
    categoryId:   r.category_id as string,
    categoryName: (cat?.name as string) ?? '—',
    title:        r.title as string,
    minutes:      (r.minutes as number) ?? 0,
    note:         (r.note as string) ?? null,
    createdAt:    r.created_at as string,
  }
}

/**
 * 기록 목록.
 * @param opts.from / opts.to 근무일 범위(포함). 월간 그리드는 그 달, 리포트는 조회 기간.
 * @param opts.testerId 지정 시 그 시험자만.
 */
export async function listLogs(opts: {
  from?: string
  to?: string
  testerId?: string
} = {}): Promise<SideWorkLog[]> {
  let q = supabaseAdmin
    .from('side_work_logs')
    .select(LOG_SELECT)
    .order('work_date', { ascending: true })
    .order('created_at', { ascending: true })

  if (opts.from)     q = q.gte('work_date', opts.from)
  if (opts.to)       q = q.lte('work_date', opts.to)
  if (opts.testerId) q = q.eq('tester_id', opts.testerId)

  const { data, error } = await q
  if (error) throw schemaError(error)
  return (data ?? []).map(r => mapLog(r as unknown as Record<string, unknown>))
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

/** 입력값 검증 — DB check 제약과 같은 규칙을 여기서 먼저 걸러 한국어로 돌려준다 */
function validate(input: { workDate?: string; title?: string; minutes?: number }): void {
  if (input.workDate !== undefined && !ISO_DATE.test(input.workDate)) {
    throw new Error('날짜는 YYYY-MM-DD 형식이어야 합니다.')
  }
  if (input.title !== undefined && !input.title.trim()) {
    throw new Error('업무 내용을 입력해 주세요.')
  }
  if (input.minutes !== undefined) {
    if (!Number.isFinite(input.minutes) || !Number.isInteger(input.minutes)) {
      throw new Error('소요시간은 분 단위 정수로 입력해 주세요.')
    }
    if (input.minutes <= 0) throw new Error('소요시간은 1분 이상이어야 합니다.')
    if (input.minutes > MAX_MINUTES_PER_LOG) {
      throw new Error('한 건의 소요시간은 24시간(1440분)을 넘을 수 없습니다.')
    }
  }
}

export interface CreateLogInput {
  /** 관리자만 유효. 시험자는 무시되고 본인으로 저장된다 */
  testerId?: string
  workDate: string
  categoryId: string
  title: string
  minutes: number
  note?: string | null
}

export async function createLog(input: CreateLogInput, actor: SideWorkActor): Promise<SideWorkLog> {
  validate(input)
  if (!input.categoryId) throw new Error('부업무 분류를 선택해 주세요.')

  // 남의 기록을 대신 넣는 것은 관리자만. 시험자는 요청 본문에 뭘 넣든 본인으로 저장한다.
  const testerId = actor.role === 'admin'
    ? (input.testerId ?? actor.testerId)
    : actor.testerId
  if (!testerId) {
    throw new Error(
      actor.role === 'admin'
        ? '기록할 시험자를 지정해 주세요.'
        : '이 계정에 연결된 시험자가 없어 기록할 수 없습니다. 관리자에게 문의해 주세요.',
    )
  }

  const { data, error } = await supabaseAdmin
    .from('side_work_logs')
    .insert({
      tester_id:   testerId,
      user_id:     actor.userId,
      work_date:   input.workDate,
      category_id: input.categoryId,
      title:       input.title.trim(),
      minutes:     input.minutes,
      note:        input.note?.trim() || null,
    })
    .select(LOG_SELECT)
    .single()
  if (error) {
    // 분류가 지워졌거나 잘못된 id — FK 위반은 사용자가 고칠 수 있는 오류다
    if (error.code === '23503') throw new Error('선택한 부업무 분류를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.')
    throw schemaError(error)
  }
  return mapLog(data as unknown as Record<string, unknown>)
}

/** 기록 1건의 소유자(tester_id). 없으면 null */
async function logOwnerTesterId(id: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from('side_work_logs').select('tester_id').eq('id', id).maybeSingle()
  if (error) throw schemaError(error)
  return (data?.tester_id as string) ?? null
}

/**
 * 소유권 확인. 관리자는 전체, 시험자는 본인 기록만.
 *
 * 이 값은 운영 리포트의 분모·분자로 곧장 들어간다. 남의 기록을 지우거나 늘릴 수 있으면
 * 리포트가 사실이 아니게 된다 — 휴가(operator_schedule)와 같은 이유로 서버에서 막는다.
 */
async function assertLogAccess(id: string, actor: SideWorkActor): Promise<void> {
  if (actor.role === 'admin') return
  const ownerTesterId = await logOwnerTesterId(id)
  if (ownerTesterId === null) throw new Error('기록을 찾을 수 없습니다.')
  if (!actor.testerId || ownerTesterId !== actor.testerId) {
    throw new Error('본인 기록만 변경할 수 있습니다.')
  }
}

export interface UpdateLogInput {
  workDate?: string
  categoryId?: string
  title?: string
  minutes?: number
  note?: string | null
}

export async function updateLog(id: string, input: UpdateLogInput, actor: SideWorkActor): Promise<void> {
  await assertLogAccess(id, actor)
  validate(input)

  const patch: Record<string, unknown> = {}
  if (input.workDate   !== undefined) patch.work_date   = input.workDate
  if (input.categoryId !== undefined) patch.category_id = input.categoryId
  if (input.title      !== undefined) patch.title       = input.title.trim()
  if (input.minutes    !== undefined) patch.minutes     = input.minutes
  if (input.note       !== undefined) patch.note        = input.note?.trim() || null
  if (Object.keys(patch).length === 0) return

  const { error } = await supabaseAdmin.from('side_work_logs').update(patch).eq('id', id)
  if (error) {
    if (error.code === '23503') throw new Error('선택한 부업무 분류를 찾을 수 없습니다.')
    throw schemaError(error)
  }
}

export async function deleteLog(id: string, actor: SideWorkActor): Promise<void> {
  await assertLogAccess(id, actor)
  const { error } = await supabaseAdmin.from('side_work_logs').delete().eq('id', id)
  if (error) throw schemaError(error)
}

// ─── 집계 (운영 리포트용) ─────────────────────────────────────────────────────
export interface SideWorkAggregate {
  /** testerId → { minutes, count } */
  byTester: Map<string, { minutes: number; count: number }>
  /** categoryId → { name, minutes, count } */
  byCategory: Map<string, { name: string; minutes: number; count: number }>
  /** 'YYYY-MM-DD' → minutes */
  byDate: Map<string, number>
  totalMinutes: number
  totalCount: number
}

/**
 * 기간 내 부업무 집계. 운영 리포트가 시험업무 집계와 나란히 놓기 위해 쓴다.
 * 기록이 없으면 빈 Map 들을 돌려준다(호출부가 0 으로 읽으면 된다).
 */
export async function aggregateSideWork(from: string, to: string): Promise<SideWorkAggregate> {
  const logs = await listLogs({ from, to })

  const byTester   = new Map<string, { minutes: number; count: number }>()
  const byCategory = new Map<string, { name: string; minutes: number; count: number }>()
  const byDate     = new Map<string, number>()
  let totalMinutes = 0

  for (const log of logs) {
    const t = byTester.get(log.testerId) ?? { minutes: 0, count: 0 }
    t.minutes += log.minutes
    t.count += 1
    byTester.set(log.testerId, t)

    const c = byCategory.get(log.categoryId) ?? { name: log.categoryName, minutes: 0, count: 0 }
    c.minutes += log.minutes
    c.count += 1
    byCategory.set(log.categoryId, c)

    byDate.set(log.workDate, (byDate.get(log.workDate) ?? 0) + log.minutes)
    totalMinutes += log.minutes
  }

  return { byTester, byCategory, byDate, totalMinutes, totalCount: logs.length }
}

// ─── 반복 부업무 ──────────────────────────────────────────────────────────────
/**
 * 매일 반복되는 부업무(문서작성·시험실 정리 등)를 기간 단위로 한 번에 넣는다.
 *
 * 규칙을 저장해 화면에서 가상으로 그리지 않고 **실제 기록을 미리 만든다.** 리포트·통계가
 * 전부 side_work_logs 를 직접 읽기 때문에, 가상 항목은 소비처마다 규칙을 알아야 하고
 * 한 곳만 빠뜨려도 숫자가 갈린다. 실제 행이면 수정·삭제·집계가 기존 경로로 그대로 된다.
 * 한 번에 지울 수 있게 series_id 로 묶는다(0043).
 *
 * 건너뛰는 날은 **미리 보여준다** — 넣고 나서 "왜 15일이 아니라 11일이지?" 를 묻게 하면
 * 편해지려고 만든 기능이 오히려 확인 부담이 된다.
 */

/** 한 번에 만들 수 있는 최대 일수 — 실수로 몇 년치를 만드는 것을 막는다 */
const MAX_RECURRING_DAYS = 200

export interface RecurringInput {
  /** 관리자만 유효. 시험자는 무시되고 본인으로 저장된다 */
  testerId?: string
  from: string
  to: string
  categoryId: string
  title: string
  minutes: number
  note?: string | null
  /** 넣을 요일 (0=일 … 6=토). 비어 있으면 모든 요일 */
  weekdays?: number[]
  /** 주말 제외 (기본 true) */
  skipWeekends?: boolean
  /** 공휴일 제외 (기본 true) */
  skipHolidays?: boolean
  /** 본인 휴가·출장일 제외 (기본 true) — 부재일에 부업무가 쌓이면 리포트가 사실이 아니게 된다 */
  skipAbsences?: boolean
}

export interface RecurringPlan {
  /** 실제로 만들 날짜 */
  dates: string[]
  /** 건너뛴 날과 사유 — 화면이 그대로 보여준다 */
  skipped: Array<{ date: string; reason: string }>
  totalMinutes: number
}

/** 입력 검증 + 대상 시험자 확정. 미리보기와 생성이 같은 규칙을 쓰도록 한 곳에 둔다. */
async function resolveRecurring(
  input: RecurringInput, actor: SideWorkActor,
): Promise<{ testerId: string; plan: RecurringPlan }> {
  if (!input.categoryId) throw new Error('부업무 분류를 선택해 주세요.')
  if (!input.title?.trim()) throw new Error('부업무 내용을 입력해 주세요.')
  if (!input.from || !input.to) throw new Error('시작일과 종료일을 선택해 주세요.')
  if (input.from > input.to) throw new Error('종료일이 시작일보다 빠릅니다.')
  if (!Number.isFinite(input.minutes) || input.minutes <= 0) {
    throw new Error('소요시간은 1분 이상이어야 합니다.')
  }
  if (input.minutes > MAX_MINUTES_PER_LOG) {
    throw new Error('한 건의 소요시간은 24시간(1440분)을 넘을 수 없습니다.')
  }

  const testerId = actor.role === 'admin' ? (input.testerId ?? actor.testerId) : actor.testerId
  if (!testerId) {
    throw new Error(
      actor.role === 'admin'
        ? '기록할 시험자를 지정해 주세요.'
        : '이 계정에 연결된 시험자가 없어 기록할 수 없습니다. 관리자에게 문의해 주세요.',
    )
  }

  const all = expandRange(input.from, input.to)
  if (all.length === 0) throw new Error('기간이 올바르지 않습니다.')
  if (all.length > MAX_RECURRING_DAYS) {
    throw new Error(`한 번에 ${MAX_RECURRING_DAYS}일까지만 만들 수 있습니다. 기간을 나눠 주세요.`)
  }

  const skipWeekends = input.skipWeekends ?? true
  const skipHolidays = input.skipHolidays ?? true
  const skipAbsences = input.skipAbsences ?? true
  const weekdays = input.weekdays?.length ? new Set(input.weekdays) : null

  // 공휴일·부재는 기간에 걸친 것만 읽는다. 실패해도 등록 자체를 막지 않는다 —
  // 건너뛰기는 편의이지 안전장치가 아니고, 여기서 던지면 아무것도 못 넣게 된다.
  const holidays = skipHolidays
    ? await getHolidaySet(Number(input.from.slice(0, 4))).catch(() => new Set<string>())
    : new Set<string>()
  // 연말에 걸친 기간은 다음 해 공휴일도 필요하다.
  if (skipHolidays && input.to.slice(0, 4) !== input.from.slice(0, 4)) {
    const next = await getHolidaySet(Number(input.to.slice(0, 4))).catch(() => new Set<string>())
    for (const d of next) holidays.add(d)
  }
  const absences = skipAbsences
    ? (await testerAbsences(input.from, input.to).catch(() => []))
        .filter(a => a.testerId === testerId)
    : []

  // 같은 내용이 그날 이미 있으면 넣지 않는다 — 반복 등록을 두 번 눌러도 두 배가 되지 않고,
  // 손으로 미리 적어 둔 날도 덮어쓰지 않는다.
  const { data: existingRows, error: exErr } = await supabaseAdmin
    .from('side_work_logs')
    .select('work_date, title, category_id')
    .eq('tester_id', testerId)
    .gte('work_date', input.from)
    .lte('work_date', input.to)
  if (exErr) throw schemaError(exErr)
  const title = input.title.trim()
  const existing = new Set(
    (existingRows ?? [])
      .filter(r => r.category_id === input.categoryId && String(r.title ?? '').trim() === title)
      .map(r => r.work_date as string),
  )

  const dates: string[] = []
  const skipped: Array<{ date: string; reason: string }> = []
  for (const d of all) {
    const dow = new Date(d + 'T00:00:00Z').getUTCDay()
    if (weekdays && !weekdays.has(dow)) {
      // 요일 필터에 걸린 날이 마침 주말이면 '주말'이라고 말한다. 기본 선택이 월~금이라
      // 그대로 두면 흔한 경우가 전부 '선택한 요일 아님' 으로 나와 읽는 사람이 갸웃한다.
      skipped.push({ date: d, reason: isWeekend(d) ? '주말' : '선택한 요일 아님' })
      continue
    }
    // 요일을 직접 고른 경우(토요일 근무 등) 그 선택이 이깁니다 — skipWeekends 는
    // 요일을 고르지 않았을 때의 기본값 역할만 한다.
    if (skipWeekends && !weekdays && isWeekend(d)) { skipped.push({ date: d, reason: '주말' }); continue }
    if (holidays.has(d)) { skipped.push({ date: d, reason: '공휴일' }); continue }
    const absent = absences.find(a => a.from <= d && a.to >= d)
    if (absent) { skipped.push({ date: d, reason: leaveTypeLabel(absent.type) }); continue }
    if (existing.has(d)) { skipped.push({ date: d, reason: '같은 기록 있음' }); continue }
    dates.push(d)
  }

  return { testerId, plan: { dates, skipped, totalMinutes: dates.length * input.minutes } }
}

/** 미리보기 — 아무것도 쓰지 않는다. 화면이 "며칠 · 총 몇 시간" 과 건너뛴 날을 보여준다. */
export async function previewRecurring(
  input: RecurringInput, actor: SideWorkActor,
): Promise<RecurringPlan> {
  const { plan } = await resolveRecurring(input, actor)
  return plan
}

/** 실제 생성. 미리보기와 같은 함수로 날짜를 정하므로 화면에 보인 것과 어긋나지 않는다. */
export async function createRecurring(
  input: RecurringInput, actor: SideWorkActor,
): Promise<RecurringPlan & { seriesId: string; created: number }> {
  const { testerId, plan } = await resolveRecurring(input, actor)
  if (plan.dates.length === 0) {
    throw new Error('만들 날짜가 없습니다. 기간이나 건너뛰기 조건을 확인해 주세요.')
  }

  const seriesId = crypto.randomUUID()
  const { error } = await supabaseAdmin.from('side_work_logs').insert(
    plan.dates.map(d => ({
      tester_id:   testerId,
      user_id:     actor.userId,
      work_date:   d,
      category_id: input.categoryId,
      title:       input.title.trim(),
      minutes:     input.minutes,
      note:        input.note?.trim() || null,
      series_id:   seriesId,
    })),
  )
  if (error) {
    if (error.code === '23503') throw new Error('선택한 부업무 분류를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.')
    throw describeSchemaError(error, '반복 부업무', '0043_side_work_series.sql')
  }
  return { ...plan, seriesId, created: plan.dates.length }
}

/**
 * 반복으로 만든 묶음을 통째로 지운다.
 *
 * 이미 지난 날의 기록까지 지우면 "그날 한 일" 이 사라진다. 그래서 기본은 **오늘 이후**만
 * 지운다(from 을 주면 그 날짜부터). 지난 기록까지 정리하려면 호출부가 from 을 명시한다.
 */
export async function deleteSeries(
  seriesId: string, actor: SideWorkActor, from?: string,
): Promise<number> {
  const { data: owned, error: oErr } = await supabaseAdmin
    .from('side_work_logs').select('tester_id').eq('series_id', seriesId).limit(1).maybeSingle()
  if (oErr) throw schemaError(oErr)
  if (!owned) return 0
  if (actor.role !== 'admin') {
    if (!actor.testerId || owned.tester_id !== actor.testerId) {
      throw new Error('본인 기록만 변경할 수 있습니다.')
    }
  }

  const cutoff = from ?? new Date().toISOString().slice(0, 10)
  const { data, error } = await supabaseAdmin
    .from('side_work_logs').delete()
    .eq('series_id', seriesId).gte('work_date', cutoff)
    .select('id')
  if (error) throw schemaError(error)
  return (data ?? []).length
}
