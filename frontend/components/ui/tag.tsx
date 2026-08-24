import * as React from "react"

import { cn } from "@frontend/lib/utils"

/**
 * 상태 표시 전용 솔리드 배지.
 * 컬러 의미: blue=처리중·진행중·**활성/사용** / green=완료·승인 / yellow=검토중·대기 /
 * red=반려·취소·오류 / mono=보류·비활성 / indigo=공지 / slate=분류·기타.
 *
 * 활성/사용 같은 on-off 상태는 **초록이 아니라 브랜드 파랑**을 쓴다.
 * 초록은 "끝났다"는 뜻일 때만 쓴다 — 켜져 있다는 뜻으로 쓰면 브랜드색에서 벗어나고
 * 완료와도 구분이 안 된다.
 * 출처: bizday UI Guideline(Tag) — .claude/commands/design-standard.md 1절 참고.
 */
export type TagColor = "blue" | "green" | "yellow" | "red" | "mono" | "indigo" | "slate"
export type TagSize = "sm" | "md"

/*
 * 채움색은 600 대를 쓴다. 500 대 위의 흰 글자는 3.8:1 밖에 안 나와
 * 본문 기준(4.5:1)에 못 미쳤다 - 한 단 내리면 5:1 을 넘긴다.
 * 배지는 작은 글자라 대비를 특히 챙겨야 한다.
 */
const COLOR_CLASS: Record<TagColor, string> = {
  blue: "bg-blue-600 text-white",
  green: "bg-green-600 text-white",
  yellow: "bg-amber-600 text-white",
  red: "bg-red-600 text-white",
  mono: "bg-slate-600 text-white",
  indigo: "bg-indigo-600 text-white",
  slate: "bg-slate-500 text-white",
}

const SIZE_CLASS: Record<TagSize, string> = {
  sm: "h-5 gap-1 px-2 text-xs leading-normal",
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
