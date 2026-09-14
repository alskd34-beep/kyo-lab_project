/**
 * [BACKEND] PCT 구글시트 적재 서비스
 *
 * 흐름: 시트 fetch → 자연키(batch_no|product_code)로 기존 pct_orders와 diff
 *   - 신규(new) insert / 변경(updated) update+사유없는 시스템변경 / 사라짐(deleted) soft-delete
 *   - 각 변경 pct_ingest_log 기록
 *   - 품목마스터(products)에 product_code 없으면 자동등록 + product_synced=false + 알림
 *   - 완료예정일 D-7 임박 미완료 건 알림
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { selectAll } from '@backend/lib/supabasePage'
import { kstToday, kstDateAfter } from '@backend/lib/kstDate'
import { fetchPctSheet, type SheetPctRow } from '@backend/lib/googleSheet'
import { createNotification } from '@backend/services/notifications'
import { rebuildGroups } from '@backend/services/concurrentGroups'
import {
  assigneesOfOrderForWrite, setOrderAssignees, setOrderPrimaryAssignee,
} from '@backend/services/orderAssignees'
import { PRIMARY_ASSIGNEE_SLOT, assigneeSlotLabel } from '@shared/assignment'
import { logReassignment } from '@backend/services/reassignmentHistory'
import { syncOrderStatusFromJobs } from '@backend/services/qcJobs'
import {
  CLOSED_STAGE,
  DELETED_STATUS,
  LOCKED_STATUSES,
  PENDING_STATUS,
} from '@shared/qc-status'

// 기존 PCT 화면이 쓰던 기본 시트 ID (폴백)
const DEFAULT_FILE_ID = '1H9_lR-_tpEHKSpVD2qLbxX5cqXRG_s5rpbGs-gqSPxU'

export interface IngestResult {
  fileId: string
  total: number
  created: number
  updated: number
  blocked: number      // 작업 진행/LOCK 상태로 변경 차단된 건수
  deleted: number
  /** 소프트 삭제됐던 오더가 시트에 재등장해 되살아난 건수(배정·확정은 초기화됨) */
  restored: number
  unsynced: number
  /** 시트에 품목코드가 없어 품목명으로 만들어 넣은 건수 (제조팀이 코드를 채워야 한다) */
  codeGenerated: number
  /** 오더로 만들지 못하고 건너뛴 시트 행 — 조용히 사라지지 않게 사유와 함께 남긴다 */
  skippedRows: Array<{ reason: string; productName: string; batchNo: string }>
  deadlineAlerts: number
  /**
   * 처리에 실패한 건. 예전에는 insert/update 실패를 `if (!error)` 로 전부 삼켜
   * 크론 로그와 요약 알림이 "성공한 것만" 보고했다. 의약품 제조 시스템에서
   * 적재 누락이 무증상으로 발생하면 사후 추적이 불가능하다.
   */
  failures: Array<{ orderKey: string; stage: 'product' | 'new' | 'blocked' | 'updated' | 'deleted' | 'restored'; message: string }>
}

/**
 * pct_orders 전체를 1000행 단위로 끝까지 모아 온다(기본 limit 우회).
 *
 * ⚠️ '삭제' 상태도 반드시 포함해야 한다 — 자연키 unique(batch_no, product_code) 는
 * 삭제된 행도 여전히 점유한다. 삭제 행을 여기서 안 읽으면, 그 자연키가 시트에 다시
 * 나타났을 때 existingByKey 에 없으니 "신규"로 오판해 insert 하고, DB 는 unique 위반
 * (23505) 으로 거절한다 — 그 오더는 이후 회차에서도 계속 이 실패를 반복해 영원히
 * 다시 살아나지 못한다.
 */
async function selectAllRange(
  client: typeof supabaseAdmin, table: string,
): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }> {
  const PAGE = 1000
  const all: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    const res = await client.from(table).select('*').range(from, from + PAGE - 1)
    if (res.error) return { data: null, error: res.error }
    const rows = (res.data ?? []) as Record<string, unknown>[]
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return { data: all, error: null }
}

const keyOf = (batchNo: string, code: string) => `${batchNo}|${code}`

/**
 * 변경 차단 대상 상태.
 * 작업이 이미 진행/완료되었거나 LOCK 된 오더는 생산계획(시트) 변경을 자동 반영하지 않는다.
 * (영문 상태 전환 후 LOCKED/IN_PROGRESS/REVIEW/COMPLETED 등을 추가)
 */
const isLockedStatus = (status: string) => LOCKED_STATUSES.has(status)

/** 변경 차단 시 before/after 비교 대상 필드 (라벨, 기존값, 신규값) */
const CHANGE_FIELDS: Array<{
  label: string
  oldVal: (e: ExistingOrder) => string
  newVal: (r: SheetPctRow) => string
  /** 0039 적용 전에는 비교하면 안 되는 필드 — 아래 needsValidationColumn 주석 참고 */
  needsValidationColumn?: boolean
}> = [
  { label: '품목명',     oldVal: e => e.product_name,            newVal: r => r.productName },
  { label: '제형',       oldVal: e => e.dosage_form ?? '',       newVal: r => r.dosageForm },
  { label: '포장완료일', oldVal: e => e.packaging_date ?? '',    newVal: r => r.packagingDate ?? '' },
  { label: '완료예정일', oldVal: e => e.due_date ?? '',          newVal: r => r.dueDate ?? '' },
  { label: '긴급',       oldVal: e => String(e.is_urgent),       newVal: r => String(r.isUrgent) },
  { label: '진행방법',   oldVal: e => e.method,                  newVal: r => r.method },
  { label: '비고',       oldVal: e => e.note ?? '',              newVal: r => r.note },
  // 0039 미적용 환경에서는 e.validation_type 이 undefined → '' 가 되어 시트 값과 항상
  // 달라진다. 가드 없이 두면 "구분: → 일반" 이라는 가짜 변경이 pct_order_edits 에 쌓이고
  // 차단 알림 본문에도 섞인다(diffChanged 는 이미 같은 이유로 가드하고 있다).
  { label: '구분', oldVal: e => e.validation_type ?? '', newVal: r => r.validationType ?? '', needsValidationColumn: true },
]

/** 시트 ID 해석: app_settings > env > 기본값 */
export async function resolveSheetFileId(): Promise<string> {
  const { data } = await supabaseAdmin
    .from('app_settings')
    .select('value')
    .eq('key', 'pct_sheet_file_id')
    .maybeSingle()
  return (data?.value as string) || process.env.GOOGLE_SHEETS_PCT_FILE_ID || DEFAULT_FILE_ID
}

// 변경 감지 대상 (수정가능 필드)
const MUTABLE: Array<keyof SheetPctRow> = [
  'productName', 'dosageForm', 'packagingDate', 'dueDate', 'isUrgent', 'method', 'note',
]

interface ExistingOrder {
  id: string
  product_code: string
  batch_no: string
  product_name: string
  dosage_form: string | null
  packaging_date: string | null
  due_date: string | null
  is_urgent: boolean
  method: string
  note: string | null
  status: string
  ingest_state: string | null
  assignee_tester_id: string | null
  /** 0015 미적용 환경에서는 이 키 자체가 없다(undefined) — hasLockedColumn 참고 */
  locked?: boolean
  /** 0039 미적용 환경에서는 이 키 자체가 없다(undefined) — hasValidationColumn 참고 */
  validation_type?: string | null
}

function diffChanged(existing: ExistingOrder, row: SheetPctRow, hasValidationColumn: boolean): boolean {
  return (
    existing.product_name !== row.productName ||
    (existing.dosage_form ?? '') !== row.dosageForm ||
    (existing.packaging_date ?? null) !== row.packagingDate ||
    (existing.due_date ?? null) !== row.dueDate ||
    existing.is_urgent !== row.isUrgent ||
    existing.method !== row.method ||
    (existing.note ?? '') !== row.note ||
    // 0039 미적용 환경에서는 비교 자체를 하지 않는다 — 컬럼이 없으면 항상 undefined 라
    // 시트에 값이 있는 모든 행이 매번 "변경됨"으로 잡혀 적재 로그가 오염된다.
    (hasValidationColumn && (existing.validation_type ?? null) !== row.validationType)
  )
}

/** 적재 실행 (크론/수동 트리거 공용) */
export async function ingestPctSheet(fileIdOverride?: string): Promise<IngestResult> {
  const fileId = fileIdOverride || (await resolveSheetFileId())
  const { rows: sheetRows, skipped: skippedRows } = await fetchPctSheet(fileId)
  void MUTABLE // 문서용(diff는 diffChanged에서 명시 비교)

  // ── 기존 오더 로드 (전체 — '삭제' 포함) ─────────────────────────────────────
  // Supabase 기본 1000행 상한을 넘기지 않도록 페이지네이션한다. selectAllRange 의
  // 상단 주석 참고: '삭제' 상태를 제외하고 읽으면 자연키가 재등장했을 때 신규로
  // 오판돼 unique(batch_no, product_code) 위반(23505)으로 죽는다.
  const { data: existingRows, error: exErr } =
    await selectAllRange(supabaseAdmin, 'pct_orders')
  if (exErr) throw new Error(`기존 오더 조회 실패: ${exErr.message}`)

  // 자연키는 전체에서 유일하므로 두 맵의 키는 절대 겹치지 않는다 — 상태로만 나눈다.
  //   existingByKey : 변경감지·변경없음갱신·삭제감지 3개 루프가 쓰는, 지금까지의 "기존 오더" 그 집합(의미 불변)
  //   deletedByKey  : 복구 판정 전용. 여기 섞으면 삭제 감지 루프가 이미 삭제된 건을 매 회차 다시 훑는다.
  const existingByKey = new Map<string, ExistingOrder>()
  const deletedByKey = new Map<string, ExistingOrder>()
  for (const r of existingRows ?? []) {
    const row = r as unknown as ExistingOrder
    const key = keyOf(row.batch_no, row.product_code)
    if (row.status === DELETED_STATUS) deletedByKey.set(key, row)
    else existingByKey.set(key, row)
  }

  // 0039(validation_type) 적용 여부. 적재는 크론이라, 컬럼이 없는데 insert/update 에
  // 넣으면 PGRST204 로 **적재 전체가 죽는다**. 마이그레이션 적용 순서에 배포가 매이지
  // 않도록 실제 행에서 컬럼 존재를 확인하고 넣을지 정한다(pctOrders 의 locked 와 같은 방식).
  // 행이 하나도 없으면 판정할 수 없으므로 넣지 않는다 — 다음 적재부터 자연히 켜진다.
  const firstRow = (existingRows ?? [])[0]
  const hasValidationColumn = firstRow != null && 'validation_type' in firstRow
  const withValidation = <T extends Record<string, unknown>>(patch: T, value: string | null) =>
    (hasValidationColumn ? { ...patch, validation_type: value } : patch)

  // locked/locked_by/locked_at(0015) 적용 여부. hasValidationColumn 과 동일한 이유로
  // 가드한다 — 없는 컬럼을 patch 에 넣으면 PGRST204 로 적재 전체가 죽는다.
  const hasLockedColumn = firstRow != null && 'locked' in firstRow
  const withLocked = <T extends Record<string, unknown>>(patch: T, lock: boolean) =>
    (hasLockedColumn ? { ...patch, locked: lock, locked_by: null, locked_at: null } : patch)

  // ── 품목마스터 코드 집합 ───────────────────────────────────────────────────
  // 품목이 1000개를 넘으면 기본 limit 에 잘려 "미동기화" 오탐이 난다 → selectAll
  const { data: prodRows, error: prodErr } = await selectAll(supabaseAdmin, 'products', 'product_code')
  if (prodErr) throw new Error(`품목마스터 조회 실패: ${prodErr.message}`)
  const productCodes = new Set((prodRows ?? []).map(p => String(p.product_code)))

  const result: IngestResult = {
    fileId, total: sheetRows.length, created: 0, updated: 0, blocked: 0, deleted: 0, restored: 0, unsynced: 0,
    codeGenerated: 0, skippedRows, deadlineAlerts: 0,
    failures: [],
  }
  const fail = (orderKey: string, stage: IngestResult['failures'][number]['stage'], message: string) => {
    console.error(`[pct-ingest] ${stage} 실패 (${orderKey}): ${message}`)
    result.failures.push({ orderKey, stage, message })
  }
  const seen = new Set<string>()
  const nowIso = new Date().toISOString()
  // 복구 성공한 오더 키 — 요약 알림에 앞 5건만 나열한다(오더별 알림은 만들지 않는다).
  const restoredKeys: string[] = []

  /**
   * 소프트 삭제됐던 오더가 자연키로 시트에 재등장 — 복구한다.
   * 단계 사이에는 트랜잭션이 없으므로 순서가 중요하다: **실패해도 덜 나쁜 쪽부터** 진행한다.
   *
   * 담당자 비우기(병렬 담당자 → 대표)는 오더 UPDATE(상태 '대기' 복구)보다 **먼저** 한다.
   * 담당자 구성·미러·구 컬럼·항목 슬롯 되돌림·감사는 각 단계가 DB 함수(0049) 한 트랜잭션이라
   * 서로 어긋나지 않는다. 담당자 비우기가 실패하면 오더는 여전히 '삭제' 상태로 남아
   * 다음 적재 회차가 복구를 다시 시도한다(상태만 복구되고 옛 담당자가 남는 쪽보다 낫다).
   * LOCK 된 오더는 함수가 담당자 변경을 거절하므로, 복구가 어차피 풀 확정 표시를 먼저 푼다.
   */
  async function restoreOrder(existing: ExistingOrder, row: SheetPctRow, key: string, synced: boolean): Promise<boolean> {
    // 1) qc_jobs 존재 여부 — 정상 흐름에서는 삭제 대상이 '대기' 상태뿐이라 있을 수
    // 없지만, 수동 개입 등 이상 케이스를 방어한다.
    const { count: jobCount, error: jobErr } = await supabaseAdmin
      .from('qc_jobs')
      .select('id', { count: 'exact', head: true })
      .eq('order_id', existing.id)
    if (jobErr) {
      fail(key, 'restored', `qc_jobs 조회 실패: ${jobErr.message}`)
      return false
    }
    const hadJobs = (jobCount ?? 0) > 0

    if (hadJobs) {
      // ── 이상 케이스: 배정을 지우지 않는다 ────────────────────────────────
      // 이미 시작된 작업의 담당자를 잃게 되므로, 시트값만 갱신하고 상태는
      // syncOrderStatusFromJobs 에 위임한다.
      const { error } = await supabaseAdmin.from('pct_orders').update(withValidation({
        deleted_at: null,
        ingest_state: 'restored',
        last_seen_at: nowIso,
        source_file_id: fileId,
        note: row.note || null,
        product_synced: synced,
        product_name: row.productName,
        dosage_form: row.dosageForm || null,
        packaging_date: row.packagingDate,
        due_date: row.dueDate,
        is_urgent: row.isUrgent,
        method: row.method,
      }, row.validationType)).eq('id', existing.id)
      if (error) {
        fail(key, 'restored', `오더 복구(작업 존재) 실패: ${error.message}`)
        return false
      }
      try {
        await syncOrderStatusFromJobs(existing.id)
      } catch (err) {
        console.error(`[pct-ingest] 복구 후 상태 동기화 실패(복구 자체는 반영됨) (${key}):`, err)
      }
      await createNotification({
        type: 'status_changed',
        severity: 'warning',
        title: '삭제됐던 오더가 작업 이력과 함께 복구됨',
        body: `${row.productName} (${row.batchNo}) 는 삭제 상태였으나 이미 진행된 작업(qc_jobs)이 있어 배정을 유지한 채 복구했습니다. 상태를 확인하세요.`,
        relatedOrderId: existing.id,
      })
      return true
    }

    // ── 정상 케이스: 배정·확정 초기화 후 '대기'로 복구 ───────────────────────
    // ① 확정(LOCK) 해제 — 담당자 변경 함수는 LOCK 오더를 거절한다. 삭제 상태 오더라 해제해도 화면 영향이 없다.
    if (hasLockedColumn && existing.locked) {
      const { error: unlockErr } = await supabaseAdmin
        .from('pct_orders').update(withLocked({}, false)).eq('id', existing.id)
      if (unlockErr) {
        fail(key, 'restored', `확정 해제 실패: ${unlockErr.message}`)
        return false
      }
    }

    // ② 담당자 비우기 — 병렬 담당자(슬롯 2~5)를 먼저 빼고(항목은 슬롯 1 로 되돌림), 대표를 비운다.
    //    둘 다 DB 함수 한 트랜잭션(슬롯·미러·구 컬럼·감사). 비원자 폴백 없음.
    const RESTORE_REASON = '생산계획 시트 재등장으로 자동 복구 — 담당자·확정 초기화'
    let clearedSlots: Array<{ slot: number; testerId: string }> = []
    try {
      const slots = await assigneesOfOrderForWrite(existing.id)
      clearedSlots = slots
      const primary = slots.find(a => a.slot === PRIMARY_ASSIGNEE_SLOT)
      if (primary && slots.length > 1) {
        await setOrderAssignees(existing.id, [{ slot: PRIMARY_ASSIGNEE_SLOT, testerId: primary.testerId }], null, RESTORE_REASON)
      }
      if (primary || existing.assignee_tester_id) {
        await setOrderPrimaryAssignee(existing.id, null, null, RESTORE_REASON)
      }
    } catch (err) {
      fail(key, 'restored', `담당자 초기화 실패: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }

    // ③ 오더 복구 — 담당자 컬럼은 여기서 쓰지 않는다(위 DB 함수가 이미 비웠다).
    const { error } = await supabaseAdmin.from('pct_orders').update(withLocked(withValidation({
      status: PENDING_STATUS,
      deleted_at: null,
      ingest_state: 'restored',
      last_seen_at: nowIso,
      source_file_id: fileId,
      note: row.note || null,
      product_synced: synced,
      product_name: row.productName,
      dosage_form: row.dosageForm || null,
      packaging_date: row.packagingDate,
      due_date: row.dueDate,
      is_urgent: row.isUrgent,
      method: row.method,
    }, row.validationType), false)).eq('id', existing.id)
    if (error) {
      fail(key, 'restored', `오더 복구 실패: ${error.message}`)
      return false
    }

    // 이력 기록 — 실패해도 복구 자체는 되돌리지 않는다(console.error 만).
    const { error: editErr } = await supabaseAdmin.from('pct_order_edits').insert({
      order_id: existing.id,
      field: 'status',
      old_value: DELETED_STATUS,
      new_value: PENDING_STATUS,
      reason: '생산계획 시트 재등장으로 자동 복구 — 담당자·확정 초기화',
      edited_by: null,
    })
    if (editErr) {
      console.error(`[pct-ingest] 복구 이력(pct_order_edits) 기록 실패 — 복구 자체는 반영됨 (${key}):`, editErr.message)
    }
    // 비운 담당자마다(담당자 1~5) 재배정 이력 1건
    for (const { slot, testerId } of clearedSlots) {
      try {
        await logReassignment({
          orderId: existing.id,
          beforeUser: testerId,
          afterUser: null,
          reason: '적재 자동 복구 — 배정 초기화',
        })
      } catch (err) {
        console.error(`[pct-ingest] 재배정 이력 기록 실패(${assigneeSlotLabel(slot)}) — 복구 자체는 반영됨 (${key}):`, err)
      }
    }

    return true
  }

  for (const row of sheetRows) {
    const key = keyOf(row.batchNo, row.productCode)
    seen.add(key)
    if (row.codeGenerated) result.codeGenerated++

    // ── 품목마스터 동기화 ────────────────────────────────────────────────────
    let synced = productCodes.has(row.productCode)
    if (!synced) {
      const { error: insErr } = await supabaseAdmin.from('products').insert({
        product_code: row.productCode,
        name: row.productName,
        product_type: '완제품',
      })
      if (insErr) {
        fail(key, 'product', `품목마스터 자동등록 실패: ${insErr.message}`)
      } else {
        productCodes.add(row.productCode)
        result.unsynced++
        await createNotification({
          type: 'product_unsynced',
          title: '품목마스터 미등록 품목 자동 등록',
          body: `${row.productName} (${row.productCode}) 가 품목마스터에 없어 자동 등록했습니다. 상세정보를 보완해주세요.`,
          severity: 'warning',
        })
      }
      synced = false  // 자동 등록되었지만 정보 미보완 → 적재에 표기
    }

    const existing = existingByKey.get(key)
    // 기존(삭제 아님)에 없을 때만 삭제 맵을 본다 — 자연키가 전체 유니크라 둘 다에
    // 있을 수는 없지만, 순서를 명시해 의도를 남긴다.
    const deleted = existing ? undefined : deletedByKey.get(key)

    if (deleted) {
      // ── 복구 ────────────────────────────────────────────────────────────────
      // ⚠️ 반드시 diffChanged 분기보다 앞에 와야 한다. 뒤에 두면, 시트값이 삭제 당시와
      // 동일한 오더는 diffChanged=false 라 "변경 없음"으로 빠져 영원히 삭제 상태로 남는다.
      const ok = await restoreOrder(deleted, row, key, synced)
      if (ok) {
        result.restored++
        restoredKeys.push(key)
        await logIngest(key, 'restored', PENDING_STATUS, fileId)
      }
    } else if (!existing) {
      // ── 신규 ────────────────────────────────────────────────────────────────
      const { error } = await supabaseAdmin.from('pct_orders').insert(withValidation({
        product_code: row.productCode,
        product_name: row.productName,
        batch_no: row.batchNo,
        dosage_form: row.dosageForm || null,
        packaging_date: row.packagingDate,
        due_date: row.dueDate,
        is_urgent: row.isUrgent,
        method: row.method,
        product_synced: synced,
        ingest_state: 'new',
        source_file_id: fileId,
      }, row.validationType))
      if (error) {
        fail(key, 'new', `신규 오더 생성 실패: ${error.message}`)
      } else {
        result.created++
        await logIngest(key, 'new', PENDING_STATUS, fileId)
      }
    } else if (diffChanged(existing, row, hasValidationColumn) && (isLockedStatus(existing.status) || existing.locked)) {
      // ── 변경 차단 ──────────────────────────────────────────────────────────
      // 작업 진행 상태이거나 관리자 확정(LOCK)된 오더는 시트 변경을 자동 반영하지 않는다(일정·배정 보존).
      // before/after 를 pct_order_edits 에 기록하고 감독관 알림만 생성한다.
      const changes = CHANGE_FIELDS
        .filter(f => !f.needsValidationColumn || hasValidationColumn)
        .filter(f => f.oldVal(existing) !== f.newVal(row))
      for (const c of changes) {
        await supabaseAdmin.from('pct_order_edits').insert({
          order_id: existing.id,
          field: c.label,
          old_value: c.oldVal(existing),
          new_value: c.newVal(row),
          reason: '생산계획 변경 차단(작업 진행/LOCK 상태) — 자동 미반영',
        })
      }
      // 존재 추적용 last_seen_at 만 갱신, 실제 필드는 보존
      await supabaseAdmin.from('pct_orders').update({ last_seen_at: nowIso }).eq('id', existing.id)
      result.blocked++
      await logIngest(key, 'blocked', existing.status, fileId)
      const summary = changes.map(c => `${c.label}: ${c.oldVal(existing) || '-'} → ${c.newVal(row) || '-'}`).join(', ')
      await createNotification({
        type: 'status_changed',
        severity: 'warning',
        title: '생산계획 변경 차단',
        body: `${existing.product_name} (${row.batchNo}) 는 '${existing.status}' 상태로 시트 변경이 자동 반영되지 않았습니다. 변경내용: ${summary || '없음'}. 필요 시 수동 반영하세요.`,
        relatedOrderId: existing.id,
      })
    } else if (diffChanged(existing, row, hasValidationColumn)) {
      // ── 변경 ────────────────────────────────────────────────────────────────
      const { error } = await supabaseAdmin.from('pct_orders').update(withValidation({
        product_name: row.productName,
        dosage_form: row.dosageForm || null,
        packaging_date: row.packagingDate,
        due_date: row.dueDate,
        is_urgent: row.isUrgent,
        method: row.method,
        note: row.note || null,
        product_synced: synced,
        ingest_state: 'updated',
        last_seen_at: nowIso,
        source_file_id: fileId,
      }, row.validationType)).eq('id', existing.id)
      if (error) {
        fail(key, 'updated', `오더 변경 반영 실패: ${error.message}`)
      } else {
        result.updated++
        await logIngest(key, 'updated', existing.status, fileId)
      }
    } else {
      // 변경 없음 — last_seen_at 갱신만
      await supabaseAdmin.from('pct_orders').update({ last_seen_at: nowIso }).eq('id', existing.id)
    }
  }

  // ── 삭제 감지: 시트에서 사라진 '대기' 상태 오더 soft-delete ─────────────────
  // (진행중/완료 등 작업이 걸린 건은 보존)
  for (const [key, existing] of existingByKey) {
    if (seen.has(key)) continue
    if (existing.status !== PENDING_STATUS) continue
    // 수동 오더는 정의상 시트에 없다 — "시트에서 사라졌다"는 판정 자체가 성립하지
    // 않는다. 가드가 없으면 '대기' 상태 수동 오더는 다음 적재에서 100% 삭제되고,
    // 게다가 삭제가 ingest_state 를 'deleted' 로 덮어써 'manual' 마커까지 잃어
    // 사후 식별조차 불가능해진다.
    if (existing.ingest_state === 'manual') continue
    const { error } = await supabaseAdmin.from('pct_orders').update({
      status: DELETED_STATUS, ingest_state: 'deleted', deleted_at: nowIso,
    }).eq('id', existing.id)
    if (error) {
      fail(key, 'deleted', `오더 소프트삭제 실패: ${error.message}`)
    } else {
      result.deleted++
      await logIngest(key, 'deleted', DELETED_STATUS, fileId)
    }
  }

  // ── 동시분석 그룹 자동 재생성 ──────────────────────────────────────────────
  // 적재로 오더가 신규/변경/삭제되면 그룹 구성이 달라질 수 있으므로 즉시 재구성한다.
  // (group_lock=true 그룹과 멤버는 rebuildGroups 내부에서 보존)
  let groupsCreated = 0
  try {
    const r = await rebuildGroups()
    groupsCreated = r.created
  } catch (err) {
    console.error('[pct-ingest] 동시분석 그룹 재생성 실패', err)
  }

  // ── 마감 임박(D-7) 미완료 알림 ─────────────────────────────────────────────
  result.deadlineAlerts = await notifyDeadlines()

  // 적재 요약 알림 (감독관)
  const failed = result.failures.length
  await createNotification({
    type: 'ingest',
    title: failed > 0 ? `PCT 시트 적재 완료 (실패 ${failed}건)` : 'PCT 시트 적재 완료',
    body:
      `신규 ${result.created} · 변경 ${result.updated} · 차단 ${result.blocked} · 삭제 ${result.deleted} · ` +
      `복구 ${result.restored} · 미동기화 ${result.unsynced} · 동시분석그룹 ${groupsCreated}` +
      (result.codeGenerated > 0 ? ` · 코드 자동생성 ${result.codeGenerated}` : '') +
      (result.skippedRows.length > 0 ? ` · 건너뜀 ${result.skippedRows.length}` : '') +
      (failed > 0
        ? `
⚠ 실패 ${failed}건: ` +
          result.failures.slice(0, 5).map(f => `${f.orderKey}(${f.stage})`).join(', ') +
          (failed > 5 ? ` 외 ${failed - 5}건` : '')
        : ''),
    severity: failed > 0 ? 'critical' : 'info',
  })

  // 품목코드 없이 들어온 행 — 임시 코드로 등록했음을 알린다.
  // 오더마다 알리지 않고 1건으로 묶는다(복구 알림과 같은 이유).
  if (result.codeGenerated > 0) {
    await createNotification({
      type: 'ingest',
      title: '품목코드 없는 행을 임시 코드로 등록',
      body:
        `제조팀 시트에 품목코드가 비어 있는 행 ${result.codeGenerated}건을 품목명 기준 임시 코드(AUTO-…)로 등록했습니다. ` +
        `시트에 정식 코드를 채우면 그 오더는 **새 오더로 다시 들어오고, 임시 코드 오더는 삭제됩니다** — ` +
        `그때 배정·확정은 유지되지 않으니 코드를 먼저 채운 뒤 배정하는 편이 안전합니다.`,
      severity: 'warning',
    })
  }

  // 오더로 만들지 못한 행 — 예전에는 파싱에서 조용히 사라져 흔적이 없었다.
  if (result.skippedRows.length > 0) {
    await createNotification({
      type: 'ingest',
      title: '적재하지 못한 시트 행',
      body:
        `${result.skippedRows.length}건을 오더로 만들지 못했습니다(품목명 또는 제조번호 없음). ` +
        result.skippedRows.slice(0, 5)
          .map(r => `${r.productName || '(품목명 없음)'}/${r.batchNo || '(제조번호 없음)'} — ${r.reason}`)
          .join(', ') +
        (result.skippedRows.length > 5 ? ` 외 ${result.skippedRows.length - 5}건` : ''),
      severity: 'warning',
    })
  }

  // 복구 건은 오더마다 알림을 만들면 첫 실행에 수십 건이 한꺼번에 쌓인다 —
  // 요약 알림 1건으로만 안내한다.
  if (result.restored > 0) {
    await createNotification({
      type: 'ingest',
      title: '삭제됐던 오더 복구됨 — 재배정 필요',
      body:
        `복구된 오더 ${result.restored}건은 담당자·확정이 초기화되었습니다. 재배정이 필요합니다.` +
        ` 앞 5건: ${restoredKeys.slice(0, 5).join(', ')}` +
        (restoredKeys.length > 5 ? ` 외 ${restoredKeys.length - 5}건` : ''),
      severity: 'warning',
    })
  }

  return result
}

async function logIngest(
  orderKey: string, changeType: 'new' | 'updated' | 'blocked' | 'deleted' | 'restored', status: string, fileId: string,
) {
  await supabaseAdmin.from('pct_ingest_log').insert({
    order_key: orderKey, change_type: changeType, status, file_id: fileId,
  })
}

/** 완료예정일 D-7 이내 & 미완료 오더에 대해 알림 (오더당 1회) */
async function notifyDeadlines(): Promise<number> {
  // KST 기준. 적재 크론이 09:00 KST(= 00:00 UTC)에 돌아 UTC 기준이면 정확히 경계에서
  // "오늘"이 하루 전으로 계산되고 D-7 알림이 하루 어긋났다.
  const todayStr = kstToday()
  const limitStr = kstDateAfter(7)

  const { data: due } = await supabaseAdmin
    .from('pct_orders')
    .select('id, product_name, batch_no, due_date, status')
    .gte('due_date', todayStr)
    .lte('due_date', limitStr)
    .not('status', 'in', `("${CLOSED_STAGE}","삭제")`)
  if (!due || due.length === 0) return 0

  // 이미 알림 보낸 오더 제외
  const ids = due.map(d => d.id as string)
  const { data: existingNotifs } = await supabaseAdmin
    .from('notifications')
    .select('related_order_id')
    .eq('type', 'deadline_due')
    .in('related_order_id', ids)
  const alerted = new Set((existingNotifs ?? []).map(n => n.related_order_id as string))

  let count = 0
  for (const d of due) {
    if (alerted.has(d.id as string)) continue
    await createNotification({
      type: 'deadline_due',
      title: '마감 임박 (D-7)',
      body: `${d.product_name} / ${d.batch_no} 완료예정일 ${d.due_date} 임박`,
      relatedOrderId: d.id as string,
      severity: 'critical',
    })
    count++
  }
  return count
}
