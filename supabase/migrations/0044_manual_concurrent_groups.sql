-- ─────────────────────────────────────────────────────────────────────────────
-- 관리자 수동 동시분석 그룹
--
-- 배경: 동시분석 그룹은 규칙(품목코드·품목명 유사도)으로 자동 생성만 됐다. 그런데
--       현장에서는 개별 의뢰가 따로 들어온 뒤 관리자가 "이건 묶어서 한 번에 돌리자" 고
--       판단하는 경우가 많다. 같은 품목코드인데 포장일이 하루 차이라 자동 규칙이 갈라
--       놓는 경우도 있다. 그 판단을 시스템에 넣을 자리가 없었다.
--
-- 해결: 관리자가 오더를 골라 그룹을 만들 수 있게 하고, 그 그룹을 자동 재생성이
--       건드리지 않게 한다.
--
--   보존은 기존 group_lock=true 를 그대로 쓴다(rebuildGroups 가 잠긴 그룹과 그 멤버를
--   재구성 대상에서 빼도록 이미 만들어져 있다). 새 보존 장치를 만들지 않는다 —
--   같은 뜻을 두 곳에 두면 언젠가 갈라진다.
--
--   source 는 "누가 이렇게 묶었는가" 를 남긴다. 화면이 자동 묶음과 사람의 판단을
--   구분해 보여줘야 하고, 잘못 묶인 그룹을 추적할 때 출처가 첫 단서다.
--
-- ⚠️ 동시분석은 **작업을 공유하는 것이지 배치를 합치는 것이 아니다.**
--    제조번호마다 시험 기록과 성적서는 그대로 분리돼야 하고(GMP 추적성), 이 테이블은
--    "함께 수행한다" 는 실행 단위만 나타낸다. qc_jobs / qc_job_items 는 오더별로 남는다.
--
-- 의존: 0013_concurrent_groups.sql, 0003_auth.sql(users)
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent)
--    `supabase db push` 금지 — 0028 헤더의 경고 참조.
-- ─────────────────────────────────────────────────────────────────────────────

alter table concurrent_analysis_groups
  add column if not exists source     text not null default 'auto',
  add column if not exists created_by uuid references users(id) on delete set null,
  add column if not exists note       text;

-- 값을 못박는다. 출처가 자유 문자열이면 화면 분기가 곧 어긋난다.
alter table concurrent_analysis_groups drop constraint if exists chk_concurrent_groups_source;
alter table concurrent_analysis_groups add constraint chk_concurrent_groups_source
  check (source in ('auto', 'manual'));

comment on column concurrent_analysis_groups.source is
  '''auto''=규칙 자동 생성 · ''manual''=관리자가 직접 묶음. 수동 그룹은 group_lock=true 로 만들어 자동 재생성이 지우지 않는다.';
comment on column concurrent_analysis_groups.created_by is
  '수동 그룹을 만든 관리자(users.id). 자동 생성은 null.';
comment on column concurrent_analysis_groups.note is
  '관리자 메모. 왜 이렇게 묶었는지(예: 포장일 하루 차이라 함께 진행) 를 남긴다.';

-- 화면이 "수동 그룹만" 을 자주 찾는다. 대부분 auto 라 부분 인덱스가 작다.
create index if not exists idx_concurrent_groups_manual
  on concurrent_analysis_groups(source)
  where source = 'manual';

notify pgrst, 'reload schema';
