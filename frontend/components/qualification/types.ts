/**
 * 시험자 자격 인증 화면 공용 타입·표기.
 *
 * 서버 응답(`/api/tester-qualifications`)과 1:1이다. 백엔드 인터페이스를 직접 import 할 수 없으므로
 * (`@backend/*`는 서버 전용) 이 파일 하나에만 다시 선언하고 화면들은 여기서 가져다 쓴다.
 */

import { qualificationStatus, type QualificationStatus } from "@shared/qualification"

export interface QualCategory {
  id: string
  name: string
  sortOrder: number
  isActive: boolean
}

export interface QualItem {
  id: string
  categoryId: string
  categoryName: string
  name: string
  validMonths: number
  note: string | null
  sortOrder: number
  isActive: boolean
}

export interface QualTester {
  id: string
  employeeNo: string
  name: string
  isActive: boolean
}

export interface TesterQual {
  id: string
  testerId: string
  qualificationItemId: string
  qualificationRole: string
  grantedOn: string
  expiresOn: string | null
  certType: string
  certMethod: string
  note: string | null
  status: Exclude<QualificationStatus, "none">
}

export interface QualificationOverview {
  categories: QualCategory[]
  items: QualItem[]
  testers: QualTester[]
  quals: TesterQual[]
}

/**
 * 화면에 쓸 자격 상태.
 *
 * 서버가 내려주는 `status` 를 그대로 믿지 않고 만료일로 다시 계산한다 —
 * 서버는 UTC, 사용자는 KST(UTC+9)라서 한국 시간 오전에는 서버 기준일이 하루 뒤처진다.
 * 만료 임박 경계에서 색과 남은 일수가 어긋나는 것을 막으려면 보는 사람의 날짜로 판정해야 한다.
 */
export function statusOf(qual: TesterQual | null): QualificationStatus {
  return qual ? qualificationStatus(qual.expiresOn) : "none"
}

/**
 * 매트릭스 셀 색 — 시험자 역량 매트릭스(LEVEL_STYLE)와 같은 규격을 따른다.
 * 유효는 브랜드 파랑, 임박은 앰버(경고), 만료는 기한초과라 빨강.
 * 예전엔 유효=초록·만료=rose 였는데, 초록은 브랜드색 밖이고 rose 는 앱의 빨강과
 * 같은 뜻을 다른 색으로 말하던 자리였다.
 */
export const STATUS_CELL_STYLE: Record<QualificationStatus, string> = {
  valid:    "border-blue-300 bg-blue-700 text-white",
  expiring: "border-amber-300 bg-amber-600 text-white",
  expired:  "border-red-300 bg-red-700 text-white",
  none:     "border bg-muted text-muted-foreground",
}

/** KPI·범례에 쓰는 점 색 */
export const STATUS_DOT_STYLE: Record<QualificationStatus, string> = {
  valid:    "bg-blue-600",
  expiring: "bg-amber-500",
  expired:  "bg-red-600",
  none:     "bg-muted-foreground/40",
}

/** 셀에 넣을 짧은 라벨. 만료 임박은 남은 일수를 그대로 보여준다. */
export function statusCellLabel(status: QualificationStatus, daysLeft: number | null): string {
  if (status === "none") return "–"
  if (status === "expired") return "만료"
  if (status === "expiring") return daysLeft == null ? "임박" : `D-${daysLeft}`
  return "유효"
}

/** 만료일 표기 — 무기한은 '무기한' */
export function formatExpiry(expiresOn: string | null): string {
  return expiresOn ? expiresOn : "무기한"
}
