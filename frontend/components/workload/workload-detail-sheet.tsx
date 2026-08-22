"use client"

/**
 * 품목 공수 상세 — 우측 슬라이드 패널.
 *
 * 구조: 요약(표준소요일 + 공수 4종) → 시험항목 표(행 펼치면 작업단계) → 추가/수정/삭제.
 * 공수 입력은 작업단계에서만 하고, 시험항목·품목 합계는 서버가 재계산한 값을 그대로 보여준다.
 */

import { useMemo, useState } from "react"
import {
  ChevronDown, ChevronRight, History, Loader2, Pencil, Plus, Trash2,
} from "lucide-react"
import { Badge } from "@frontend/components/ui/badge"
import { Button } from "@frontend/components/ui/button"
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@frontend/components/ui/sheet"
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@frontend/components/ui/table"
import { useConfirmMessage } from "@frontend/components/common/confirm-message"
import { formatLeadDays, formatMinutes } from "@frontend/lib/workload-format"
import {
  DIFFICULTY_LABEL,
  WORKLOAD_STATUS_LABEL,
  type Difficulty,
  type ProductTestItem,
  type ProductWorkload,
  type TestWorkStep,
} from "@shared/workload"
import { WORKLOAD_TYPE_CLASS, WorkloadTypeBadge } from "@frontend/components/workload/workload-ui"
import { StepDialog } from "@frontend/components/workload/step-dialog"
import { TestItemDialog } from "@frontend/components/workload/test-item-dialog"
import { VersionHistoryDialog } from "@frontend/components/workload/version-history-dialog"

const DIFFICULTY_DOT: Record<Difficulty, string> = {
  LOW: "bg-slate-400",
  NORMAL: "bg-emerald-500",
  HIGH: "bg-amber-500",
  VERY_HIGH: "bg-red-500",
}

export interface WorkloadDetailSheetProps {
  open: boolean
  product: ProductWorkload
  canEdit: boolean
  /** 이미 쓰이고 있는 기기 종류 후보 */
  equipmentOptions: string[]
  onClose: () => void
  /** 하위 데이터가 바뀌어 목록을 다시 읽어야 할 때 */
  onChanged: () => void
  onEditProduct: () => void
  onError: (msg: string) => void
}

export function WorkloadDetailSheet({
  open, product, canEdit, equipmentOptions, onClose, onChanged, onEditProduct, onError,
}: WorkloadDetailSheetProps) {
  const { requestConfirm } = useConfirmMessage()

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [busyId, setBusyId] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [itemDialog, setItemDialog] = useState<{ initial: ProductTestItem | null } | null>(null)
  const [stepDialog, setStepDialog] = useState<{ item: ProductTestItem; initial: TestWorkStep | null } | null>(null)

  const toggle = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const summary = useMemo(
    () => [
      { label: "인적공수", value: product.totalHumanMinutes, dot: WORKLOAD_TYPE_CLASS.HUMAN.dot },
      { label: "기기공수", value: product.totalEquipmentMinutes, dot: WORKLOAD_TYPE_CLASS.EQUIPMENT.dot },
      { label: "대기시간", value: product.totalWaitingMinutes, dot: WORKLOAD_TYPE_CLASS.WAITING.dot },
      { label: "검토공수", value: product.totalReviewMinutes, dot: WORKLOAD_TYPE_CLASS.REVIEW.dot },
    ],
    [product],
  )

  const deleteTestItem = async (item: ProductTestItem) => {
    const ok = await requestConfirm({
      title: "시험항목을 삭제할까요?",
      description: `${item.testName} 과(와) 하위 작업단계 ${item.steps.length}개가 목록에서 제외됩니다. 과거 실적 추적을 위해 데이터는 보관됩니다.`,
      confirmLabel: "시험항목 삭제",
      variant: "danger",
    })
    if (!ok) return

    setBusyId(item.id)
    try {
      const res = await fetch(`/api/workloads/tests/${item.id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) {
        const d = (await res.json()) as { error?: string }
        onError(d.error ?? "삭제 실패")
        return
      }
      onChanged()
    } finally {
      setBusyId(null)
    }
  }

  const deleteStep = async (step: TestWorkStep) => {
    const ok = await requestConfirm({
      title: "작업단계를 삭제할까요?",
      description: `${step.stepName} 단계를 삭제하면 시험항목·품목 공수 합계가 다시 계산됩니다.`,
      confirmLabel: "작업단계 삭제",
      variant: "danger",
    })
    if (!ok) return

    setBusyId(step.id)
    try {
      const res = await fetch(`/api/workloads/steps/${step.id}`, { method: "DELETE", credentials: "include" })
      if (!res.ok) {
        const d = (await res.json()) as { error?: string }
        onError(d.error ?? "삭제 실패")
        return
      }
      onChanged()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <>
      <Sheet open={open} onOpenChange={next => { if (!next) onClose() }}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 data-[side=right]:sm:max-w-5xl"
        >
          {/* shrink-0: 헤더가 눌려 제목·버튼이 잘리지 않게 한다 */}
          <SheetHeader className="shrink-0 border-b px-5 py-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <SheetTitle className="flex items-center gap-2 text-base font-semibold">
                  {product.productName}
                  <Badge variant="secondary" className="font-mono text-[11px]">{product.productCode}</Badge>
                  <Badge variant="outline" className="text-[11px]">v{product.version}</Badge>
                </SheetTitle>
                <SheetDescription className="text-xs text-muted-foreground">
                  제형 {product.dosageForm ?? "—"} · 상태 {WORKLOAD_STATUS_LABEL[product.status]}
                  {product.effectiveFrom && ` · 적용 ${product.effectiveFrom}`}
                </SheetDescription>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => setShowHistory(true)}>
                  <History /> 변경이력
                </Button>
                {canEdit && (
                  <Button size="sm" onClick={onEditProduct}>
                    <Pencil /> 수정
                  </Button>
                )}
              </div>
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto bg-muted/30 px-5 py-4">
            <div className="grid gap-4">
              {/* 요약 */}
              <section className="rounded-lg border bg-card p-4 shadow-sm">
                <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
                  <div className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
                    <p className="text-[11px] font-medium text-muted-foreground">표준 소요일</p>
                    <p className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                      {formatLeadDays(product.standardLeadTimeDays)}
                    </p>
                  </div>
                  {summary.map(s => (
                    <div key={s.label} className="rounded-lg border bg-background px-3 py-2.5">
                      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
                        <span className={`size-1.5 rounded-full ${s.dot}`} />
                        {s.label}
                      </p>
                      <p className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
                        {formatMinutes(s.value)}
                      </p>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] text-muted-foreground">
                  공수 4종은 각각 독립적으로 관리합니다. 표준 소요일은 공수 합계로 계산하지 않습니다.
                </p>
              </section>

              {/* 시험항목 */}
              <section className="overflow-hidden rounded-lg border bg-card shadow-sm">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
                  <span className="text-sm font-semibold text-foreground">
                    시험항목 <span className="text-muted-foreground">({product.testItems.length})</span>
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      작업단계 {product.stepCount}개
                    </span>
                  </span>
                  {canEdit && (
                    <Button size="sm" onClick={() => setItemDialog({ initial: null })}>
                      <Plus /> 시험항목 추가
                    </Button>
                  )}
                </div>

                {product.testItems.length === 0 ? (
                  <div className="py-16 text-center text-sm text-muted-foreground">
                    등록된 시험항목이 없습니다. 시험항목을 추가한 뒤 작업단계에 공수를 입력하세요.
                  </div>
                ) : (
                  <Table>
                    <colgroup>
                      <col className="w-[7%]" />
                      <col className="w-[19%]" />
                      <col className="w-[11%]" />
                      <col className="w-[11%]" />
                      <col className="w-[10%]" />
                      <col className="w-[10%]" />
                      <col className="w-[11%]" />
                      <col className="w-[10%]" />
                      {canEdit && <col className="w-[11%]" />}
                    </colgroup>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="px-3 text-muted-foreground">순서</TableHead>
                        <TableHead className="px-3 text-muted-foreground">시험항목</TableHead>
                        <TableHead className="px-3 text-right text-muted-foreground">인적공수</TableHead>
                        <TableHead className="px-3 text-right text-muted-foreground">기기공수</TableHead>
                        <TableHead className="px-3 text-right text-muted-foreground">대기시간</TableHead>
                        <TableHead className="px-3 text-right text-muted-foreground">검토공수</TableHead>
                        <TableHead className="px-3 text-muted-foreground">필요기기</TableHead>
                        <TableHead className="px-3 text-muted-foreground">난이도</TableHead>
                        {canEdit && (
                          <TableHead className="px-3 text-center text-muted-foreground">
                            <span className="sr-only">관리</span>
                          </TableHead>
                        )}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {product.testItems.map(item => {
                        const isOpen = expanded.has(item.id)
                        const equipments = [
                          ...new Set(
                            item.steps
                              .filter(s => s.workloadType === "EQUIPMENT")
                              .map(s => s.equipmentTypeName)
                              .filter((v): v is string => !!v),
                          ),
                        ]
                        return (
                          <TestItemRows
                            key={item.id}
                            item={item}
                            isOpen={isOpen}
                            equipments={equipments}
                            canEdit={canEdit}
                            busyId={busyId}
                            colSpan={canEdit ? 9 : 8}
                            onToggle={() => toggle(item.id)}
                            onEditItem={() => setItemDialog({ initial: item })}
                            onDeleteItem={() => void deleteTestItem(item)}
                            onAddStep={() => setStepDialog({ item, initial: null })}
                            onEditStep={step => setStepDialog({ item, initial: step })}
                            onDeleteStep={step => void deleteStep(step)}
                          />
                        )
                      })}
                    </TableBody>
                  </Table>
                )}
              </section>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {showHistory && (
        <VersionHistoryDialog open product={product} onClose={() => setShowHistory(false)} />
      )}

      {itemDialog && (
        <TestItemDialog
          key={itemDialog.initial?.id ?? "add-item"}
          open
          productId={product.id}
          initial={itemDialog.initial}
          defaultSequence={product.testItems.length + 1}
          onClose={() => setItemDialog(null)}
          onSaved={savedId => {
            setItemDialog(null)
            // 새 시험항목은 바로 펼쳐 작업단계를 이어서 등록하도록 한다.
            if (savedId) setExpanded(prev => new Set(prev).add(savedId))
            onChanged()
          }}
          onError={onError}
        />
      )}

      {stepDialog && (
        <StepDialog
          key={stepDialog.initial?.id ?? `add-step-${stepDialog.item.id}`}
          open
          testItem={stepDialog.item}
          initial={stepDialog.initial}
          equipmentOptions={equipmentOptions}
          onClose={() => setStepDialog(null)}
          onSaved={() => {
            setStepDialog(null)
            onChanged()
          }}
          onError={onError}
        />
      )}
    </>
  )
}

// ─── 시험항목 행 + 펼침(작업단계) ─────────────────────────────────────────────

function TestItemRows({
  item, isOpen, equipments, canEdit, busyId, colSpan,
  onToggle, onEditItem, onDeleteItem, onAddStep, onEditStep, onDeleteStep,
}: {
  item: ProductTestItem
  isOpen: boolean
  equipments: string[]
  canEdit: boolean
  busyId: string | null
  colSpan: number
  onToggle: () => void
  onEditItem: () => void
  onDeleteItem: () => void
  onAddStep: () => void
  onEditStep: (step: TestWorkStep) => void
  onDeleteStep: (step: TestWorkStep) => void
}) {
  const stepById = new Map(item.steps.map(s => [s.id, s]))

  return (
    <>
      <TableRow className="cursor-pointer hover:bg-muted/40" onClick={onToggle}>
        <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            {isOpen ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
            {item.sequence}
          </span>
        </TableCell>
        <TableCell className="px-3 py-2.5">
          <span className="block truncate font-medium text-foreground" title={item.testName}>
            {item.testName}
          </span>
          <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {item.testCode && <span className="font-mono">{item.testCode}</span>}
            <span>단계 {item.steps.length}</span>
            {item.simultaneousAnalysisAllowed && <span className="text-primary">동시분석</span>}
          </span>
        </TableCell>
        <TableCell className="px-3 py-2.5 text-right text-sm tabular-nums">{formatMinutes(item.humanMinutes)}</TableCell>
        <TableCell className="px-3 py-2.5 text-right text-sm tabular-nums">{formatMinutes(item.equipmentMinutes)}</TableCell>
        <TableCell className="px-3 py-2.5 text-right text-sm tabular-nums">{formatMinutes(item.waitingMinutes)}</TableCell>
        <TableCell className="px-3 py-2.5 text-right text-sm tabular-nums">{formatMinutes(item.reviewMinutes)}</TableCell>
        <TableCell className="px-3 py-2.5 text-xs text-muted-foreground">
          {equipments.length > 0 ? equipments.join(", ") : "—"}
        </TableCell>
        <TableCell className="px-3 py-2.5">
          <Badge variant="outline" className="gap-1.5 font-normal">
            <span className={`size-1.5 rounded-full ${DIFFICULTY_DOT[item.difficulty]}`} />
            {DIFFICULTY_LABEL[item.difficulty]}
          </Badge>
          <span className="mt-0.5 block text-[11px] text-muted-foreground">
            {item.parallelAllowed ? "병렬 가능" : "병렬 불가"}
          </span>
        </TableCell>
        {canEdit && (
          <TableCell className="px-3 py-2.5 text-center">
            <div className="flex items-center justify-center gap-0.5">
              <Button
                variant="ghost" size="icon-sm" title="시험항목 수정"
                className="text-muted-foreground"
                onClick={e => { e.stopPropagation(); onEditItem() }}
              >
                <Pencil />
              </Button>
              <Button
                variant="ghost" size="icon-sm" title="시험항목 삭제"
                className="text-muted-foreground hover:text-destructive"
                disabled={busyId === item.id}
                onClick={e => { e.stopPropagation(); onDeleteItem() }}
              >
                {busyId === item.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
              </Button>
            </div>
          </TableCell>
        )}
      </TableRow>

      {isOpen && (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={colSpan} className="bg-muted/40 px-3 py-3">
            <div className="rounded-lg border bg-card p-3">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-semibold text-foreground">작업단계</span>
                {canEdit && (
                  <Button variant="outline" size="sm" onClick={onAddStep}>
                    <Plus /> 작업단계 추가
                  </Button>
                )}
              </div>

              {item.steps.length === 0 ? (
                <p className="py-6 text-center text-xs text-muted-foreground">
                  등록된 작업단계가 없습니다. 공수는 작업단계에 입력합니다.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {item.steps.map(step => (
                    <div
                      key={step.id}
                      className="flex flex-wrap items-center gap-2 rounded-md border bg-background px-3 py-2 text-sm"
                    >
                      <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">{step.sequence}</span>
                      <span className="min-w-32 flex-1 truncate font-medium text-foreground" title={step.stepName}>
                        {step.stepName}
                      </span>
                      <WorkloadTypeBadge type={step.workloadType} short />
                      <span className="w-20 text-xs text-muted-foreground">
                        {step.workloadType === "EQUIPMENT" ? (step.equipmentTypeName ?? "—") : ""}
                      </span>
                      <span className="w-24 text-right font-medium tabular-nums text-foreground">
                        {formatMinutes(step.durationMinutes)}
                      </span>
                      <span className="w-40 truncate text-[11px] text-muted-foreground">
                        {step.predecessorStepId
                          ? `선행: ${stepById.get(step.predecessorStepId)?.stepName ?? "—"}`
                          : ""}
                        {step.requiredSkill ? ` · 역량 ${step.requiredSkill}` : ""}
                      </span>
                      {canEdit && (
                        <span className="ml-auto flex items-center gap-0.5">
                          <Button
                            variant="ghost" size="icon-sm" title="작업단계 수정"
                            className="text-muted-foreground"
                            onClick={() => onEditStep(step)}
                          >
                            <Pencil />
                          </Button>
                          <Button
                            variant="ghost" size="icon-sm" title="작업단계 삭제"
                            className="text-muted-foreground hover:text-destructive"
                            disabled={busyId === step.id}
                            onClick={() => onDeleteStep(step)}
                          >
                            {busyId === step.id ? <Loader2 className="animate-spin" /> : <Trash2 />}
                          </Button>
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  )
}
