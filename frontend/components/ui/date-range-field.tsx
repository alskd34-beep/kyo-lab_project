"use client"

/**
 * DateRangeField — 기간(시작~종료) 선택 컴포넌트
 *
 * startDate / endDate / onChange 는 "yyyy-MM-dd" ISO 문자열 기준.
 */

import { useState } from "react"
import { format, parse } from "date-fns"
import { ko } from "date-fns/locale"
import { Calendar as CalendarIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { cn } from "@frontend/lib/utils"
import { Calendar } from "@frontend/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@frontend/components/ui/popover"

const toIso = (d: Date) => format(d, "yyyy-MM-dd")
const toDate = (s: string): Date | undefined =>
  s ? parse(s, "yyyy-MM-dd", new Date()) : undefined
const fmt = (s: string) => (s ? s.replace(/-/g, ".") : "")

interface Props {
  startDate: string
  endDate: string
  onChange: (start: string, end: string) => void
  label?: string
  disabled?: boolean
}

export function DateRangeField({
  startDate,
  endDate,
  onChange,
  label,
  disabled,
}: Props) {
  const [open, setOpen] = useState(false)

  const range: DateRange | undefined = startDate
    ? { from: toDate(startDate), to: toDate(endDate) }
    : undefined

  const handleSelect = (r: DateRange | undefined) => {
    const from = r?.from
    const to = r?.to
    const start = from ? toIso(from) : ""
    const end = to ? toIso(to) : start
    onChange(start, end)
    if (from && to) setOpen(false)
  }

  const cell = (caption: string, value: string) => (
    <span className="flex flex-1 flex-col justify-center gap-0.5 px-3 py-1.5">
      <span className="text-[10px] font-medium text-muted-foreground">{caption}</span>
      <span
        className={cn(
          "flex items-center gap-1.5 text-sm",
          value ? "font-medium text-foreground" : "text-muted-foreground",
        )}
      >
        <CalendarIcon className="size-3.5 shrink-0 text-muted-foreground" />
        {value ? fmt(value) : "선택"}
      </span>
    </span>
  )

  return (
    <div className="grid gap-1.5">
      {label && (
        <label className="text-xs font-medium text-foreground">{label}</label>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="flex w-full items-stretch overflow-hidden rounded-md border border-input bg-background text-left outline-none transition-colors hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cell("시작일", startDate)}
            <span className="flex items-center px-1 text-muted-foreground">~</span>
            {cell("종료일", endDate)}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <PopoverHeader className="px-3 pt-3">
            <PopoverTitle>기간 선택</PopoverTitle>
            <PopoverDescription>
              시작일을 클릭한 뒤 종료일을 클릭하세요. 하루만 필요하면 시작일만 선택합니다.
            </PopoverDescription>
          </PopoverHeader>
          <Calendar
            mode="range"
            selected={range}
            onSelect={handleSelect}
            defaultMonth={toDate(startDate)}
            locale={ko}
            numberOfMonths={1}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
