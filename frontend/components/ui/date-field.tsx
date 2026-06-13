"use client"

/**
 * DateField — 공통 날짜 선택 컴포넌트
 *
 * 사용법:
 *   <DateField label="포장일" value={form.date} onChange={v => setForm({...form, date: v})} />
 *
 * value / onChange 모두 "yyyy-MM-dd" ISO 문자열 기준.
 * placeholder, helper, disabled, size("sm"|"md") 선택 가능.
 */

import { useState } from "react"
import { format, parse, isValid } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"
import { Button } from "@frontend/components/ui/button"
import { Calendar } from "@frontend/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@frontend/components/ui/popover"

interface DateFieldProps {
  label?: string
  helper?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  /** "sm" = h-8 text-xs, "md"(default) = h-10 text-sm */
  size?: "sm" | "md"
  /** 라벨 없이 트리거 버튼만 렌더링할 때 true */
  noLabel?: boolean
}

function parseDateValue(value: string): Date | undefined {
  if (!value) return undefined
  const d = parse(value, "yyyy-MM-dd", new Date())
  return isValid(d) ? d : undefined
}

function formatDateLabel(value: string): string {
  const d = parseDateValue(value)
  return d ? format(d, "yyyy.MM.dd") : ""
}

export function DateField({
  label,
  helper,
  value,
  onChange,
  placeholder = "날짜 선택",
  disabled,
  size = "md",
  noLabel = false,
}: DateFieldProps) {
  const [open, setOpen] = useState(false)
  const selectedDate = parseDateValue(value)

  const heightCls = size === "sm" ? "h-8" : "h-10"
  const textCls   = size === "sm" ? "text-xs" : "text-sm"

  const trigger = (
    <Button
      type="button"
      variant="outline"
      disabled={disabled}
      className={`${heightCls} w-full justify-between rounded-lg border-slate-200 bg-white px-3 ${textCls} font-normal text-slate-700 shadow-none hover:bg-slate-50`}
    >
      <span className={`truncate ${value ? "text-slate-800" : "text-slate-400"}`}>
        {value ? formatDateLabel(value) : placeholder}
      </span>
      <CalendarIcon size={size === "sm" ? 13 : 15} className="shrink-0 text-slate-400" />
    </Button>
  )

  const popover = (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={8}
        className="w-auto min-w-[17rem] rounded-2xl border border-slate-100 bg-white p-0 shadow-2xl"
      >
        {(label || helper) && (
          <div className="flex items-start justify-between gap-3 px-4 pt-3 pb-1">
            <div>
              {label && <p className="text-sm font-semibold text-slate-800">{label}</p>}
              <p className="text-[11px] text-slate-500">
                {helper ?? "날짜를 선택하면 바로 반영됩니다."}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                onChange(format(new Date(), "yyyy-MM-dd"))
                setOpen(false)
              }}
              className="h-8 px-2.5 text-xs text-slate-600"
            >
              오늘
            </Button>
          </div>
        )}
        <Calendar
          mode="single"
          selected={selectedDate}
          onSelect={(date) => {
            onChange(date ? format(date, "yyyy-MM-dd") : "")
            setOpen(false)
          }}
          className="shadow-none"
        />
      </PopoverContent>
    </Popover>
  )

  if (noLabel) return popover

  return (
    <div>
      {label && (
        <label className="mb-1.5 block text-xs font-semibold text-slate-600">
          {label}
          {helper && (
            <span className="ml-1 text-[10px] font-normal text-slate-400">{helper}</span>
          )}
        </label>
      )}
      {popover}
    </div>
  )
}
