/**
 * [BACKEND] 근무일 계산 — 구현은 `@shared/workdays` 하나뿐이다.
 *
 * 배정 화면도 같은 계산이 필요해지면서(휴가 다음 근무일 추천) 순수 함수를 shared 로
 * 올렸다. 서버 쪽 import 경로를 바꾸지 않으려고 이 파일은 재수출만 남긴다 —
 * 구현을 두 벌 두면 서버가 잡은 날짜와 화면이 안내한 날짜가 갈린다.
 */

export {
  addDays,
  isWeekend,
  isNonWorkingDay,
  workingDaysFromInclusive,
  workingDaysAfter,
  workingDaysBefore,
  expandRange,
} from '@shared/workdays'
