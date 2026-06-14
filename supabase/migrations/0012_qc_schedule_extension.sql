-- ─────────────────────────────────────────────────────────────────────────────
-- QC 시험 스케줄 자동배정 확장 (요구사항 정의서 2026-06-14)
--
--   1) operator_schedule     — 시험자 휴가/출장 (AI 배정 시 해당 기간 시험자 제외)
--   2) equipment_reservation — 장비 예약 (선착순/대기/24h 자동취소)
--   3) reassignment_history  — 재배정 이력 (관리자 분석용)
--
-- 의존: 0003_auth.sql(users), 0004_pqm_schema.sql(testers, set_updated_at()),
--       0010_pct_workflow.sql(pct_orders)
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists "pgcrypto";

-- ─── 휴가 / 출장 (시험자 부재) ───────────────────────────────────────────────
-- AI 배정 규칙: [start_date, end_date] 구간에 걸치는 시험자는 자동 배정 대상 제외.
create table if not exists operator_schedule (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references users(id) on delete cascade,
  start_date      date not null,
  end_date        date not null,
  type            text not null default 'ANNUAL',   -- ANNUAL | HALF_DAY | BUSINESS_TRIP
  manager_checked boolean not null default false,
  memo            text,
  created_at      timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists idx_operator_schedule_user  on operator_schedule(user_id);
create index if not exists idx_operator_schedule_range on operator_schedule(start_date, end_date);

-- ─── 장비 예약 (캘린더 방식, 선착순 + 대기열) ────────────────────────────────
-- 장비 마스터 테이블이 아직 없으므로 equipment_id 는 자유 텍스트 키로 둔다(후속 FK화).
create table if not exists equipment_reservation (
  id            uuid primary key default gen_random_uuid(),
  equipment_id  text not null,
  user_id       uuid not null references users(id) on delete cascade,
  start_date    date not null,
  end_date      date not null,
  status        text not null default 'RESERVED',   -- RESERVED | WAITING | CANCELLED | COMPLETED
  wait_order    int,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (end_date >= start_date)
);

create index if not exists idx_equipment_reservation_equip  on equipment_reservation(equipment_id, start_date);
create index if not exists idx_equipment_reservation_status on equipment_reservation(status);

create trigger trg_equipment_reservation_updated
  before update on equipment_reservation
  for each row execute function set_updated_at();

-- ─── 재배정 이력 (관리자만 조회, 분석용) ─────────────────────────────────────
-- group_id 는 동시분석 그룹 도입 전까지 nullable(개별 오더 재배정도 기록 가능).
create table if not exists reassignment_history (
  id           uuid primary key default gen_random_uuid(),
  group_id     uuid,
  order_id     uuid references pct_orders(id) on delete set null,
  before_user  uuid references testers(id) on delete set null,
  after_user   uuid references testers(id) on delete set null,
  reason       text,
  changed_by   uuid references users(id) on delete set null,
  changed_at   timestamptz not null default now()
);

create index if not exists idx_reassignment_history_group on reassignment_history(group_id, changed_at desc);
create index if not exists idx_reassignment_history_order on reassignment_history(order_id, changed_at desc);
