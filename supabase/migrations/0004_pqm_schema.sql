-- ─────────────────────────────────────────────────────────────────────────────
-- PQM (Product Quality Management) 스키마
-- 품목/배치/시험항목/시험자/역량매트릭스/시험배정
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

-- ─── 품목분류 (외주/고형제/전제/환제/주사제/액제/의약외품) ────────────────────
create table if not exists product_categories (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ─── 전문분류 (일반의약품/전문의약품/의약외품/향정신성/기타) ──────────────────
create table if not exists product_classifications (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ─── 제형 (현탁제/내용고형제/전제/환제/액제/주사제) ───────────────────────────
create table if not exists dosage_forms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ─── 품목 마스터 ──────────────────────────────────────────────────────────────
create table if not exists products (
  id                uuid primary key default gen_random_uuid(),
  product_code      text not null unique,
  name              text not null,
  name_alt          text,                                        -- 품목명2
  product_type      text,                                        -- 포장제품/상품/의약외품
  unit              text,                                        -- 단위
  abbreviation      text,                                        -- 약호
  difficulty        text check (difficulty in ('Low','Medium','High')),
  category_id       uuid references product_categories(id)      on delete set null,
  classification_id uuid references product_classifications(id) on delete set null,
  package_spec      text,
  sort_order        int  not null default 0,
  is_active         boolean not null default true,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_products_name           on products(name);
create index if not exists idx_products_category       on products(category_id);
create index if not exists idx_products_classification on products(classification_id);
create index if not exists idx_products_active         on products(is_active) where is_active;

drop trigger if exists trg_products_updated_at on products;
create trigger trg_products_updated_at
  before update on products
  for each row execute function set_updated_at();

-- ─── 생산 배치 ────────────────────────────────────────────────────────────────
create table if not exists production_batches (
  id                            uuid primary key default gen_random_uuid(),
  product_id                    uuid not null references products(id) on delete restrict,
  spec                          text,                                            -- 규격
  batch_no                      text not null unique,                             -- 제조번호
  dosage_form_id                uuid references dosage_forms(id) on delete set null,
  packaging_planned_date        date,                                             -- 포장일_예정일
  record_review_deadline        date,                                             -- 기록서검토기한
  qc_planned_completion_date    date,                                             -- QC완료예정일
  qc_actual_completion_date     date,                                             -- QC완료일
  status                        varchar(20) not null default 'PLANNED'
                                check (status in ('PLANNED','IN_PROGRESS','COMPLETED','ON_HOLD','CANCELLED')),
  notes                         text,
  created_at                    timestamptz not null default now(),
  updated_at                    timestamptz not null default now()
);

create index if not exists idx_batches_product        on production_batches(product_id);
create index if not exists idx_batches_status         on production_batches(status);
create index if not exists idx_batches_qc_planned     on production_batches(qc_planned_completion_date);
create index if not exists idx_batches_packaging      on production_batches(packaging_planned_date);
create index if not exists idx_batches_dosage_form    on production_batches(dosage_form_id);

drop trigger if exists trg_batches_updated_at on production_batches;
create trigger trg_batches_updated_at
  before update on production_batches
  for each row execute function set_updated_at();

-- ─── 시험 항목 ────────────────────────────────────────────────────────────────
create table if not exists test_items (
  id              uuid primary key default gen_random_uuid(),
  name            text not null unique,
  estimated_hours numeric(6,2),
  requires_duo    boolean not null default false,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_test_items_active on test_items(is_active) where is_active;

drop trigger if exists trg_test_items_updated_at on test_items;
create trigger trg_test_items_updated_at
  before update on test_items
  for each row execute function set_updated_at();

-- ─── 품목-시험항목 매핑 ───────────────────────────────────────────────────────
create table if not exists product_test_items (
  product_id     uuid not null references products(id)   on delete cascade,
  test_item_id   uuid not null references test_items(id) on delete cascade,
  is_mandatory   boolean not null default true,
  sequence_order int    not null default 0,
  created_at     timestamptz not null default now(),
  primary key (product_id, test_item_id)
);

create index if not exists idx_pti_test_item on product_test_items(test_item_id);

-- ─── 시험 역량 마스터 ─────────────────────────────────────────────────────────
create table if not exists test_capabilities (
  id          uuid primary key default gen_random_uuid(),
  code        text not null unique,
  name        text not null,
  sort_order  int  not null default 0,
  created_at  timestamptz not null default now()
);

-- ─── 시험자 ───────────────────────────────────────────────────────────────────
create table if not exists testers (
  id           uuid primary key default gen_random_uuid(),
  employee_no  text not null unique,
  name         text not null,
  can_solo     boolean not null default true,
  can_duo      boolean not null default true,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_testers_active on testers(is_active) where is_active;

drop trigger if exists trg_testers_updated_at on testers;
create trigger trg_testers_updated_at
  before update on testers
  for each row execute function set_updated_at();

-- ─── 시험자 역량 매트릭스 ─────────────────────────────────────────────────────
-- proficiency_level: Y(가능) / N(불가) / X(미평가) / O(우수)
create table if not exists tester_capability_matrix (
  tester_id          uuid not null references testers(id)            on delete cascade,
  capability_id      uuid not null references test_capabilities(id)  on delete cascade,
  proficiency_level  char(1) not null check (proficiency_level in ('Y','N','X','O')),
  updated_at         timestamptz not null default now(),
  primary key (tester_id, capability_id)
);

create index if not exists idx_tcm_capability on tester_capability_matrix(capability_id);

drop trigger if exists trg_tcm_updated_at on tester_capability_matrix;
create trigger trg_tcm_updated_at
  before update on tester_capability_matrix
  for each row execute function set_updated_at();

-- ─── 평균 공수 (품목 × 포장단위) ──────────────────────────────────────────────
create table if not exists product_manhours (
  id            uuid primary key default gen_random_uuid(),
  product_id    uuid not null references products(id) on delete cascade,
  package_unit  text not null,
  avg_hours     numeric(8,2) not null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (product_id, package_unit)
);

create index if not exists idx_manhours_product on product_manhours(product_id);

drop trigger if exists trg_manhours_updated_at on product_manhours;
create trigger trg_manhours_updated_at
  before update on product_manhours
  for each row execute function set_updated_at();

-- ─── 배치 시험 배정 ──────────────────────────────────────────────────────────
create table if not exists batch_test_assignments (
  id                   uuid primary key default gen_random_uuid(),
  batch_id             uuid not null references production_batches(id) on delete cascade,
  test_item_id         uuid not null references test_items(id)         on delete restrict,
  primary_tester_id    uuid references testers(id) on delete set null,
  secondary_tester_id  uuid references testers(id) on delete set null,
  status               varchar(20) not null default 'PLANNED'
                       check (status in ('PLANNED','IN_PROGRESS','COMPLETED','ON_HOLD','CANCELLED','FAIL')),
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

create index if not exists idx_bta_batch              on batch_test_assignments(batch_id);
create index if not exists idx_bta_test_item          on batch_test_assignments(test_item_id);
create index if not exists idx_bta_primary_tester    on batch_test_assignments(primary_tester_id);
create index if not exists idx_bta_secondary_tester  on batch_test_assignments(secondary_tester_id);
create index if not exists idx_bta_status             on batch_test_assignments(status);
create index if not exists idx_bta_scheduled_start    on batch_test_assignments(scheduled_start_at);

drop trigger if exists trg_bta_updated_at on batch_test_assignments;
create trigger trg_bta_updated_at
  before update on batch_test_assignments
  for each row execute function set_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED DATA
-- ─────────────────────────────────────────────────────────────────────────────

-- 품목분류 (7개)
insert into product_categories (code, name, sort_order) values
  ('OUTSOURCE',   '외주',     10),
  ('SOLID',       '고형제',   20),
  ('DECOCTION',   '전제',     30),
  ('PILL',        '환제',     40),
  ('INJECTION',   '주사제',   50),
  ('LIQUID',      '액제',     60),
  ('QUASI_DRUG',  '의약외품', 70)
on conflict (code) do nothing;

-- 전문분류 (5개)
insert into product_classifications (code, name, sort_order) values
  ('OTC',         '일반의약품',     10),
  ('ETC',         '전문의약품',     20),
  ('QUASI_DRUG',  '의약외품',       30),
  ('PSYCHOTROPIC','향정신성의약품', 40),
  ('OTHER',       '기타',           99)
on conflict (code) do nothing;

-- 제형 (6개)
insert into dosage_forms (code, name, sort_order) values
  ('SUSPENSION',     '현탁제',     10),
  ('ORAL_SOLID',     '내용고형제', 20),
  ('DECOCTION',      '전제',       30),
  ('PILL',           '환제',       40),
  ('LIQUID',         '액제',       50),
  ('INJECTION',      '주사제',     60)
on conflict (code) do nothing;

-- 시험 역량 (20종)
insert into test_capabilities (code, name, sort_order) values
  ('HPLC',           'HPLC',                10),
  ('GC',             'GC',                  20),
  ('GCMS',           'GCMS',                30),
  ('LCMS_TQ',        'LCMS-TQ',             40),
  ('UHPLC',          'UHPLC',               50),
  ('SHIMADZU_HPLC',  'Shimadzu HPLC',       60),
  ('GCMS_TQ',        'GCMS-TQ',             70),
  ('FTIR',           'FT-IR',               80),
  ('UV_VIS',         'UV/Vis',              90),
  ('TOC',            'TOC',                100),
  ('DISSOLUTION',    '용출',               110),
  ('POTENTIOMETER',  '전위차적정기',       120),
  ('MOISTURE',       '수분',               130),
  ('CONDUCTIVITY',   '전도도측정기',       140),
  ('TLC',            'TLC',                150),
  ('PH',             'pH',                 160),
  ('FLUORESCENCE',   '형광분광도계',       170),
  ('PHYSICOCHEM',    '이화학',             180),
  ('APPEARANCE',     '성상',               190),
  ('PACKAGE_CHECK',  '포장확인',           200)
on conflict (code) do nothing;
