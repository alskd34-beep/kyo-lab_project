"use client"

import { Badge } from "@frontend/components/ui/badge"
import { cn } from "@frontend/lib/utils"

/**
 * 시험항목 대분류(`test_items.category`).
 *
 * '시험항목 그룹'(여러 항목을 순서대로 묶은 템플릿)과는 **다른 개념**이다.
 * 대분류는 분류·색상용이고 항목당 하나뿐이며, 그룹은 항목이 여러 개에 속할 수 있다.
 */
export const CATEGORIES = [
  "성상·포장",
  "이화학",
  "함량시험",
  "확인시험",
  "기기분석",
  "안전성",
  "기타",
] as const

export type Category = (typeof CATEGORIES)[number]

const CATEGORY_DOT: Record<string, string> = {
  "성상·포장": "bg-fuchsia-500",
  이화학: "bg-blue-500",
  함량시험: "bg-blue-500",
  확인시험: "bg-cyan-500",
  기기분석: "bg-amber-500",
  안전성: "bg-red-500",
  기타: "bg-muted-foreground",
}

export function CategoryBadge({ category }: { category: string }) {
  const dot = CATEGORY_DOT[category] ?? CATEGORY_DOT["기타"]
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className={cn("size-1.5 rounded-full", dot)} />
      {category || "기타"}
    </Badge>
  )
}
