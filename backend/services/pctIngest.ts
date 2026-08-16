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
import { fetchPctSheet, type SheetPctRow } from '@backend/lib/googleSheet'
import { createNotification } from '@backend/services/notifications'
import { rebuildGroups } from '@backend/services/concurrentGroups'
import { CLOSED_STAGE, LOCKED_STATUSES } from '@shared/qc-status'

// 기존 PCT 화면이 쓰던 기본 시트 ID (폴백)
const DEFAULT_FILE_ID = '1H9_lR-_tpEHKSpVD2qLbxX5cqXRG_s5rpbGs-gqSPxU'

export interface IngestResult {
  fileId: string
  total: number
  created: number
  updated: number
  blocked: number      // 작업 진행/LOCK 상태로 변경 차단된 건수
  deleted: number
  unsynced: number
  deadlineAlerts: number
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
}> = [
  { label: '품목명',     oldVal: e => e.product_name,            newVal: r => r.productName },
  { label: '제형',       oldVal: e => e.dosage_form ?? '',       newVal: r => r.dosageForm },
  { label: '포장완료일', oldVal: e => e.packaging_date ?? '',    newVal: r => r.packagingDate ?? '' },
  { label: '완료예정일', oldVal: e => e.due_date ?? '',          newVal: r => r.dueDate ?? '' },
  { label: '긴급',       oldVal: e => String(e.is_urgent),       newVal: r => String(r.isUrgent) },
  { label: '진행방법',   oldVal: e => e.method,                  newVal: r => r.method },
  { label: '비고',       oldVal: e => e.note ?? '',              newVal: r => r.note },
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
  product_name: string
  dosage_form: string | null
  packaging_date: string | null
  due_date: string | null
  is_urgent: boolean
  method: string
  note: string | null
  status: string
}

function diffChanged(existing: ExistingOrder, row: SheetPctRow): boolean {
  return (
    existing.product_name !== row.productName ||
    (existing.dosage_form ?? '') !== row.dosageForm ||
    (existing.packaging_date ?? null) !== row.packagingDate ||
    (existing.due_date ?? null) !== row.dueDate ||
    existing.is_urgent !== row.isUrgent ||
    existing.method !== row.method ||
    (existing.note ?? '') !== row.note
  )
}

/** 적재 실행 (크론/수동 트리거 공용) */
export async function ingestPctSheet(fileIdOverride?: string): Promise<IngestResult> {
  const fileId = fileIdOverride || (await resolveSheetFileId())
  const sheetRows = await fetchPctSheet(fileId)
  void MUTABLE // 문서용(diff는 diffChanged에서 명시 비교)

  // ── 기존 오더 로드 (삭제 제외) ─────────────────────────────────────────────
  const { data: existingRows, error: exErr } = await supabaseAdmin
    .from('pct_orders')
    .select('*')   // locked 컬럼(0015)까지 받되 미적용 시 자동 누락 — 방어적
    .neq('status', '삭제')
  if (exErr) throw exErr
  const existingByKey = new Map<string, ExistingOrder & { batch_no: string; product_code: string }>()
  for (const r of existingRows ?? []) {
    existingByKey.set(keyOf(r.batch_no as string, r.product_code as string), r as never)
  }

  // ── 품목마스터 코드 집합 ───────────────────────────────────────────────────
  const { data: prodRows } = await supabaseAdmin.from('products').select('product_code')
  const productCodes = new Set((prodRows ?? []).map(p => String(p.product_code)))

  const result: IngestResult = {
    fileId, total: sheetRows.length, created: 0, updated: 0, blocked: 0, deleted: 0, unsynced: 0, deadlineAlerts: 0,
  }
  const seen = new Set<string>()
  const nowIso = new Date().toISOString()

  for (const row of sheetRows) {
    const key = keyOf(row.batchNo, row.productCode)
    seen.add(key)

    // ── 품목마스터 동기화 ────────────────────────────────────────────────────
    let synced = productCodes.has(row.productCode)
    if (!synced) {
      const { error: insErr } = await supabaseAdmin.from('products').insert({
        product_code: row.productCode,
        name: row.productName,
        product_type: '완제품',
      })
      if (!insErr) {
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
    if (!existing) {
      // ── 신규 ────────────────────────────────────────────────────────────────
      const { error } = await supabaseAdmin.from('pct_orders').insert({
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
      })
      if (!error) {
        result.created++
        await logIngest(key, 'new', '대기', fileId)
      }
    } else if (diffChanged(existing, row) && (isLockedStatus(existing.status) || (existing as { locked?: boolean }).locked)) {
      // ── 변경 차단 ──────────────────────────────────────────────────────────
      // 작업 진행 상태이거나 관리자 확정(LOCK)된 오더는 시트 변경을 자동 반영하지 않는다(일정·배정 보존).
      // before/after 를 pct_order_edits 에 기록하고 감독관 알림만 생성한다.
      const changes = CHANGE_FIELDS.filter(f => f.oldVal(existing) !== f.newVal(row))
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
    } else if (diffChanged(existing, row)) {
      // ── 변경 ────────────────────────────────────────────────────────────────
      const { error } = await supabaseAdmin.from('pct_orders').update({
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
      }).eq('id', existing.id)
      if (!error) {
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
    if (existing.status !== '대기') continue
    const { error } = await supabaseAdmin.from('pct_orders').update({
      status: '삭제', ingest_state: 'deleted', deleted_at: nowIso,
    }).eq('id', existing.id)
    if (!error) {
      result.deleted++
      await logIngest(key, 'deleted', '삭제', fileId)
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
  await createNotification({
    type: 'ingest',
    title: 'PCT 시트 적재 완료',
    body: `신규 ${result.created} · 변경 ${result.updated} · 차단 ${result.blocked} · 삭제 ${result.deleted} · 미동기화 ${result.unsynced} · 동시분석그룹 ${groupsCreated}`,
    severity: 'info',
  })

  return result
}

async function logIngest(orderKey: string, changeType: 'new' | 'updated' | 'blocked' | 'deleted', status: string, fileId: string) {
  await supabaseAdmin.from('pct_ingest_log').insert({
    order_key: orderKey, change_type: changeType, status, file_id: fileId,
  })
}

/** 완료예정일 D-7 이내 & 미완료 오더에 대해 알림 (오더당 1회) */
async function notifyDeadlines(): Promise<number> {
  const today = new Date()
  const limit = new Date(today)
  limit.setDate(limit.getDate() + 7)
  const todayStr = today.toISOString().slice(0, 10)
  const limitStr = limit.toISOString().slice(0, 10)

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
