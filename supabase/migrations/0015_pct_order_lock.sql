-- ─────────────────────────────────────────────────────────────────────────────
-- 배정 확정/LOCK (PRD 원칙1: AI 추천 → 관리자 확정 → LOCK / 원칙3: LOCK 존중)
--
-- 관리자가 자동배정 결과를 검토 후 "확정"하면 locked=true 가 되어
--   - 생산계획(시트) 변경이 와도 자동 반영 차단(알림만)
--   - 자동배정/재배정 대상에서 제외
-- 잠금 해제(관리자)는 locked=false.
--
-- 의존: 0010_pct_workflow.sql (pct_orders)
-- ─────────────────────────────────────────────────────────────────────────────

alter table pct_orders add column if not exists locked      boolean not null default false;
alter table pct_orders add column if not exists locked_by   uuid;          -- 확정한 관리자(users.id)
alter table pct_orders add column if not exists locked_at   timestamptz;   -- 확정 시각

create index if not exists idx_pct_orders_locked on pct_orders(locked);
