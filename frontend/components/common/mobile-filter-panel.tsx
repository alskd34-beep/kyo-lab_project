"use client"

/**
 * MobileFilterPanel — 모바일에서 조회 옵션을 접는다.
 *
 * 목록 화면의 상단(탭 · 상태 요약 · 조회조건)은 데스크톱에서는 한눈에 들어오지만
 * 좁은 화면에서는 세로로 400px 가까이 쌓여 **정작 봐야 할 목록을 화면 밖으로 밀어낸다.**
 * 모바일에서는 기본으로 접고, 지금 무엇으로 보고 있는지만 한 줄로 남긴다.
 *
 * `sm`(640px) 이상에서는 접기 자체가 없다 — 옵션이 항상 펼쳐진 지금 모습 그대로다.
 *
 * ```tsx
 * <MobileFilterPanel summary={`주차별 · 전체 ${rows.length}건`}>
 *   <Tabs /> <StatusSummary /> <FilterBar />
 * </MobileFilterPanel>
 * ```
 */

import { useState, type ReactNode } from "react"
import { ChevronDown, SlidersHorizontal, type LucideIcon } from "lucide-react"

import { cn } from "@frontend/lib/utils"

export function MobileFilterPanel({
  summary,
  children,
  className,
  label = "조회 옵션",
  icon: Icon = SlidersHorizontal,
}: {
  /** 접혀 있을 때 한 줄로 보여 줄 현재 상태(예: `주차별 · 전체 14건`) */
  summary: ReactNode
  children: ReactNode
  className?: string
  label?: string
  /** 막대 왼쪽 아이콘. 조회조건이 아니라 지표 요약을 접을 때 바꿔 단다(기본: 조절 손잡이). */
  icon?: LucideIcon
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className={cn("flex min-w-0 shrink-0 flex-col gap-3", className)}>
      {/* 접기 막대 — 모바일 전용 */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className={cn(
          "flex min-h-9 w-full min-w-0 shrink-0 items-center gap-2 rounded-md border bg-card px-3 py-1.5 text-left",
          "transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
          "sm:hidden",
        )}
      >
        <Icon className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-xs leading-normal text-muted-foreground">
          {summary}
        </span>
        <span className="shrink-0 text-xs leading-normal font-medium text-primary">{label}</span>
        <ChevronDown
          className={cn(
            "size-3.5 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {/* 옵션 본체 — 모바일은 접힘/펼침, sm 부터는 항상 보인다 */}
      <div
        className={cn(
          "min-w-0 flex-col gap-3",
          open ? "flex" : "hidden",
          "sm:flex",
        )}
      >
        {children}
      </div>
    </div>
  )
}
