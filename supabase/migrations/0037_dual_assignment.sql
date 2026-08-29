-- ─────────────────────────────────────────────────────────────────────────────
-- 2인 배정 (Dual Assignment)
--
-- 지금까지 오더(pct_orders)는 담당자를 1명만 가질 수 있었다. 품목코드 1개·제조번호
-- 1개인 오더를 2명이 나눠 시험해야 하는 현장 요구가 있어, 오더에 담당자2를 추가하고
-- 담당자별로 QC작업을 별도로(2건) 만들 수 있게 한다. 항목의 담당자는 사람(tester_id)이
-- 아니라 슬롯 번호(1|2)로 저장한다 — 관리자가 담당자를 교체해도 "이 항목은 누구 몫인가"
-- 라는 참조가 깨지지 않고, 담당자1/2가 누구인지는 오더 행 하나(assignee_tester_id /
-- assignee_tester_id_2)로만 유지되기 때문이다.
--
-- 의존: 0010_pct_workflow.sql (pct_orders, qc_jobs), 0027_pct_order_test_items.sql
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── pct_orders: 2인 배정 플래그 + 두 번째 담당자 ────────────────────────────
alter table pct_orders
  add column if not exists is_dual_assignment   boolean not null default false,
  add column if not exists assignee_tester_id_2 uuid references testers(id) on delete set null;

create index if not exists idx_pct_orders_assignee2 on pct_orders(assignee_tester_id_2);

-- 같은 사람을 담당자1·담당자2로 동시에 배정할 수 없다.
alter table pct_orders drop constraint if exists chk_pct_orders_dual_distinct;
alter table pct_orders add constraint chk_pct_orders_dual_distinct
  check (assignee_tester_id_2 is null
         or assignee_tester_id_2 is distinct from assignee_tester_id);

-- ─── pct_order_test_items: 항목별 담당자 슬롯 ────────────────────────────────
-- 2인 배정이 아닌 오더는 이 컬럼을 무시한다(전부 기본값 1이므로 기존 동작과 완전히
-- 동일하다 — 별도 백필이 필요 없는 이유).
alter table pct_order_test_items
  add column if not exists assignee_slot smallint not null default 1;
alter table pct_order_test_items drop constraint if exists chk_pct_order_test_items_slot;
alter table pct_order_test_items add constraint chk_pct_order_test_items_slot
  check (assignee_slot in (1, 2));
create index if not exists idx_pct_order_test_items_slot
  on pct_order_test_items(order_id, assignee_slot);

-- ─── qc_jobs: order_id 유니크를 (order_id, assignee_tester_id) 로 교체 ───────
--
-- 0010 은 `order_id uuid not null unique` 로 컬럼 레벨 유니크 제약을 선언했다.
-- 제약명은 Postgres 가 자동 생성(qc_jobs_order_id_key 로 추정)했을 뿐 어디에도
-- 명시적으로 적어두지 않았으므로, 이름을 하드코딩해 드롭하면 실제 운영 DB의
-- 제약명이 다를 때 조용히 실패한다. 카탈로그(pg_constraint)에서 "qc_jobs 위의,
-- order_id 딱 한 컬럼만 묶는 유니크 제약"을 직접 찾아 드롭한다.
do $$
declare
  r record;
begin
  for r in
    select con.conname
      from pg_constraint con
      join pg_class c  on c.oid = con.conrelid
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relname = 'qc_jobs'
       and con.contype = 'u'                    -- unique 제약만 (PK 제외)
       and array_length(con.conkey, 1) = 1       -- 단일 컬럼 제약만
       and (
             select attname from pg_attribute
              where attrelid = con.conrelid and attnum = con.conkey[1]
           ) = 'order_id'
  loop
    execute format('alter table public.qc_jobs drop constraint %I', r.conname);
    raise notice 'qc_jobs 의 order_id 단일 unique 제약 % 를 드롭했습니다.', r.conname;
  end loop;
end $$;

-- 대체: 부분 유니크 인덱스 2개.
--   - 담당자가 배정된 작업: 오더당 같은 담당자는 1건만(오더당 최대 2건 = 담당자1/2).
--   - 담당자가 없는 작업(이론상 발생하지 않지만 과거 데이터 방어): 오더당 1건만.
-- PG15+ 의 `nulls not distinct` 대신 조건부(where) 부분 인덱스 2개로 나눈 이유는
-- 이 프로젝트가 그 이하 버전에서도 동작해야 하기 때문이다.
create unique index if not exists uq_qc_jobs_order_assignee
  on qc_jobs(order_id, assignee_tester_id) where assignee_tester_id is not null;
create unique index if not exists uq_qc_jobs_order_unassigned
  on qc_jobs(order_id) where assignee_tester_id is null;

-- RLS: 새 테이블이 없으므로 0033_enable_rls.sql 의 카탈로그 순회로 이미 커버된다.

-- PostgREST 스키마 캐시 즉시 갱신 (적용 직후 PGRST204/42703 방지)
notify pgrst, 'reload schema';
