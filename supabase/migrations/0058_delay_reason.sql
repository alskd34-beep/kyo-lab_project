-- 수동 적용 안내: 운영 DB에 자동 적용하지 않는다.
-- Supabase SQL Editor에서 이 파일 전체를 실행한 뒤 앱을 사용한다.
-- `supabase db push`로 적용하지 말 것. 미적용 환경에서는 지연·복귀 상태 변경을
-- 명확한 한국어 안내와 함께 거절하며, 기존 상태 이력 조회는 계속 동작한다.

create table if not exists delay_reason_categories (
  id uuid primary key,
  code text not null unique,
  name text not null,
  kind text not null check (kind in ('delay', 'resume')),
  attribution text not null default 'unknown' check (attribution in ('external', 'internal', 'unknown')),
  sort_order int not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

alter table qc_job_status_history
  add column if not exists reason_category_id uuid references delay_reason_categories(id),
  add column if not exists attribution text check (attribution in ('external', 'internal', 'unknown'));

create index if not exists idx_qc_job_status_history_period
  on qc_job_status_history(created_at desc) where to_status is not null;
create index if not exists idx_qc_job_status_history_reason
  on qc_job_status_history(reason_category_id) where reason_category_id is not null;

insert into delay_reason_categories (id, code, name, kind, attribution, sort_order) values
('a0000000-0000-4000-8000-000000000001', 'EQUIP_DOWN', '장비 고장·정지', 'delay', 'external', 10),
('a0000000-0000-4000-8000-000000000002', 'EQUIP_BUSY', '장비 선점·대기', 'delay', 'external', 20),
('a0000000-0000-4000-8000-000000000003', 'SAMPLE_LATE', '검체 미입고·의뢰 지연', 'delay', 'external', 30),
('a0000000-0000-4000-8000-000000000004', 'REAGENT', '시약·표준품 부족', 'delay', 'external', 40),
('a0000000-0000-4000-8000-000000000005', 'CONCURRENT_WAIT', '동시분석 대기', 'delay', 'external', 50),
('a0000000-0000-4000-8000-000000000006', 'PRIORITY', '긴급 건 투입으로 밀림', 'delay', 'external', 60),
('a0000000-0000-4000-8000-000000000007', 'LEAVE', '휴가·부재', 'delay', 'external', 70),
('a0000000-0000-4000-8000-000000000008', 'SIDE_WORK', '부업무 과다', 'delay', 'external', 80),
('a0000000-0000-4000-8000-000000000009', 'RETEST', '재시험·재실시', 'delay', 'internal', 90),
('a0000000-0000-4000-8000-00000000000a', 'METHOD', '시험 난이도·재현 실패', 'delay', 'internal', 100),
('a0000000-0000-4000-8000-00000000000b', 'DELAY_ETC', '기타', 'delay', 'unknown', 110),
('a0000000-0000-4000-8000-00000000000c', 'RECOVERED', '만회 완료(추가 시간 투입)', 'resume', 'internal', 10),
('a0000000-0000-4000-8000-00000000000d', 'EQUIP_FIXED', '장비 복구', 'resume', 'external', 20),
('a0000000-0000-4000-8000-00000000000e', 'SAMPLE_IN', '검체 입고', 'resume', 'external', 30),
('a0000000-0000-4000-8000-00000000000f', 'REASSIGNED', '재배정·분담으로 해소', 'resume', 'external', 40),
('a0000000-0000-4000-8000-000000000010', 'RESCHEDULED', '일정 재조정(납기 변경)', 'resume', 'external', 50),
('a0000000-0000-4000-8000-000000000011', 'RESUME_ETC', '기타', 'resume', 'unknown', 60)
on conflict (id) do update set name = excluded.name, kind = excluded.kind, attribution = excluded.attribution,
  sort_order = excluded.sort_order, is_active = true;

alter table delay_reason_categories enable row level security;
alter table delay_reason_categories force row level security;
notify pgrst, 'reload schema';
