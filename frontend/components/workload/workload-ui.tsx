"use client"

/**
 * 품목별 시험공수 관리 화면 공용 조각 — KPI 카드 / 섹션 카드 / 공수구분 배지.
 *
 * 색상: 인적·기기·대기·검토는 "색 자체가 구분 의미"인 카테고리 팔레트라
 * 브랜드 단일색 규칙의 예외다. 브랜드 강조색이 필요한 자리는 primary/indigo 를 쓴다.
 */

import { Badge } from "@frontend/components/ui/badge"
import { Card } from "@frontend/components/ui/card"
import { cn } from "@frontend/lib/utils"
import { WORKLOAD_TYPE_LABEL, WORKLOAD_TYPE_SHORT, type WorkloadType } from "@shared/workload"

/** 차트(recharts)용 hex — Tailwind 클래스를 쓸 수 없는 자리 */
export const WORKLOAD_TYPE_HEX: Record<WorkloadType, string> = {
  HUMAN: "#6366f1",      // indigo-500
  EQUIPMENT: "#f59e0b",  // amber-500
  WAITING: "#94a3b8",    // slate-400
  REVIEW: "#10b981",     // emerald-500
}

/** 배지·점 표시용 Tailwind 클래스 */
export const WORKLOAD_TYPE_CLASS: Record<WorkloadType, { dot: string; chip: string }> = {
  HUMAN: { dot: "bg-indigo-500", chip: "border-indigo-200 bg-indigo-50 text-indigo-700" },
  EQUIPMENT: { dot: "bg-amber-500", chip: "border-amber-200 bg-amber-50 text-amber-700" },
  WAITING: { dot: "bg-slate-400", chip: "border-slate-200 bg-slate-100 text-slate-600" },
  REVIEW: { dot: "bg-emerald-500", chip: "border-emerald-200 bg-emerald-50 text-emerald-700" },
}

export function WorkloadTypeBadge({ type, short = false }: { type: WorkloadType; short?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium",
        WORKLOAD_TYPE_CLASS[type].chip,
      )}
    >
      <span className={cn("size-1.5 rounded-full", WORKLOAD_TYPE_CLASS[type].dot)} />
      {short ? WORKLOAD_TYPE_SHORT[type] : WORKLOAD_TYPE_LABEL[type]}
    </span>
  )
}

/** 상단 KPI 카드 */
export function KpiCard({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string
  value: string
  hint?: string
  icon?: React.ReactNode
  /** 왼쪽 보더 색 (기본: 브랜드 primary) */
  accent?: string
}) {
  return (
    <Card className={cn("gap-1 border-l-4 px-4 py-3.5", accent ?? "border-l-primary")}>
      <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="text-2xl font-semibold tabular-nums text-foreground">{value}</span>
      {hint && <span className="text-[11px] text-muted-foreground">{hint}</span>}
    </Card>
  )
}

/** 제목 + 설명을 가진 콘텐츠 카드 */
export function SectionCard({
  title,
  hint,
  action,
  children,
  className,
}: {
  title: string
  hint?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn("gap-0 overflow-hidden py-0", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {hint && <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  )
}

/** 상태/난이도처럼 값에 따라 점 색이 바뀌는 배지 */
export function DotBadge({ dotClass, children }: { dotClass: string; children: React.ReactNode }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={cn("size-1.5 rounded-full", dotClass)} />
      {children}
    </Badge>
  )
}
