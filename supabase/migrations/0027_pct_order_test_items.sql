-- ─────────────────────────────────────────────────────────────────────────────
-- 오더별 선택 시험항목 (진행방법 = '개별항목')
--
-- 진행방법
--   전항목   : 품목에 등록된 시험항목 전체를 담당자에게 배정 → 별도 저장 없음
--              (작업 시작 시 product_test_items 를 그대로 사용)
--   개별항목 : 오더 생성 시 고른 항목만 배정 → 이 테이블에 저장
--              (작업 시작 시 이 목록으로 qc_job_items 를 만든다)
--
-- test_item_name 을 함께 저장하는 이유:
--   qc_job_items 와 같은 이유로, 시험항목 마스터가 바뀌거나 삭제돼도
--   그 오더에 무엇을 배정했는지는 그대로 남아야 한다.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists pct_order_test_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references pct_orders(id) on delete cascade,
  test_item_id   uuid references test_items(id) on delete set null,
  test_item_name text not null,
  sequence_order int  not null default 0,
  created_at     timestamptz not null default now(),
  -- 같은 오더에 같은 항목을 두 번 담지 않는다
  unique (order_id, test_item_name)
);

create index if not exists idx_pct_order_test_items_order
  on pct_order_test_items(order_id, sequence_order);

comment on table pct_order_test_items is
  '진행방법=개별항목 오더에서 선택한 시험항목. 전항목 오더는 행을 만들지 않는다.';
