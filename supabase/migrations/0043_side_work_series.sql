-- ─────────────────────────────────────────────────────────────────────────────
-- 반복 부업무 묶음 (side_work_logs.series_id)
--
-- 배경: 문서작성·시험실 정리처럼 **매일 반복되는** 부업무를 시험자가 날마다 한 건씩
--       손으로 넣고 있었다. 한 달이면 20번 넘게 같은 내용을 다시 적는다.
--
-- 해결: 기간과 내용을 한 번 정하면 그 기간의 근무일마다 기록을 **미리 만들어 둔다.**
--
--   규칙을 저장해 화면에서 가상으로 그리는 방법도 있지만 택하지 않았다. 운영 리포트와
--   통계(aggregateSideWork·operationReport)가 전부 side_work_logs 를 직접 읽기 때문에,
--   가상 항목으로 두면 소비처마다 규칙을 알아야 하고 한 곳만 빠뜨려도 숫자가 갈린다.
--   실제 행으로 만들어 두면 수정·삭제·집계가 전부 기존 경로로 그대로 동작한다.
--
--   대신 한 번에 만든 것을 한 번에 지울 수 있어야 하므로 묶음 id 를 둔다.
--   series_id 가 같은 행들이 한 번의 반복 등록으로 생긴 것이다.
--
-- 개별 수정은 그대로 허용한다 — "그날은 2시간이 아니라 4시간이었다" 는 흔한 일이고,
-- 그때 묶음 전체가 따라 바뀌면 오히려 사실과 멀어진다. 묶음은 만들기·지우기의 단위일 뿐
-- 값의 단일 출처가 아니다.
--
-- null = 손으로 하루씩 넣은 기존 기록. 반복으로 생긴 것과 구분된다.
--
-- 의존: 0041_side_work.sql (side_work_logs)
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent)
--    `supabase db push` 금지 — 0028 헤더의 경고 참조.
-- ─────────────────────────────────────────────────────────────────────────────

alter table side_work_logs
  add column if not exists series_id uuid;

comment on column side_work_logs.series_id is
  '반복 부업무 묶음 id. 한 번의 반복 등록으로 생긴 행들이 같은 값을 갖는다. null = 하루씩 직접 넣은 기록.';

-- "이 묶음 전체" 를 지우거나 세는 조회가 이 컬럼 하나로 이뤄진다.
-- 대부분의 행은 null(직접 입력)이라 부분 인덱스가 훨씬 작다.
create index if not exists idx_side_work_logs_series
  on side_work_logs(series_id)
  where series_id is not null;

-- 같은 묶음이 같은 날에 두 번 들어가지 않게 한다. 반복 등록을 실수로 두 번 눌러도
-- 그날 기록이 두 개가 되지 않는다(생성 쪽에서도 거르지만, 마지막 방어선을 DB 에 둔다).
create unique index if not exists uq_side_work_logs_series_date
  on side_work_logs(series_id, work_date)
  where series_id is not null;

-- ─── 곁다리: minutes 주석에서 프리셋 값 나열을 걷어낸다 ──────────────────────
-- 0041 이 '프리셋(30/60/120/240/480)' 이라고 값을 적어 뒀는데, 화면에 10분이 추가되면서
-- 곧바로 사실과 어긋났다. 주석이 화면 상수를 따라다니게 만들면 계속 어긋난다 —
-- 프리셋 목록의 단일 기준은 types/side-work.ts 의 MINUTE_PRESETS 하나다.
comment on column side_work_logs.minutes is
  '소요 분. 화면 프리셋과 직접 입력 둘 다 이 컬럼 하나로 들어온다. 프리셋 목록의 기준은 types/side-work.ts 의 MINUTE_PRESETS.';

notify pgrst, 'reload schema';
