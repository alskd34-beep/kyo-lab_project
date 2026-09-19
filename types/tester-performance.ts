import type { DelayReasonAttribution } from '@shared/delay-reason'

export interface DelaySpan {
  jobId: string
  testerId: string | null
  startedAt: string
  endedAt: string | null
  workdays: number
  ongoing: boolean
  /** 사유/attribution을 시험자가 선언해 남긴 지연인지 여부 */
  declared: boolean
  /** 지연 판정·기록의 실제 주체. declared는 기존 소비자 호환용 boolean이다. */
  declaredBy: 'tester' | 'admin' | 'automatic'
  reasonCategoryId: string | null
  reasonCategoryName: string | null
  attribution: DelayReasonAttribution | null
  note: string | null
}

export interface TesterPerformanceRow {
  testerId: string
  name: string
  completed: number
  dueEligible: number
  dueOnTime: number
  dueComplianceRate: number | null
  overrunDays: number | null
  overrunBuckets: { compliant: number; oneDay: number; twoToThreeDays: number; fourPlusDays: number; missing: number }
  delayJobs: number
  delayCount: number
  avgDelayDays: number | null
  ongoingDelayCount: number
  declaredDelayCount: number
  autoOverdueCount: number
  externalDelayCount: number
  internalDelayCount: number
  unknownAttributionCount: number
  recoveryRate: number | null
  holidayItems: number
  holidayMinutes: number
  holidaySideWorkCount: number
  holidaySideWorkMinutes: number
  sideWorkRatio: number | null
  sideToTestRatio: number | null
  sideFragmentation: number | null
  availableDayUtilization: number | null
  reassignedIn: number
  reassignedOut: number
  reopenCount: number
  concurrentSavingsDays: number
}

export interface TesterPerformanceResponse {
  period: { from: string; to: string; workingDays: number }
  totals: Omit<TesterPerformanceRow, 'testerId' | 'name'>
  byTester: TesterPerformanceRow[]
  delayReasonCoverage: 'recorded' | 'unrecorded'
  delayReasons: Array<{ categoryId: string | null; label: string; attribution: DelayReasonAttribution | null; count: number; ratio: number | null }>
  delaySpans: DelaySpan[]
  fairness: { totalDelayJobs: number; externalDelayJobs: number; sampleSize: number; insufficientSample: boolean; completedJobs: number; delayedCompletedJobs: number }
}
