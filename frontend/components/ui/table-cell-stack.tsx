"use client"

import type { ReactNode } from "react"

import { cn } from "@frontend/lib/utils"

export function CellStack({
  primary,
  secondary,
  primaryClass,
  title,
}: {
  primary: ReactNode
  secondary?: ReactNode
  primaryClass?: string
  title?: string
}) {
  return (
    <div className="min-w-0" title={title}>
      <div className={cn("truncate", primaryClass)}>{primary}</div>
      {secondary ? <div className="truncate text-[11px] leading-4 text-muted-foreground">{secondary}</div> : null}
    </div>
  )
}
