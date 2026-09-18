import { supabaseAdmin as supabase } from '@backend/lib/supabase'
import { selectAll } from '@backend/lib/supabasePage'
import { supportsColumn, supportsColumns } from '@backend/lib/columnSupport'

/**
 * 예상시간의 출처 — 같은 "4시간" 이라도 신뢰도가 다르다(0046).
 *  - assumed   : 담당자가 경험으로 잡은 가정치. 일정은 세울 수 있지만 근거는 사람의 감이다.
 *  - measured  : 실제 완료 실적에서 나온 값. 표본 수(estimateSampleCount)와 함께 읽는다.
 *  - confirmed : 실적을 사람이 검토해 "이 값이 맞다" 고 확정한 값. 가장 강한 근거.
 */
export const ESTIMATE_SOURCES = ['assumed', 'measured', 'confirmed'] as const
export type EstimateSource = typeof ESTIMATE_SOURCES[number]

export const ESTIMATE_SOURCE_LABEL: Record<EstimateSource, string> = {
  assumed: '가정',
  measured: '실적',
  confirmed: '확정',
}

export function isEstimateSource(v: unknown): v is EstimateSource {
  return typeof v === 'string' && (ESTIMATE_SOURCES as readonly string[]).includes(v)
}

export interface TestItemRow {
  id: string
  name: string
  category: string
  /** 예상 소요 분 — 이 시스템 소요시간의 단일 기준(0045) */
  estimatedMinutes: number | null
  /** @deprecated 하위 호환용 파생값. 새 코드는 estimatedMinutes 를 쓴다 */
  estimatedHours: number | null
  /** 예상시간의 출처(0046). 값을 얼마나 믿을지 판단하는 기준. */
  estimateSource: EstimateSource
  /** measured/confirmed 의 근거가 된 유효 실적 건수. assumed 면 0. */
  estimateSampleCount: number
  /** 예상시간을 마지막으로 바꾼 시각. null = 초기 등록값 그대로. */
  estimateUpdatedAt: string | null
  /** 시간박스 항목(MT 등) — 평균이 수렴하지 않아 실적 기반 제안에서 제외한다. */
  isTimeboxed: boolean
  requiresDuo: boolean
  isActive: boolean
  createdAt: string
}

export const TEST_ITEM_CATEGORIES = [
  '성상·포장', '이화학', '함량시험', '확인시험', '기기분석', '안전성', '밸리데이션', '기타',
] as const
export type TestItemCategory = typeof TEST_ITEM_CATEGORIES[number]

function mapRow(r: Record<string, unknown>): TestItemRow {
  return {
    id:             r.id as string,
    name:           r.name as string,
    category:       (r.category as string) ?? '기타',
    // 예상시간의 단일 기준은 **분**이다(0045). estimated_hours 는 하위 호환용 파생값이라
    // 분이 없을 때만 시간에서 되계산한다 — 0045 미적용 DB 에서도 화면이 비지 않는다.
    estimatedMinutes: r.estimated_minutes != null
      ? Number(r.estimated_minutes)
      : (r.estimated_hours != null ? Math.round(Number(r.estimated_hours) * 60) : null),
    estimatedHours: r.estimated_hours != null ? Number(r.estimated_hours) : null,
    // 0046 미적용 DB 에서는 컬럼이 아예 오지 않는다. 그때의 기본값은 '가정' 이 맞다 —
    // 실적을 반영한 적이 없다는 뜻이고, 실제로 그때는 반영할 방법도 없었다.
    estimateSource:      isEstimateSource(r.estimate_source) ? r.estimate_source : 'assumed',
    estimateSampleCount: r.estimate_sample_count != null ? Number(r.estimate_sample_count) : 0,
    estimateUpdatedAt:   (r.estimate_updated_at as string) ?? null,
    isTimeboxed:         r.is_timeboxed === true,
    requiresDuo:    r.requires_duo as boolean,
    isActive:       r.is_active as boolean,
    createdAt:      r.created_at as string,
  }
}

/** 0045 — 예상시간 분 컬럼 */
const supportsMinutes = () =>
  supportsColumn('test_items', 'estimated_minutes', '0045 마이그레이션을 적용하면 분 단위로 저장됩니다')

/**
 * 0046 — 출처 4종. 한 마이그레이션에서 함께 추가되므로 묶어서 확인한다.
 * 하나라도 없으면 전부 빼고 쓴다(섞어 쓰면 어느 쪽이 빠졌는지 추적이 어렵다).
 */
const PROVENANCE_COLUMNS = [
  'estimate_source', 'estimate_sample_count', 'estimate_updated_at', 'is_timeboxed',
] as const
const supportsProvenance = () =>
  supportsColumns('test_items', PROVENANCE_COLUMNS, '0046 마이그레이션을 적용하면 공수 출처가 기록됩니다')

export async function listTestItems(): Promise<TestItemRow[]> {
  // 0045/0046 의 새 컬럼을 이름으로 적으면 미적용 DB 에서 42703 이 나고 목록 전체가
  // 500 이 된다. '*' 면 없는 컬럼은 빠지고 mapRow 의 폴백이 받는다.
  const { data, error } = await selectAll(supabase, 'test_items', '*', { orderBy: 'id' })
  if (error) throw error
  return [...(data ?? [])]
    .sort((a, b) => {
      const categoryOrder = String(a.category ?? '').localeCompare(String(b.category ?? ''), 'ko')
      return categoryOrder || String(a.name ?? '').localeCompare(String(b.name ?? ''), 'ko')
    })
    .map(r => mapRow(r as Record<string, unknown>))
}

export async function createTestItem(input: {
  name: string
  category?: string
  /** 예상 소요 분 — 화면이 보내는 기준값 */
  estimatedMinutes?: number | null
  estimateSource?: EstimateSource
  isTimeboxed?: boolean
  requiresDuo?: boolean
}): Promise<TestItemRow> {
  const [hasMinutes, hasProvenance] = await Promise.all([supportsMinutes(), supportsProvenance()])
  const { data, error } = await supabase
    .from('test_items')
    .insert({
      name:           input.name,
      category:       input.category ?? '기타',
      // 분이 기준이고 시간은 함께 채워 둔다 — 챗봇 컨텍스트(qthinkAgent·chat)가 아직
      // estimated_hours 를 읽는다. 한쪽만 갱신하면 그 조회가 조용히 빈다.
      // 0045 미적용 DB 에서는 분 컬럼을 빼고 보낸다(넣으면 저장 자체가 실패한다).
      ...(hasMinutes ? { estimated_minutes: input.estimatedMinutes ?? null } : {}),
      estimated_hours: input.estimatedMinutes != null
        ? Math.round((input.estimatedMinutes / 60) * 100) / 100
        : null,
      // 새로 만든 항목의 예상시간은 정의상 가정치다 — 실적이 있을 리 없다.
      ...(hasProvenance ? {
        estimate_source:       input.estimateSource ?? 'assumed',
        estimate_sample_count: 0,
        estimate_updated_at:   input.estimatedMinutes != null ? new Date().toISOString() : null,
        is_timeboxed:          input.isTimeboxed ?? false,
      } : {}),
      requires_duo:   input.requiresDuo ?? false,
    })
    .select('*')
    .single()
  if (error) {
    // 23505: unique_violation — 시험항목명 중복
    if ((error as { code?: string }).code === '23505') {
      throw new Error(`이미 등록된 시험항목명입니다: "${input.name}"`)
    }
    throw error
  }
  return mapRow(data as Record<string, unknown>)
}

export async function updateTestItem(
  id: string,
  input: Partial<{
    name: string
    category: string
    estimatedMinutes: number | null
    estimateSource: EstimateSource
    /** 실적 반영으로 바꿀 때만 채운다. 손으로 고친 값에는 표본이 없다. */
    estimateSampleCount: number
    isTimeboxed: boolean
    requiresDuo: boolean
    isActive: boolean
  }>
): Promise<void> {
  const patch: Record<string, unknown> = {}
  if (input.name            !== undefined) patch.name            = input.name
  if (input.category        !== undefined) patch.category        = input.category
  if (input.estimatedMinutes !== undefined) {
    if (await supportsMinutes()) patch.estimated_minutes = input.estimatedMinutes
    patch.estimated_hours = input.estimatedMinutes != null
      ? Math.round((input.estimatedMinutes / 60) * 100) / 100
      : null
  }

  if (await supportsProvenance()) {
    if (input.estimateSource !== undefined) {
      if (!isEstimateSource(input.estimateSource)) {
        throw new Error(`알 수 없는 공수 출처입니다: "${String(input.estimateSource)}"`)
      }
      patch.estimate_source = input.estimateSource
      // 출처가 '가정'으로 돌아가면 표본은 근거를 잃는다. 남겨 두면 "가정치인데 실적
      // 12건" 이라는 앞뒤가 안 맞는 표시가 생긴다 — 명시적으로 지운다.
      if (input.estimateSource === 'assumed' && input.estimateSampleCount === undefined) {
        patch.estimate_sample_count = 0
      }
    }
    if (input.estimateSampleCount !== undefined) {
      patch.estimate_sample_count = Math.max(0, Math.round(input.estimateSampleCount))
    }
    if (input.isTimeboxed !== undefined) patch.is_timeboxed = input.isTimeboxed
    // 예상시간이 바뀐 순간이 곧 "이 값의 나이"다. 이름·분류만 고친 수정은 건드리지 않는다.
    if (input.estimatedMinutes !== undefined) patch.estimate_updated_at = new Date().toISOString()
  }

  if (input.requiresDuo     !== undefined) patch.requires_duo    = input.requiresDuo
  if (input.isActive        !== undefined) patch.is_active       = input.isActive

  if (Object.keys(patch).length === 0) return

  const { error } = await supabase.from('test_items').update(patch).eq('id', id)
  if (error) {
    // 23505: unique_violation — 다른 시험항목과 이름 중복
    if ((error as { code?: string }).code === '23505') {
      throw new Error(
        input.name ? `이미 등록된 시험항목명입니다: "${input.name}"` : '이미 등록된 시험항목명입니다.'
      )
    }
    throw error
  }
}

export async function deleteTestItem(id: string): Promise<void> {
  const { error } = await supabase.from('test_items').delete().eq('id', id)
  if (error) throw error
}
