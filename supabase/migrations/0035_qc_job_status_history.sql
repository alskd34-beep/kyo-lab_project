-- ─────────────────────────────────────────────────────────────────────────────
-- QC 작업 상태 변경 이력
--
-- 지금까지 상태 전이(진행중 → 검토전 → 검토중 → 승인전 → 승인완료)는
-- qc_jobs.status 를 덮어쓰기만 해서 "누가·언제·왜 바꿨는지" 를 알 수 없었다.
-- notifications 에 사람이 읽는 문장만 남아 있어 조회·감사에 쓸 수 없다.
--
-- 상태 이력을 구조화해 별도 테이블에 적재한다(작업 삭제 시 함께 삭제).
-- 단계 정의는 types/qc-status.ts 가 단일 기준이다.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists qc_job_status_history (
  id              uuid primary key default gen_random_uuid(),
  qc_job_id       uuid not null references qc_jobs(id) on delete cascade,
  order_id        uuid references pct_orders(id) on delete set null,
  from_status     text,                                   -- null = 작업 생성(최초 상태)
  to_status       text not null,
  -- 사용자 계정이 지워져도 이력에는 이름이 남아야 한다(감사 목적) → 스냅샷으로 함께 저장
  changed_by      uuid references users(id) on delete set null,
  changed_by_name text,
  -- manual = 사람이 버튼으로, auto = 서버 자동 전환(전 항목 완료 등),
  -- system = 배치/동기화, backfill = 이력 기능 도입 전 데이터
  source          text not null default 'manual',
  note            text,                                   -- 사유·부가 설명
  created_at      timestamptz not null default now()
);

create index if not exists idx_qc_job_status_history_job
  on qc_job_status_history(qc_job_id, created_at desc);
create index if not exists idx_qc_job_status_history_order
  on qc_job_status_history(order_id, created_at desc);

comment on table qc_job_status_history is
  'QC 작업 상태 전이 이력 — 시험현황/작업현황 화면의 "상태 변경 이력" 원본';
comment on column qc_job_status_history.source is
  'manual/auto/system/backfill — auto 는 서버 자동 전환(전 시험항목 완료)';

-- ── 기존 작업 백필 ───────────────────────────────────────────────────────────
-- 이력 도입 전 작업에는 전이 기록이 없다. 없는 이력을 지어내지 않고,
-- "현재 상태가 이 값이었다" 는 사실 한 줄만 backfill 로 남긴다.
-- 시각은 알 수 없으므로 작업 생성 시각을 쓰고, 화면에서 backfill 배지로 구분한다.
insert into qc_job_status_history (qc_job_id, order_id, from_status, to_status, source, note, created_at)
select j.id, j.order_id, null, j.status, 'backfill',
       '상태 이력 도입(0032) 이전 작업 — 당시 상태만 기록되어 변경 시각·변경자는 알 수 없습니다.',
       coalesce(j.created_at, now())
  from qc_jobs j
 where not exists (
   select 1 from qc_job_status_history h where h.qc_job_id = j.id
 );

-- ── RLS (0033_enable_rls.sql 과 같은 원칙: 기본 차단, service_role 만 통과) ──
alter table qc_job_status_history enable row level security;
alter table qc_job_status_history force row level security;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
