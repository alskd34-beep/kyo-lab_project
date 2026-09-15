/**
 * [SHARED] 수동 오더의 N/A(해당 없음) 규칙 — 판정·표시의 단일 기준.
 *
 * 수동 오더는 품목명·완료예정일만 필수다. 나머지 칸은 N/A 로 둘 수 있다.
 *  - 선택 칸(제형·포장일·구분·착수 예정일): N/A = null. 이미 null 허용 컬럼이다.
 *  - 키 칸(품목코드·제조번호): null·'N/A' 문자열로 저장하면 안 된다.
 *    · `pct_orders` 가 NOT NULL + unique(batch_no, product_code) 라 같은 품목의 두 번째 N/A 오더가 막히고
 *    · 동시분석 자동 묶기(품목코드 같음)·AI 배정 결과 되붙이기(품목코드|제조번호)가 다른 오더와 섞인다.
 *    그래서 **서버가 오더마다 고유한 대체값**을 만들어 넣는다(backend/lib/orderNa.ts).
 *      품목코드: `NA-P-<yyMMdd>-<12자리 hex>`   예) NA-P-260915-3f9a0c2d71be
 *      제조번호: `NA-B-<yyMMdd>-<12자리 hex>`   예) NA-B-260915-a04e19c7d352
 *    hex 는 crypto.randomUUID 에서 떼어 쓴다(48비트) — 칸 하나만 N/A 여도 오더끼리 사실상 겹치지 않는다.
 *    예전 형식 `NA-P-<yyMMddHHmmss>-<4자리 숫자>` 로 이미 저장된 값도 계속 N/A 로 판정한다.
 *    화면·알림·슬랙·챗봇은 아래 display 함수로 이 값을 "N/A" 로 보여 준다.
 *  - 사용자가 `NA-` 로 시작하는 값이나 'N/A'·'NA' 같은 문자열을 직접 입력하면 화면·서버가 거절한다(N/A 흉내 금지).
 *
 * 판정은 접두사가 아니라 **전체 형식**으로 한다 — 시트에서 우연히 'NA-' 로 시작하는 실제 번호가
 * 들어와도 N/A 로 잘못 보이지 않게. 시트 적재는 예약어 검사를 하지 않지만, 제조팀 시트 번호가
 * 날짜 + 무작위 12자리 hex 형식과 같아질 일은 없고 설령 같은 모양이어도 무작위 부분까지 겹칠 확률은 무시할 만하다.
 */

/** 화면·메시지에 쓰는 N/A 표기 */
export const NA_LABEL = 'N/A'

/** 사용자 입력 금지 접두사 (대소문자 무시) */
export const NA_RESERVED_PREFIX = 'NA-'

/** 키 칸에 N/A 문자열을 직접 넣었을 때의 거절 문구(화면·서버 공통) */
export const NA_DIRECT_INPUT_MESSAGE = '품목코드·제조번호에 N/A 를 직접 입력하지 말고 N/A 체크를 사용하세요.'

const NA_PRODUCT_CODE_RE = /^NA-P-(?:\d{6}-[0-9a-f]{12}|\d{12}-\d{4})$/
const NA_BATCH_NO_RE = /^NA-B-(?:\d{6}-[0-9a-f]{12}|\d{12}-\d{4})$/
const NA_KEY_IN_TEXT_RE = /NA-[PB]-(?:\d{6}-[0-9a-f]{12}|\d{12}-\d{4})/g

/** 서버가 만든 N/A 품목코드 대체값인가 */
export function isNaProductCode(value: string | null | undefined): boolean {
  return typeof value === 'string' && NA_PRODUCT_CODE_RE.test(value)
}

/** 서버가 만든 N/A 제조번호 대체값인가 */
export function isNaBatchNo(value: string | null | undefined): boolean {
  return typeof value === 'string' && NA_BATCH_NO_RE.test(value)
}

/** 품목코드·제조번호 어느 쪽이든 N/A 대체값인가 (소비처가 칸 종류를 모를 때) */
export function isNaKeyValue(value: string | null | undefined): boolean {
  return isNaProductCode(value) || isNaBatchNo(value)
}

/** 사용자가 직접 넣으면 안 되는(예약된) 값인가 */
export function hasReservedNaPrefix(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().toUpperCase().startsWith(NA_RESERVED_PREFIX)
}

/** 'N/A'·'NA'·'n/a'·'N / A' 처럼 N/A 를 글자로 적은 값인가 (대소문자·공백 무시) */
export function isNaLiteralText(value: string | null | undefined): boolean {
  if (typeof value !== 'string') return false
  return /^N[/.\-\\]?A$/.test(value.replace(/\s+/g, '').toUpperCase())
}

/** 품목코드 표시값 — N/A 대체값이면 "N/A", 아니면 그대로 */
export function displayProductCode<T extends string | null | undefined>(value: T): T | typeof NA_LABEL {
  return isNaProductCode(value) ? NA_LABEL : value
}

/** 제조번호 표시값 — N/A 대체값이면 "N/A", 아니면 그대로 */
export function displayBatchNo<T extends string | null | undefined>(value: T): T | typeof NA_LABEL {
  return isNaBatchNo(value) ? NA_LABEL : value
}

/**
 * 선택 칸(제형·포장일·구분·착수 예정일) 표시값.
 * 값이 있으면 그대로. 비어 있으면 수동 오더는 "N/A"(관리자가 N/A 로 둔 칸), 자동(시트) 오더는 `emptyLabel`(기본 '-').
 */
export function displayOrderOptional(
  value: string | null | undefined,
  isManual: boolean,
  emptyLabel = '-',
): string {
  if (value != null && String(value).trim() !== '') return String(value)
  return isManual ? NA_LABEL : emptyLabel
}

/** 텍스트 안에 섞여 있는 N/A 대체값을 모두 "N/A" 로 바꾼다 (알림 본문·챗봇 컨텍스트 등 자유 문장용) */
export function maskNaKeys(text: string): string {
  return text.replace(NA_KEY_IN_TEXT_RE, NA_LABEL)
}
