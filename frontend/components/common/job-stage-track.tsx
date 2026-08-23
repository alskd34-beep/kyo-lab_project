"use client"

import { JOB_STAGES } from "@shared/qc-status"
import { cn } from "@frontend/lib/utils"

/**
 * 단계 진행 램프(blue-300 → blue-800). 단계 5개를 잇는 6개 스톱이라,
 * 구간 i 는 RAMP[i] → RAMP[i+1] 로 칠하면 막대 전체가 하나의 그라데이션이 된다.
 * 팔레트(STAGE_STYLE)와 같은 파랑 계열이라 배지 색과 따로 놀지 않는다.
 */
const RAMP = ["#93c5fd", "#60a5fa", "#3b82f6", "#2563eb", "#1d4ed8", "#1e40af"] as const

/**
 * 진행중 → 검토전 → 검토중 → 승인전 → 승인완료 진행 막대.
 *
 * 작업 상세 모달(작업현황)과 시험 미리보기(시험현황)가 같은 그림을 써야
 * 화면마다 단계 표현이 갈리지 않는다.
 */
export function JobStageTrack({ status, className }: { status: string; className?: string }) {
  const idx = (JOB_STAGES as readonly string[]).indexOf(status)
  // '대기'(시작 전), '지연' 등 단계에 없는 상태는 막대를 그리지 않는다
  if (idx < 0) return null
  return (
    <div className={cn("flex items-center gap-1", className)}>
      {JOB_STAGES.map((s, i) => {
        const reached = i <= idx
        const here = i === idx
        return (
          <div key={s} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div
              className={cn("h-1 w-full rounded-md", !reached && "bg-muted")}
              style={reached
                ? { backgroundImage: `linear-gradient(90deg, ${RAMP[i]}, ${RAMP[i + 1]})` }
                : undefined}
            />
            <span className={cn(
              "truncate text-xs leading-normal",
              here ? "font-semibold text-foreground" : "text-muted-foreground",
            )}>
              {s}
            </span>
          </div>
        )
      })}
    </div>
  )
}
