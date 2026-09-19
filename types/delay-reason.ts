/** 지연·복귀 사유는 운영 설정이 아니라 제품 코드의 고정 분류다. */
export type DelayReasonKind = 'delay' | 'resume'
export type DelayReasonAttribution = 'external' | 'internal' | 'unknown'

export interface DelayReasonCategory {
  id: string
  code: string
  label: string
  kind: DelayReasonKind
  attribution: DelayReasonAttribution
}

/** migration 0058의 시드 UUID와 동일해야 과거 이력의 FK가 유지된다. */
export const DELAY_REASON_CATEGORIES: readonly DelayReasonCategory[] = [
  { id: 'a0000000-0000-4000-8000-000000000001', code: 'EQUIP_DOWN', label: '장비 고장·정지', kind: 'delay', attribution: 'external' },
  { id: 'a0000000-0000-4000-8000-000000000002', code: 'EQUIP_BUSY', label: '장비 선점·대기', kind: 'delay', attribution: 'external' },
  { id: 'a0000000-0000-4000-8000-000000000003', code: 'SAMPLE_LATE', label: '검체 미입고·의뢰 지연', kind: 'delay', attribution: 'external' },
  { id: 'a0000000-0000-4000-8000-000000000004', code: 'REAGENT', label: '시약·표준품 부족', kind: 'delay', attribution: 'external' },
  { id: 'a0000000-0000-4000-8000-000000000005', code: 'CONCURRENT_WAIT', label: '동시분석 대기', kind: 'delay', attribution: 'external' },
  { id: 'a0000000-0000-4000-8000-000000000006', code: 'PRIORITY', label: '긴급 건 투입으로 밀림', kind: 'delay', attribution: 'external' },
  { id: 'a0000000-0000-4000-8000-000000000007', code: 'LEAVE', label: '휴가·부재', kind: 'delay', attribution: 'external' },
  { id: 'a0000000-0000-4000-8000-000000000008', code: 'SIDE_WORK', label: '부업무 과다', kind: 'delay', attribution: 'external' },
  { id: 'a0000000-0000-4000-8000-000000000009', code: 'RETEST', label: '재시험·재실시', kind: 'delay', attribution: 'internal' },
  { id: 'a0000000-0000-4000-8000-00000000000a', code: 'METHOD', label: '시험 난이도·재현 실패', kind: 'delay', attribution: 'internal' },
  { id: 'a0000000-0000-4000-8000-00000000000b', code: 'DELAY_ETC', label: '기타', kind: 'delay', attribution: 'unknown' },
  { id: 'a0000000-0000-4000-8000-00000000000c', code: 'RECOVERED', label: '만회 완료(추가 시간 투입)', kind: 'resume', attribution: 'internal' },
  { id: 'a0000000-0000-4000-8000-00000000000d', code: 'EQUIP_FIXED', label: '장비 복구', kind: 'resume', attribution: 'external' },
  { id: 'a0000000-0000-4000-8000-00000000000e', code: 'SAMPLE_IN', label: '검체 입고', kind: 'resume', attribution: 'external' },
  { id: 'a0000000-0000-4000-8000-00000000000f', code: 'REASSIGNED', label: '재배정·분담으로 해소', kind: 'resume', attribution: 'external' },
  { id: 'a0000000-0000-4000-8000-000000000010', code: 'RESCHEDULED', label: '일정 재조정(납기 변경)', kind: 'resume', attribution: 'external' },
  { id: 'a0000000-0000-4000-8000-000000000011', code: 'RESUME_ETC', label: '기타', kind: 'resume', attribution: 'unknown' },
]

export function getDelayReasonCategory(id: string, kind?: DelayReasonKind): DelayReasonCategory | undefined {
  return DELAY_REASON_CATEGORIES.find(c => c.id === id && (!kind || c.kind === kind))
}

