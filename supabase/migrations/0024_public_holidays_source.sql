-- 0024_public_holidays_source.sql
-- public_holidays 출처 구분 컬럼(source) 추가: 'api' | 'manual'
--   - data.go.kr 공휴일 API 로 가져온 행은 'api', 사용자가 직접 추가한 행은 'manual'.
--   - 기존 행은 모두 'manual' 로 채운다(과거 수동/시드 데이터 보존 → 자동 수집이 덮어쓰지 않도록).
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent)
-- 의존: 0016_holidays.sql(public_holidays)
-- ─────────────────────────────────────────────────────────────────────────────

-- ADD COLUMN ... DEFAULT 'manual' NOT NULL → 기존 행이 모두 'manual' 로 채워진다.
alter table public_holidays
  add column if not exists source text not null default 'manual';

-- 값 제약(api|manual)
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'public_holidays_source_check') then
    alter table public_holidays
      add constraint public_holidays_source_check check (source in ('api', 'manual'));
  end if;
end $$;

-- 안전망: 혹시 남은 NULL 보정
update public_holidays set source = 'manual' where source is null;

-- PostgREST 스키마 캐시 즉시 갱신 (적용 직후 PGRST204/42703 방지)
notify pgrst, 'reload schema';
