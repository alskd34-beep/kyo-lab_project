-- ============================================================
-- 0029_test_item_groups.sql
--
-- 1) 시험항목 그룹 — '전공정' 처럼 여러 시험항목을 순서대로 묶은 템플릿.
--    기존 test_items.category(대분류)는 분류·색상용으로 그대로 두고, 그룹은 별도 개념이다.
--    한 시험항목이 여러 그룹에 속할 수 있다.
--
-- 2) 오더별 시험항목을 "전항목/개별항목" 구분 대신 **스냅샷 + 제외 플래그** 로 바꾼다.
--    - 오더가 생기면 품목 기준(product_test_items) 전체를 pct_order_test_items 로 복사한다.
--    - 관리자가 빼면 행을 지우지 않고 is_excluded = true 로 둔다(무엇을 뺐는지 남긴다).
--    - 기준을 나중에 바꿔도 이미 만들어진 오더는 흔들리지 않는다(PRD 원칙2).
--
-- [적용 방법] ⚠️ `supabase db push` 를 쓰지 말 것 — 0028 헤더의 경고 참조.
--   대시보드 SQL Editor 에서 이 파일만 실행한다. 전부 재실행 안전(if not exists / add column if not exists).
-- ============================================================

-- ─── 1) 시험항목 그룹 ────────────────────────────────────────────────────────
create table if not exists test_item_groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  description text,
  sort_order  int  not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

create table if not exists test_item_group_items (
  group_id       uuid not null references test_item_groups(id) on delete cascade,
  test_item_id   uuid not null references test_items(id)       on delete cascade,
  sequence_order int  not null default 0,
  primary key (group_id, test_item_id)
);

create index if not exists idx_test_item_group_items_group
  on test_item_group_items(group_id, sequence_order);

comment on table test_item_groups is
  '시험항목 그룹(순서 있는 템플릿). 품목별 시험항목에 통째로 넣기 위한 묶음. 예: 전공정';

-- ─── 2) 오더별 시험항목: 스냅샷 + 제외 플래그 ────────────────────────────────
alter table pct_order_test_items
  add column if not exists is_excluded     boolean not null default false,
  add column if not exists excluded_reason text,
  -- 'product' = 품목 기준에서 복사됨 / 'manual' = 이 오더에만 따로 추가됨
  add column if not exists source          text not null default 'product';

create index if not exists idx_pct_order_test_items_active
  on pct_order_test_items(order_id) where not is_excluded;

comment on column pct_order_test_items.is_excluded is
  '이 오더에서만 일시적으로 뺀 항목. 행을 지우지 않고 남겨 "무엇을 뺐는지" 이력을 보존한다.';
comment on column pct_order_test_items.source is
  'product = 품목 기준 스냅샷 / manual = 이 오더에만 추가';

-- 진행방법(pct_orders.method)은 구글시트에서 들어오는 값이라 컬럼을 남긴다.
-- 다만 이제 "무엇을 배정할지"를 결정하지 않는다. 오더 생성 시 초기값 힌트로만 쓴다.
comment on column pct_orders.method is
  '구글시트 원본값(전항목/개별항목). 배정 항목은 pct_order_test_items 가 결정한다(0029 이후). 초기값 힌트로만 사용.';
