"use client"

import type { ReactNode } from "react"

import { cn } from "@frontend/lib/utils"

/**
 * 한 칸에 주·보조 값을 넣는다.
 * 표가 넓으면 Table 이 헤더·내용의 한글 자수 최소 폭을 비교해 보조줄을 별도 컬럼으로 올린다.
 * 칸 안에서는 여유가 있을 때 같은 줄에 나란히 두기도 한다.
 */
export function CellStack({
  primary,
  secondary,
  secondaryLabel,
  primaryClass,
  title,
}: {
  primary: ReactNode
  secondary?: ReactNode
  /** 표가 넓어 보조줄을 별도 컬럼으로 올릴 때 쓰는 헤더. 없으면 정렬 필드의 다음 라벨을 쓴다. */
  secondaryLabel?: string
  primaryClass?: string
  title?: string
}) {
  return (
    <div className="@container min-w-0" title={title} data-secondary-label={secondaryLabel}>
      <div
        className={cn(
          "flex min-w-0 flex-col",
          secondary && "@min-[12.5rem]:flex-row @min-[12.5rem]:items-baseline @min-[12.5rem]:gap-x-2",
        )}
      >
        <div className={cn("min-w-0 truncate", primaryClass)}>{primary}</div>
        {secondary ? (
          <div className="min-w-0 truncate text-xs leading-4 text-muted-foreground">{secondary}</div>
        ) : null}
      </div>
    </div>
  )
}

CellStack.displayName = "CellStack"
