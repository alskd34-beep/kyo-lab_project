"use client"

/**
 * 품목 공수 표준 추가/수정 Dialog.
 *
 * - 공수 4종은 여기서 입력하지 않는다(하위 합계 자동 계산). 표준 소요일만 직접 관리한다.
 * - 신규 등록 시 기준 품목을 고르면 시험항목·작업단계를 통째로 복사한다(§22).
 * - 수정 시 "새 버전으로 저장"을 체크하면 version 을 올리고 변경이력을 남긴다(§21).
 */

import { useState } from "react"
import { Loader2, Save } from "lucide-react"
import { Button } from "@frontend/components/ui/button"
import { DateField } from "@frontend/components/ui/date-field"
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@frontend/components/ui/dialog"
import { Input } from "@frontend/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@frontend/components/ui/select"
import {
  WORKLOAD_STATUSES,
  WORKLOAD_STATUS_LABEL,
  type ProductWorkload,
  type WorkloadStatus,
} from "@shared/workload"

const NONE = "__none__"

export interface ProductWorkloadDialogProps {
  open: boolean
  /** 없으면 추가 모드 */
  initial?: ProductWorkload | null
  /** 복사 기준 후보 (자기 자신 제외) */
  copySources: ProductWorkload[]
  onClose: () => void
  onSaved: () => void
  onError: (msg: string) => void
}

export function ProductWorkloadDialog({
  open, initial, copySources, onClose, onSaved, onError,
}: ProductWorkloadDialogProps) {
  const isEdit = !!initial

  const [productCode, setProductCode] = useState(initial?.productCode ?? "")
  const [productName, setProductName] = useState(initial?.productName ?? "")
  const [dosageForm, setDosageForm] = useState(initial?.dosageForm ?? "")
  const [leadTimeDays, setLeadTimeDays] = useState(String(initial?.standardLeadTimeDays ?? 1))
  const [status, setStatus] = useState<WorkloadStatus>(initial?.status ?? "DRAFT")
  const [effectiveFrom, setEffectiveFrom] = useState(initial?.effectiveFrom ?? "")
  const [effectiveTo, setEffectiveTo] = useState(initial?.effectiveTo ?? "")
  const [copyFromProductId, setCopyFromProductId] = useState("")
  const [bumpVersion, setBumpVersion] = useState(false)
  const [changeNote, setChangeNote] = useState("")
  const [saving, setSaving] = useState(false)

  const submit = async () => {
    if (!productCode.trim()) { onError("품목코드를 입력하세요."); return }
    if (!productName.trim()) { onError("품목명을 입력하세요."); return }
    const days = Number(leadTimeDays)
    if (!(days > 0)) { onError("표준 소요일은 0보다 커야 합니다."); return }
    if (effectiveFrom && effectiveTo && effectiveFrom > effectiveTo) {
      onError("적용 시작일이 종료일보다 늦습니다."); return
    }

    setSaving(true)
    try {
      const body = {
        productCode: productCode.trim(),
        productName: productName.trim(),
        dosageForm: dosageForm.trim() || null,
        standardLeadTimeDays: days,
        status,
        effectiveFrom: effectiveFrom || null,
        effectiveTo: effectiveTo || null,
        ...(isEdit
          ? { bumpVersion, changeNote: changeNote.trim() || undefined }
          : { copyFromProductId: copyFromProductId || null }),
      }

      const res = await fetch(
        isEdit ? `/api/workloads/products/${initial!.id}` : "/api/workloads/products",
        {
          method: isEdit ? "PUT" : "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      )
      if (!res.ok) {
        const d = (await res.json()) as { error?: string }
        onError(d.error ?? "저장 실패")
        return
      }
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!next && !saving) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "품목 공수 수정" : "품목 공수 등록"}</DialogTitle>
          <DialogDescription>
            인적·기기·대기·검토 공수는 작업단계에서 입력하며 자동 합산됩니다. 여기서는 표준 소요일만 관리합니다.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="grid gap-4">
          <section className="rounded-md border bg-card p-3 shadow-sm sm:p-4">
            <div className="mb-3 border-b pb-3">
              <h3 className="text-sm font-semibold text-foreground">품목 정보</h3>
            </div>

            <div className="grid gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    품목코드 <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={productCode}
                    onChange={e => setProductCode(e.target.value)}
                    placeholder="예) P001"
                    className="h-9 font-mono"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    품목명 <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={productName}
                    onChange={e => setProductName(e.target.value)}
                    placeholder="예) 쌍화탕"
                    className="h-9"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">제형</label>
                  <Input
                    value={dosageForm}
                    onChange={e => setDosageForm(e.target.value)}
                    placeholder="예) 액제"
                    className="h-9"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    표준 소요일(일) <span className="text-red-500">*</span>
                  </label>
                  <Input
                    type="number" min={0.5} step={0.5} value={leadTimeDays}
                    onChange={e => setLeadTimeDays(e.target.value)}
                    className="h-9 tabular-nums"
                  />
                  <p className="mt-1 text-xs leading-normal text-muted-foreground">
                    공수 합계로 계산하지 않는 별도 관리값입니다.
                  </p>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">상태</label>
                  <Select value={status} onValueChange={v => setStatus(v as WorkloadStatus)}>
                    <SelectTrigger className="!h-9 w-full px-3">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WORKLOAD_STATUSES.map(s => (
                        <SelectItem key={s} value={s}>{WORKLOAD_STATUS_LABEL[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <DateField label="적용 시작일" value={effectiveFrom} onChange={setEffectiveFrom} />
                <DateField label="적용 종료일" value={effectiveTo} onChange={setEffectiveTo} />
              </div>
            </div>
          </section>

          {/* 신규 등록: 다른 품목 공수 복사 */}
          {!isEdit && copySources.length > 0 && (
            <section className="rounded-md border bg-card p-3 shadow-sm sm:p-4">
              <div className="mb-3 border-b pb-3">
                <h3 className="text-sm font-semibold text-foreground">다른 품목 공수 복사</h3>
                <p className="mt-0.5 text-xs leading-normal text-muted-foreground">
                  기준 품목의 시험항목·작업단계·공수를 그대로 복사합니다. 복사 후 수정할 수 있습니다.
                </p>
              </div>
              <Select
                value={copyFromProductId || NONE}
                onValueChange={v => setCopyFromProductId(v === NONE ? "" : v)}
              >
                <SelectTrigger className="!h-9 w-full px-3">
                  <SelectValue placeholder="복사하지 않음" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE}>복사하지 않음</SelectItem>
                  {copySources.map(p => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.productName} ({p.productCode}) · 시험항목 {p.testItemCount}개
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </section>
          )}

          {/* 수정: 버전 관리 */}
          {isEdit && (
            <section className="rounded-md border bg-card p-3 shadow-sm sm:p-4">
              <div className="mb-3 border-b pb-3">
                <h3 className="text-sm font-semibold text-foreground">버전 관리</h3>
                <p className="mt-0.5 text-xs leading-normal text-muted-foreground">
                  현재 v{initial!.version} · 새 버전으로 저장하면 변경이력에 기록됩니다.
                </p>
              </div>
              <div className="grid gap-3">
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox" className="cb-custom"
                    checked={bumpVersion}
                    onChange={e => setBumpVersion(e.target.checked)}
                  />
                  새 버전(v{initial!.version + 1})으로 저장
                </label>
                {bumpVersion && (
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-foreground">변경 내용</label>
                    <Input
                      value={changeNote}
                      onChange={e => setChangeNote(e.target.value)}
                      placeholder="예) HPLC 분석시간 30시간으로 조정"
                      className="h-9"
                    />
                  </div>
                )}
              </div>
            </section>
          )}
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {saving ? "저장 중..." : isEdit ? "저장" : "등록"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
