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
