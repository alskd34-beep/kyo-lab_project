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

import { useEffect, useRef, useState } from "react"
import { format, parse, isValid } from "date-fns"
import { Calendar as CalendarIcon } from "lucide-react"
import { Button } from "@frontend/components/ui/button"
import { Calendar } from "@frontend/components/ui/calendar"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@frontend/components/ui/popover"

// ─── 마스킹 유틸 ──────────────────────────────────────────────────────────────
/** 숫자만 추출 후 YYYY.MM.DD 마스크 적용 */
function applyMask(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 8)
  if (d.length <= 4) return d
  if (d.length <= 6) return `${d.slice(0, 4)}.${d.slice(4)}`
  return `${d.slice(0, 4)}.${d.slice(4, 6)}.${d.slice(6)}`
}

/** 마스킹된 값(YYYY.MM.DD) → ISO(yyyy-MM-dd). 불완전하거나 잘못된 날짜면 null */
function maskedToIso(masked: string): string | null {
  const d = masked.replace(/\D/g, "")
  if (d.length !== 8) return null
  const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6)}`
  const date = parse(iso, "yyyy-MM-dd", new Date())
  return isValid(date) ? iso : null
}

/** ISO → 마스킹 표시(YYYY.MM.DD) */
function isoToMasked(iso: string): string {
  if (!iso) return ""
  return applyMask(iso.replace(/-/g, ""))
}

// ─── Props ───────────────────────────────────────────────────────────────────
interface DateFieldProps {
  label?: string
  helper?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
  /** "sm" = h-8 text-xs  /  "md"(기본) = h-10 text-sm */
  size?: "sm" | "md"
  /** 라벨 없이 입력 행만 렌더링 */
  noLabel?: boolean
}

// ─── Component ────────────────────────────────────────────────────────────────
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
  // 표시용 마스크 문자열 (입력 중 중간 상태 유지)
  const [inputVal, setInputVal] = useState(() => isoToMasked(value))
  const inputRef = useRef<HTMLInputElement>(null)

  const heightCls = size === "sm" ? "h-8" : "h-10"
  const textCls   = size === "sm" ? "text-xs" : "text-sm"

  // ── 달력에서 선택 ──────────────────────────────────────────────────────────
  const handleCalendarSelect = (date: Date | undefined) => {
    const iso = date ? format(date, "yyyy-MM-dd") : ""
    onChange(iso)
    setInputVal(isoToMasked(iso))
    setOpen(false)
  }

  // ── 키보드 직접 입력 ───────────────────────────────────────────────────────
  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = applyMask(e.target.value)
    setInputVal(masked)
    const iso = maskedToIso(masked)
    if (iso) onChange(iso)
    else if (masked === "") onChange("")
  }

  // 붙여넣기: 숫자 8자리 붙여넣으면 즉시 확정
  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData("text")
    const masked = applyMask(pasted)
    setInputVal(masked)
    const iso = maskedToIso(masked)
    if (iso) onChange(iso)
  }

  // 포커스 해제 시: 불완전한 입력이면 기존 value 로 복원
  const handleBlur = () => {
    const iso = maskedToIso(inputVal)
    if (!iso) setInputVal(isoToMasked(value))
  }

  // 외부 value 변경 시 표시 동기화 (단, 포커스 중엔 유지)
  useEffect(() => {
    // ref·activeElement 접근은 렌더 중이 아닌 effect 안에서 수행
    const isFocused = document.activeElement === inputRef.current
    if (isFocused) return
    const expected = isoToMasked(value)
    if (inputVal !== expected && maskedToIso(inputVal) !== value) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 외부 value(prop) 변경을 표시 상태에 동기화
      setInputVal(expected)
    }
  }, [value, inputVal])

  // ── 입력 행 ───────────────────────────────────────────────────────────────
  const inputRow = (
    <div className={`relative flex w-full items-center rounded-lg border border-slate-200 bg-white ${heightCls} focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100`}>
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={inputVal}
        onChange={handleInputChange}
        onPaste={handlePaste}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        className={`flex-1 bg-transparent pl-3 pr-0 ${textCls} text-slate-800 placeholder:text-slate-400 outline-none disabled:cursor-not-allowed disabled:opacity-50`}
      />
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            className={`flex ${size === "sm" ? "w-8" : "w-9"} shrink-0 items-center justify-center self-stretch rounded-r-lg text-slate-400 hover:text-blue-500 disabled:cursor-not-allowed disabled:opacity-50`}
          >
            <CalendarIcon size={size === "sm" ? 13 : 15} />
          </button>
        </PopoverTrigger>
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
                  handleCalendarSelect(new Date())
                }}
                className="h-8 px-2.5 text-xs text-slate-600"
              >
                오늘
              </Button>
            </div>
          )}
          <Calendar
            mode="single"
            selected={value ? parse(value, "yyyy-MM-dd", new Date()) : undefined}
            onSelect={handleCalendarSelect}
            className="shadow-none"
          />
        </PopoverContent>
      </Popover>
    </div>
  )

  if (noLabel) return inputRow

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
      {inputRow}
    </div>
  )
}
