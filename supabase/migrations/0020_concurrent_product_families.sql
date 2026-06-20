-- 0020_concurrent_product_families.sql
-- 동시분석 품목군 (기준설정 마스터)
--
--   사용자가 "동시에 시험할 품목"을 직접 묶어 관리하는 마스터.
--   예) 네비레트엠정2.5mg / 네비레트엠정1.25mg → 하나의 동시분석 품목군.
--   멤버는 품목코드(product_code) 기준. 한 품목코드는 최대 1개 품목군에만 속한다.
--
--   자동배정 그룹핑(concurrentGroups.buildGroupsFromOrders)에서 이 마스터를
--   "마스터 우선 + 유사도 규칙 보완"으로 사용한다.
--   ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent)
--
-- 의존: 0004_pqm_schema.sql(set_updated_at())
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ─── 품목군 헤더 ───────────────────────────────────────────────────────────────
create table if not exists concurrent_product_families (
  id          uuid        primary key default gen_random_uuid(),
  name        text        not null,            -- 품목군 이름 (예: '네비레트엠 계열')
  note        text,                            -- 비고
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

drop trigger if exists trg_concurrent_product_families_updated on concurrent_product_families;
create trigger trg_concurrent_product_families_updated
  before update on concurrent_product_families
  for each row execute function set_updated_at();

-- ─── 품목군 멤버 (품목코드 기준) ───────────────────────────────────────────────
-- unique(product_code): 한 품목코드는 동시에 하나의 품목군에만 속한다(결정적 그룹핑).
create table if not exists concurrent_product_family_members (
  id            uuid        primary key default gen_random_uuid(),
  family_id     uuid        not null references concurrent_product_families(id) on delete cascade,
  product_code  text        not null,
  product_name  text,                          -- 표시용 스냅샷(품목명)
  created_at    timestamptz not null default now(),
  unique (product_code)
);

create index if not exists idx_concurrent_product_family_members_family
  on concurrent_product_family_members(family_id);

-- ─── PostgREST 스키마 캐시 즉시 갱신 ───────────────────────────────────────────
-- 테이블 생성 직후 PostgREST 캐시가 갱신되지 않으면 API에서 PGRST205
-- ("Could not find the table ... in the schema cache") 가 발생한다.
-- 적용 후 아래 NOTIFY 로 캐시를 강제 reload 한다(이미 적용된 환경에서도 단독 실행 가능).
notify pgrst, 'reload schema';
