import type { DelaySpan, TesterPerformanceRow } from '@shared/tester-performance'

export type TesterReportDelaySpan = DelaySpan & {
  productName?: string | null
  batchNo?: string | null
  result?: string
}

export interface TesterReportResponse {
  period: { from: string; to: string; workingDays: number }
  tester: TesterPerformanceRow
  teamAverage: TesterPerformanceRow
  delaySpans: TesterReportDelaySpan[]
  delayReasonCoverage: 'recorded' | 'unrecorded'
  insufficientSample: boolean
  teamAverageSampleSize: number
  testers?: Array<{ testerId: string; name: string }>
}
