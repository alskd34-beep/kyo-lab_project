"use client"

/**
 * DateRangeField — 노션 스타일 기간(시작~종료) 선택 컴포넌트
 *
 * 시작일/종료일 칸이 시각적으로 구분되어 있고, 어느 칸을 눌러도 팝오버 달력이 열린다.
 * 시작일을 클릭한 뒤 종료일을 클릭하면 범위가 하이라이트되며 자동 반영된다.
 * (단일일은 시작일만 선택해도 됨)
 *
 * startDate / endDate / onChange 는 "yyyy-MM-dd" ISO 문자열 기준.
 */

import { useState } from "react"
import { format, parse } from "date-fns"
import { ko } from "date-fns/locale"
import { Calendar as CalendarIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { Calendar } from "@frontend/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@frontend/components/ui/popover"

const iso = (d: Date) => format(d, "yyyy-MM-dd")
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
    const start = from ? iso(from) : ""
    // 종료 미선택이면 시작일과 동일(단일일). 시작 미선택이면 비움.
    const end = to ? iso(to) : start
    onChange(start, end)
    // 시작·종료가 모두 선택돼 범위가 완성되면 닫는다.
    if (from && to) setOpen(false)
  }

  // 한 칸(시작일/종료일) 렌더
  const cell = (caption: string, value: string) => (
    <span className="flex flex-1 flex-col justify-center gap-0.5 px-3 py-1.5">
      <span className="text-[10px] font-semibold tracking-wide text-slate-400">
        {caption}
      </span>
      <span
        className={`flex items-center gap-1.5 text-sm ${
          value ? "font-medium text-slate-800" : "text-slate-400"
        }`}
      >
        <CalendarIcon size={13} className="shrink-0 text-slate-400" />
        {value ? fmt(value) : "선택"}
      </span>
    </span>
  )

  return (
    <div>
      {label && (
        <label className="mb-1.5 block text-xs font-semibold text-slate-600">
          {label}
        </label>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className="flex w-full items-stretch overflow-hidden rounded-lg border border-slate-200 bg-white text-left outline-none transition-colors hover:border-slate-300 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {cell("시작일", startDate)}
            <span className="flex items-center px-1 text-base text-slate-300">~</span>
            {cell("종료일", endDate)}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          sideOffset={8}
          className="w-auto rounded-2xl border border-slate-100 bg-white p-0 shadow-2xl"
        >
          <div className="px-4 pt-3 pb-1">
            <p className="text-sm font-semibold text-slate-800">기간 선택</p>
            <p className="text-[11px] text-slate-500">
              시작일을 클릭한 뒤 종료일을 클릭하세요. (단일일은 시작일만 선택)
            </p>
          </div>
          <Calendar
            mode="range"
            selected={range}
            onSelect={handleSelect}
            defaultMonth={toDate(startDate)}
            locale={ko}
            numberOfMonths={1}
            className="shadow-none"
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
