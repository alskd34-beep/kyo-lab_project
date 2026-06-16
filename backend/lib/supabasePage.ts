import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Supabase 단일 요청 1000행(max-rows) 제한을 우회해 테이블 전체를 페이지네이션으로 조회한다.
 *
 * `from('product_test_items').select(...)` 처럼 필터 없는 전체 조회가 1000행을 넘으면
 * 기본 limit에 잘려 일부 행이 누락된다(예: product_test_items 1327행 → 327행 누락 →
 * 일부 품목의 시험항목 매핑이 사라져 미배정). 이 헬퍼는 1000행 단위로 끝까지 모아 반환한다.
 *
 * 반환 형태는 기존 `{ data, error }` 와 동일해 호출부 변경을 최소화한다.
 */
export async function selectAll(
  client: SupabaseClient,
  table: string,
  columns: string,
): Promise<{ data: Record<string, unknown>[] | null; error: { message: string } | null }> {
  const PAGE = 1000
  const all: Record<string, unknown>[] = []
  for (let from = 0; ; from += PAGE) {
    const res = await client.from(table).select(columns).range(from, from + PAGE - 1)
    if (res.error) return { data: null, error: res.error }
    const rows = (res.data ?? []) as unknown as Record<string, unknown>[]
    all.push(...rows)
    if (rows.length < PAGE) break
  }
  return { data: all, error: null }
}
