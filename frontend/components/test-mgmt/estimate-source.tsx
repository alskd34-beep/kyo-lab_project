"use client"

import { Tag, type TagColor } from "@frontend/components/ui/tag"

/**
 * 예상시간의 **출처** 배지 (0046).
 *
 * 같은 "4시간" 이라도 그 값이 사람의 감인지, 실적에서 나온 값인지, 실적을 검토해 확정한
 * 값인지에 따라 믿을 수 있는 정도가 다르다. 일정·부하·납기가 전부 이 값 위에 서 있으므로
 * 숫자만 보여주면 근거의 강약이 통째로 사라진다. 숫자 옆에 항상 이 배지를 함께 둔다.
 *
 * 색은 근거의 강도 순이다 — 가정(앰버·주의) → 실적(파랑) → 확정(초록). Tag 의 의미
 * 매핑(디자인 표준)과도 어긋나지 않는다: yellow=대기·미확정, blue=진행, green=승인.
 */
export type EstimateSource = "assumed" | "measured" | "confirmed"

const SOURCE_META: Record<EstimateSource, { label: string; color: TagColor; help: string }> = {
  assumed: {
    label: "가정",
    color: "yellow",
    help: "담당자 경험으로 잡은 값입니다. 실적이 쌓이면 조정을 제안합니다.",
  },
  measured: {
    label: "실적",
    color: "blue",
    help: "완료된 시험 실적에서 나온 값입니다.",
  },
  confirmed: {
    label: "확정",
    color: "green",
    help: "실적을 검토해 확정한 값입니다.",
  },
}

export function estimateSourceLabel(source: EstimateSource): string {
  return SOURCE_META[source]?.label ?? "가정"
}

export function estimateSourceHelp(source: EstimateSource): string {
  return SOURCE_META[source]?.help ?? SOURCE_META.assumed.help
}

export function EstimateSourceBadge({
  source,
  sampleCount = 0,
  hasEstimate = true,
}: {
  source: EstimateSource
  /** measured/confirmed 의 근거 표본 수. 0 이면 건수를 적지 않는다. */
  sampleCount?: number
  /** 예상시간 자체가 없으면 출처를 말할 것이 없다 — '미설정' 으로 보여준다. */
  hasEstimate?: boolean
}) {
  if (!hasEstimate) {
    return (
      <Tag color="mono" title="예상시간이 등록되지 않았습니다. 일정 계산에서 이 항목은 0으로 잡힙니다.">
        미설정
      </Tag>
    )
  }
  const meta = SOURCE_META[source] ?? SOURCE_META.assumed
  // 표본 수는 실적 기반일 때만 뜻이 있다. 가정치에 "가정 3건" 은 말이 되지 않는다.
  const withCount = source !== "assumed" && sampleCount > 0
  return (
    <Tag color={meta.color} title={meta.help}>
      {withCount ? `${meta.label} ${sampleCount}건` : meta.label}
    </Tag>
  )
}

/**
 * 시간박스 표식 — MT 처럼 정확한 공수가 존재하지 않는 항목.
 * 색상 팔레트에서 '분류' 자리(slate)를 쓴다. 상태가 아니라 항목의 성질이기 때문이다.
 */
export function TimeboxedBadge() {
  return (
    <Tag
      color="slate"
      title="정확한 공수가 존재하지 않는 항목입니다. 실적 평균이 수렴하지 않아 조정 제안에서 제외하고, 초과는 성과가 아니라 재계획 신호로 읽습니다."
    >
      시간박스
    </Tag>
  )
}
