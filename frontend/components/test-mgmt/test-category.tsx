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

/**
 * 대분류별 점 색.
 *
 * 색 자체가 분류를 뜻하는 자리라 브랜드 파랑 단일 규칙의 예외다(AGENTS.md).
 * 대신 두 가지를 지킨다.
 *  ① 일곱 분류가 서로 다른 색이어야 한다 — 이화학·함량시험이 둘 다 `blue-500` 이라
 *     배지를 구분할 수 없었다. 함량시험을 초록으로 떼어 놓았다.
 *  ② 색각이상에서도 갈라져야 한다 — 적록색약에서 한 덩어리로 보이는 따뜻한 색
 *     세 개(안전성·기기분석·함량시험)는 색상만이 아니라 명도로도 벌린다
 *     (앰버 500 밝음 › 에메랄드 500 중간 › 레드 600 어두움). 배지에는 분류 이름이
 *     항상 함께 나오므로 색은 보조 신호다.
 * 브랜드 인접색(indigo/violet/purple/sky)은 여기서도 쓰지 않는다.
 */
const CATEGORY_DOT: Record<string, string> = {
  "성상·포장": "bg-fuchsia-500", // 자홍
  이화학: "bg-blue-500",         // 파랑
  함량시험: "bg-emerald-500",     // 초록 — 파랑 중복을 걷어낸 자리
  확인시험: "bg-cyan-500",        // 청록
  기기분석: "bg-amber-500",       // 앰버 (따뜻한 색 중 가장 밝게)
  안전성: "bg-red-600",          // 빨강 (따뜻한 색 중 가장 어둡게)
  기타: "bg-muted-foreground",   // 회색
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
