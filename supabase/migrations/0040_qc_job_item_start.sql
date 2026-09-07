-- ─────────────────────────────────────────────────────────────────────────────
-- 시험항목 개별 시작 (qc_job_items.started_at / status='in_progress')
--
-- 문제: qc_job_items 에는 'pending' | 'cleared' 두 상태밖에 없어서 "지금 진행 중인
--       항목"을 저장할 자리가 없었다. 그래서 화면은 "미완료 항목 중 sequence_order 가
--       가장 작은 것"을 진행 중으로 **추론**했고, 1번을 완료하면 2번이 저절로 진행
--       중으로 넘어갔다. 실제 시험자는 순번대로 시험하지 않는다 — 용출처럼 오래 걸리는
--       시험을 걸어두고 다른 항목을 병행하는 것이 정상이다.
--
-- 해결: 항목마다 시작 시각을 직접 갖는다.
--   - started_at : 시험자가 그 항목의 [시작] 을 누른 시각. null = 아직 시작 안 함.
--   - status     : 'pending' | 'in_progress' | 'cleared' 세 값으로 넓힌다.
--                  동시에 여러 항목이 'in_progress' 일 수 있다(병행 시험).
--
-- 소요시간 의미 변화: elapsed_minutes 는 지금까지 "직전 항목 완료 → 이 항목 완료"
-- 구간이었다. started_at 이 있으면 "이 항목 시작 → 완료" 로 계산한다 — 인사이트의
-- '시험항목별 평균 소요시간' 과 시험자 평가가 원래 재고 싶었던 값이 이쪽이다.
-- started_at 이 없는 옛 항목은 기존 방식으로 계속 계산한다(qcJobs.clearItem 폴백).
--
-- 의존: 0010_pct_workflow.sql (qc_job_items), 0030_qc_item_elapsed_from_start.sql
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent)
--    `supabase db push` 금지 — 0028 헤더의 경고 참조.
-- ─────────────────────────────────────────────────────────────────────────────

alter table qc_job_items
  add column if not exists started_at timestamptz;

comment on column qc_job_items.started_at is
  '시험자가 이 항목을 시작한 시각. null = 미시작. elapsed_minutes(항목 실소요시간)의 기준점.';

comment on column qc_job_items.status is
  '''pending''(대기) | ''in_progress''(진행 중) | ''cleared''(완료). 병행 시험이 있으므로 in_progress 는 동시에 여러 건일 수 있다.';

comment on column qc_job_items.elapsed_minutes is
  '이 항목의 실소요 분(started_at → cleared_at). started_at 이 없는 옛 항목은 직전 항목 완료 이후 구간. 통계·평가 기준.';

-- 이미 완료된 항목의 시작 시각을 되채운다. elapsed_minutes 가 곧 "완료 시각에서
-- 거슬러 올라간 구간"이므로 두 값으로 시작 시각이 그대로 복원된다. 값이 비면
-- 건드리지 않는다 — 모르는 것을 지어내는 쪽이 통계를 더 망친다.
update qc_job_items
   set started_at = cleared_at - make_interval(mins => elapsed_minutes)
 where started_at is null
   and cleared_at is not null
   and elapsed_minutes is not null;

-- 진행 중 항목 조회(작업 화면·관리자 현황)가 잦다. 대부분의 행은 pending/cleared 라
-- 부분 인덱스가 훨씬 작다.
create index if not exists idx_qc_job_items_in_progress
  on qc_job_items(qc_job_id)
  where status = 'in_progress';
