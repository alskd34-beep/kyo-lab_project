"use client"

import { cn } from "@frontend/lib/utils"

export type StatusFilterValue = "all" | "active" | "inactive"

/**
 * 목록 상단 요약 영역에 붙이는 활성/비활성 필터. 세 값 중 하나만 선택되는
 * 세그먼트 버튼으로, 이 프로젝트의 기존 탭 버튼 패턴(스케줄/시험자 관리 등)과 통일한다.
 */
export function StatusFilterTabs({
  value,
  onChange,
  counts,
  activeLabel = "활성",
  inactiveLabel = "비활성",
  className,
}: {
  value: StatusFilterValue
  onChange: (v: StatusFilterValue) => void
  counts: { all: number; active: number; inactive: number }
  activeLabel?: string
  inactiveLabel?: string
  className?: string
}) {
  const tabs: { key: StatusFilterValue; label: string; count: number }[] = [
    { key: "all", label: "전체", count: counts.all },
    { key: "active", label: activeLabel, count: counts.active },
    { key: "inactive", label: inactiveLabel, count: counts.inactive },
  ]
  return (
    <div
      className={cn(
        "inline-flex h-9 items-center gap-0.5 rounded-lg bg-muted p-0.5 text-muted-foreground",
        className,
      )}
    >
      {tabs.map((t) => (
        <button
          key={t.key}
          type="button"
          onClick={() => onChange(t.key)}
          aria-pressed={value === t.key}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
            value === t.key ? "bg-card text-foreground shadow-sm" : "hover:text-foreground",
          )}
        >
          {t.label}
          <span className="text-xs tabular-nums opacity-70">{t.count}</span>
        </button>
      ))}
    </div>
  )
}
