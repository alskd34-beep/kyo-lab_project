/**
 * [BACKEND] PostgREST 필터 문자열 안전화
 *
 * 배경 (2026-08-23 점검):
 *   `query.or(`name.ilike.%${search}%,product_code.ilike.%${search}%`)` 처럼
 *   사용자 입력을 PostgREST 필터 DSL 에 그대로 이어붙이는 코드가 있었다.
 *   PostgREST 의 `or` 는 콤마·괄호로 구분되는 **필터 문법**이라,
 *   `search` 에 `x,is_active.is.null` 을 넣으면 의도치 않은 OR 조건이 붙고
 *   `x,avg_hours.gt.1` 처럼 다른 컬럼에 조건을 걸어 불리언 오라클로 값을 추론할 수 있다.
 *   (값은 파라미터화되므로 SQL 인젝션은 아니지만, 필터 구조가 공격자 제어에 들어간다)
 *
 * 대응: 문법 의미를 갖는 문자를 제거하고 길이를 제한한다.
 */

/** 검색어 최대 길이 — 이보다 긴 입력은 잘라낸다 */
const MAX_SEARCH_LEN = 100

/**
 * PostgREST 필터 표현식에 끼워 넣을 검색어를 안전하게 만든다.
 *
 * 제거 대상:
 *   `,` `(` `)`  — or/and 그룹 구분자
 *   `.`          — `컬럼.연산자.값` 구분자
 *   `*` `%`      — like 패턴 와일드카드(호출부가 직접 붙인다)
 *   `\` `"` `'`  — 인용/이스케이프
 *   제어문자
 *
 * 반환값이 빈 문자열이면 호출부는 검색 조건을 걸지 않아야 한다.
 */
export function sanitizeFilterTerm(raw: string | null | undefined): string {
  if (!raw) return ''
  return raw
    .slice(0, MAX_SEARCH_LEN)
    .replace(/[,()."'\\*%\u0000-\u001F]/g, ' ')
    .trim()
}
