import { supabaseAdmin } from '@backend/lib/supabase'

/**
 * "이 컬럼이 지금 DB 에 있는가" 를 한 번만 확인하고 기억한다.
 *
 * 왜 필요한가 — 이 프로젝트의 마이그레이션은 **배포 뒤에 사람이 직접** Supabase SQL
 * Editor 에서 돌린다(`supabase db push` 금지). 그래서 "새 컬럼을 쓰는 코드"가 "그 컬럼이
 * 아직 없는 DB" 위에서 반드시 한동안 돌아간다.
 *
 * 읽기는 `select('*')` 로 피할 수 있다. 하지만 **쓰기는 컬럼명을 적어야 해서** 피할 수 없고,
 * 없는 컬럼을 patch 에 넣으면 PostgREST 가 PGRST204 로 요청 전체를 거절한다 — 한 컬럼이
 * 아니라 **저장 자체가 실패한다**. 실제로 0045(estimated_minutes) 에서 시험항목 저장이
 * 통째로 막힌 적이 있다. 그 뒤로 새 컬럼에 쓰기를 넣을 때는 항상 여기를 거친다.
 *
 * 캐시는 프로세스 수명과 같다. 마이그레이션을 적용한 뒤에는 서버를 다시 띄우면 되고,
 * false 로 굳어도 기능이 하나 빠질 뿐 저장이 깨지지는 않는다(그 반대가 훨씬 나쁘다).
 */
const cache = new Map<string, boolean>()

export async function supportsColumn(
  table: string,
  column: string,
  /** false 일 때 한 번 남길 안내 — 어느 마이그레이션이 밀렸는지 로그만 보고 알 수 있게 */
  hint?: string,
): Promise<boolean> {
  const key = `${table}.${column}`
  const cached = cache.get(key)
  if (cached !== undefined) return cached

  const { error } = await supabaseAdmin.from(table).select(column).limit(1)
  const ok = !error
  cache.set(key, ok)
  if (!ok) console.warn(`[schema] ${key} 컬럼이 없습니다${hint ? ` — ${hint}` : ''}`)
  return ok
}

/** 여러 컬럼을 한 번에. 하나라도 없으면 false — 함께 써야 뜻이 통하는 묶음에 쓴다. */
export async function supportsColumns(
  table: string, columns: readonly string[], hint?: string,
): Promise<boolean> {
  const results = await Promise.all(columns.map(c => supportsColumn(table, c, hint)))
  return results.every(Boolean)
}

/** 테스트·마이그레이션 직후용. 캐시를 비워 다음 호출이 다시 확인하게 한다. */
export function resetColumnSupportCache(): void {
  cache.clear()
}
