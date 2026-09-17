export const STABILITY_SHEET_ID = '1gvAtB1ETkCol1gM2mmppOUJTgIidEq1IdGaQaiSXdCg'

export interface StabilitySheetRow {
  id: string
  productCode: string
  productName: string
  testType: string
  batchNo: string
  manufacturedAt: string
  expiryDate: string
  periodEndDate: string
  reason: string
  period: string
  requestedAt: string
  requestNo: string
  status: string
  approved: boolean
  source: Record<string, string>
}

export function stabilityCompositeKey(row: Pick<StabilitySheetRow, 'productCode' | 'batchNo' | 'testType' | 'period'>): string {
  const clean = (value: string) => value.trim().replace(/\s+/g, ' ')
  return `composite:${[row.productCode, row.batchNo, row.testType, row.period].map(clean).join('|')}`
}

export function stabilitySourceKey(row: Pick<StabilitySheetRow, 'requestNo' | 'productCode' | 'batchNo' | 'testType' | 'period'>): string {
  const clean = (value: string) => value.trim().replace(/\s+/g, ' ')
  return row.requestNo.trim() ? `request:${clean(row.requestNo)}` : stabilityCompositeKey(row)
}

export function pick(row: Record<string, string>, candidates: string[]): string {
  for (const key of candidates) {
    const exact = row[key]?.trim()
    if (exact) return exact
  }

  for (const candidate of candidates) {
    const normalized = candidate.includes('/') ? candidate.split('/').at(-1) : candidate
    const foundKey = Object.keys(row).find(key => {
      const tail = key.includes('/') ? key.split('/').at(-1) : key
      return tail?.replace(/\s/g, '') === normalized?.replace(/\s/g, '')
    })
    const value = foundKey ? row[foundKey]?.trim() : ''
    if (value) return value
  }

  return ''
}

function normalize(value: string): string {
  return value.replace(/\s/g, '')
}

export function mapRow(row: Record<string, string>, idx: number): StabilitySheetRow {
  const start = pick(row, ['진행정보/시험기간시작일', '시험기간시작일', '기간시작일', '시작일'])
  const end = pick(row, ['진행정보/시험기간종료일', '시험기간종료일', '기간종료일', '종료일'])
  const period = pick(row, ['안정성시험 계획 정보/기간', '진행정보/기간', '기간']) || [start, end].filter(Boolean).join(' ~ ')
  const productCode = pick(row, ['안정성시험 계획 정보/품목코드', '품목코드', '자재코드'])
  const batchNo = pick(row, ['안정성시험 계획 정보/제조번호', '제조번호', 'Lot', 'Lot No'])
  const requestNo = pick(row, ['진행정보/의뢰번호', '상세정보/의뢰번호', '의뢰번호', '외뢰번호'])
  const testStatus = pick(row, ['진행정보/시험상태', '시험상태'])
  // 시험상태가 비어 있을 때 계획 상태보다 진행정보의 현재 상태를 우선한다.
  const status = testStatus || pick(row, ['진행정보/진행상태', '안정성시험 계획 정보/진행상태', '진행상태', '상태']) || '미확인'

  return {
    id: `${productCode || 'unknown'}-${batchNo || 'no-batch'}-${requestNo || 'no-request'}-${idx}`,
    productCode,
    productName: pick(row, ['안정성시험 계획 정보/품목', '품목', '품목명', '자재내역']),
    testType: pick(row, ['안정성시험 계획 정보/시험종류', '시험종류', '시험유형']),
    batchNo,
    manufacturedAt: pick(row, ['상세정보/제조일자', '안정성시험 계획 정보/제조일자', '제조일자', '제조일']),
    expiryDate: pick(row, ['상세정보/사용기한', '안정성시험 계획 정보/사용기한', '사용기한', '유효기간']),
    periodEndDate: end,
    reason: pick(row, ['상세정보/실시사유', '안정성시험 계획 정보/실시사유', '실시사유', '사유']),
    period,
    requestedAt: pick(row, ['진행정보/의뢰일자', '상세정보/의뢰일자', '의뢰일자', '의뢰일']),
    requestNo,
    status,
    approved: normalize(testStatus) === '승인',
    source: row,
  }
}

/** 시트 하단의 '총 건 수 :' 요약 행은 품목 목록에 포함하지 않는다. */
export function isStabilitySummaryRow(row: StabilitySheetRow): boolean {
  return Object.entries(row.source).some(([key, value]) => {
    const normalizedKey = normalize(key)
    return normalizedKey.includes('목록번호') && /^총건수:?$/.test(normalize(value))
  })
}

export function getStabilityStatusClass(status: string, approved = true): string {
  const value = normalize(status)
  if (!approved || /(미승인|미확인)/.test(value)) return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
  if (/(완료|종료|승인)/.test(value)) return 'border-blue-400 bg-blue-100 text-blue-900 dark:border-blue-600 dark:bg-blue-900/60 dark:text-blue-200'
  if (/(진행|시험중|분석중|의뢰)/.test(value)) return 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-300'
  if (/(대기|예정|준비)/.test(value)) return 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300'
  if (/(보류|지연|중단|취소)/.test(value)) return 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300'
  return 'border bg-muted/50 text-muted-foreground'
}

export function isApprovedStatus(row: StabilitySheetRow): boolean {
  return row.approved
}

export function isScheduleCandidate(row: StabilitySheetRow): boolean {
  return !!row.productCode && !/(완료|종료|취소|중단)/.test(normalize(row.status))
}

export function getStatusRank(status: string): number {
  const value = normalize(status)
  if (/(미승인|미확인)/.test(value)) return 0
  if (/^(대기|의뢰|예정|준비)$/.test(value)) return 1
  if (/^지시$/.test(value)) return 2
  if (/^(진행중|진행|시험중|분석중)$/.test(value)) return 3
  if (/^(완료|종료|승인)$/.test(value)) return 4
  if (/(보류|지연)/.test(value)) return 5
  if (/(취소|중단)/.test(value)) return 6
  return 7
}
