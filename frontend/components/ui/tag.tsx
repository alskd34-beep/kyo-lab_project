import * as React from "react"

import { cn } from "@frontend/lib/utils"

/**
 * 상태 표시 전용 솔리드 배지.
 * 컬러 의미: blue=처리중·진행중 / green=완료·승인 / yellow=검토중·대기 /
 * red=반려·취소·오류 / mono=보류 / indigo=공지 / slate=분류·기타.
 * 출처: bizday UI Guideline(Tag) — .claude/commands/design-standard.md 1절 참고.
 */
export type TagColor = "blue" | "green" | "yellow" | "red" | "mono" | "indigo" | "slate"
export type TagSize = "sm" | "md"

const COLOR_CLASS: Record<TagColor, string> = {
  blue: "bg-blue-500 text-white",
  green: "bg-green-500 text-white",
  yellow: "bg-amber-500 text-white",
  red: "bg-red-500 text-white",
  mono: "bg-slate-500 text-white",
  indigo: "bg-indigo-500 text-white",
  slate: "bg-slate-400 text-white",
}

const SIZE_CLASS: Record<TagSize, string> = {
  sm: "h-5 gap-1 px-2 text-[11px]",
  md: "h-6 gap-1.5 px-2.5 text-xs",
}

export interface TagProps extends Omit<React.ComponentProps<"span">, "color"> {
  color?: TagColor
  size?: TagSize
  /** 동적으로 계속 바뀌는 상태(처리중 등)에 dot 추가 권장 */
  dot?: boolean
  variant?: "solid"
}

function Tag({ color = "slate", size = "sm", dot = false, className, children, ...props }: TagProps) {
  return (
    <span
      data-slot="tag"
      className={cn(
        "inline-flex w-fit shrink-0 items-center justify-center rounded-md font-medium whitespace-nowrap",
        COLOR_CLASS[color],
        SIZE_CLASS[size],
        className,
      )}
      {...props}
    >
      {dot && <span className="size-1.5 shrink-0 rounded-full bg-white/85" />}
      {children}
    </span>
  )
}

export { Tag }
