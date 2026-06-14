-- ─────────────────────────────────────────────────────────────────────────────
-- 동시분석 그룹 (concurrent analysis groups)
--
--   대기/미배정 성격의 PCT 오더를 "동시에 시험 가능한" 묶음으로 그룹핑한다.
--   그룹핑 규칙(OR, 하나라도 충족 시 동일 그룹) 및 재생성 정책은
--   backend/services/concurrentGroups.ts 의 buildGroupsFromOrders() 참조.
--
--   1) concurrent_analysis_groups       — 그룹 헤더(시험 시작일, 잠금 등)
--   2) concurrent_analysis_group_items  — 그룹 ↔ 오더 매핑(오더당 1그룹)
--
-- 의존: 0004_pqm_schema.sql(set_updated_at()),
--       0010_pct_workflow.sql(pct_orders)
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ─── 그룹 헤더 ───────────────────────────────────────────────────────────────
-- group_lock=true 인 그룹은 rebuild 시 보존(재생성 금지).
-- test_start_date = MAX(그룹 내 각 오더의 packaging_date) + 1일.
create table if not exists concurrent_analysis_groups (
  id              uuid primary key default gen_random_uuid(),
  group_key       text not null,
  label           text,
  test_start_date date,
  group_lock      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create trigger trg_concurrent_analysis_groups_updated
  before update on concurrent_analysis_groups
  for each row execute function set_updated_at();

-- ─── 그룹 멤버(오더) ─────────────────────────────────────────────────────────
-- unique(order_id): 하나의 오더는 동시에 하나의 그룹에만 속한다.
create table if not exists concurrent_analysis_group_items (
  id                      uuid primary key default gen_random_uuid(),
  group_id                uuid not null references concurrent_analysis_groups(id) on delete cascade,
  order_id                uuid not null references pct_orders(id) on delete cascade,
  packaging_complete_date date,
  created_at              timestamptz not null default now(),
  unique (order_id)
);

create index if not exists idx_concurrent_group_items_group on concurrent_analysis_group_items(group_id);
