"use client"

/**
 * 작업단계 추가/수정 Dialog.
 *
 * 공수는 이 화면에서만 입력한다. 저장하면 시험항목·품목 합계가 서버에서 자동 재계산된다.
 * 소요시간은 "시간 + 분" 두 칸으로 받아 분으로 환산해 저장한다(DB 단위는 분).
 */

import { useMemo, useState } from "react"
import { Loader2, Save } from "lucide-react"
import { Button } from "@frontend/components/ui/button"
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@frontend/components/ui/dialog"
import { Input } from "@frontend/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@frontend/components/ui/select"
import { splitMinutes, toMinutes } from "@frontend/lib/workload-format"
import {
  EQUIPMENT_TYPE_PRESETS,
  SKILL_PRESETS,
  STEP_NAME_PRESETS,
  WORKLOAD_TYPES,
  WORKLOAD_TYPE_LABEL,
  type ProductTestItem,
  type TestWorkStep,
  type WorkloadType,
} from "@shared/workload"
import { WorkloadTypeBadge } from "@frontend/components/workload/workload-ui"

const NONE = "__none__"
const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"

export interface StepDialogProps {
  open: boolean
  /** 소속 시험항목 — 선행작업 후보를 여기서 뽑는다 */
  testItem: ProductTestItem
  /** 없으면 추가 모드 */
  initial?: TestWorkStep | null
  /** 이미 쓰이고 있는 기기 종류 (프리셋과 합쳐서 제시) */
  equipmentOptions?: string[]
  onClose: () => void
  onSaved: () => void
  onError: (msg: string) => void
}

export function StepDialog({
  open, testItem, initial, equipmentOptions = [], onClose, onSaved, onError,
}: StepDialogProps) {
  const isEdit = !!initial
  const initialSplit = splitMinutes(initial?.durationMinutes ?? 0)

  const [stepName, setStepName] = useState(initial?.stepName ?? "")
  const [workloadType, setWorkloadType] = useState<WorkloadType>(initial?.workloadType ?? "HUMAN")
  const [hours, setHours] = useState(String(initialSplit.hours))
  const [minutes, setMinutes] = useState(String(initialSplit.minutes))
  const [equipmentTypeName, setEquipmentTypeName] = useState(initial?.equipmentTypeName ?? "")
  const [requiredSkill, setRequiredSkill] = useState(initial?.requiredSkill ?? "")
  const [sequence, setSequence] = useState(String(initial?.sequence ?? testItem.steps.length + 1))
  const [predecessorStepId, setPredecessorStepId] = useState(initial?.predecessorStepId ?? "")
  const [parallelAllowed, setParallelAllowed] = useState(initial?.parallelAllowed ?? false)
  const [memo, setMemo] = useState(initial?.memo ?? "")
  const [saving, setSaving] = useState(false)

  // 선행작업 후보: 같은 시험항목의 다른 단계 (자기 자신 제외)
  const predecessorCandidates = useMemo(
    () => testItem.steps.filter(s => s.id !== initial?.id),
    [testItem.steps, initial?.id],
  )

  const equipmentChoices = useMemo(() => {
    const merged = new Set<string>([...EQUIPMENT_TYPE_PRESETS, ...equipmentOptions.filter(Boolean)])
    if (equipmentTypeName) merged.add(equipmentTypeName)
    return [...merged]
  }, [equipmentOptions, equipmentTypeName])

  const totalMinutes = toMinutes(hours, minutes)
  const needsEquipment = workloadType === "EQUIPMENT"

  const submit = async () => {
    if (!stepName.trim()) { onError("작업단계명을 입력하세요."); return }
    if (totalMinutes < 0) { onError("소요시간은 0분 이상이어야 합니다."); return }
    if (needsEquipment && !equipmentTypeName.trim()) { onError("기기공수는 기기 종류를 선택해야 합니다."); return }

    setSaving(true)
    try {
      const body = {
        stepName: stepName.trim(),
        workloadType,
        durationMinutes: totalMinutes,
        // WAITING/REVIEW 는 장비 선택이 불필요하므로 서버에서도 비워진다.
        equipmentTypeName: needsEquipment ? equipmentTypeName.trim() : null,
        requiredSkill: requiredSkill.trim() || null,
        sequence: Number(sequence) || 1,
        predecessorStepId: predecessorStepId || null,
        parallelAllowed,
        memo: memo.trim() || null,
      }

      const res = await fetch(
        isEdit ? `/api/workloads/steps/${initial!.id}` : `/api/workloads/tests/${testItem.id}/steps`,
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
          <DialogTitle>{isEdit ? "작업단계 수정" : "작업단계 추가"}</DialogTitle>
          <DialogDescription>
            {testItem.testName} · 공수는 작업단계에만 입력합니다. 시험항목·품목 합계는 자동 계산됩니다.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="grid gap-4">
          <section className="rounded-lg border bg-card p-3 shadow-sm sm:p-4">
            <div className="mb-3 border-b pb-3">
              <h3 className="text-sm font-semibold text-foreground">단계 정보</h3>
            </div>

            <div className="grid gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    작업단계명 <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={stepName}
                    onChange={e => setStepName(e.target.value)}
                    placeholder="예) HPLC 분석"
                    list="workload-step-name-presets"
                    className="h-9"
                  />
                  <datalist id="workload-step-name-presets">
                    {STEP_NAME_PRESETS.map(n => <option key={n} value={n} />)}
                  </datalist>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    공수구분 <span className="text-red-500">*</span>
                  </label>
                  <Select value={workloadType} onValueChange={v => setWorkloadType(v as WorkloadType)}>
                    <SelectTrigger className="!h-9 w-full px-3">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {WORKLOAD_TYPES.map(t => (
                        <SelectItem key={t} value={t}>{WORKLOAD_TYPE_LABEL[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* 소요시간 — 시간 + 분 */}
              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">
                  소요시간 <span className="text-red-500">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number" min={0} step={1} value={hours}
                    onChange={e => setHours(e.target.value)}
                    className="h-9 w-24 text-right tabular-nums"
                  />
                  <span className="text-sm text-muted-foreground">시간</span>
                  <Input
                    type="number" min={0} max={59} step={1} value={minutes}
                    onChange={e => setMinutes(e.target.value)}
                    className="h-9 w-24 text-right tabular-nums"
                  />
                  <span className="text-sm text-muted-foreground">분</span>
                  <span className="ml-auto flex items-center gap-2">
                    <WorkloadTypeBadge type={workloadType} />
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {totalMinutes}분 저장
                    </span>
                  </span>
                </div>
              </div>

              {/* 기기 종류 — 기기공수일 때만 */}
              {needsEquipment && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    기기 종류 <span className="text-red-500">*</span>
                  </label>
                  <Select
                    value={equipmentTypeName || NONE}
                    onValueChange={v => setEquipmentTypeName(v === NONE ? "" : v)}
                  >
                    <SelectTrigger className="!h-9 w-full px-3">
                      <SelectValue placeholder="기기 선택" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>—</SelectItem>
                      {equipmentChoices.map(e => <SelectItem key={e} value={e}>{e}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    기기공수는 &quot;기기 유형 + 사용시간&quot;으로 관리합니다. 대기·검토는 기기를 선택하지 않습니다.
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border bg-card p-3 shadow-sm sm:p-4">
            <div className="mb-3 border-b pb-3">
              <h3 className="text-sm font-semibold text-foreground">순서 · 옵션</h3>
            </div>

            <div className="grid gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">순서</label>
                  <Input
                    type="number" min={1} step={1} value={sequence}
                    onChange={e => setSequence(e.target.value)}
                    className="h-9 tabular-nums"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">선행 작업</label>
                  <Select
                    value={predecessorStepId || NONE}
                    onValueChange={v => setPredecessorStepId(v === NONE ? "" : v)}
                  >
                    <SelectTrigger className="!h-9 w-full px-3">
                      <SelectValue placeholder="없음" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NONE}>없음</SelectItem>
                      {predecessorCandidates.map(s => (
                        <SelectItem key={s.id} value={s.id}>{s.sequence}. {s.stepName}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">필요 역량</label>
                <Input
                  value={requiredSkill}
                  onChange={e => setRequiredSkill(e.target.value)}
                  placeholder="예) HPLC"
                  list="workload-skill-presets"
                  className="h-9"
                />
                <datalist id="workload-skill-presets">
                  {SKILL_PRESETS.map(s => <option key={s} value={s} />)}
                </datalist>
              </div>

              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="cb-custom"
                  checked={parallelAllowed}
                  onChange={e => setParallelAllowed(e.target.checked)}
                />
                병렬 수행 가능
              </label>

              <div>
                <label className="mb-1 block text-xs font-semibold text-foreground">메모</label>
                <textarea
                  value={memo}
                  onChange={e => setMemo(e.target.value)}
                  rows={2}
                  placeholder="기타 참고사항"
                  className={`${inputCls} resize-none py-2`}
                />
              </div>
            </div>
          </section>
        </DialogBody>

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={saving}>취소</Button>
          <Button onClick={() => void submit()} disabled={saving}>
            {saving ? <Loader2 className="animate-spin" /> : <Save />}
            {saving ? "저장 중..." : isEdit ? "저장" : "추가"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
