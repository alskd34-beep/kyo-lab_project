-- ============================================================
-- 0030_qc_item_elapsed_from_start.sql
--
-- 시험항목 소요시간 기준을 "작업 시작 시각" 으로 확정한다.
--
-- 문제: clearItem 이 경과시간을 항상 '직전 항목 완료 시각' 부터 재기 때문에,
--       완료 버튼을 누를 때마다 기준 시각이 초기화되어 화면에는 구간(delta)만 보였다.
--       사용자가 기대하는 값은 "작업 시작 → 이 항목 완료" 까지의 누적 소요시간이다.
--
-- 해결:
--   1) qc_jobs.work_started_at   — 작업 시작 버튼을 누른 시각(정본, 시:분 포함).
--      work_start_date 는 date 라서 시각이 없어 기준으로 쓸 수 없다.
--      기존 행은 created_at(= startJob 이 행을 만든 시각) 으로 backfill 한다.
--   2) qc_job_items.elapsed_total_minutes — 작업 시작 → 항목 완료 누적 분.
--      기존 elapsed_minutes(직전 항목 완료 이후 구간)는 그대로 둔다.
--      인사이트의 "시험항목별 평균 소요시간" · 시험자 평가는 구간 값이 기준이므로
--      의미를 바꾸지 않고 누적 값을 별도 컬럼으로 추가한다.
--
-- [적용 방법] ⚠️ `supabase db push` 를 쓰지 말 것 — 0028 헤더의 경고 참조.
--   대시보드 SQL Editor 에서 이 파일만 실행한다. 전부 재실행 안전(add column if not exists).
-- ============================================================

-- ─── 1) 작업 시작 시각 ───────────────────────────────────────────────────────
alter table qc_jobs
  add column if not exists work_started_at timestamptz;

comment on column qc_jobs.work_started_at is
  '작업 시작 버튼을 누른 시각. 시험항목 누적 소요시간(elapsed_total_minutes)의 기준점.';

-- 기존 작업: 행 생성 시각이 곧 작업 시작 시각이다(startJob 이 유일한 생성 경로).
update qc_jobs
   set work_started_at = created_at
 where work_started_at is null;

alter table qc_jobs
  alter column work_started_at set default now();

-- ─── 2) 항목 누적 소요시간 ───────────────────────────────────────────────────
alter table qc_job_items
  add column if not exists elapsed_total_minutes int;

comment on column qc_job_items.elapsed_minutes is
  '직전 항목 완료(첫 항목은 작업 시작) 이후 이 항목까지의 구간 소요 분. 통계·평가용.';
comment on column qc_job_items.elapsed_total_minutes is
  '작업 시작 시각부터 이 항목 완료까지의 누적 소요 분. 작업 화면 표시용.';

-- 이미 완료된 항목은 작업 시작 시각과 cleared_at 으로 되계산한다.
update qc_job_items i
   set elapsed_total_minutes =
         greatest(0, round(extract(epoch from (i.cleared_at - j.work_started_at)) / 60))::int
  from qc_jobs j
 where i.qc_job_id = j.id
   and i.cleared_at is not null
   and j.work_started_at is not null
   and i.elapsed_total_minutes is null;
