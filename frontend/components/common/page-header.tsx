"use client"

import type { LucideIcon } from "lucide-react"
import type { ReactNode } from "react"

import { cn } from "@frontend/lib/utils"

/** 헤더에 인라인으로 붙이는 요약 수치 한 칸. */
export interface PageStat {
  label: string
  value: ReactNode
  /** 수치 강조색. 기본은 본문색, 지표 성격에 따라 blue/amber 사용. */
  tone?: "default" | "blue" | "amber"
}

const STAT_TONE: Record<NonNullable<PageStat["tone"]>, string> = {
  default: "text-foreground",
  blue: "text-blue-600 dark:text-blue-400",
  amber: "text-amber-700 dark:text-amber-400",
}

/**
 * 목록 화면 공통 헤더.
 *
 * 예전 마스터 화면들은 `KPI 카드 3장 → 상태 탭 → 제목 → 분류 탭`이 세로로 쌓여
 * 어디가 화면 제목이고 어디가 필터인지 구분되지 않았다. 제목·설명·요약 수치·주요 액션을
 * 한 덩어리로 묶고, 필터는 아래 `FilterBar` **한 줄**로만 두어 위계를 정리한다.
 */
export function PageHeader({
  icon: Icon,
  title,
  count,
  countSuffix = "건",
  description,
  stats,
  actions,
  className,
}: {
  icon?: LucideIcon
  title: string
  /** 제목 옆 총 건수. 생략하면 표시하지 않는다. */
  count?: number
  countSuffix?: string
  description?: ReactNode
  stats?: PageStat[]
  actions?: ReactNode
  className?: string
}) {
  return (
    <header
      className={cn(
        "flex shrink-0 flex-wrap items-start justify-between gap-x-4 gap-y-3",
        className,
      )}
    >
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          {Icon && <Icon className="size-5 shrink-0 text-muted-foreground" />}
          <h1 className="truncate text-lg font-semibold text-foreground">{title}</h1>
          {count != null && (
            <span className="text-sm font-medium tabular-nums text-muted-foreground">
              {count.toLocaleString("ko-KR")}
              {countSuffix}
            </span>
          )}
        </div>

        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}

        {stats && stats.length > 0 && (
          <dl className="mt-2.5 flex flex-wrap items-center gap-x-2 gap-y-1.5">
            {stats.map((stat, i) => (
              <div key={stat.label} className="flex items-center gap-2">
                {i > 0 && <span aria-hidden className="h-3 w-px bg-border" />}
                <div className="flex items-baseline gap-1.5">
                  <dt className="text-xs text-muted-foreground">{stat.label}</dt>
                  <dd
                    className={cn(
                      "text-sm font-semibold tabular-nums",
                      STAT_TONE[stat.tone ?? "default"],
                    )}
                  >
                    {stat.value}
                  </dd>
                </div>
              </div>
            ))}
          </dl>
        )}
      </div>

      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  )
}

/**
 * 헤더 아래 **필터 한 줄**. 검색·드롭다운 필터·초기화 버튼만 담는다.
 * 탭 모양 세그먼트를 여러 줄 쌓지 않기 위한 공통 컨테이너다.
 */
export function FilterBar({
  children,
  trailing,
  className,
}: {
  children: ReactNode
  /** 우측 끝에 붙는 보조 정보(표시 건수 등). */
  trailing?: ReactNode
  className?: string
}) {
  return (
    <div
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-2 rounded-md border bg-card px-2.5 py-2 shadow-sm",
        className,
      )}
    >
      {children}
      {trailing && (
        <div className="ml-auto flex items-center gap-2 pr-1 text-xs text-muted-foreground">
          {trailing}
        </div>
      )}
    </div>
  )
}
