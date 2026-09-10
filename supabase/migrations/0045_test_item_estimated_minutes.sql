-- ─────────────────────────────────────────────────────────────────────────────
-- 시험항목 예상시간을 분(minutes) 기준으로
--
-- 배경: test_items.estimated_hours 는 시간(h) 단위인데, 화면 입력이 정수 단위라 실제로는
--       **1시간 미만을 넣을 수 없었다.** 성상 확인처럼 10분이면 끝나는 항목을 1시간으로
--       적으면 부하 계산과 일정이 통째로 부풀려진다.
--
-- 그리고 이 시스템의 다른 소요시간은 전부 분이다.
--   qc_job_items.elapsed_minutes  (실적)
--   side_work_logs.minutes        (부업무)
-- 예상시간만 시간이라 계획과 실적을 나란히 놓을 때마다 환산이 끼어든다. 기준을 하나로 맞춘다.
--
-- 왜 estimated_hours 를 그대로 쓰지 않는가: numeric(6,2) 라 10분은 0.17 로만 담긴다.
-- 되돌리면 10.2분이다. 품질 데이터에서 저장할 때마다 값이 미끄러지는 컬럼을 기준으로
-- 삼을 수는 없다. 분은 정수로 정확히 담긴다.
--
-- estimated_hours 는 지우지 않고 앱이 함께 갱신한다 — 챗봇 컨텍스트(qthinkAgent·chat)가
-- 아직 그 컬럼을 읽는다. 한 번에 다 바꾸다 조회가 조용히 비는 쪽이 더 나쁘다.
--
-- 의존: 0004_pqm_schema.sql (test_items)
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent)
--    `supabase db push` 금지 — 0028 헤더의 경고 참조.
-- ─────────────────────────────────────────────────────────────────────────────

alter table test_items
  add column if not exists estimated_minutes int;

comment on column test_items.estimated_minutes is
  '시험항목 예상 소요 분. 이 시스템의 소요시간 단일 기준(실적 elapsed_minutes·부업무 minutes 와 같은 단위). estimated_hours 는 하위 호환용 파생값이다.';

-- 기존 값(시간)을 분으로 옮긴다. 0.5h → 30분. 값이 없던 항목은 그대로 비워 둔다 —
-- "모른다" 와 "0분" 은 다른 사실이고, 0 으로 채우면 부하 계산이 그 항목을 공짜로 본다.
update test_items
   set estimated_minutes = round(estimated_hours * 60)::int
 where estimated_minutes is null
   and estimated_hours is not null;

-- 양수만 검사한다. 상한은 두지 않는다.
--
-- 처음에는 "항목 하나가 하루를 넘을 리 없다" 며 1440분 상한을 걸었는데, 실제 데이터에
-- MT(52시간)·다종 확인시험(32시간) 이 있었다. 그 값들은 사람이 붙어 있는 시간이 아니라
-- 배양·방치 같은 **대기시간**이 섞인 것이다 — 즉 데이터가 틀린 게 아니라 이 컬럼이
-- 인시(人時)와 경과시간을 구분하지 못하는 것이 한계다(그 분리는 별도 과제).
-- 실재하는 값을 제약이 부정하면 마이그레이션이 실패하고, 통과시키려면 데이터를 지워야 한다.
-- 지금 필요한 것은 "0분·음수만 막기" 다.
alter table test_items drop constraint if exists chk_test_items_estimated_minutes;
alter table test_items add constraint chk_test_items_estimated_minutes
  check (estimated_minutes is null or estimated_minutes > 0);

notify pgrst, 'reload schema';
