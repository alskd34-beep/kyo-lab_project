"use client"

import { useState } from "react"
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react"

import { cn } from "@frontend/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@frontend/components/ui/popover"

export type SortDir = "asc" | "desc"

export interface SortOption<F extends string = string> {
  id: F
  label: string
}

export interface SortColumnDef<F extends string = string> {
  key: string
  label: string
  fields: SortOption<F>[]
}

export function sortCol<F extends string>(id: F, label: string): SortColumnDef<F> {
  return { key: id, label, fields: [{ id, label }] }
}

function SortDirButton({
  dir,
  active,
  label,
  onClick,
}: {
  dir: SortDir
  active: boolean
  label: string
  onClick: () => void
}) {
  const Icon = dir === "asc" ? ArrowUp : ArrowDown
  return (
    <button
      type="button"
      title={label}
      onClick={(e) => { e.stopPropagation(); onClick() }}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors",
        "hover:bg-muted hover:text-foreground",
        active && "border-primary bg-primary/10 text-primary",
      )}
    >
      <Icon className="size-3.5" />
    </button>
  )
}

export function SortColumnHeader<F extends string>({
  col,
  sortField,
  sortDir,
  onPick,
}: {
  col: SortColumnDef<F>
  sortField: F | null
  sortDir: SortDir
  onPick: (field: F, dir: SortDir) => void
}) {
  const [open, setOpen] = useState(false)
  const active = col.fields.some((f) => f.id === sortField)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex max-w-full items-center gap-1 text-left text-sm font-medium text-muted-foreground",
            "hover:text-foreground",
            active && "text-foreground",
          )}
        >
          <span className="truncate">{col.label}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" sideOffset={6} className="w-56 gap-0 p-1.5">
        {col.fields.map((opt) => {
          const isField = sortField === opt.id
          return (
            <div
              key={opt.id}
              className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5"
            >
              <span className={cn("min-w-0 truncate text-sm", isField && "font-medium text-foreground")}>
                {opt.label}
              </span>
              <div className="flex shrink-0 items-center gap-1">
                <SortDirButton
                  dir="asc"
                  active={isField && sortDir === "asc"}
                  label={`${opt.label} 오름차순`}
                  onClick={() => { onPick(opt.id, "asc"); setOpen(false) }}
                />
                <SortDirButton
                  dir="desc"
                  active={isField && sortDir === "desc"}
                  label={`${opt.label} 내림차순`}
                  onClick={() => { onPick(opt.id, "desc"); setOpen(false) }}
                />
              </div>
            </div>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

SortColumnHeader.displayName = "SortColumnHeader"
