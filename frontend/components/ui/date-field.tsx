"use client"

/**
 * DateField — 공통 날짜 선택 컴포넌트
 *
 * 입력 방법 두 가지:
 *   1) 텍스트 직접 입력: 숫자 8자리 → 자동으로 YYYY.MM.DD 포맷
 *   2) 달력 아이콘 클릭 → 팝오버 달력에서 선택
 *
 * value / onChange 는 "yyyy-MM-dd" ISO 문자열 기준.
 */

import { useEffect, useId, useRef, useState } from "react"
import { format, isValid, parse } from "date-fns"
import { ko } from "date-fns/locale"
import { Calendar as CalendarIcon } from "lucide-react"

import { cn } from "@frontend/lib/utils"
import { Button } from "@frontend/components/ui/button"
import { Calendar } from "@frontend/components/ui/calendar"
import { Input } from "@frontend/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from "@frontend/components/ui/popover"

function applyMask(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8)
  if (d.length <= 4) return d
  if (d.length <= 6) return `${d.slice(0, 4)}.${d.slice(4)}`
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`
}

function maskedToIso(masked: string): string | null {
  const d = masked.replace(/\D/g, "")
  if (d.length !== 8) return null
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`
  const date = parse(iso, "yyyy-MM-dd", new Date())
  return isValid(date) ? iso : null
}

function isoToMasked(iso: string): string {
  if (!iso) return ""
  return applyMask(iso.replace(/-/g, ""))
}

interface DateFieldProps {
  label?: string
  helper?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  size?: "sm" | "md"
  noLabel?: boolean
}

export function DateField({
  label,
  helper,
  value,
  onChange,
  placeholder = "YYYY.MM.DD",
  disabled,
  size = "md",
  noLabel = false,
}: DateFieldProps) {
  const [open, setOpen] = useState(false)
  const [inputVal, setInputVal] = useState(() => isoToMasked(value))
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()

  const handleCalendarSelect = (date: Date | undefined) => {
    const iso = date ? format(date, "yyyy-MM-dd") : ""
    onChange(iso)
    setInputVal(isoToMasked(iso))
    setOpen(false)
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = applyMask(e.target.value)
    setInputVal(masked)
    const iso = maskedToIso(masked)
    if (iso) onChange(iso)
    else if (masked === "") onChange("")
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData("text")
    const masked = applyMask(pasted)
    setInputVal(masked)
    const iso = maskedToIso(masked)
    if (iso) onChange(iso)
  }

  const handleBlur = () => {
    const iso = maskedToIso(inputVal)
    if (!iso) setInputVal(isoToMasked(value))
  }

  useEffect(() => {
    const isFocused = document.activeElement === inputRef.current
    if (isFocused) return
    const expected = isoToMasked(value)
    if (inputVal !== expected && maskedToIso(inputVal) !== value) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 value(prop) 변경을 표시 상태에 동기화
      setInputVal(expected)
    }
  }, [value, inputVal])

  const inputRow = (
    <div className="relative">
      <Input
        ref={inputRef}
        id={inputId}
        type="text"
        inputMode="numeric"
        value={inputVal}
        onChange={handleInputChange}
        onPaste={handlePaste}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "pr-9 tabular-nums",
          size === "sm" && "h-8 text-xs",
        )}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={disabled}
            className="absolute top-1/2 right-1 -translate-y-1/2 text-muted-foreground"
          >
            <CalendarIcon />
            <span className="sr-only">달력 열기</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          {(label || helper) && (
            <PopoverHeader className="flex-row items-start justify-between gap-3 px-3 pt-3">
              <div>
                {label && <PopoverTitle>{label}</PopoverTitle>}
                <PopoverDescription>
                  {helper ?? "날짜를 선택하면 바로 반영됩니다."}
                </PopoverDescription>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => handleCalendarSelect(new Date())}
              >
                오늘
              </Button>
            </PopoverHeader>
          )}
          <Calendar
            mode="single"
            locale={ko}
            selected={value ? parse(value, "yyyy-MM-dd", new Date()) : undefined}
            onSelect={handleCalendarSelect}
            defaultMonth={value ? parse(value, "yyyy-MM-dd", new Date()) : undefined}
          />
        </PopoverContent>
      </Popover>
    </div>
  )

  if (noLabel) return inputRow

  return (
    <div className="grid gap-1.5">
      {label && (
        <label htmlFor={inputId} className="text-xs font-medium text-foreground">
          {label}
          {helper && (
            <span className="ml-1 font-normal text-muted-foreground">{helper}</span>
          )}
        </label>
      )}
      {inputRow}
    </div>
  )
}
