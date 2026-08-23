"use client"

import { JOB_STAGES, stageStyle } from "@shared/qc-status"
import { cn } from "@frontend/lib/utils"

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
        const done = i < idx
        const here = i === idx
        return (
          <div key={s} className="flex min-w-0 flex-1 flex-col items-center gap-1">
            <div
              className={cn(
                "h-1 w-full rounded-md",
                done ? "bg-emerald-400" : here ? stageStyle(s).dot : "bg-muted",
              )}
            />
            <span className={cn(
              "truncate text-[10px]",
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
