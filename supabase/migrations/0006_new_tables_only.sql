-- ─────────────────────────────────────────────────────────────────────────────
-- 0006_new_tables_only.sql
-- 기존 DB에 없는 신규 테이블만 추가 (기존 테이블 건드리지 않음)
-- 실행: Supabase 대시보드 → SQL Editor에 붙여넣기 후 실행
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 공용 updated_at 트리거 함수 (없으면 생성) ───────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ─── 시험 역량 마스터 ─────────────────────────────────────────────────────────
create table if not exists test_capabilities (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

insert into test_capabilities (code, name, sort_order) values
  ('APPEARANCE',     '성상',               10),
  ('PACKAGE_CHECK',  '포장확인',           20),
  ('HPLC',           'HPLC',               30),
  ('GC',             'GC',                 40),
  ('GCMS',           'GCMS',               50),
  ('LCMS_TQ',        'LCMS-TQ',            60),
  ('UHPLC',          'UHPLC',              70),
  ('SHIMADZU_HPLC',  'Shimadzu HPLC',      80),
  ('GCMS_TQ',        'GCMS-TQ',            90),
  ('FTIR',           'FT-IR',             100),
  ('UV_VIS',         'UV/Vis',            110),
  ('TOC',            'TOC',               120),
  ('DISSOLUTION',    '용출',              130),
  ('POTENTIOMETER',  '전위차적정기',      140),
  ('MOISTURE',       '수분',              150),
  ('CONDUCTIVITY',   '전도도측정기',      160),
  ('TLC',            'TLC',               170),
  ('PH',             'pH',                180),
  ('FLUORESCENCE',   '형광분광도계',      190),
  ('PHYSICOCHEM',    '이화학',            200)
on conflict (code) do nothing;

-- ─── 평균 공수 (품목코드 × 포장단위) ─────────────────────────────────────────
-- product_master 기준 (product_code TEXT FK)
create table if not exists product_manhours (
  id            uuid primary key default gen_random_uuid(),
  product_code  text not null,
  package_unit  text not null,
  avg_hours     numeric(8,2) not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (product_code, package_unit)
);

create index if not exists idx_manhours_product_code on product_manhours(product_code);

drop trigger if exists trg_manhours_updated_at on product_manhours;
create trigger trg_manhours_updated_at
  before update on product_manhours
  for each row execute function set_updated_at();

-- ─── 배치 시험 배정 ───────────────────────────────────────────────────────────
-- production_batches(id) + testers(id) 기준
create table if not exists batch_test_assignments (
  id                   uuid primary key default gen_random_uuid(),
  batch_id             bigint not null references production_batches(id) on delete cascade,
  test_item            text not null,
  primary_tester_id    bigint references testers(id) on delete set null,
  secondary_tester_id  bigint references testers(id) on delete set null,
  status               text not null default 'pending'
                       check (status in ('pending','in_progress','completed','on_hold','cancelled','fail')),
  result               text,
  scheduled_start_at   timestamptz,
  scheduled_end_at     timestamptz,
  actual_start_at      timestamptz,
  actual_end_at        timestamptz,
  estimated_hours      numeric(6,2),
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (batch_id, test_item)
);

create index if not exists idx_bta_batch             on batch_test_assignments(batch_id);
create index if not exists idx_bta_primary_tester    on batch_test_assignments(primary_tester_id);
create index if not exists idx_bta_secondary_tester  on batch_test_assignments(secondary_tester_id);
create index if not exists idx_bta_status            on batch_test_assignments(status);

drop trigger if exists trg_bta_updated_at on batch_test_assignments;
create trigger trg_bta_updated_at
  before update on batch_test_assignments
  for each row execute function set_updated_at();
