-- ─────────────────────────────────────────────────────────────────────────────
-- PCT 오더 → 배정 → 담당자 실행 워크플로우 (1차 구현)
--
-- 제조부서 구글시트(PCT) 적재 → 신규/수정/삭제 이력 + 품목마스터 동기화 + 알림
-- → (감독관) 배정/수정 → (담당자) QC번호 채번·항목별 클리어 시간·상태/마감 알림
--
-- 의존: 0004_pqm_schema.sql (products, test_items, product_test_items, testers,
--       set_updated_at()), 0003_auth.sql (users)
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ─── 담당자(user) ↔ 시험자(tester) 연결 ──────────────────────────────────────
-- admin=감독관, user=담당자. AI 배정은 tester 기준이므로 로그인 user를 tester에 연결.
alter table users
  add column if not exists tester_id uuid references testers(id) on delete set null;

-- 이름이 일치하는 tester를 자동 연결 (시드/베스트에포트)
update users u
   set tester_id = t.id
  from testers t
 where u.tester_id is null
   and t.name = coalesce(u.display_name, u.username);

-- ─── 런타임 설정 (시트ID 등) ─────────────────────────────────────────────────
create table if not exists app_settings (
  key         text primary key,
  value       text,
  updated_at  timestamptz not null default now()
);

-- ─── PCT 오더 (적재된 제조 오더, 영속) ───────────────────────────────────────
create table if not exists pct_orders (
  id              uuid primary key default gen_random_uuid(),
  -- 고정값 (제조팀 제공)
  product_code    text not null,
  product_name    text not null,
  batch_no        text not null,
  dosage_form     text,
  -- 제조팀 제공 · 수정가능
  packaging_date  date,
  due_date        date,                 -- 완료예정일
  is_urgent       boolean not null default false,
  method          text not null default '전항목',   -- '전항목' | '개별항목'
  -- 운영
  status          text not null default '대기',      -- 대기/진행중/검토중/완료/지연/삭제
  assignee_tester_id uuid references testers(id) on delete set null,
  product_synced  boolean not null default true,     -- 품목마스터 동기화 여부
  note            text,
  ingest_state    text not null default 'new',       -- 'new' | 'updated' | 'deleted'
  source_file_id  text,
  first_seen_at   timestamptz not null default now(),
  last_seen_at    timestamptz not null default now(),
  deleted_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (batch_no, product_code)        -- 자연키: upsert/중복방지/변경감지
);

create index if not exists idx_pct_orders_status   on pct_orders(status);
create index if not exists idx_pct_orders_assignee on pct_orders(assignee_tester_id);
create index if not exists idx_pct_orders_due       on pct_orders(due_date);

create trigger trg_pct_orders_updated
  before update on pct_orders
  for each row execute function set_updated_at();

-- ─── 가져온 이력 (최소: 신규/수정/삭제 + 일시 + 상태) ────────────────────────
create table if not exists pct_ingest_log (
  id           uuid primary key default gen_random_uuid(),
  run_at       timestamptz not null default now(),
  order_key    text not null,           -- batch_no + '|' + product_code
  change_type  text not null,           -- 'new' | 'updated' | 'deleted'
  status       text,                    -- 적재 시점 오더 상태
  file_id      text
);

create index if not exists idx_pct_ingest_log_run on pct_ingest_log(run_at desc);

-- ─── 수정 사유 이력 ──────────────────────────────────────────────────────────
create table if not exists pct_order_edits (
  id          uuid primary key default gen_random_uuid(),
  order_id    uuid not null references pct_orders(id) on delete cascade,
  field       text not null,
  old_value   text,
  new_value   text,
  reason      text not null,            -- 사유 필수
  edited_by   uuid references users(id) on delete set null,
  edited_at   timestamptz not null default now()
);

create index if not exists idx_pct_order_edits_order on pct_order_edits(order_id, edited_at desc);

-- ─── QC 작업 (담당자가 시작한 작업) ──────────────────────────────────────────
create table if not exists qc_jobs (
  id                 uuid primary key default gen_random_uuid(),
  order_id           uuid not null unique references pct_orders(id) on delete cascade,
  qc_no              text not null unique,            -- YYYYMMDDHHMM + 2자리
  assignee_tester_id uuid references testers(id) on delete set null,
  assignee_user_id   uuid references users(id) on delete set null,
  work_start_date    date,
  work_end_date      date,
  status             text not null default '진행중',  -- 진행중/검토중/완료/지연
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists idx_qc_jobs_assignee on qc_jobs(assignee_user_id);

create trigger trg_qc_jobs_updated
  before update on qc_jobs
  for each row execute function set_updated_at();

-- ─── QC 작업 항목별 진행 (시험항목 클리어 시간 적재) ─────────────────────────
create table if not exists qc_job_items (
  id              uuid primary key default gen_random_uuid(),
  qc_job_id       uuid not null references qc_jobs(id) on delete cascade,
  test_item_id    uuid references test_items(id) on delete set null,
  test_item_name  text not null,
  sequence_order  int not null default 0,
  status          text not null default 'pending',   -- 'pending' | 'cleared'
  cleared_at      timestamptz,
  elapsed_minutes int,
  created_at      timestamptz not null default now()
);

create index if not exists idx_qc_job_items_job on qc_job_items(qc_job_id, sequence_order);

-- ─── 알림 ────────────────────────────────────────────────────────────────────
create table if not exists notifications (
  id                uuid primary key default gen_random_uuid(),
  type              text not null,        -- product_unsynced/item_cleared/status_changed/deadline_due/ingest
  title             text not null,
  body              text,
  target_user_id    uuid references users(id) on delete cascade,  -- null = 전체 감독관(admin)
  related_order_id  uuid references pct_orders(id) on delete set null,
  related_qc_job_id uuid references qc_jobs(id) on delete set null,
  channel           text not null default 'in_app',  -- in_app/telegram/kakao(HOLD)
  severity          text not null default 'info',     -- info/warning/critical
  is_read           boolean not null default false,
  sent_at           timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists idx_notifications_target on notifications(target_user_id, is_read, created_at desc);
