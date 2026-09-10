import { supabaseAdmin as supabase } from '@backend/lib/supabase'
import { ITEM_CLEARED } from '@shared/qc-status'
import { listTestItems, type TestItemRow } from '@backend/services/testItems'

/**
 * 시험항목별 **실적** 소요시간 — 예상시간을 실측으로 되먹이기 위한 계산.
 *
 * 원칙: 자동으로 덮어쓰지 않는다.
 *   예상시간은 일정·부하·납기가 모두 올라서 있는 값이라, 시스템이 몰래 바꾸면 어제와
 *   오늘의 계획이 이유 없이 달라진다. GMP 관점에서도 "누가 언제 왜 바꿨는가" 가 남아야
 *   한다. 그래서 여기서는 **제안까지만** 만들고, 반영은 사람이 누른다.
 *
 * ── 왜 0분을 버리는가 (이 파일에서 가장 중요한 규칙) ────────────────────────────
 * qc_job_items.elapsed_minutes 는 항목 [시작] → [완료] 구간이다. 그런데 시작을 누르지
 * 않고 완료만 누르면 qcJobs.clearItem 이 "직전 항목이 완료된 시각" 을 시작점으로 삼는다.
 * 하루 일과를 마치고 항목 여러 개를 몰아서 체크하면 그 간격이 몇 초라, 값이 줄줄이 0 이
 * 된다. 실제 데이터에서 완료 51건 중 34건이 정확히 0분이었다.
 *
 * 0분은 "0분 걸렸다" 가 아니라 **"측정되지 않았다"** 는 뜻이다. 이걸 평균에 넣으면
 * 실측 평균이 실제의 몇 분의 일로 내려앉고, 그 값을 예상시간에 반영하는 순간 일정이
 * 통째로 무너진다. 그래서 표본에서 제외하고, 몇 건을 버렸는지는 함께 보고한다 —
 * 버린 건수가 많다는 사실 자체가 "시작 버튼을 안 누르고 있다" 는 운영 신호다.
 */

/** 이 분 수 미만은 측정 실패로 본다. 실제 시험 중 5분 안에 끝나는 것은 사실상 없다. */
export const MIN_VALID_MINUTES = 5
/** 표본이 이보다 적으면 제안하지 않는다. 두세 건으로 기준을 바꾸면 우연에 끌려다닌다. */
export const MIN_SAMPLES = 3
/** 현재값과 이만큼은 차이가 나야 제안한다. 10% 차이로 매번 배너를 띄우면 아무도 안 본다. */
export const SUGGEST_DIFF_RATIO = 0.2

export interface TestItemActual {
  /** qc_job_items.test_item_id. 옛 기록은 비어 있어 이름으로 이었다. */
  testItemId: string | null
  name: string
  /** 유효 표본 수(0분·측정 실패 제외) */
  sampleCount: number
  /** 측정 실패로 제외한 건수 */
  ignoredCount: number
  /** 대표값 — 중앙값. 배양·방치가 섞인 한 건에 평균이 끌려가는 것을 막는다. */
  medianMinutes: number
  avgMinutes: number
  minMinutes: number
  maxMinutes: number
  lastClearedAt: string | null
}

export interface EstimateSuggestion {
  testItemId: string
  name: string
  category: string
  currentMinutes: number | null
  suggestedMinutes: number
  sampleCount: number
  /** (제안 − 현재) / 현재. 현재값이 없으면 null. */
  diffRatio: number | null
  /** 'up' 늘려야 함 · 'down' 줄여야 함 · 'new' 예상시간이 아예 없음 */
  direction: 'up' | 'down' | 'new'
}

export interface TestItemStats {
  actuals: TestItemActual[]
  suggestions: EstimateSuggestion[]
  coverage: {
    /** 완료된 시험항목 기록 전체 */
    clearedTotal: number
    /** 그중 유효 표본 */
    validSamples: number
    /** 그중 측정 실패로 버린 건수 */
    ignoredSamples: number
    /** 실적이 하나라도 있는 마스터 항목 수 */
    itemsWithActuals: number
    /** 시간박스라서 제안 대상에서 뺀 항목 수 */
    timeboxedSkipped: number
  }
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2)
}

/**
 * 제안값을 사람이 읽을 눈금으로 맞춘다. "237분" 같은 값은 정밀해 보이지만, 표본 세 건에서
 * 나온 값을 분 단위까지 믿는다는 뜻이 되어 오히려 근거를 과장한다.
 *  - 1시간 미만 : 5분 단위
 *  - 1시간 이상 : 15분 단위
 * 어느 쪽이든 0 으로 내려가지 않게 한 눈금은 남긴다.
 */
export function roundToGrain(minutes: number): number {
  const grain = minutes < 60 ? 5 : 15
  return Math.max(grain, Math.round(minutes / grain) * grain)
}

/**
 * 시험항목별 실적을 모은다.
 *
 * 매칭은 test_item_id 를 먼저 본다. 옛 기록(0046 이전)은 이 값이 비어 있어 이름으로
 * 잇는다 — qc_job_items.test_item_name 은 작업 생성 시점의 마스터 이름 스냅샷이라
 * 마스터 이름을 바꾸면 그 지점에서 끊긴다. 그래서 새 기록에는 id 를 함께 적는다
 * (backend/services/qcJobs.ts 의 plannedItems).
 */
export async function collectActuals(): Promise<{
  byId: Map<string, TestItemActual>
  coverage: Pick<TestItemStats['coverage'], 'clearedTotal' | 'validSamples' | 'ignoredSamples'>
}> {
  const { data, error } = await supabase
    .from('qc_job_items')
    .select('test_item_id, test_item_name, elapsed_minutes, cleared_at')
    .eq('status', ITEM_CLEARED)
  if (error) throw error

  const rows = data ?? []
  const masters = await listTestItems()
  const idByName = new Map(masters.map(m => [m.name, m.id]))
  const nameById = new Map(masters.map(m => [m.id, m.name]))

  interface Acc { samples: number[]; ignored: number; last: string | null; name: string }
  const acc = new Map<string, Acc>()
  let validSamples = 0
  let ignoredSamples = 0

  for (const r of rows) {
    const rawId = (r.test_item_id as string | null) ?? null
    const name = String(r.test_item_name ?? '')
    // 마스터에 없는 이름(수동 추가 항목 등)은 제안할 대상이 없으므로 건너뛴다.
    const id = rawId && nameById.has(rawId) ? rawId : idByName.get(name)
    if (!id) continue

    const cur = acc.get(id) ?? { samples: [], ignored: 0, last: null, name: nameById.get(id) ?? name }
    const minutes = r.elapsed_minutes == null ? null : Number(r.elapsed_minutes)
    if (minutes == null || !Number.isFinite(minutes) || minutes < MIN_VALID_MINUTES) {
      cur.ignored += 1
      ignoredSamples += 1
    } else {
      cur.samples.push(minutes)
      validSamples += 1
    }
    const clearedAt = (r.cleared_at as string | null) ?? null
    if (clearedAt && (!cur.last || clearedAt > cur.last)) cur.last = clearedAt
    acc.set(id, cur)
  }

  const byId = new Map<string, TestItemActual>()
  for (const [id, a] of acc) {
    const sorted = [...a.samples].sort((x, y) => x - y)
    byId.set(id, {
      testItemId: id,
      name: a.name,
      sampleCount: sorted.length,
      ignoredCount: a.ignored,
      medianMinutes: median(sorted),
      avgMinutes: sorted.length
        ? Math.round(sorted.reduce((s, v) => s + v, 0) / sorted.length) : 0,
      minMinutes: sorted[0] ?? 0,
      maxMinutes: sorted[sorted.length - 1] ?? 0,
      lastClearedAt: a.last,
    })
  }

  return {
    byId,
    coverage: { clearedTotal: rows.length, validSamples, ignoredSamples },
  }
}

/** 한 항목에 대한 제안 — 조건에 맞지 않으면 null. 규칙을 한 곳에 모아 화면과 어긋나지 않게 한다. */
export function suggestionFor(
  item: Pick<TestItemRow, 'id' | 'name' | 'category' | 'estimatedMinutes' | 'isTimeboxed'>,
  actual: TestItemActual | undefined,
): EstimateSuggestion | null {
  // 시간박스 항목은 평균이 수렴하지 않는다(MT 등). 실적을 보여주기는 해도 제안은 하지 않는다.
  if (item.isTimeboxed) return null
  if (!actual || actual.sampleCount < MIN_SAMPLES) return null

  const suggested = roundToGrain(actual.medianMinutes)
  const current = item.estimatedMinutes

  if (current == null) {
    return {
      testItemId: item.id, name: item.name, category: item.category,
      currentMinutes: null, suggestedMinutes: suggested,
      sampleCount: actual.sampleCount, diffRatio: null, direction: 'new',
    }
  }
  const diffRatio = (suggested - current) / current
  if (Math.abs(diffRatio) < SUGGEST_DIFF_RATIO) return null
  if (suggested === current) return null

  return {
    testItemId: item.id, name: item.name, category: item.category,
    currentMinutes: current, suggestedMinutes: suggested,
    sampleCount: actual.sampleCount, diffRatio,
    direction: diffRatio > 0 ? 'up' : 'down',
  }
}

/** 화면(시험항목 마스터)이 쓰는 진입점 — 실적 + 제안 + 데이터 품질 요약. */
export async function getTestItemStats(): Promise<TestItemStats> {
  const [{ byId, coverage }, masters] = await Promise.all([collectActuals(), listTestItems()])

  const suggestions: EstimateSuggestion[] = []
  let timeboxedSkipped = 0
  for (const m of masters) {
    const actual = byId.get(m.id)
    if (m.isTimeboxed && actual && actual.sampleCount >= MIN_SAMPLES) timeboxedSkipped += 1
    const s = suggestionFor(m, actual)
    if (s) suggestions.push(s)
  }

  // 차이가 큰 것부터 — 가장 많이 어긋난 값이 일정을 가장 많이 망친다.
  suggestions.sort((a, b) => Math.abs(b.diffRatio ?? 1) - Math.abs(a.diffRatio ?? 1))

  return {
    actuals: [...byId.values()].sort((a, b) => b.sampleCount - a.sampleCount),
    suggestions,
    coverage: { ...coverage, itemsWithActuals: byId.size, timeboxedSkipped },
  }
}
