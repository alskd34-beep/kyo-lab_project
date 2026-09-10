-- ─────────────────────────────────────────────────────────────────────────────
-- 예상시간의 출처(provenance)와 시간박스 구분
--
-- 왜 필요한가
--   지금 test_items.estimated_minutes 는 **숫자 하나뿐**이라, 그 값이
--     (가) 담당자가 경험으로 잡은 가정치인지,
--     (나) 실제 실적이 쌓여 나온 값인지,
--     (다) 실적을 사람이 검토해 확정한 값인지
--   구분할 수 없다. 셋은 신뢰도가 전혀 다른데 화면에서는 똑같이 "4시간" 으로 보인다.
--   일정·부하가 이 값 위에 서 있으므로, 얼마나 믿을 값인지가 값 자체만큼 중요하다.
--   GMP 관점에서도 "이 소요시간의 근거는 무엇인가" 에 답할 수 있어야 한다.
--
--   estimate_source       : 'assumed'(가정) | 'measured'(실적) | 'confirmed'(확정)
--   estimate_sample_count : measured/confirmed 일 때 근거가 된 유효 실적 건수
--   estimate_updated_at   : 예상시간을 마지막으로 바꾼 시각(이름·분류 수정과 무관)
--
-- is_timeboxed — 평균이 수렴하지 않는 항목
--   MT(Method Transfer, 시험법 정립)처럼 **정확한 공수가 존재하지 않는** 항목이 있다.
--   목표가 "평균 얼마"가 아니라 "할당한 시간 안에 끝낸다" 라서, 실적을 모아 평균을 내도
--   값이 수렴하지 않고 오히려 다른 항목의 통계까지 오염시킨다. 초과도 성과 저하가 아니라
--   재계획 신호로 읽어야 한다. 이 항목들을 실적 기반 제안에서 제외하기 위한 표식이다.
--   부하(load) 집계에서는 그대로 센다 — 시간은 실제로 쓰이기 때문이다.
--
-- 0045(estimated_minutes)와는 서로 독립이다. 0045 를 아직 안 돌렸어도 이 마이그레이션은
-- 그대로 적용되고, 앱도 두 컬럼의 유무를 각각 확인한다(backend/lib/columnSupport.ts).
--
-- 의존: 0004_pqm_schema.sql (test_items)
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent)
--    `supabase db push` 금지 — 0028 헤더의 경고 참조.
-- ─────────────────────────────────────────────────────────────────────────────

alter table test_items
  add column if not exists estimate_source       text    not null default 'assumed',
  add column if not exists estimate_sample_count int     not null default 0,
  add column if not exists estimate_updated_at   timestamptz,
  add column if not exists is_timeboxed          boolean not null default false;

comment on column test_items.estimate_source is
  '예상시간의 출처: ''assumed''(가정·경험치) | ''measured''(실적 평균 반영) | ''confirmed''(실적을 사람이 검토해 확정).';
comment on column test_items.estimate_sample_count is
  'estimate_source 가 measured/confirmed 일 때 근거가 된 유효 실적 건수. assumed 면 0.';
comment on column test_items.estimate_updated_at is
  '예상시간을 마지막으로 바꾼 시각. null = 한 번도 바꾼 적 없음(초기 등록값 그대로).';
comment on column test_items.is_timeboxed is
  '시간박스 항목(MT 등). 정확한 공수가 존재하지 않아 실적 평균이 수렴하지 않는다. 실적 기반 제안에서 제외하고, 초과는 재계획 신호로 읽는다. 부하 집계에는 그대로 포함.';

-- 값을 세 가지로 못박는다. 여기는 밸리데이션 구분(0039)과 달리 종류가 늘어날 성질이
-- 아니다 — 신뢰도 등급이라 늘어나면 그때마다 화면 해석 규칙도 함께 바뀌어야 한다.
alter table test_items drop constraint if exists chk_test_items_estimate_source;
alter table test_items add constraint chk_test_items_estimate_source
  check (estimate_source in ('assumed', 'measured', 'confirmed'));

alter table test_items drop constraint if exists chk_test_items_estimate_sample_count;
alter table test_items add constraint chk_test_items_estimate_sample_count
  check (estimate_sample_count >= 0);

-- 기존 행은 전부 '가정'이 맞다. 지금까지 실적을 반영한 적이 없다 —
-- qc_job_items.elapsed_minutes 를 예상시간에 되먹인 코드가 없었기 때문이다.
-- default 로 이미 채워지지만, 재실행 시에도 뜻이 분명하도록 남겨 둔다.
update test_items set estimate_source = 'assumed'
 where estimate_source is null or estimate_source not in ('assumed', 'measured', 'confirmed');

-- MT(Method Transfer)는 이 시스템에서 시간박스의 원형이다. 시험법을 정립하는 일이라
-- 배치마다 걸리는 시간이 다르고, 평균을 내는 것 자체가 의미가 없다. 나머지 항목의
-- 시간박스 여부는 관리자가 시험항목 마스터에서 직접 켠다.
update test_items set is_timeboxed = true
 where name = 'MT' and is_timeboxed = false;

-- 제안 배너가 "실적은 쌓였는데 아직 가정치인 항목"을 자주 훑는다.
create index if not exists idx_test_items_estimate_source
  on test_items(estimate_source) where is_active;

-- RLS: 새 테이블이 아니라 0033_enable_rls.sql 의 카탈로그 순회로 이미 커버된다.

-- PostgREST 스키마 캐시 즉시 갱신 (적용 직후 PGRST204/42703 방지)
notify pgrst, 'reload schema';
