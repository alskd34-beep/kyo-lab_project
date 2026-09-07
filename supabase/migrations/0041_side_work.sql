-- ============================================================
-- 0041_side_work.sql — 부업무(시험 외 업무) 기록
--
-- 배경: 시험자의 하루는 시험만으로 채워지지 않는다. 문서작성·교육·장비점검·
--       시약관리·감사대응 같은 일이 실제 시간의 상당 부분을 먹는데, 이 시스템은
--       그 시간을 **한 곳도 기록하지 않았다**. 그래서 "이 사람이 왜 시험을 더 못
--       받는가"를 설명할 근거가 없고, 월간 그리드의 빈 칸은 늘 '노는 날'로 읽혔다.
--
-- 해결: 월간 그리드에서 시험자가 자기 칸을 눌러 그날의 부업무를 직접 남긴다.
--       기록 단위는 **분(minutes)** — 시험업무 실적(qc_job_items.elapsed_minutes)이
--       이미 분이라 같은 자로 재야 '시험 vs 부업무' 비교가 왜곡되지 않는다.
--
--   1) side_work_categories — 부업무 분류 마스터(관리자가 화면에서 추가/비활성화)
--   2) side_work_logs       — 기록 1건 = 한 사람 · 하루 · 한 가지 일
--
-- 집계 키는 tester_id 다. 월간 그리드의 행도, 운영 리포트의 시험업무 실적
-- (qc_jobs.assignee_tester_id)도 tester 기준이라 여기에 맞춰야 join 이 성립한다.
-- user_id 는 "누가 입력했는가"(감사 추적)이지 집계 키가 아니다.
--
-- 의존: 0004_pqm_schema.sql(testers, set_updated_at()), 0003_auth.sql(users)
--
-- [적용 방법] ⚠️ `supabase db push` 를 쓰지 말 것 — 0028 헤더의 경고 참조.
--   대시보드 SQL Editor 에서 이 파일만 실행한다. 전부 재실행 안전(idempotent).
-- ============================================================

create extension if not exists "pgcrypto";

-- ─── 1) 부업무 분류 마스터 ───────────────────────────────────────────────────
create table if not exists side_work_categories (
  id         uuid primary key default gen_random_uuid(),
  code       text not null unique,
  name       text not null,
  -- 기록 화면의 분류 버튼 순서. 자주 쓰는 것을 앞에 둔다.
  sort_order int  not null default 0,
  -- 지우지 않고 끈다. 지우면 그 분류로 쌓인 과거 기록의 뜻이 사라진다.
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

comment on table side_work_categories is
  '부업무 분류 마스터. 삭제 대신 is_active=false 로 끈다 — 과거 기록의 분류가 사라지면 리포트를 다시 읽을 수 없다.';

-- ─── 2) 부업무 기록 ──────────────────────────────────────────────────────────
create table if not exists side_work_logs (
  id          uuid primary key default gen_random_uuid(),
  -- 집계 키. 월간 그리드 행·운영 리포트가 전부 tester 기준이다.
  tester_id   uuid not null references testers(id) on delete cascade,
  -- 입력자(감사 추적). 관리자가 대신 넣을 수 있으므로 tester 의 계정과 다를 수 있다.
  user_id     uuid references users(id) on delete set null,
  work_date   date not null,
  category_id uuid not null references side_work_categories(id) on delete restrict,
  -- 그리드 칸에 뜨는 한 줄. "무슨 문서를 썼는가"까지 남겨야 나중에 읽힌다.
  title       text not null,
  -- 소요 분. 0 은 기록의 뜻이 없고, 하루(1440분)를 넘는 한 건은 입력 실수다.
  minutes     int  not null check (minutes > 0 and minutes <= 1440),
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

comment on table side_work_logs is
  '시험 외 업무(부업무) 기록. 1행 = 한 시험자의 하루 한 가지 일. 소요는 분 단위 — 시험업무 실적(qc_job_items.elapsed_minutes)과 같은 자로 재야 비교가 성립한다.';
comment on column side_work_logs.tester_id is
  '집계 키(testers.id). 월간 그리드 행·운영 리포트의 시험업무(qc_jobs.assignee_tester_id)와 이 키로 맞춘다.';
comment on column side_work_logs.user_id is
  '입력한 계정(users.id). 감사 추적용이며 집계 키가 아니다 — 관리자가 대신 입력하면 tester 의 계정과 다르다.';
comment on column side_work_logs.minutes is
  '소요 분. 프리셋(30/60/120/240/480)과 직접 입력 둘 다 이 컬럼 하나로 들어온다.';

-- 월간 그리드는 "이 시험자의 이 달"을, 리포트는 "이 기간 전원"을 읽는다.
create index if not exists idx_side_work_logs_tester_date on side_work_logs(tester_id, work_date);
create index if not exists idx_side_work_logs_date        on side_work_logs(work_date);
create index if not exists idx_side_work_logs_category    on side_work_logs(category_id);

-- 갱신 시각 트리거 (0004 의 set_updated_at() 재사용)
drop trigger if exists trg_side_work_categories_updated on side_work_categories;
create trigger trg_side_work_categories_updated
  before update on side_work_categories
  for each row execute function set_updated_at();

drop trigger if exists trg_side_work_logs_updated on side_work_logs;
create trigger trg_side_work_logs_updated
  before update on side_work_logs
  for each row execute function set_updated_at();

-- ─── 3) 기본 분류 시드 ───────────────────────────────────────────────────────
-- QC 시험실에서 실제로 시간을 먹는 일들. 운영하며 관리자가 화면에서 늘린다.
-- code 로 충돌을 막아 재실행해도 이름을 덮어쓰지 않는다(현장에서 고친 이름을 지키려고).
insert into side_work_categories (code, name, sort_order) values
  ('DOC',        '문서작성·기록',        10),
  ('EDU',        '교육·훈련',            20),
  ('MEETING',    '회의·보고',            30),
  ('EQUIP',      '장비 점검·검교정',     40),
  ('REAGENT',    '시약·표준품 관리',     50),
  ('SAMPLE',     '검체 접수·관리',       60),
  ('DEVIATION',  '일탈·OOS 조사',        70),
  ('VALIDATION', '밸리데이션 지원',      80),
  ('AUDIT',      '감사·실사 대응',       90),
  ('LAB',        '시험실 정리·환경관리', 100),
  ('SYSTEM',     '전산·시스템 업무',     110),
  ('ETC',        '기타',                 900)
on conflict (code) do nothing;

-- ─── 4) RLS ──────────────────────────────────────────────────────────────────
-- 0033 의 원칙 그대로: 정책 없이 켜기만 한다(deny-by-default).
-- 앱의 DB 접근은 전부 서버 라우트(service_role)를 경유하므로 이것으로 충분하다.
alter table side_work_categories enable row level security;
alter table side_work_categories force  row level security;
alter table side_work_logs       enable row level security;
alter table side_work_logs       force  row level security;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
