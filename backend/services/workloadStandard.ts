/**
 * [BACKEND] 품목별 시험공수 표준 (Workload Standard)
 *
 * 계층: workload_product → workload_test_item → workload_step
 *
 * 핵심 규칙
 *   - 공수 입력은 작업단계(step)에서만 한다. 시험항목·품목의 공수 컬럼은
 *     recalcProduct() 가 하위 합계로 항상 다시 계산한다(사용자 직접 입력 없음).
 *   - 인적/기기/대기/검토는 서로 합산하지 않는다. 표준 소요일은 별도 관리값.
 *   - 삭제는 Soft Delete(deleted_at). 과거 시험실적 추적을 위해 행을 남긴다.
 *
 * ⚠️ 스키마 미적용 대비
 *   supabase/migrations/0026_workload_standard.sql 이 아직 적용되지 않은 환경에서도
 *   화면을 확인할 수 있도록, 조회는 예제 데이터(쌍화탕)로 폴백하고 schemaReady:false 를 함께
 *   돌려준다. 변경(쓰기)은 폴백하지 않고 안내 메시지를 담은 오류를 던진다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import type {
  Difficulty,
  ProductTestItem,
  ProductWorkload,
  TestWorkStep,
  WorkloadActual,
  WorkloadStatus,
  WorkloadType,
  WorkloadVarianceRow,
  WorkloadVersion,
} from '@shared/workload'
import { WORKLOAD_PREVIEW_SEED } from '@backend/services/workloadSeed'

const T_PRODUCT = 'workload_product'
const T_ITEM = 'workload_test_item'
const T_STEP = 'workload_step'
const T_VERSION = 'workload_version_history'
const T_ACTUAL = 'workload_actual'

const SCHEMA_MISSING_MESSAGE =
  '공수 표준 테이블이 아직 생성되지 않았습니다. supabase/migrations/0026_workload_standard.sql 을 적용해 주세요.'

// ─── 오류 판별 ───────────────────────────────────────────────────────────────

/** 테이블 부재(마이그레이션 미적용) 여부 */
function isSchemaMissing(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as Record<string, unknown>).code
  return code === '42P01' || code === 'PGRST205' || code === 'PGRST202'
}

function schemaMissingError(): Error {
  return new Error(SCHEMA_MISSING_MESSAGE)
}

/** Postgres 오류 코드 (23505 = unique 위반 등) */
function errorCode(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null
  const code = (err as { code?: unknown }).code
  return typeof code === 'string' ? code : null
}

// ─── row 매핑 ────────────────────────────────────────────────────────────────

type Row = Record<string, unknown>

const str = (v: unknown): string | null => (v == null || v === '' ? null : String(v))
const num = (v: unknown): number => (v == null ? 0 : Number(v))
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v))

function mapStep(r: Row): TestWorkStep {
  return {
    id: String(r.id),
    testItemId: String(r.test_item_id),
    stepCode: str(r.step_code),
    stepName: String(r.step_name),
    sequence: num(r.sequence),
    workloadType: r.workload_type as WorkloadType,
    durationMinutes: num(r.duration_minutes),
    equipmentTypeId: str(r.equipment_type_id),
    equipmentTypeName: str(r.equipment_type_name),
    requiredSkill: str(r.required_skill),
    parallelAllowed: Boolean(r.parallel_allowed),
    predecessorStepId: str(r.predecessor_step_id),
    memo: str(r.memo),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }
}

function mapTestItem(r: Row, steps: TestWorkStep[] = []): ProductTestItem {
  return {
    id: String(r.id),
    productWorkloadId: String(r.product_workload_id),
    testCode: str(r.test_code),
    testName: String(r.test_name),
    sequence: num(r.sequence),
    humanMinutes: num(r.human_minutes),
    equipmentMinutes: num(r.equipment_minutes),
    waitingMinutes: num(r.waiting_minutes),
    reviewMinutes: num(r.review_minutes),
    parallelAllowed: Boolean(r.parallel_allowed),
    simultaneousAnalysisAllowed: Boolean(r.simultaneous_analysis_allowed),
    simultaneousMaxCount: numOrNull(r.simultaneous_max_count),
    simultaneousAdditionalHumanMinutes: numOrNull(r.simultaneous_additional_human_minutes),
    simultaneousAdditionalEquipmentMinutes: numOrNull(r.simultaneous_additional_equipment_minutes),
    requiredSkill: str(r.required_skill),
    difficulty: (r.difficulty as Difficulty) ?? 'NORMAL',
    memo: str(r.memo),
    steps,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  }
}

function mapProduct(r: Row, testItems: ProductTestItem[] = []): ProductWorkload {
  return {
    id: String(r.id),
    productCode: String(r.product_code),
    productName: String(r.product_name),
    dosageForm: str(r.dosage_form),
    standardLeadTimeDays: num(r.standard_lead_time_days),
    totalHumanMinutes: num(r.total_human_minutes),
    totalEquipmentMinutes: num(r.total_equipment_minutes),
    totalWaitingMinutes: num(r.total_waiting_minutes),
    totalReviewMinutes: num(r.total_review_minutes),
    testItemCount: num(r.test_item_count),
    stepCount: num(r.step_count),
    version: num(r.version),
    effectiveFrom: str(r.effective_from),
    effectiveTo: str(r.effective_to),
    status: (r.status as WorkloadStatus) ?? 'DRAFT',
    testItems,
    createdAt: String(r.created_at),
    createdBy: str(r.created_by),
    updatedAt: String(r.updated_at),
    updatedBy: str(r.updated_by),
  }
}

function mapVersion(r: Row): WorkloadVersion {
  return {
    id: String(r.id),
    productWorkloadId: String(r.product_workload_id),
    version: num(r.version),
    effectiveFrom: str(r.effective_from),
    changedBy: str(r.changed_by),
    changeNote: str(r.change_note),
    createdAt: String(r.created_at),
  }
}

function mapActual(r: Row): WorkloadActual {
  const actual = num(r.actual_minutes)
  const standard = num(r.standard_minutes)
  return {
    id: String(r.id),
    productWorkloadId: str(r.product_workload_id),
    testItemId: str(r.test_item_id),
    workStepId: str(r.work_step_id),
    workerId: str(r.worker_id),
    equipmentId: str(r.equipment_id),
    startedAt: str(r.started_at),
    completedAt: str(r.completed_at),
    actualMinutes: actual,
    standardMinutes: standard,
    varianceMinutes: actual - standard,
    varianceRate: standard > 0 ? ((actual - standard) / standard) * 100 : null,
    productionLotNo: str(r.production_lot_no),
    recordedAt: String(r.recorded_at),
  }
}

// ─── 조회 ────────────────────────────────────────────────────────────────────

export interface WorkloadListResult {
  rows: ProductWorkload[]
  /** false = 마이그레이션 미적용. rows 는 예제(미리보기) 데이터다. */
  schemaReady: boolean
}

/**
 * 품목 공수 표준 전체 목록 (하위 시험항목·작업단계 포함).
 * 대시보드/차트/목록이 모두 이 결과 하나로 렌더링된다.
 */
export async function listProductWorkloads(): Promise<WorkloadListResult> {
  const { data: products, error } = await supabaseAdmin
    .from(T_PRODUCT)
    .select('*')
    .is('deleted_at', null)
    .order('product_code', { ascending: true })

  if (error) {
    if (isSchemaMissing(error)) return { rows: WORKLOAD_PREVIEW_SEED, schemaReady: false }
    throw error
  }

  const productRows = (products ?? []) as Row[]
  if (productRows.length === 0) return { rows: [], schemaReady: true }

  const productIds = productRows.map(p => String(p.id))
  const { itemsByProduct } = await loadItemsWithSteps(productIds)

  return {
    rows: productRows.map(p => mapProduct(p, itemsByProduct.get(String(p.id)) ?? [])),
    schemaReady: true,
  }
}

/** 단일 품목 상세 (시험항목 + 작업단계) */
export async function getProductWorkload(
  productId: string,
): Promise<{ row: ProductWorkload | null; schemaReady: boolean }> {
  const { data, error } = await supabaseAdmin
    .from(T_PRODUCT)
    .select('*')
    .eq('id', productId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) {
    if (isSchemaMissing(error)) {
      return { row: WORKLOAD_PREVIEW_SEED.find(p => p.id === productId) ?? null, schemaReady: false }
    }
    throw error
  }
  if (!data) return { row: null, schemaReady: true }

  const { itemsByProduct } = await loadItemsWithSteps([productId])
  return { row: mapProduct(data as Row, itemsByProduct.get(productId) ?? []), schemaReady: true }
}

/** 여러 품목의 시험항목 + 작업단계를 2회 쿼리로 한 번에 읽는다. */
async function loadItemsWithSteps(productIds: string[]): Promise<{
  itemsByProduct: Map<string, ProductTestItem[]>
}> {
  const { data: itemRows, error: itemErr } = await supabaseAdmin
    .from(T_ITEM)
    .select('*')
    .in('product_workload_id', productIds)
    .is('deleted_at', null)
    .order('sequence', { ascending: true })
  if (itemErr) throw itemErr

  const items = (itemRows ?? []) as Row[]
  const itemIds = items.map(i => String(i.id))

  let steps: Row[] = []
  if (itemIds.length > 0) {
    const { data: stepRows, error: stepErr } = await supabaseAdmin
      .from(T_STEP)
      .select('*')
      .in('test_item_id', itemIds)
      .is('deleted_at', null)
      .order('sequence', { ascending: true })
    if (stepErr) throw stepErr
    steps = (stepRows ?? []) as Row[]
  }

  const stepsByItem = new Map<string, TestWorkStep[]>()
  for (const s of steps) {
    const key = String(s.test_item_id)
    const list = stepsByItem.get(key) ?? []
    list.push(mapStep(s))
    stepsByItem.set(key, list)
  }

  const itemsByProduct = new Map<string, ProductTestItem[]>()
  for (const i of items) {
    const key = String(i.product_workload_id)
    const list = itemsByProduct.get(key) ?? []
    list.push(mapTestItem(i, stepsByItem.get(String(i.id)) ?? []))
    itemsByProduct.set(key, list)
  }

  return { itemsByProduct }
}

/** 버전 변경이력 (최신 버전 우선) */
export async function listWorkloadVersions(productId: string): Promise<WorkloadVersion[]> {
  const { data, error } = await supabaseAdmin
    .from(T_VERSION)
    .select('*')
    .eq('product_workload_id', productId)
    .order('version', { ascending: false })

  if (error) {
    if (isSchemaMissing(error)) return []
    throw error
  }
  return ((data ?? []) as Row[]).map(mapVersion)
}

// ─── 합계 재계산 (작업단계 → 시험항목 → 품목) ────────────────────────────────

/**
 * 품목 하위 전체를 다시 합산해 시험항목·품목의 공수 컬럼을 갱신한다.
 * 작업단계/시험항목이 바뀔 때마다 호출한다.
 *
 * 주의: 인적/기기/대기/검토는 각각 따로 합산한다. 총합이나 소요일로 환산하지 않는다.
 */
export async function recalcProduct(productId: string): Promise<void> {
  const { data: itemRows, error: itemErr } = await supabaseAdmin
    .from(T_ITEM)
    .select('id')
    .eq('product_workload_id', productId)
    .is('deleted_at', null)
  if (itemErr) throw itemErr

  const itemIds = ((itemRows ?? []) as Row[]).map(r => String(r.id))

  let steps: Row[] = []
  if (itemIds.length > 0) {
    const { data: stepRows, error: stepErr } = await supabaseAdmin
      .from(T_STEP)
      .select('test_item_id, workload_type, duration_minutes')
      .in('test_item_id', itemIds)
      .is('deleted_at', null)
    if (stepErr) throw stepErr
    steps = (stepRows ?? []) as Row[]
  }

  const zero = () => ({ HUMAN: 0, EQUIPMENT: 0, WAITING: 0, REVIEW: 0 })
  const perItem = new Map<string, ReturnType<typeof zero>>()
  for (const id of itemIds) perItem.set(id, zero())
  for (const s of steps) {
    const bucket = perItem.get(String(s.test_item_id))
    if (!bucket) continue
    bucket[s.workload_type as WorkloadType] += num(s.duration_minutes)
  }

  // 시험항목 합계 갱신
  await Promise.all(
    itemIds.map(id => {
      const b = perItem.get(id)!
      return supabaseAdmin
        .from(T_ITEM)
        .update({
          human_minutes: b.HUMAN,
          equipment_minutes: b.EQUIPMENT,
          waiting_minutes: b.WAITING,
          review_minutes: b.REVIEW,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
    }),
  )

  // 품목 합계 갱신
  const total = zero()
  for (const b of perItem.values()) {
    total.HUMAN += b.HUMAN
    total.EQUIPMENT += b.EQUIPMENT
    total.WAITING += b.WAITING
    total.REVIEW += b.REVIEW
  }

  const { error: prodErr } = await supabaseAdmin
    .from(T_PRODUCT)
    .update({
      total_human_minutes: total.HUMAN,
      total_equipment_minutes: total.EQUIPMENT,
      total_waiting_minutes: total.WAITING,
      total_review_minutes: total.REVIEW,
      test_item_count: itemIds.length,
      step_count: steps.length,
      updated_at: new Date().toISOString(),
    })
    .eq('id', productId)
  if (prodErr) throw prodErr
}

// ─── 품목 CRUD ───────────────────────────────────────────────────────────────

export interface ProductWorkloadInput {
  productCode: string
  productName: string
  dosageForm?: string | null
  standardLeadTimeDays: number
  effectiveFrom?: string | null
  effectiveTo?: string | null
  status?: WorkloadStatus
  /** 지정 시 해당 품목의 시험항목·작업단계를 복사한다 */
  copyFromProductId?: string | null
}

export async function createProductWorkload(
  input: ProductWorkloadInput,
  actor: string | null,
): Promise<ProductWorkload> {
  if (!input.productCode?.trim()) throw new Error('품목코드는 필수입니다.')
  if (!input.productName?.trim()) throw new Error('품목명은 필수입니다.')
  if (!(input.standardLeadTimeDays > 0)) throw new Error('표준 소요일은 0보다 커야 합니다.')

  const { data, error } = await supabaseAdmin
    .from(T_PRODUCT)
    .insert({
      product_code: input.productCode.trim(),
      product_name: input.productName.trim(),
      dosage_form: input.dosageForm?.trim() || null,
      standard_lead_time_days: input.standardLeadTimeDays,
      effective_from: input.effectiveFrom || null,
      effective_to: input.effectiveTo || null,
      status: input.status ?? 'DRAFT',
      version: 1,
      created_by: actor,
      updated_by: actor,
    })
    .select('*')
    .single()

  if (error) {
    if (isSchemaMissing(error)) throw schemaMissingError()
    if (errorCode(error) === '23505') throw new Error('이미 등록된 품목코드입니다.')
    throw error
  }

  const productId = String((data as Row).id)

  await insertVersionHistory(productId, 1, input.effectiveFrom ?? null, actor, '공수 표준 신규 등록')

  if (input.copyFromProductId) {
    await copyWorkloadStructure(input.copyFromProductId, productId)
    await recalcProduct(productId)
  }

  const { row } = await getProductWorkload(productId)
  return row!
}

export interface ProductWorkloadPatch {
  productCode?: string
  productName?: string
  dosageForm?: string | null
  standardLeadTimeDays?: number
  effectiveFrom?: string | null
  effectiveTo?: string | null
  status?: WorkloadStatus
  /** true 면 version 을 올리고 변경이력을 남긴다 */
  bumpVersion?: boolean
  changeNote?: string
}

export async function updateProductWorkload(
  productId: string,
  patch: ProductWorkloadPatch,
  actor: string | null,
): Promise<void> {
  if (patch.standardLeadTimeDays !== undefined && !(patch.standardLeadTimeDays > 0)) {
    throw new Error('표준 소요일은 0보다 커야 합니다.')
  }

  const dbPatch: Row = { updated_at: new Date().toISOString(), updated_by: actor }
  if (patch.productCode !== undefined) dbPatch.product_code = patch.productCode.trim()
  if (patch.productName !== undefined) dbPatch.product_name = patch.productName.trim()
  if (patch.dosageForm !== undefined) dbPatch.dosage_form = patch.dosageForm?.trim() || null
  if (patch.standardLeadTimeDays !== undefined) dbPatch.standard_lead_time_days = patch.standardLeadTimeDays
  if (patch.effectiveFrom !== undefined) dbPatch.effective_from = patch.effectiveFrom || null
  if (patch.effectiveTo !== undefined) dbPatch.effective_to = patch.effectiveTo || null
  if (patch.status !== undefined) dbPatch.status = patch.status

  let nextVersion: number | null = null
  if (patch.bumpVersion) {
    const { data: cur, error: curErr } = await supabaseAdmin
      .from(T_PRODUCT).select('version').eq('id', productId).maybeSingle()
    if (curErr) {
      if (isSchemaMissing(curErr)) throw schemaMissingError()
      throw curErr
    }
    nextVersion = num((cur as Row | null)?.version) + 1
    dbPatch.version = nextVersion
  }

  const { error } = await supabaseAdmin.from(T_PRODUCT).update(dbPatch).eq('id', productId)
  if (error) {
    if (isSchemaMissing(error)) throw schemaMissingError()
    if (errorCode(error) === '23505') throw new Error('이미 등록된 품목코드입니다.')
    throw error
  }

  if (nextVersion != null) {
    await insertVersionHistory(
      productId, nextVersion, patch.effectiveFrom ?? null, actor,
      patch.changeNote?.trim() || '공수 표준 변경',
    )
  }
}

/** Soft delete — 실적 추적을 위해 행을 남기고 상태만 내린다. */
export async function deleteProductWorkload(productId: string, actor: string | null): Promise<void> {
  const { error } = await supabaseAdmin
    .from(T_PRODUCT)
    .update({
      deleted_at: new Date().toISOString(),
      status: 'INACTIVE',
      updated_at: new Date().toISOString(),
      updated_by: actor,
    })
    .eq('id', productId)
  if (error) {
    if (isSchemaMissing(error)) throw schemaMissingError()
    throw error
  }
}

async function insertVersionHistory(
  productId: string,
  version: number,
  effectiveFrom: string | null,
  actor: string | null,
  note: string,
): Promise<void> {
  const { error } = await supabaseAdmin.from(T_VERSION).insert({
    product_workload_id: productId,
    version,
    effective_from: effectiveFrom,
    changed_by: actor,
    change_note: note,
  })
  // 이력 적재 실패가 본 작업을 막지 않도록 스키마 부재만 무시한다.
  if (error && !isSchemaMissing(error)) throw error
}

// ─── 시험항목 CRUD ───────────────────────────────────────────────────────────

export interface TestItemInput {
  testCode?: string | null
  testName: string
  sequence?: number
  parallelAllowed?: boolean
  simultaneousAnalysisAllowed?: boolean
  simultaneousMaxCount?: number | null
  simultaneousAdditionalHumanMinutes?: number | null
  simultaneousAdditionalEquipmentMinutes?: number | null
  requiredSkill?: string | null
  difficulty?: Difficulty
  memo?: string | null
}

export async function createTestItem(productId: string, input: TestItemInput): Promise<ProductTestItem> {
  if (!input.testName?.trim()) throw new Error('시험항목명은 필수입니다.')

  const sequence = input.sequence ?? (await nextSequence(T_ITEM, 'product_workload_id', productId))

  const { data, error } = await supabaseAdmin
    .from(T_ITEM)
    .insert({
      product_workload_id: productId,
      test_code: input.testCode?.trim() || null,
      test_name: input.testName.trim(),
      sequence,
      parallel_allowed: input.parallelAllowed ?? true,
      simultaneous_analysis_allowed: input.simultaneousAnalysisAllowed ?? false,
      simultaneous_max_count: input.simultaneousMaxCount ?? null,
      simultaneous_additional_human_minutes: input.simultaneousAdditionalHumanMinutes ?? null,
      simultaneous_additional_equipment_minutes: input.simultaneousAdditionalEquipmentMinutes ?? null,
      required_skill: input.requiredSkill?.trim() || null,
      difficulty: input.difficulty ?? 'NORMAL',
      memo: input.memo?.trim() || null,
    })
    .select('*')
    .single()

  if (error) {
    if (isSchemaMissing(error)) throw schemaMissingError()
    throw error
  }

  await resequence(T_ITEM, 'product_workload_id', productId)
  await recalcProduct(productId)
  return mapTestItem(data as Row)
}

export async function updateTestItem(testItemId: string, input: Partial<TestItemInput>): Promise<void> {
  const dbPatch: Row = { updated_at: new Date().toISOString() }
  if (input.testCode !== undefined) dbPatch.test_code = input.testCode?.trim() || null
  if (input.testName !== undefined) {
    if (!input.testName.trim()) throw new Error('시험항목명은 필수입니다.')
    dbPatch.test_name = input.testName.trim()
  }
  if (input.sequence !== undefined) dbPatch.sequence = input.sequence
  if (input.parallelAllowed !== undefined) dbPatch.parallel_allowed = input.parallelAllowed
  if (input.simultaneousAnalysisAllowed !== undefined) {
    dbPatch.simultaneous_analysis_allowed = input.simultaneousAnalysisAllowed
  }
  if (input.simultaneousMaxCount !== undefined) dbPatch.simultaneous_max_count = input.simultaneousMaxCount
  if (input.simultaneousAdditionalHumanMinutes !== undefined) {
    dbPatch.simultaneous_additional_human_minutes = input.simultaneousAdditionalHumanMinutes
  }
  if (input.simultaneousAdditionalEquipmentMinutes !== undefined) {
    dbPatch.simultaneous_additional_equipment_minutes = input.simultaneousAdditionalEquipmentMinutes
  }
  if (input.requiredSkill !== undefined) dbPatch.required_skill = input.requiredSkill?.trim() || null
  if (input.difficulty !== undefined) dbPatch.difficulty = input.difficulty
  if (input.memo !== undefined) dbPatch.memo = input.memo?.trim() || null

  const { data, error } = await supabaseAdmin
    .from(T_ITEM).update(dbPatch).eq('id', testItemId).select('product_workload_id').maybeSingle()
  if (error) {
    if (isSchemaMissing(error)) throw schemaMissingError()
    throw error
  }

  const productId = str((data as Row | null)?.product_workload_id)
  if (productId) {
    if (input.sequence !== undefined) await resequence(T_ITEM, 'product_workload_id', productId)
    await recalcProduct(productId)
  }
}

export async function deleteTestItem(testItemId: string): Promise<void> {
  const productId = await ownerProductIdOfItem(testItemId)

  const { error } = await supabaseAdmin
    .from(T_ITEM)
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', testItemId)
  if (error) {
    if (isSchemaMissing(error)) throw schemaMissingError()
    throw error
  }

  // 하위 작업단계도 함께 내린다.
  await supabaseAdmin
    .from(T_STEP)
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('test_item_id', testItemId)
    .is('deleted_at', null)

  if (productId) {
    await resequence(T_ITEM, 'product_workload_id', productId)
    await recalcProduct(productId)
  }
}

// ─── 작업단계 CRUD ───────────────────────────────────────────────────────────

export interface StepInput {
  stepCode?: string | null
  stepName: string
  sequence?: number
  workloadType: WorkloadType
  durationMinutes: number
  equipmentTypeId?: string | null
  equipmentTypeName?: string | null
  requiredSkill?: string | null
  parallelAllowed?: boolean
  predecessorStepId?: string | null
  memo?: string | null
}

/** 작업단계 입력 정합성 검증 (§33) */
function validateStep(input: Partial<StepInput>): void {
  if (input.stepName !== undefined && !input.stepName.trim()) {
    throw new Error('작업단계명은 필수입니다.')
  }
  if (input.durationMinutes !== undefined && (!Number.isFinite(input.durationMinutes) || input.durationMinutes < 0)) {
    throw new Error('소요시간은 0분 이상이어야 합니다.')
  }
  if (input.workloadType === 'EQUIPMENT') {
    const hasEquipment = !!input.equipmentTypeId?.trim() || !!input.equipmentTypeName?.trim()
    if (!hasEquipment) throw new Error('기기공수는 기기 종류를 선택해야 합니다.')
  }
}

/** WAITING/REVIEW 는 기기 정보를 저장하지 않는다. */
function normalizeEquipment(type: WorkloadType | undefined, input: Partial<StepInput>) {
  if (type === 'EQUIPMENT') {
    return {
      equipment_type_id: input.equipmentTypeId?.trim() || null,
      equipment_type_name: input.equipmentTypeName?.trim() || null,
    }
  }
  return { equipment_type_id: null, equipment_type_name: null }
}

export async function createStep(testItemId: string, input: StepInput): Promise<TestWorkStep> {
  validateStep(input)

  const sequence = input.sequence ?? (await nextSequence(T_STEP, 'test_item_id', testItemId))

  const { data, error } = await supabaseAdmin
    .from(T_STEP)
    .insert({
      test_item_id: testItemId,
      step_code: input.stepCode?.trim() || null,
      step_name: input.stepName.trim(),
      sequence,
      workload_type: input.workloadType,
      duration_minutes: Math.round(input.durationMinutes),
      ...normalizeEquipment(input.workloadType, input),
      required_skill: input.requiredSkill?.trim() || null,
      parallel_allowed: input.parallelAllowed ?? false,
      predecessor_step_id: input.predecessorStepId || null,
      memo: input.memo?.trim() || null,
    })
    .select('*')
    .single()

  if (error) {
    if (isSchemaMissing(error)) throw schemaMissingError()
    throw error
  }

  await resequence(T_STEP, 'test_item_id', testItemId)
  const productId = await ownerProductIdOfItem(testItemId)
  if (productId) await recalcProduct(productId)

  return mapStep(data as Row)
}

export async function updateStep(stepId: string, input: Partial<StepInput>): Promise<void> {
  // 기기 정보 정규화를 위해 변경 후의 공수구분을 먼저 확정한다.
  const { data: cur, error: curErr } = await supabaseAdmin
    .from(T_STEP).select('test_item_id, workload_type, equipment_type_id, equipment_type_name')
    .eq('id', stepId).maybeSingle()
  if (curErr) {
    if (isSchemaMissing(curErr)) throw schemaMissingError()
    throw curErr
  }
  if (!cur) throw new Error('작업단계를 찾을 수 없습니다.')

  const curRow = cur as Row
  const nextType = (input.workloadType ?? curRow.workload_type) as WorkloadType
  const merged: Partial<StepInput> = {
    ...input,
    workloadType: nextType,
    equipmentTypeId: input.equipmentTypeId !== undefined ? input.equipmentTypeId : str(curRow.equipment_type_id),
    equipmentTypeName:
      input.equipmentTypeName !== undefined ? input.equipmentTypeName : str(curRow.equipment_type_name),
  }
  validateStep(merged)

  const dbPatch: Row = { updated_at: new Date().toISOString() }
  if (input.stepCode !== undefined) dbPatch.step_code = input.stepCode?.trim() || null
  if (input.stepName !== undefined) dbPatch.step_name = input.stepName.trim()
  if (input.sequence !== undefined) dbPatch.sequence = input.sequence
  if (input.workloadType !== undefined) dbPatch.workload_type = input.workloadType
  if (input.durationMinutes !== undefined) dbPatch.duration_minutes = Math.round(input.durationMinutes)
  if (input.requiredSkill !== undefined) dbPatch.required_skill = input.requiredSkill?.trim() || null
  if (input.parallelAllowed !== undefined) dbPatch.parallel_allowed = input.parallelAllowed
  if (input.predecessorStepId !== undefined) dbPatch.predecessor_step_id = input.predecessorStepId || null
  if (input.memo !== undefined) dbPatch.memo = input.memo?.trim() || null
  Object.assign(dbPatch, normalizeEquipment(nextType, merged))

  const { error } = await supabaseAdmin.from(T_STEP).update(dbPatch).eq('id', stepId)
  if (error) {
    if (isSchemaMissing(error)) throw schemaMissingError()
    throw error
  }

  const testItemId = String(curRow.test_item_id)
  if (input.sequence !== undefined) await resequence(T_STEP, 'test_item_id', testItemId)
  const productId = await ownerProductIdOfItem(testItemId)
  if (productId) await recalcProduct(productId)
}

export async function deleteStep(stepId: string): Promise<void> {
  const { data: cur, error: curErr } = await supabaseAdmin
    .from(T_STEP).select('test_item_id').eq('id', stepId).maybeSingle()
  if (curErr) {
    if (isSchemaMissing(curErr)) throw schemaMissingError()
    throw curErr
  }
  if (!cur) return

  const testItemId = String((cur as Row).test_item_id)

  const { error } = await supabaseAdmin
    .from(T_STEP)
    .update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', stepId)
  if (error) throw error

  // 이 단계를 선행으로 참조하던 단계의 연결을 끊는다.
  await supabaseAdmin.from(T_STEP).update({ predecessor_step_id: null }).eq('predecessor_step_id', stepId)

  await resequence(T_STEP, 'test_item_id', testItemId)
  const productId = await ownerProductIdOfItem(testItemId)
  if (productId) await recalcProduct(productId)
}

// ─── 순서 관리 ───────────────────────────────────────────────────────────────

async function nextSequence(table: string, fkColumn: string, fkValue: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from(table).select('sequence').eq(fkColumn, fkValue).is('deleted_at', null)
    .order('sequence', { ascending: false }).limit(1)
  if (error) {
    if (isSchemaMissing(error)) throw schemaMissingError()
    throw error
  }
  const rows = (data ?? []) as Row[]
  return rows.length > 0 ? num(rows[0].sequence) + 1 : 1
}

/**
 * sequence 중복·구멍을 1..N 으로 자동 재정렬한다(§33).
 * 같은 sequence 가 겹치면 방금 지정한 쪽(updated_at 이 최신)을 앞에 둔다 —
 * 사용자가 "이 자리로 옮긴다"고 입력한 의도를 그대로 반영하기 위함이다.
 */
async function resequence(table: string, fkColumn: string, fkValue: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from(table).select('id, sequence, updated_at').eq(fkColumn, fkValue).is('deleted_at', null)
    .order('sequence', { ascending: true }).order('updated_at', { ascending: false })
  if (error) throw error

  const rows = (data ?? []) as Row[]
  const updates = rows
    .map((r, idx) => ({ id: String(r.id), seq: idx + 1, cur: num(r.sequence) }))
    .filter(u => u.seq !== u.cur)

  if (updates.length === 0) return
  await Promise.all(updates.map(u => supabaseAdmin.from(table).update({ sequence: u.seq }).eq('id', u.id)))
}

// ─── 공수 복사 ───────────────────────────────────────────────────────────────

/**
 * 기준 품목의 시험항목·작업단계를 대상 품목으로 복사한다.
 * 선행 작업(predecessor)은 복사된 새 ID 로 다시 연결한다.
 */
export async function copyWorkloadStructure(sourceProductId: string, targetProductId: string): Promise<void> {
  const { itemsByProduct } = await loadItemsWithSteps([sourceProductId])
  const items = itemsByProduct.get(sourceProductId) ?? []
  if (items.length === 0) return

  for (const item of items) {
    const created = await createTestItem(targetProductId, {
      testCode: item.testCode,
      testName: item.testName,
      sequence: item.sequence,
      parallelAllowed: item.parallelAllowed,
      simultaneousAnalysisAllowed: item.simultaneousAnalysisAllowed,
      simultaneousMaxCount: item.simultaneousMaxCount,
      simultaneousAdditionalHumanMinutes: item.simultaneousAdditionalHumanMinutes,
      simultaneousAdditionalEquipmentMinutes: item.simultaneousAdditionalEquipmentMinutes,
      requiredSkill: item.requiredSkill,
      difficulty: item.difficulty,
      memo: item.memo,
    })

    const idMap = new Map<string, string>()
    for (const step of item.steps) {
      const newStep = await createStep(created.id, {
        stepCode: step.stepCode,
        stepName: step.stepName,
        sequence: step.sequence,
        workloadType: step.workloadType,
        durationMinutes: step.durationMinutes,
        equipmentTypeId: step.equipmentTypeId,
        equipmentTypeName: step.equipmentTypeName,
        requiredSkill: step.requiredSkill,
        parallelAllowed: step.parallelAllowed,
        memo: step.memo,
      })
      idMap.set(step.id, newStep.id)
    }

    // 선행관계 재연결 (원본 ID → 복사본 ID)
    for (const step of item.steps) {
      if (!step.predecessorStepId) continue
      const newId = idMap.get(step.id)
      const newPredecessor = idMap.get(step.predecessorStepId)
      if (!newId || !newPredecessor) continue
      await supabaseAdmin.from(T_STEP).update({ predecessor_step_id: newPredecessor }).eq('id', newId)
    }
  }

  await recalcProduct(targetProductId)
}

// ─── 표준 vs 실제 ────────────────────────────────────────────────────────────

export interface ActualSummary {
  /** 실적 데이터가 하나도 없으면 false — UI 는 "실적 데이터 없음"으로 처리한다. */
  hasData: boolean
  from: string
  rows: WorkloadVarianceRow[]
}

/**
 * 최근 N개월 실적과 표준공수를 비교한다.
 * 아직 실측 데이터를 수집하지 않으므로 대부분 hasData:false 로 응답한다.
 */
export async function getActualSummary(input: {
  months: number
  productId?: string | null
}): Promise<ActualSummary> {
  const from = new Date()
  from.setMonth(from.getMonth() - input.months)
  const fromIso = from.toISOString()

  let query = supabaseAdmin
    .from(T_ACTUAL)
    .select('*')
    .gte('recorded_at', fromIso)
    .limit(5000)
  if (input.productId) query = query.eq('product_workload_id', input.productId)

  const { data, error } = await query
  if (error) {
    if (isSchemaMissing(error)) return { hasData: false, from: fromIso.slice(0, 10), rows: [] }
    throw error
  }

  const actuals = ((data ?? []) as Row[]).map(mapActual)
  if (actuals.length === 0) return { hasData: false, from: fromIso.slice(0, 10), rows: [] }

  // 시험항목 단위로 집계 (항목명은 별도 조회)
  const itemIds = [...new Set(actuals.map(a => a.testItemId).filter((v): v is string => !!v))]
  const nameById = new Map<string, string>()
  if (itemIds.length > 0) {
    const { data: itemRows } = await supabaseAdmin.from(T_ITEM).select('id, test_name').in('id', itemIds)
    for (const r of (itemRows ?? []) as Row[]) nameById.set(String(r.id), String(r.test_name))
  }

  const grouped = new Map<string, { standard: number; actual: number; count: number }>()
  for (const a of actuals) {
    const key = a.testItemId ?? a.workStepId ?? 'unknown'
    const g = grouped.get(key) ?? { standard: 0, actual: 0, count: 0 }
    g.standard += a.standardMinutes
    g.actual += a.actualMinutes
    g.count += 1
    grouped.set(key, g)
  }

  const rows: WorkloadVarianceRow[] = [...grouped.entries()].map(([key, g]) => {
    const standard = g.count > 0 ? g.standard / g.count : 0
    const actualAvg = g.count > 0 ? g.actual / g.count : 0
    return {
      key,
      label: nameById.get(key) ?? '미지정',
      sampleCount: g.count,
      standardMinutes: Math.round(standard),
      actualAvgMinutes: Math.round(actualAvg),
      varianceMinutes: Math.round(actualAvg - standard),
      varianceRate: standard > 0 ? Number((((actualAvg - standard) / standard) * 100).toFixed(1)) : null,
    }
  })

  rows.sort((a, b) => Math.abs(b.varianceRate ?? 0) - Math.abs(a.varianceRate ?? 0))
  return { hasData: true, from: fromIso.slice(0, 10), rows }
}

// ─── 내부 헬퍼 ───────────────────────────────────────────────────────────────

async function ownerProductIdOfItem(testItemId: string): Promise<string | null> {
  const { data, error } = await supabaseAdmin
    .from(T_ITEM).select('product_workload_id').eq('id', testItemId).maybeSingle()
  if (error) {
    if (isSchemaMissing(error)) return null
    throw error
  }
  return str((data as Row | null)?.product_workload_id)
}
