/**
 * 「운영 결과 리포트」는 「시험자 운영 분석」(/insights/stats)에 흡수됐다.
 *
 * 두 화면이 같은 기간·같은 시험자를 두 벌로 재고 있었고, 정작 알고 싶은 질문
 * ("준수율이 낮은 이유가 부업무인가")은 두 화면에 걸쳐 있어 어느 쪽에서도 답이 안 나왔다.
 *
 * 이 경로는 흡수 직전에 공유된 링크가 있어 남겨 둔다 — 지우면 그 링크가 404 가 된다.
 */

import { redirect } from 'next/navigation'

export default function InsightsReportPage() {
  redirect('/insights/stats')
}
