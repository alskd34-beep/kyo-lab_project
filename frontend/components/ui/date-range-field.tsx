"use client"

/**
 * DateRangeField — 기간(시작~종료) 선택 **표준** 컴포넌트
 *
 * from-to 달력은 앱 전체에서 이 컴포넌트 하나로 통일한다.
 * 기준이 된 모양은 `/test-mgmt/test-status` 의 조회기간 필터다 —
 * 한 줄짜리 알약 버튼(`📅 2026.07.24 ~ 2026.08.24`) + 두 달을 나란히 펼친 팝오버.
 * 예전에는 그 화면만 Popover+Calendar 를 직접 조립해 쓰고 다른 화면은 이 컴포넌트를
 * 써서, 같은 "기간 고르기"가 화면마다 다르게 보였다.
 *
 * startDate / endDate / onChange 는 "yyyy-MM-dd" ISO 문자열 기준.
 */

import { useId, useState } from "react"
import { format, parse } from "date-fns"
import { ko } from "date-fns/locale"
import { Calendar as CalendarIcon } from "lucide-react"
import type { DateRange } from "react-day-picker"

import { cn } from "@frontend/lib/utils"
import { useIsMobile } from "@frontend/hooks/use-mobile"
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
  /**
   * 달력을 몇 달 펼칠지. 기본은 데스크톱 2달 · 모바일 1달로 알아서 접힌다.
   * 값을 넘기면 그 값이 상한이 되고, 모바일에서는 여전히 1달로 접힌다.
   */
  numberOfMonths?: number
  /**
   * @deprecated 표준 모양이 이미 한 줄짜리라 더 나눌 이유가 없다.
   * 남아 있는 호출부 호환을 위해 받기만 하고 동작은 같다.
   */
  compact?: boolean
  className?: string
}

export function DateRangeField({
  startDate,
  endDate,
  onChange,
  label,
  disabled,
  numberOfMonths = 2,
  className,
}: Props) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const triggerId = useId()

  // 320px 에서 두 달을 나란히 펼치면 팝오버가 화면을 넘어간다.
  const months = isMobile ? 1 : numberOfMonths

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

  return (
    <div className={cn("flex min-w-0 items-center gap-1.5", className)}>
      {label && (
        <label
          htmlFor={triggerId}
          className="shrink-0 text-xs font-medium break-keep text-muted-foreground"
        >
          {label}
        </label>
      )}

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={triggerId}
            disabled={disabled}
            /* 모바일에서는 한 줄을 꽉 채우고, sm 부터는 내용 폭만 차지한다. */
            className="inline-flex h-8 w-full min-w-0 items-center gap-1.5 rounded-md border border-input bg-background px-3 text-xs outline-none transition-colors hover:bg-muted/30 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            <CalendarIcon className="size-3.5 shrink-0 text-muted-foreground" />
            <span
              className={cn(
                "tabular-nums",
                startDate ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {startDate ? fmt(startDate) : "시작일"}
            </span>
            <span className="shrink-0 text-muted-foreground">~</span>
            <span
              className={cn(
                "tabular-nums",
                endDate ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {endDate ? fmt(endDate) : "종료일"}
            </span>
          </button>
        </PopoverTrigger>

        <PopoverContent align="start" className="w-auto max-w-[calc(100vw-2rem)] p-0">
          <PopoverHeader className="px-3 pt-3">
            <PopoverTitle>기간 선택</PopoverTitle>
            <PopoverDescription className="break-keep">
              시작일을 누른 뒤 종료일을 누르세요. 하루만 필요하면 시작일만 선택합니다.
            </PopoverDescription>
          </PopoverHeader>
          <Calendar
            mode="range"
            selected={range}
            onSelect={handleSelect}
            defaultMonth={toDate(startDate)}
            locale={ko}
            numberOfMonths={months}
          />
        </PopoverContent>
      </Popover>
    </div>
  )
}
