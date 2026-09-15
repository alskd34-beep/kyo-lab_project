"use client"

/**
 * 오더 정보 식별 표 — 오더 추가 서랍(수동 등록)과 오더 수정 서랍이 **같은 모양·같은 칸 순서**로 쓴다.
 *
 *   ┌──────────┬──────────┐
 *   │ 품목코드  │ 제조번호  │
 *   ├──────────┼──────────┤
 *   │ 품목명    │ 구분      │
 *   └──────────┴──────────┘
 *
 * 칸마다 편집 가능 여부를 호출부가 정한다:
 *  - 자동 적재 오더: 네 칸 모두 읽기 전용(제조팀 시트가 원본)
 *  - 수동 오더: 입력 가능. 품목명을 뺀 칸은 N/A 토글을 둘 수 있다(규칙: @shared/order-na)
 * 읽기 전용 칸은 N/A 대체값을 "N/A" 로 보여 준다.
 */

import { cn } from "@frontend/lib/utils"
import { NA_LABEL } from "@shared/order-na"

export interface OrderInfoCell {
  /** 입력칸 값(편집 칸) 또는 표시값(읽기 전용 칸, 이미 display 처리된 값) */
  value: string
  editable: boolean
  /** N/A 토글 — 없으면 토글을 그리지 않는다 */
  na?: { checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean }
  onChange?: (value: string) => void
  required?: boolean
  mono?: boolean
  placeholder?: string
}

const cellInputCls =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground shadow-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-not-allowed disabled:bg-muted"

/** 칸 옆 N/A 체크 — 켜면 호출부가 값을 비우고 입력칸을 잠근다 */
export function NaToggle({ label, checked, onChange, disabled }: {
  label: string; checked: boolean; onChange: (checked: boolean) => void; disabled?: boolean
}) {
  return (
    <label className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-muted-foreground">
      <input
        type="checkbox"
        className="cb-custom"
        checked={checked}
        disabled={disabled}
        onChange={e => onChange(e.target.checked)}
        aria-label={`${label} N/A`}
      />
      {NA_LABEL}
    </label>
  )
}

function Cell({ label, cell }: { label: string; cell: OrderInfoCell }) {
  const naOn = !!cell.na?.checked
  return (
    <div>
      {/* dt 안에 토글을 둔다 — dl > div 안에는 dt/dd 만 올 수 있다 */}
      <dt className="flex min-h-5 items-center justify-between gap-2 text-muted-foreground">
        <span>
          {label}
          {cell.required && cell.editable && <span className="text-red-500"> *</span>}
        </span>
        {cell.editable && cell.na && (
          <NaToggle label={label} checked={naOn} onChange={cell.na.onChange} disabled={cell.na.disabled} />
        )}
      </dt>
      <dd className="mt-1">
        {cell.editable ? (
          <input
            value={naOn ? "" : cell.value}
            disabled={naOn}
            onChange={e => cell.onChange?.(e.target.value)}
            placeholder={naOn ? NA_LABEL : cell.placeholder}
            aria-label={label}
            className={cn(cellInputCls, cell.mono && "font-mono")}
          />
        ) : (
          <span className={cn("block text-sm font-medium break-all text-foreground", cell.mono && "font-mono tabular-nums")}>
            {cell.value || "—"}
          </span>
        )}
      </dd>
    </div>
  )
}

export function OrderInfoTable({ productCode, batchNo, productName, validationType }: {
  productCode: OrderInfoCell
  batchNo: OrderInfoCell
  productName: OrderInfoCell
  validationType: OrderInfoCell
}) {
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-md border bg-background text-xs leading-normal [&>div]:min-w-0 [&>div]:p-3 [&>div:nth-child(odd)]:border-r [&>div:nth-child(n+3)]:border-t">
      <Cell label="품목코드" cell={productCode} />
      <Cell label="제조번호" cell={batchNo} />
      <Cell label="품목명" cell={productName} />
      {/* 구분도 제조팀 시트가 원본이라 품목 식별정보와 같은 칸에 둔다(자동 오더는 읽기 전용) */}
      <Cell label="구분" cell={validationType} />
    </dl>
  )
}
