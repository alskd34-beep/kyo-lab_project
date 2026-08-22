-- ─────────────────────────────────────────────────────────────────────────────
-- 품목별 시험공수 표준 (Workload Standard)
--
--   품목(workload_product) → 시험항목(workload_test_item) → 작업단계(workload_step)
--
-- 배경/정책
--   - 공수는 인적 / 기기 / 대기 / 검토 4종으로 분리해 관리한다. 서로 합산하지 않는다.
--   - 표준 소요일(standard_lead_time_days)은 위 공수 합계로 계산하지 않는 별도 관리값이다.
--     (기기 가동 중 시험자는 다른 업무 수행 가능, 대기시간은 사람이 일하는 시간이 아님)
--   - 시간 단위는 전부 '분(minute)'으로 저장한다. 시/일 표기는 UI 에서 변환한다.
--   - 상위(시험항목/품목)의 공수 합계 컬럼은 하위 작업단계 합계로 서비스가 재계산한다.
--
-- ⚠️ 기존 `product_workload`(공수 '일' 단일값, PCT 자동배정용)과는 다른 개념/테이블이다.
--    이름 충돌을 피하려고 `workload_*` 접두사를 쓴다.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 품목 공수 표준 ──────────────────────────────────────────────────────────
create table if not exists workload_product (
  id                       uuid primary key default gen_random_uuid(),
  product_code             text not null,
  product_name             text not null,
  dosage_form              text,

  -- 표준 소요일(일). 공수 합계와 무관한 별도 관리값. 0 초과.
  standard_lead_time_days  numeric(5,1) not null default 1 check (standard_lead_time_days > 0),

  -- 하위 합계(자동 계산 · 분)
  total_human_minutes      integer not null default 0,
  total_equipment_minutes  integer not null default 0,
  total_waiting_minutes    integer not null default 0,
  total_review_minutes     integer not null default 0,
  test_item_count          integer not null default 0,
  step_count               integer not null default 0,

  version                  integer not null default 1,
  effective_from           date,
  effective_to             date,
  status                   text not null default 'DRAFT'
                             check (status in ('DRAFT', 'ACTIVE', 'INACTIVE')),

  -- Soft delete: 과거 시험실적이 연결될 수 있어 hard delete 하지 않는다.
  deleted_at               timestamptz,

  created_at               timestamptz not null default now(),
  created_by               text,
  updated_at               timestamptz not null default now(),
  updated_by               text
);

-- 품목코드 자연키 (삭제되지 않은 행 기준 유일)
create unique index if not exists ux_workload_product_code
  on workload_product (product_code)
  where deleted_at is null;

-- ─── 시험항목 ────────────────────────────────────────────────────────────────
create table if not exists workload_test_item (
  id                        uuid primary key default gen_random_uuid(),
  product_workload_id       uuid not null references workload_product(id) on delete cascade,

  test_code                 text,
  test_name                 text not null,
  sequence                  integer not null default 1,

  -- 하위 작업단계 합계(자동 계산 · 분)
  human_minutes             integer not null default 0,
  equipment_minutes         integer not null default 0,
  waiting_minutes           integer not null default 0,
  review_minutes            integer not null default 0,

  parallel_allowed              boolean not null default true,
  simultaneous_analysis_allowed boolean not null default false,
  -- 동시분석 시 공수를 건수만큼 단순 곱셈할 수 없어 증분을 따로 둔다.
  simultaneous_max_count                     integer,
  simultaneous_additional_human_minutes      integer,
  simultaneous_additional_equipment_minutes  integer,

  required_skill            text,
  difficulty                text not null default 'NORMAL'
                              check (difficulty in ('LOW', 'NORMAL', 'HIGH', 'VERY_HIGH')),
  memo                      text,

  deleted_at                timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists ix_workload_test_item_product
  on workload_test_item (product_workload_id)
  where deleted_at is null;

-- ─── 작업단계 ────────────────────────────────────────────────────────────────
create table if not exists workload_step (
  id                   uuid primary key default gen_random_uuid(),
  test_item_id         uuid not null references workload_test_item(id) on delete cascade,

  step_code            text,
  step_name            text not null,
  sequence             integer not null default 1,

  workload_type        text not null
                         check (workload_type in ('HUMAN', 'EQUIPMENT', 'WAITING', 'REVIEW')),
  duration_minutes     integer not null default 0 check (duration_minutes >= 0),

  -- 기기공수는 '유형 + 사용시간' 으로 관리한다.
  -- equipment_type_id 는 향후 Equipment Master 연결용 예약 컬럼(현재는 name 만 사용).
  equipment_type_id    text,
  equipment_type_name  text,

  required_skill       text,
  parallel_allowed     boolean not null default false,
  predecessor_step_id  uuid references workload_step(id) on delete set null,
  memo                 text,

  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),

  -- EQUIPMENT 는 기기 유형 필수, WAITING/REVIEW 는 기기 불필요
  constraint ck_workload_step_equipment check (
    workload_type <> 'EQUIPMENT'
    or equipment_type_id is not null
    or coalesce(equipment_type_name, '') <> ''
  )
);

create index if not exists ix_workload_step_test_item
  on workload_step (test_item_id)
  where deleted_at is null;

-- ─── 버전 변경이력 ───────────────────────────────────────────────────────────
-- 어떤 제조번호/시험에 어떤 버전 공수를 적용했는지 추적하기 위한 스냅샷 보관.
create table if not exists workload_version_history (
  id                   uuid primary key default gen_random_uuid(),
  product_workload_id  uuid not null references workload_product(id) on delete cascade,
  version              integer not null,
  effective_from       date,
  changed_by           text,
  change_note          text,
  snapshot             jsonb,
  created_at           timestamptz not null default now()
);

create index if not exists ix_workload_version_history_product
  on workload_version_history (product_workload_id, version desc);

-- ─── 실적 공수 (표준공수 개선용 · 현재는 수집 전) ────────────────────────────
create table if not exists workload_actual (
  id                   uuid primary key default gen_random_uuid(),
  product_workload_id  uuid references workload_product(id) on delete set null,
  test_item_id         uuid references workload_test_item(id) on delete set null,
  work_step_id         uuid references workload_step(id) on delete set null,

  worker_id            text,
  equipment_id         text,

  started_at           timestamptz,
  completed_at         timestamptz,

  actual_minutes       integer not null default 0,
  standard_minutes     integer not null default 0,

  production_lot_no    text,
  recorded_at          timestamptz not null default now()
);

create index if not exists ix_workload_actual_recorded
  on workload_actual (recorded_at desc);
create index if not exists ix_workload_actual_product
  on workload_actual (product_workload_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 초기 확인용 예제 데이터 — 쌍화탕 (P001)
--
--   인적공수  5 + 10 + 30 + 15 + 30 = 90분 (1시간 30분)
--   기기공수  30 + 1800            = 1830분 (30시간 30분)
--   대기시간  120분 (2시간)
--   검토공수  480분 (8시간)
--   표준소요일 3일  ← 위 합계로 계산하지 않는다
-- ─────────────────────────────────────────────────────────────────────────────
do $$
declare
  v_product uuid;
  v_item    uuid;
  v_prev    uuid;
begin
  if exists (select 1 from workload_product where product_code = 'P001' and deleted_at is null) then
    return;
  end if;

  insert into workload_product (
    product_code, product_name, dosage_form, standard_lead_time_days,
    version, effective_from, status, created_by, updated_by
  ) values (
    'P001', '쌍화탕', '액제', 3,
    1, current_date, 'ACTIVE', 'system', 'system'
  ) returning id into v_product;

  -- ① 성상
  insert into workload_test_item (product_workload_id, test_code, test_name, sequence, difficulty, parallel_allowed)
    values (v_product, 'T-APPR', '성상', 1, 'LOW', true) returning id into v_item;
  insert into workload_step (test_item_id, step_name, sequence, workload_type, duration_minutes)
    values (v_item, '시험수행', 1, 'HUMAN', 5);

  -- ② 확인시험 (반응대기 포함)
  insert into workload_test_item (product_workload_id, test_code, test_name, sequence, difficulty, required_skill, parallel_allowed)
    values (v_product, 'T-ID', '확인시험', 2, 'NORMAL', 'HPLC', true) returning id into v_item;
  insert into workload_step (test_item_id, step_name, sequence, workload_type, duration_minutes)
    values (v_item, '검체 준비', 1, 'HUMAN', 10) returning id into v_prev;
  insert into workload_step (test_item_id, step_name, sequence, workload_type, duration_minutes, predecessor_step_id)
    values (v_item, '반응대기', 2, 'WAITING', 120, v_prev) returning id into v_prev;
  insert into workload_step (test_item_id, step_name, sequence, workload_type, duration_minutes,
                             equipment_type_name, required_skill, predecessor_step_id)
    values (v_item, '확인 분석', 3, 'EQUIPMENT', 30, 'HPLC', 'HPLC', v_prev);

  -- ③ 함량시험
  insert into workload_test_item (product_workload_id, test_code, test_name, sequence, difficulty, required_skill,
                                  parallel_allowed, simultaneous_analysis_allowed, simultaneous_max_count,
                                  simultaneous_additional_equipment_minutes)
    values (v_product, 'T-ASSAY', '함량시험', 3, 'HIGH', 'HPLC', true, true, 4, 120) returning id into v_item;
  insert into workload_step (test_item_id, step_name, sequence, workload_type, duration_minutes)
    values (v_item, '검체 전처리', 1, 'HUMAN', 30) returning id into v_prev;
  insert into workload_step (test_item_id, step_name, sequence, workload_type, duration_minutes,
                             equipment_type_name, predecessor_step_id)
    values (v_item, 'HPLC 세팅', 2, 'HUMAN', 15, null, v_prev) returning id into v_prev;
  insert into workload_step (test_item_id, step_name, sequence, workload_type, duration_minutes,
                             equipment_type_name, required_skill, predecessor_step_id)
    values (v_item, 'HPLC 분석', 3, 'EQUIPMENT', 1800, 'HPLC', 'HPLC', v_prev) returning id into v_prev;
  insert into workload_step (test_item_id, step_name, sequence, workload_type, duration_minutes, predecessor_step_id)
    values (v_item, '결과처리', 4, 'HUMAN', 30, v_prev);

  -- ④ 시험검토
  insert into workload_test_item (product_workload_id, test_code, test_name, sequence, difficulty, parallel_allowed)
    values (v_product, 'T-REVIEW', '시험검토', 4, 'NORMAL', false) returning id into v_item;
  insert into workload_step (test_item_id, step_name, sequence, workload_type, duration_minutes)
    values (v_item, '시험검토', 1, 'REVIEW', 480);

  -- 합계 재계산 (서비스와 동일 규칙)
  update workload_test_item ti set
    human_minutes     = coalesce(s.human, 0),
    equipment_minutes = coalesce(s.equip, 0),
    waiting_minutes   = coalesce(s.wait, 0),
    review_minutes    = coalesce(s.review, 0)
  from (
    select test_item_id,
           sum(duration_minutes) filter (where workload_type = 'HUMAN')     as human,
           sum(duration_minutes) filter (where workload_type = 'EQUIPMENT') as equip,
           sum(duration_minutes) filter (where workload_type = 'WAITING')   as wait,
           sum(duration_minutes) filter (where workload_type = 'REVIEW')    as review
      from workload_step where deleted_at is null group by test_item_id
  ) s
  where s.test_item_id = ti.id and ti.product_workload_id = v_product;

  update workload_product p set
    total_human_minutes     = coalesce(a.human, 0),
    total_equipment_minutes = coalesce(a.equip, 0),
    total_waiting_minutes   = coalesce(a.wait, 0),
    total_review_minutes    = coalesce(a.review, 0),
    test_item_count         = coalesce(a.items, 0),
    step_count              = coalesce(a.steps, 0)
  from (
    select ti.product_workload_id,
           sum(ti.human_minutes)     as human,
           sum(ti.equipment_minutes) as equip,
           sum(ti.waiting_minutes)   as wait,
           sum(ti.review_minutes)    as review,
           count(*)                  as items,
           (select count(*) from workload_step s
              join workload_test_item t2 on t2.id = s.test_item_id
             where t2.product_workload_id = ti.product_workload_id
               and s.deleted_at is null and t2.deleted_at is null) as steps
      from workload_test_item ti
     where ti.deleted_at is null
     group by ti.product_workload_id
  ) a
  where a.product_workload_id = p.id and p.id = v_product;

  insert into workload_version_history (product_workload_id, version, effective_from, changed_by, change_note)
    values (v_product, 1, current_date, 'system', '초기 공수 표준 등록');
end $$;
