/**
 * [BACKEND] 수동 오더 키 칸(품목코드·제조번호) N/A 대체값 생성.
 *
 * 규칙·판정 함수는 @shared/order-na 가 단일 기준이다. 여기는 **서버만** 값을 만든다 —
 * 화면이 만들면 사용자가 같은 값을 흉내 낼 수 있고, 시각이 사용자 PC 시계에 묶인다.
 *
 * 형식: `NA-P-<yyMMdd>-<12자리 hex>` / `NA-B-<같은 형식>` (날짜는 Asia/Seoul)
 * hex 는 crypto.randomUUID 의 무작위 부분 12자리(48비트)다. 자연키가 (제조번호, 품목코드) 쌍이라
 * 한 칸만 N/A 면 복합 unique 가 대체값끼리의 충돌을 잡지 못한다 — 그래서 **대체값 하나하나가**
 * 오더마다 겹치지 않을 만큼 길어야 한다. 그래도 자연키 충돌이 나면 호출부가 다시 만든다.
 *
 * 시트 적재 값은 예약어 검사를 하지 않지만, 날짜 + 무작위 12자리 hex 까지 같은 실제 번호가 올라올 일은 없다
 * (시트 코드는 실제 품목코드 또는 `AUTO-<8hex>`, googleSheet.ts).
 */

import { randomUUID } from 'crypto'

function kstDateStamp(now: Date): string {
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return p(kst.getUTCFullYear() % 100) + p(kst.getUTCMonth() + 1) + p(kst.getUTCDate())
}

function naValue(kind: 'P' | 'B', now: Date): string {
  // UUID v4 의 마지막 묶음(12자리 hex)은 버전·변형 비트가 없는 순수 무작위 부분이다
  const random = randomUUID().replace(/-/g, '').slice(-12)
  return `NA-${kind}-${kstDateStamp(now)}-${random}`
}

/** N/A 품목코드 대체값 */
export function generateNaProductCode(now: Date = new Date()): string {
  return naValue('P', now)
}

/** N/A 제조번호 대체값 */
export function generateNaBatchNo(now: Date = new Date()): string {
  return naValue('B', now)
}
