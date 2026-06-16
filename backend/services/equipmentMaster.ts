/**
 * [BACKEND] 장비 마스터 (equipment_master)
 *
 * - 장비 등록/수정/삭제/목록 CRUD
 * - checkEquipmentReadiness: 작업 시작일 기준 장비 가용성·검교정 상태 종합 판정
 *
 * ⚠️ 방어적 설계:
 *   equipment_master 테이블이 아직 생성되지 않은 경우(42P01 등) 쿼리 오류 발생 가능.
 *   checkEquipmentReadiness 는 테이블/레코드 부재 시 found:false + ok:true(통과) 로 폴백.
 *   다른 CRUD 함수들도 테이블 부재 에러 시 빈 결과로 폴백한다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'

// ─── Types ──────────────────────────────────────────────────────────────────

export type EquipmentStatus = 'active' | 'calibrating' | 'out_of_service'

export interface EquipmentMasterRow {
  id: string
  code: string
  name: string
  category: string | null
  status: EquipmentStatus
  calibrationDate: string | null
  calibrationDueDate: string | null
  location: string | null
  note: string | null
  createdAt: string
  updatedAt: string | null
}

export interface EquipmentCheck {
  code: string
  name: string | null
  found: boolean                  // 마스터 등록 여부
  status: EquipmentStatus | null
  calibrationOk: boolean          // due_date >= date (또는 미등록=true)
  calibrationDueDate: string | null
  available: boolean              // 해당 날짜 RESERVED 충돌 없음
  blocked: boolean                // 하드 차단: 검교정 만료 OR status==='out_of_service'
  warning: string | null          // 소프트 경고: 미등록 / 검교정일정 미등록 / 검교정 중 / 가용성 충돌
  reason: string | null           // blocked 사유 설명
}

export interface ReadinessResult {
  ok: boolean
  checks: EquipmentCheck[]
}

// ─── DB row → 앱 row 매핑 ───────────────────────────────────────────────────

function mapRow(r: Record<string, unknown>): EquipmentMasterRow {
  return {
    id:                 r.id as string,
    code:               r.code as string,
    name:               r.name as string,
    category:           (r.category as string) ?? null,
    status:             (r.status as EquipmentStatus) ?? 'active',
    calibrationDate:    (r.calibration_date as string) ?? null,
    calibrationDueDate: (r.calibration_due_date as string) ?? null,
    location:           (r.location as string) ?? null,
    note:               (r.note as string) ?? null,
    createdAt:          r.created_at as string,
    updatedAt:          (r.updated_at as string) ?? null,
  }
}

/** 테이블 부재(42P01) 등 무해한 오류 여부 판단 */
function isTableMissingError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = (err as Record<string, unknown>).code
  return code === '42P01' || code === 'PGRST116'
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

/** 전체 장비 목록 (code 오름차순) */
export async function listEquipment(): Promise<EquipmentMasterRow[]> {
  const { data, error } = await supabaseAdmin
    .from('equipment_master')
    .select('*')
    .order('code', { ascending: true })

  if (error) {
    if (isTableMissingError(error)) return []
    throw error
  }
  return (data ?? []).map(r => mapRow(r as Record<string, unknown>))
}

/** 단일 장비 조회 */
export async function getEquipment(id: string): Promise<EquipmentMasterRow | null> {
  const { data, error } = await supabaseAdmin
    .from('equipment_master')
    .select('*')
    .eq('id', id)
    .single()

  if (error) {
    if (isTableMissingError(error)) return null
    // PGRST116 = no rows found
    if ((error as unknown as Record<string, unknown>).code === 'PGRST116') return null
    throw error
  }
  return data ? mapRow(data as Record<string, unknown>) : null
}

/** 장비 등록 */
export async function createEquipment(
  input: Partial<EquipmentMasterRow> & { code: string; name: string }
): Promise<EquipmentMasterRow> {
  const { data, error } = await supabaseAdmin
    .from('equipment_master')
    .insert({
      code:                 input.code,
      name:                 input.name,
      category:             input.category ?? null,
      status:               input.status ?? 'active',
      calibration_date:     input.calibrationDate ?? null,
      calibration_due_date: input.calibrationDueDate ?? null,
      location:             input.location ?? null,
      note:                 input.note ?? null,
    })
    .select('*')
    .single()

  if (error) throw error
  return mapRow(data as Record<string, unknown>)
}

/** 장비 수정 */
export async function updateEquipment(
  id: string,
  patch: Partial<EquipmentMasterRow>
): Promise<void> {
  const dbPatch: Record<string, unknown> = { updated_at: new Date().toISOString() }
  if (patch.code               !== undefined) dbPatch.code                 = patch.code
  if (patch.name               !== undefined) dbPatch.name                 = patch.name
  if (patch.category           !== undefined) dbPatch.category             = patch.category
  if (patch.status             !== undefined) dbPatch.status               = patch.status
  if (patch.calibrationDate    !== undefined) dbPatch.calibration_date     = patch.calibrationDate
  if (patch.calibrationDueDate !== undefined) dbPatch.calibration_due_date = patch.calibrationDueDate
  if (patch.location           !== undefined) dbPatch.location             = patch.location
  if (patch.note               !== undefined) dbPatch.note                 = patch.note

  const { error } = await supabaseAdmin
    .from('equipment_master')
    .update(dbPatch)
    .eq('id', id)

  if (error) throw error
}

/** 장비 삭제 */
export async function deleteEquipment(id: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('equipment_master')
    .delete()
    .eq('id', id)

  if (error) throw error
}

// ─── 가용성 판정 ─────────────────────────────────────────────────────────────

/**
 * 작업 시작일(date) 기준 장비 코드 목록의 가용성·검교정 상태를 종합 판정한다.
 *
 * - 테이블 부재 / 오류 → 전체 found:false, ok:true 로 폴백 (작업 차단 없음).
 * - 개별 장비 미등록 → found:false, blocked:false, warning:'장비 마스터 미등록'.
 * - 검교정 만료 / out_of_service → blocked:true (하드 차단).
 * - 검교정 일정 미등록 / calibrating / 예약 점유 → warning (소프트 경고).
 */
export async function checkEquipmentReadiness(input: {
  equipmentCodes: string[]
  date: string
}): Promise<ReadinessResult> {
  const { equipmentCodes, date } = input

  // 빈 목록 → 즉시 통과
  if (!equipmentCodes || equipmentCodes.length === 0) {
    return { ok: true, checks: [] }
  }

  // 코드 정규화: 소문자, 공백·특수문자 제거
  const normalize = (s: string) => s.toLowerCase().replace(/[\s_\-/().]+/g, '')

  try {
    // 1) equipment_master 에서 코드 목록 일괄 조회 (ilike 를 쓰면 인덱스 비효율 → 전체 조회 후 정규화 비교)
    const { data: masterRows, error: masterErr } = await supabaseAdmin
      .from('equipment_master')
      .select('*')

    if (masterErr) {
      // 테이블 부재 등 → 모두 found:false, 통과
      return buildFallback(equipmentCodes)
    }

    const masterList = (masterRows ?? []).map(r => mapRow(r as Record<string, unknown>))

    // 2) 해당 날짜에 RESERVED 상태인 예약 조회
    const { data: reservRows, error: reservErr } = await supabaseAdmin
      .from('equipment_reservation')
      .select('equipment_id')
      .eq('status', 'RESERVED')
      .lte('start_date', date)
      .gte('end_date', date)

    // 예약 테이블 오류는 무시(가용성 경고만 건너뜀)
    const reservedCodes = new Set<string>(
      reservErr
        ? []
        : (reservRows ?? []).map(r => (r as Record<string, unknown>).equipment_id as string)
    )

    // 3) 각 요청 코드 판정
    const checks: EquipmentCheck[] = equipmentCodes.map(code => {
      const normCode = normalize(code)

      // 마스터에서 정확 일치 우선, 없으면 정규화 비교
      const master =
        masterList.find(m => m.code === code) ??
        masterList.find(m => normalize(m.code) === normCode)

      if (!master) {
        return {
          code,
          name: null,
          found: false,
          status: null,
          calibrationOk: true,
          calibrationDueDate: null,
          available: true,
          blocked: false,
          warning: '장비 마스터 미등록',
          reason: null,
        } satisfies EquipmentCheck
      }

      // 검교정 만료 판정
      let calibrationOk = true
      let calibrationBlockReason: string | null = null
      let calibrationWarning: string | null = null

      if (master.calibrationDueDate) {
        if (master.calibrationDueDate < date) {
          calibrationOk = false
          calibrationBlockReason = `검교정 만료(차기 예정 ${master.calibrationDueDate})`
        }
      } else {
        calibrationWarning = '검교정 일정 미등록'
      }

      // 상태 판정
      let statusBlocked = false
      let statusBlockReason: string | null = null
      let statusWarning: string | null = null

      if (master.status === 'out_of_service') {
        statusBlocked = true
        statusBlockReason = '사용 불가(out_of_service)'
      } else if (master.status === 'calibrating') {
        statusWarning = '검교정 중'
      }

      // 가용성 판정 (soft warning)
      // equipment_reservation의 equipment_id는 자유 텍스트 → 정규화 비교
      const available = ![...reservedCodes].some(
        rid => rid === master.code || normalize(rid) === normalize(master.code)
      )
      const availWarning = available ? null : '해당 일자 예약 점유'

      // 경고 병합
      const warnings = [calibrationWarning, statusWarning, availWarning].filter(Boolean)
      const warning = warnings.length > 0 ? warnings.join(' / ') : null

      // 차단 판정
      const blocked = !calibrationOk || statusBlocked
      const reason = [calibrationBlockReason, statusBlockReason].filter(Boolean).join(' / ') || null

      return {
        code,
        name: master.name,
        found: true,
        status: master.status,
        calibrationOk,
        calibrationDueDate: master.calibrationDueDate,
        available,
        blocked,
        warning,
        reason,
      } satisfies EquipmentCheck
    })

    const ok = !checks.some(c => c.blocked)
    return { ok, checks }
  } catch {
    // 예상치 못한 오류 → 전체 통과 폴백
    return buildFallback(equipmentCodes)
  }
}

/** 폴백: 모든 장비를 found:false, blocked:false 로 반환 (작업 차단 없음) */
function buildFallback(codes: string[]): ReadinessResult {
  return {
    ok: true,
    checks: codes.map(code => ({
      code,
      name: null,
      found: false,
      status: null,
      calibrationOk: true,
      calibrationDueDate: null,
      available: true,
      blocked: false,
      warning: '장비 마스터 미등록',
      reason: null,
    })),
  }
}
