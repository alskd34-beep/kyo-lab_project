-- ─────────────────────────────────────────────────────────────────────────────
-- PQM (Product Quality Management) 스키마
-- 기존 flat 테이블 → 정규화 스키마로 교체
-- 실행 순서: 0004 → 0005 (시드 데이터)
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ─── 공용 updated_at 트리거 함수 ──────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- 기존 flat 테이블 제거 (정규화 테이블로 교체)
-- ─────────────────────────────────────────────────────────────────────────────
drop table if exists batch_test_assignments  cascade;
drop table if exists product_manhours        cascade;
drop table if exists tester_capability_matrix cascade;
drop table if exists product_test_items      cascade;
drop table if exists production_batches      cascade;
drop table if exists testers                 cascade;
drop table if exists products                cascade;
drop table if exists product_master          cascade;
drop table if exists test_capabilities       cascade;
drop table if exists test_items              cascade;
drop table if exists dosage_forms            cascade;
drop table if exists product_classifications cascade;
drop table if exists product_categories      cascade;

-- ─────────────────────────────────────────────────────────────────────────────
-- 참조 테이블
-- ─────────────────────────────────────────────────────────────────────────────

-- 품목분류 (외주/고형제/전제/환제/주사제/액제/의약외품)
create table product_categories (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- 전문분류 (일반의약품/전문의약품/의약외품/향정신성/기타)
create table product_classifications (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- 제형 (현탁제/내용고형제/전제/환제/액제/주사제)
create table dosage_forms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- 시험 역량 마스터 (HPLC, GC, 성상 등 20종)
create table test_capabilities (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 품목 마스터
-- ─────────────────────────────────────────────────────────────────────────────
create table products (
  id                uuid primary key default gen_random_uuid(),
  product_code      text not null unique,
  name              text not null,
  name_alt          text,
  product_type      text,
  unit              text,
  abbreviation      text,
  difficulty        text check (difficulty in ('Low','Medium','High')),
  category_id       uuid references product_categories(id)      on delete set null,
  classification_id uuid references product_classifications(id) on delete set null,
  package_spec      text,
  sort_order        int  not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index idx_products_name           on products(name);
create index idx_products_category       on products(category_id);
create index idx_products_classification on products(classification_id);
create index idx_products_active         on products(is_active) where is_active;

create trigger trg_products_updated_at
  before update on products
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 시험 항목
-- ─────────────────────────────────────────────────────────────────────────────
create table test_items (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  estimated_hours numeric(6,2),
  requires_duo    boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index idx_test_items_active on test_items(is_active) where is_active;

create trigger trg_test_items_updated_at
  before update on test_items
  for each row execute function set_updated_at();

-- 품목-시험항목 매핑
create table product_test_items (
  product_id     uuid not null references products(id)   on delete cascade,
  test_item_id   uuid not null references test_items(id) on delete cascade,
  is_mandatory   boolean not null default true,
  sequence_order int    not null default 0,
  created_at     timestamptz not null default now(),
  primary key (product_id, test_item_id)
);

create index idx_pti_test_item on product_test_items(test_item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 생산 배치
-- ─────────────────────────────────────────────────────────────────────────────
create table production_batches (
  id                            uuid primary key default gen_random_uuid(),
  product_id                    uuid not null references products(id) on delete restrict,
  spec                          text,
  batch_no                      text not null unique,
  dosage_form_id                uuid references dosage_forms(id) on delete set null,
  packaging_planned_date        date,
  record_review_deadline        date,
  qc_planned_completion_date    date,
  qc_actual_completion_date     date,
  status                        text not null default 'pending'
                                check (status in ('pending','in_progress','completed','on_hold','cancelled')),
  is_urgent                     boolean not null default false,
  notes                         text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index idx_batches_product     on production_batches(product_id);
create index idx_batches_status      on production_batches(status);
create index idx_batches_qc_planned  on production_batches(qc_planned_completion_date);
create index idx_batches_packaging   on production_batches(packaging_planned_date);

create trigger trg_batches_updated_at
  before update on production_batches
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 시험자
-- ─────────────────────────────────────────────────────────────────────────────
create table testers (
  id           uuid primary key default gen_random_uuid(),
  employee_no  text not null unique,
  name         text not null,
  can_solo     boolean not null default true,
  can_duo      boolean not null default true,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index idx_testers_active on testers(is_active) where is_active;

create trigger trg_testers_updated_at
  before update on testers
  for each row execute function set_updated_at();

-- 시험자 역량 매트릭스
-- proficiency_level: Y(가능) / N(불가) / X(미평가) / O(우수)
create table tester_capability_matrix (
  tester_id          uuid not null references testers(id)           on delete cascade,
  capability_id      uuid not null references test_capabilities(id) on delete cascade,
  proficiency_level  char(1) not null check (proficiency_level in ('Y','N','X','O')),
  updated_at         timestamptz not null default now(),
  primary key (tester_id, capability_id)
);

create index idx_tcm_capability on tester_capability_matrix(capability_id);

create trigger trg_tcm_updated_at
  before update on tester_capability_matrix
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 평균 공수 (품목 × 포장단위)
-- ─────────────────────────────────────────────────────────────────────────────
create table product_manhours (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  package_unit  text not null,
  avg_hours     numeric(8,2) not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (product_id, package_unit)
);

create index idx_manhours_product on product_manhours(product_id);

create trigger trg_manhours_updated_at
  before update on product_manhours
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 배치 시험 배정
-- ─────────────────────────────────────────────────────────────────────────────
create table batch_test_assignments (
  id                   uuid primary key default gen_random_uuid(),
  batch_id             uuid not null references production_batches(id) on delete cascade,
  test_item_id         uuid not null references test_items(id)         on delete restrict,
  primary_tester_id    uuid references testers(id) on delete set null,
  secondary_tester_id  uuid references testers(id) on delete set null,
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
  unique (batch_id, test_item_id)
);

create index idx_bta_batch             on batch_test_assignments(batch_id);
create index idx_bta_test_item         on batch_test_assignments(test_item_id);
create index idx_bta_primary_tester    on batch_test_assignments(primary_tester_id);
create index idx_bta_secondary_tester  on batch_test_assignments(secondary_tester_id);
create index idx_bta_status            on batch_test_assignments(status);

create trigger trg_bta_updated_at
  before update on batch_test_assignments
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 기본 시드 데이터 (참조 테이블)
-- ─────────────────────────────────────────────────────────────────────────────

insert into dosage_forms (code, name, sort_order) values
  ('현탁제',     '현탁제',     10),
  ('내용고형제', '내용고형제', 20),
  ('전제',       '전제',       30),
  ('환제',       '환제',       40),
  ('액제',       '액제',       50),
  ('주사제',     '주사제',     60)
on conflict (code) do nothing;

insert into test_capabilities (code, name, sort_order) values
  ('APPEARANCE',    '성상',         10),
  ('PACKAGE_CHECK', '포장확인',     20),
  ('HPLC',          'HPLC',         30),
  ('GC',            'GC',           40),
  ('GCMS',          'GCMS',         50),
  ('LCMS_TQ',       'LCMS-TQ',      60),
  ('UHPLC',         'UHPLC',        70),
  ('SHIMADZU_HPLC', 'Shimadzu HPLC',80),
  ('GCMS_TQ',       'GCMS-TQ',      90),
  ('FTIR',          'FT-IR',       100),
  ('UV_VIS',        'UV/Vis',      110),
  ('TOC',           'TOC',         120),
  ('DISSOLUTION',   '용출',        130),
  ('POTENTIOMETER', '전위차적정기',140),
  ('MOISTURE',      '수분',        150),
  ('CONDUCTIVITY',  '전도도측정기',160),
  ('TLC',           'TLC',         170),
  ('PH',            'pH',          180),
  ('FLUORESCENCE',  '형광분광도계',190),
  ('PHYSICOCHEM',   '이화학',      200)
on conflict (code) do nothing;
