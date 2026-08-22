"use client"

/**
 * 시험항목 추가/수정 Dialog.
 *
 * 시험항목 자체에는 공수를 입력하지 않는다 — 하위 작업단계 합계로 자동 계산되므로
 * 저장 후 "작업단계 추가"로 이어간다.
 */

import { useState } from "react"
import { Loader2, Save } from "lucide-react"
import { Button } from "@frontend/components/ui/button"
import {
  Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@frontend/components/ui/dialog"
import { Input } from "@frontend/components/ui/input"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@frontend/components/ui/select"
import {
  DIFFICULTIES,
  DIFFICULTY_LABEL,
  SKILL_PRESETS,
  type Difficulty,
  type ProductTestItem,
} from "@shared/workload"

const inputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"

export interface TestItemDialogProps {
  open: boolean
  productId: string
  /** 없으면 추가 모드 */
  initial?: ProductTestItem | null
  /** 추가 모드 기본 순서 */
  defaultSequence?: number
  onClose: () => void
  /** 저장된 시험항목 id 를 넘겨준다(추가 직후 작업단계로 이어가기 위함) */
  onSaved: (savedId: string | null) => void
  onError: (msg: string) => void
}

export function TestItemDialog({
  open, productId, initial, defaultSequence = 1, onClose, onSaved, onError,
}: TestItemDialogProps) {
  const isEdit = !!initial

  const [testName, setTestName] = useState(initial?.testName ?? "")
  const [testCode, setTestCode] = useState(initial?.testCode ?? "")
  const [sequence, setSequence] = useState(String(initial?.sequence ?? defaultSequence))
  const [difficulty, setDifficulty] = useState<Difficulty>(initial?.difficulty ?? "NORMAL")
  const [requiredSkill, setRequiredSkill] = useState(initial?.requiredSkill ?? "")
  const [parallelAllowed, setParallelAllowed] = useState(initial?.parallelAllowed ?? true)
  const [simultaneousAllowed, setSimultaneousAllowed] = useState(initial?.simultaneousAnalysisAllowed ?? false)
  const [simMaxCount, setSimMaxCount] = useState(
    initial?.simultaneousMaxCount != null ? String(initial.simultaneousMaxCount) : "",
  )
  const [simAddHuman, setSimAddHuman] = useState(
    initial?.simultaneousAdditionalHumanMinutes != null ? String(initial.simultaneousAdditionalHumanMinutes) : "",
  )
  const [simAddEquipment, setSimAddEquipment] = useState(
    initial?.simultaneousAdditionalEquipmentMinutes != null
      ? String(initial.simultaneousAdditionalEquipmentMinutes) : "",
  )
  const [memo, setMemo] = useState(initial?.memo ?? "")
  const [saving, setSaving] = useState(false)

  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v))

  const submit = async () => {
    if (!testName.trim()) { onError("시험항목명을 입력하세요."); return }

    setSaving(true)
    try {
      const body = {
        testName: testName.trim(),
        testCode: testCode.trim() || null,
        sequence: Number(sequence) || 1,
        difficulty,
        requiredSkill: requiredSkill.trim() || null,
        parallelAllowed,
        simultaneousAnalysisAllowed: simultaneousAllowed,
        // 동시분석 관련 값은 허용일 때만 의미가 있다.
        simultaneousMaxCount: simultaneousAllowed ? numOrNull(simMaxCount) : null,
        simultaneousAdditionalHumanMinutes: simultaneousAllowed ? numOrNull(simAddHuman) : null,
        simultaneousAdditionalEquipmentMinutes: simultaneousAllowed ? numOrNull(simAddEquipment) : null,
        memo: memo.trim() || null,
      }

      const res = await fetch(
        isEdit ? `/api/workloads/tests/${initial!.id}` : `/api/workloads/products/${productId}/tests`,
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
      const data = (await res.json()) as { row?: { id: string } }
      onSaved(data.row?.id ?? null)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!next && !saving) onClose() }}>
      <DialogContent size="lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "시험항목 수정" : "시험항목 추가"}</DialogTitle>
          <DialogDescription>
            시험항목의 공수는 하위 작업단계 합계로 자동 계산됩니다. 저장 후 작업단계를 등록하세요.
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="grid gap-4">
          <section className="rounded-lg border bg-card p-3 shadow-sm sm:p-4">
            <div className="mb-3 border-b pb-3">
              <h3 className="text-sm font-semibold text-foreground">기본 정보</h3>
            </div>

            <div className="grid gap-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="sm:col-span-2">
                  <label className="mb-1 block text-xs font-semibold text-foreground">
                    시험항목명 <span className="text-red-500">*</span>
                  </label>
                  <Input
                    value={testName}
                    onChange={e => setTestName(e.target.value)}
                    placeholder="예) 함량시험"
                    className="h-9"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">순서</label>
                  <Input
                    type="number" min={1} step={1} value={sequence}
                    onChange={e => setSequence(e.target.value)}
                    className="h-9 tabular-nums"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">시험코드</label>
                  <Input
                    value={testCode}
                    onChange={e => setTestCode(e.target.value)}
                    placeholder="예) T-ASSAY"
                    className="h-9"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">난이도</label>
                  <Select value={difficulty} onValueChange={v => setDifficulty(v as Difficulty)}>
                    <SelectTrigger className="!h-9 w-full px-3">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIFFICULTIES.map(d => (
                        <SelectItem key={d} value={d}>{DIFFICULTY_LABEL[d]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-semibold text-foreground">필요 역량</label>
                  <Input
                    value={requiredSkill}
                    onChange={e => setRequiredSkill(e.target.value)}
                    placeholder="예) HPLC"
                    list="workload-item-skill-presets"
                    className="h-9"
                  />
                  <datalist id="workload-item-skill-presets">
                    {SKILL_PRESETS.map(s => <option key={s} value={s} />)}
                  </datalist>
                </div>
              </div>
            </div>
          </section>

          <section className="rounded-lg border bg-card p-3 shadow-sm sm:p-4">
            <div className="mb-3 border-b pb-3">
              <h3 className="text-sm font-semibold text-foreground">수행 조건</h3>
            </div>

            <div className="grid gap-3">
              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox" className="cb-custom"
                  checked={parallelAllowed}
                  onChange={e => setParallelAllowed(e.target.checked)}
                />
                병렬 수행 가능
              </label>

              <label className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox" className="cb-custom"
                  checked={simultaneousAllowed}
                  onChange={e => setSimultaneousAllowed(e.target.checked)}
                />
                동시분석 가능 (다른 제조번호와 같은 기기에서 함께 분석)
              </label>

              {simultaneousAllowed && (
                <div className="rounded-lg border border-dashed bg-muted/40 p-3">
                  <p className="mb-2.5 text-[11px] text-muted-foreground">
                    동시분석은 건수만큼 공수가 그대로 곱해지지 않습니다. 추가되는 증분만 입력하세요.
                    (예: 1건 HPLC 10시간 → 2건 동시분석 12시간이면 증분 기기공수 120분)
                  </p>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-foreground">최대 동시 건수</label>
                      <Input
                        type="number" min={1} step={1} value={simMaxCount}
                        onChange={e => setSimMaxCount(e.target.value)}
                        placeholder="예) 4"
                        className="h-9 tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-foreground">추가 인적공수(분)</label>
                      <Input
                        type="number" min={0} step={1} value={simAddHuman}
                        onChange={e => setSimAddHuman(e.target.value)}
                        placeholder="예) 10"
                        className="h-9 tabular-nums"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-foreground">추가 기기공수(분)</label>
                      <Input
                        type="number" min={0} step={1} value={simAddEquipment}
                        onChange={e => setSimAddEquipment(e.target.value)}
                        placeholder="예) 120"
                        className="h-9 tabular-nums"
                      />
                    </div>
                  </div>
                </div>
              )}

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
