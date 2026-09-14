/**
 * [BACKEND] 스키마 미적용을 안내 메시지로 바꾸는 헬퍼.
 */
/**
 * 마이그레이션 미적용을 사람이 읽을 수 있게 바꾼다.
 * Supabase 는 이 경우 PGRST205(테이블 없음) 또는 42703(컬럼 없음)을 준다.
 *
 * @param migration 실행해야 할 SQL 파일명. 기본값은 이 헬퍼가 처음 생긴 0029 다.
 */
export function describeSchemaError(
  err: unknown,
  feature: string,
  migration = '0029_test_item_groups.sql',
): Error {
  const e = err as { code?: string; message?: string } | null
  const msg = e?.message ?? ''
  const missing =
    // PGRST205 테이블 없음 / PGRST204 컬럼 없음 / 42P01 relation / 42703 column
    e?.code === 'PGRST205' || e?.code === 'PGRST204'
    // PGRST200 관계(임베드) 없음 — 병렬 배정(0049) 담당자 테이블 임베드일 때만 미적용으로 본다.
    // 다른 임베드 오타까지 설치 안내로 가리지 않게 좁힌다.
    || (e?.code === 'PGRST200' && /pct_order_assignees/.test(msg))
    || e?.code === '42P01' || e?.code === '42703'
    || /Could not find the .*(table|column)|does not exist/i.test(msg)
  if (missing) {
    return new Error(
      `${feature} 기능이 아직 DB에 반영되지 않았습니다. ` +
      `Supabase SQL Editor 에서 supabase/migrations/${migration} 을 실행해 주세요. ` +
      `(원인: ${msg || e?.code || '스키마 없음'})`,
    )
  }
  return err instanceof Error ? err : new Error(msg || '서버 오류')
}
