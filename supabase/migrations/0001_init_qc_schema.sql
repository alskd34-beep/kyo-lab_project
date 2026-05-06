-- ─────────────────────────────────────────────────────────────────────────────
-- KD QC 시험 관리 시스템 - 초기 스키마
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ─── ENUM: 시험 상태 ──────────────────────────────────────────────────────────
do $$ begin
  create type qc_status as enum ('completed', 'reviewing', 'pending', 'fail', 'inprogress');
exception when duplicate_object then null; end $$;

-- ─── 담당자 ───────────────────────────────────────────────────────────────────
create table if not exists managers (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  initial       text not null,
  email         text unique,
  avatar_color  text,
  created_at    timestamptz not null default now()
);

-- ─── 수탁사 ───────────────────────────────────────────────────────────────────
create table if not exists contractors (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique,
  created_at  timestamptz not null default now()
);

-- ─── 시험 (Test) ──────────────────────────────────────────────────────────────
-- 시험현황 / 제품시험 / 안정성시험 / 일탈관리 모두 포괄
create table if not exists tests (
  id              uuid primary key default gen_random_uuid(),
  test_no         text not null unique,                      -- QC-2024-0312
  category        text not null,                             -- 완제품 / 원료
  type            text not null,                             -- 이화학시험 / 미생물시험 / 안정성시험 / 중금속시험 / 관능시험
  product         text not null,
  items           text not null,                             -- 시험 항목 목록 (콤마 구분 또는 별도 테이블 분리 가능)
  contractor_id   uuid references contractors(id) on delete set null,
  manager_id      uuid references managers(id)   on delete set null,
  receive_date    date not null,
  due_date        date,
  status          qc_status not null default 'pending',
  is_deviation    boolean not null default false,            -- 일탈관리 플래그
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_tests_status        on tests(status);
create index if not exists idx_tests_receive_date  on tests(receive_date desc);
create index if not exists idx_tests_manager       on tests(manager_id);
create index if not exists idx_tests_deviation     on tests(is_deviation) where is_deviation;

-- ─── 안정성 시험 부가 정보 ────────────────────────────────────────────────────
create table if not exists stability_tests (
  test_id           uuid primary key references tests(id) on delete cascade,
  storage_condition text,                                    -- 25°C/60%RH 등
  duration_months   int,
  next_check_date   date
);

-- ─── 일탈 (OOS / Deviation) ───────────────────────────────────────────────────
create table if not exists deviations (
  id            uuid primary key default gen_random_uuid(),
  test_id       uuid not null references tests(id) on delete cascade,
  reported_at   timestamptz not null default now(),
  description   text not null,
  root_cause    text,
  capa          text,                                        -- Corrective And Preventive Action
  resolved_at   timestamptz
);

create index if not exists idx_deviations_test on deviations(test_id);

-- ─── 챗봇 대화 이력 ───────────────────────────────────────────────────────────
create table if not exists chat_conversations (
  id              uuid primary key default gen_random_uuid(),
  dify_conv_id    text unique,                               -- Dify가 발급한 conversation_id
  user_key        text not null,                             -- 사용자 식별 (현재 'kd-qc-user')
  title           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create table if not exists chat_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references chat_conversations(id) on delete cascade,
  role             text not null check (role in ('user','bot')),
  content          text not null,
  created_at       timestamptz not null default now()
);

create index if not exists idx_chat_messages_conv on chat_messages(conversation_id, created_at);

-- ─── updated_at 자동 갱신 트리거 ──────────────────────────────────────────────
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end $$ language plpgsql;

drop trigger if exists trg_tests_updated_at on tests;
create trigger trg_tests_updated_at
  before update on tests
  for each row execute procedure set_updated_at();

drop trigger if exists trg_chat_conv_updated_at on chat_conversations;
create trigger trg_chat_conv_updated_at
  before update on chat_conversations
  for each row execute procedure set_updated_at();
