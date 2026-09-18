import { supabaseAdmin } from "@backend/lib/supabase"
import { selectAll } from "@backend/lib/supabasePage"
import { createOrder } from "@backend/services/pctOrders"
import { stabilityCompositeKey } from "@shared/stability"

export type StabilityPlanStatus = "미전송" | "전송됨" | "완료" | "시트 제외"
export interface StabilityPlanRow {
  id: string
  sourceKey: string
  productCode: string
  productName: string
  batchNo: string
  testType: string
  period: string
  manufacturedAt: string | null
  expiryDate: string | null
  periodEndDate: string | null
  reason: string | null
  requestedAt: string | null
  requestNo: string | null
  sheetStatus: string
  planStatus: StabilityPlanStatus
  linkedOrderId: string | null
  lastSeenAt: string | null
  createdAt: string
  updatedAt: string
}
export interface StabilityPlanInput {
  sourceKey: string
  productCode: string
  productName: string
  batchNo: string
  testType: string
  period: string
  manufacturedAt?: string
  expiryDate?: string
  reason?: string
  requestedAt?: string
  periodEndDate?: string
  requestNo?: string
  sheetStatus: string
  approved: boolean
  source?: Record<string, string>
}
const mapRow = (r: Record<string, unknown>): StabilityPlanRow => ({
  id: r.id as string,
  sourceKey: r.source_key as string,
  productCode: r.product_code as string,
  productName: r.product_name as string,
  batchNo: r.batch_no as string,
  testType: r.test_type as string,
  period: r.period as string,
  manufacturedAt: (r.manufactured_at as string) ?? null,
  expiryDate: (r.expiry_date as string) ?? null,
  reason: (r.reason as string) ?? null,
  periodEndDate: (r.period_end_date as string) ?? null,
  requestedAt: (r.requested_at as string) ?? null,
  requestNo: (r.request_no as string) ?? null,
  sheetStatus: r.sheet_status as string,
  planStatus: r.plan_status as StabilityPlanStatus,
  linkedOrderId: (r.linked_order_id as string) ?? null,
  lastSeenAt: (r.last_seen_at as string) ?? null,
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
})

export async function listStabilityPlans(): Promise<StabilityPlanRow[]> {
  const { data, error } = await selectAll(
    supabaseAdmin,
    "stability_plans",
    "*",
    { orderBy: "id" }
  )
  if (error) throw error
  return (data ?? [])
    .sort((a, b) =>
      String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""), "ko")
    )
    .map((r) => mapRow(r as Record<string, unknown>))
}

export async function syncStabilityPlans(
  inputs: StabilityPlanInput[]
): Promise<StabilityPlanRow[]> {
  if (inputs.length === 0)
    throw new Error("시트에서 시험계획 행을 읽지 못해 동기화를 중단했습니다.")
  const now = new Date().toISOString()
  const keys = new Set<string>()
  const { data: existingRows, error: existingError } = await selectAll(
    supabaseAdmin,
    "stability_plans",
    "id, source_key, composite_key, plan_status, linked_order_id",
    { orderBy: "id" }
  )
  if (existingError) throw existingError

  type ExistingPlan = {
    id: string
    source_key: string
    composite_key: string | null
    plan_status: StabilityPlanStatus
    linked_order_id: string | null
  }
  const bySourceKey = new Map<string, ExistingPlan>()
  const byCompositeKey = new Map<string, ExistingPlan>()
  for (const row of existingRows ?? []) {
    const plan = row as unknown as ExistingPlan
    bySourceKey.set(plan.source_key, plan)
    if (plan.source_key.startsWith("composite:") && plan.composite_key) {
      byCompositeKey.set(plan.composite_key, plan)
    }
  }

  const payloads: Array<Record<string, unknown>> = []
  const newPayloadIndexes = new Map<string, number>()
  for (const input of inputs) {
    const compositeKey = stabilityCompositeKey(input)
    keys.add(input.sourceKey)
    keys.add(compositeKey)
    const existing =
      bySourceKey.get(input.sourceKey) ??
      byCompositeKey.get(compositeKey)
    // 승인 완료 행은 아직 계획이 없으면 생성하지 않는다.
    if (input.approved && !existing) continue
    const nextStatus = input.approved
      ? existing
        ? "완료"
        : undefined
      : existing?.linked_order_id
        ? "전송됨"
        : "미전송"
    const payload = {
      source_key: input.sourceKey,
      composite_key: compositeKey,
      product_code: input.productCode || "N/A",
      product_name: input.productName || "N/A",
      batch_no: input.batchNo || "N/A",
      test_type: input.testType || "N/A",
      period: input.period || "N/A",
      manufactured_at: input.manufacturedAt || null,
      expiry_date: input.expiryDate || null,
      reason: input.reason || null,
      period_end_date: input.periodEndDate || null,
      requested_at: input.requestedAt || null,
      request_no: input.requestNo || null,
      sheet_status: input.sheetStatus || "미확인",
      ...(nextStatus ? { plan_status: nextStatus } : {}),
      last_seen_at: now,
      source: input.source ?? {},
      updated_at: now,
    }
    if (existing) payloads.push({ id: existing.id, ...payload })
    else {
      const previousIndex =
        newPayloadIndexes.get(input.sourceKey) ??
        newPayloadIndexes.get(compositeKey)
      if (previousIndex === undefined) {
        newPayloadIndexes.set(input.sourceKey, payloads.length)
        newPayloadIndexes.set(compositeKey, payloads.length)
        payloads.push(payload)
      } else payloads[previousIndex] = payload
    }
  }
  if (payloads.length) {
    const { error } = await supabaseAdmin
      .from("stability_plans")
      .upsert(payloads, { onConflict: "id" })
    if (error) throw error
  }
  const { data: all, error: allError } = await selectAll(
    supabaseAdmin,
    "stability_plans",
    "id, source_key, composite_key, plan_status",
    { orderBy: "id" }
  )
  if (allError) throw allError
  const excludedIds = (all ?? [])
    .filter(
      (row) =>
        !keys.has(row.source_key as string) &&
        !keys.has(row.composite_key as string) &&
        row.plan_status !== "전송됨"
    )
    .map((row) => row.id as string)
  if (excludedIds.length) {
    const { error } = await supabaseAdmin
      .from("stability_plans")
      .update({ plan_status: "시트 제외", updated_at: now })
      .in("id", excludedIds)
    if (error) throw error
  }
  return listStabilityPlans()
}

export async function transferStabilityPlans(
  ids: string[],
  createdBy: string | null
) {
  const { data, error } = await supabaseAdmin
    .from("stability_plans")
    .select("*")
    .in("id", ids)
  if (error) throw error
  const results: Array<{
    id: string
    status: "성공" | "건너뜀" | "실패"
    message?: string
  }> = []
  for (const row of data ?? []) {
    if (row.plan_status !== "미전송") {
      results.push({
        id: row.id as string,
        status: "건너뜀",
        message: `현재 상태: ${row.plan_status}`,
      })
      continue
    }
    try {
      const stabilityType =
        `STABILITY-${String(row.test_type ?? "").trim()}-${String(row.period ?? "").trim()}`
          .replace(/\s+/g, "-")
          .toUpperCase()
      const order = await createOrder({
        productCode:
          row.product_code === "N/A" ? "" : (row.product_code as string),
        productName: row.product_name as string,
        batchNo: row.batch_no === "N/A" ? "" : (row.batch_no as string),
        validationType: stabilityType,
        packagingDate: row.manufactured_at as string | null,
        dueDate:
          (row.period_end_date as string) ||
          (row.requested_at as string) ||
          new Date().toISOString().slice(0, 10),
        method: "전항목",
        note: `안정성시험 계획 연계 · ${row.test_type as string} · ${row.period as string}`,
        createdBy,
        stabilityPlanId: row.id as string,
      })
      const { error: updateError } = await supabaseAdmin
        .from("stability_plans")
        .update({
          linked_order_id: order.id,
          plan_status: "전송됨",
          updated_at: new Date().toISOString(),
        })
        .eq("id", row.id)
      if (updateError) throw updateError
      results.push({ id: row.id as string, status: "성공" })
    } catch (e) {
      results.push({
        id: row.id as string,
        status: "실패",
        message: e instanceof Error ? e.message : "오더 생성 실패",
      })
    }
  }
  return results
}
