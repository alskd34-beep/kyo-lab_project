"use client"

/**
 * 품목별 시험공수 관리 화면 공용 조각 — KPI 카드 / 섹션 카드 / 공수구분 배지.
 *
 * 색상: 인적·기기·대기·검토는 "색 자체가 구분 의미"인 카테고리 팔레트라
 * 브랜드 단일색 규칙의 예외다. 다만 인적공수는 indigo 대신 브랜드 파랑을 쓴다 —
 * 네 갈래를 구분하는 데는 파랑/앰버/슬레이트/에메랄드로 충분하고, 파랑 옆의
 * indigo 는 브랜드색과 섞여 보일 뿐이었다.
 */

import { Badge } from "@frontend/components/ui/badge"
import { Card } from "@frontend/components/ui/card"
import { cn } from "@frontend/lib/utils"
import { WORKLOAD_TYPE_LABEL, WORKLOAD_TYPE_SHORT, type WorkloadType } from "@shared/workload"

/** 차트(recharts)용 hex — Tailwind 클래스를 쓸 수 없는 자리 */
export const WORKLOAD_TYPE_HEX: Record<WorkloadType, string> = {
  HUMAN: "#2563eb",      // blue-600 (브랜드 파랑)
  EQUIPMENT: "#f59e0b",  // amber-500
  WAITING: "#94a3b8",    // slate-400
  REVIEW: "#10b981",     // emerald-500
}

/*
 * 배지·점 표시용 Tailwind 클래스.
 * `chip` 은 밝은 배경을 전제한 연한 칩이라 다크에서는 흰 알약처럼 뜬다.
 * 명도만 뒤집어 짝을 붙인다(배경 50->950 / 100->900, 글자 700->300, 테두리 200->800).
 * 중립인 WAITING 은 색이 아니라 회색이므로 시맨틱 토큰을 쓴다.
 * `dot` 은 솔리드(500~600대)라 두 테마에서 그대로 읽히므로 건드리지 않는다.
 */
export const WORKLOAD_TYPE_CLASS: Record<WorkloadType, { dot: string; chip: string }> = {
  HUMAN: { dot: "bg-blue-600", chip: "border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300" },
  EQUIPMENT: { dot: "bg-amber-500", chip: "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  WAITING: { dot: "bg-slate-400", chip: "border-slate-200 bg-slate-100 text-slate-600 dark:border-border dark:bg-muted dark:text-muted-foreground" },
  REVIEW: { dot: "bg-emerald-500", chip: "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
}

export function WorkloadTypeBadge({ type, short = false }: { type: WorkloadType; short?: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-xs leading-normal font-medium",
        WORKLOAD_TYPE_CLASS[type]?.chip,
      )}
    >
      <span className={cn("size-1.5 rounded-full", WORKLOAD_TYPE_CLASS[type]?.dot)} />
      {short ? WORKLOAD_TYPE_SHORT[type] : WORKLOAD_TYPE_LABEL[type]}
    </span>
  )
}

/** 상단 KPI 카드 */
export function KpiCard({
  label,
  value,
  hint,
  icon,
  accent,
}: {
  label: string
  value: string
  hint?: string
  icon?: React.ReactNode
  /**
   * 아이콘에 입힐 계열 색(`text-*`). 아래 차트의 막대 색과 같은 값을 넘겨
   * "이 숫자가 저 막대"임을 잇는다. 없으면 아이콘도 회색이다.
   */
  accent?: string
}) {
  return (
    // 카드 왼쪽에 두르던 굵은 색 띠(border-l-4)를 걷어냈다.
    // 강조는 띠가 아니라 숫자 크기와 아이콘 색이 한다.
    <Card
      className={cn(
        /* 모바일은 라벨·숫자를 한 줄로 눕혀 타일 높이를 절반으로 줄인다 —
           다섯 칸이 세로로 세 줄(300px 가까이) 쌓여 정작 봐야 할 품목 목록을
           화면 밖으로 밀어내던 자리다. */
        "min-h-8 min-w-0 flex-row items-center justify-between gap-1 px-2 py-1",
        /* sm:justify-start — 격자는 칸 높이를 서로 맞추므로(stretch) justify-between 을
           남겨 두면 짧은 칸에서 숫자가 바닥에 붙어 원래 모양과 달라진다. */
        "sm:flex-col sm:items-stretch sm:justify-start sm:gap-1 sm:px-4 sm:py-3.5",
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
        {/* 좁은 칸에서 아이콘 20px 를 빼야 '평균 표준 소요일' 같은 라벨이 잘리지 않는다.
            아이콘 색이 이어 주던 아래 차트도 모바일에서는 목록 뒤로 내려가 있다. */}
        <span className={cn("hidden shrink-0 items-center sm:flex", accent ?? "text-muted-foreground")}>{icon}</span>
        <span className="min-w-0 truncate">{label}</span>
      </span>
      {/* 320px 2열 격자에서 "12.5시간" 같은 값이 칸을 밀어낸다 — 모바일에서 한 단 줄인다 */}
      <span className="min-w-0 shrink-0 truncate text-sm font-semibold tabular-nums text-foreground sm:text-2xl" title={value}>
        {value}
      </span>
      {/* 한 줄로 눕힌 모바일에는 셋째 조각이 들어갈 자리가 없다. 두 힌트("전체 N 품목 중" ·
          "공수 합계와 무관한 별도 값")는 화면 머리말 줄이 이미 같은 말을 하고 있다. */}
      {hint && <span className="hidden text-xs leading-normal break-keep text-muted-foreground sm:block">{hint}</span>}
    </Card>
  )
}

/** 제목 + 설명을 가진 콘텐츠 카드 */
export function SectionCard({
  title,
  hint,
  action,
  children,
  className,
}: {
  title: string
  hint?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}) {
  return (
    <Card className={cn("min-w-0 gap-0 overflow-hidden py-0", className)}>
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-2.5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
          {hint && <p className="mt-0.5 text-xs leading-normal break-keep text-muted-foreground">{hint}</p>}
        </div>
        {action}
      </div>
      <div className="p-4">{children}</div>
    </Card>
  )
}

/** 상태/난이도처럼 값에 따라 점 색이 바뀌는 배지 */
export function DotBadge({ dotClass, children }: { dotClass: string; children: React.ReactNode }) {
  return (
    <Badge variant="outline" className="gap-1.5 font-normal">
      <span className={cn("size-1.5 rounded-full", dotClass)} />
      {children}
    </Badge>
  )
}
