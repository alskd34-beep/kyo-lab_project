-- ─────────────────────────────────────────────────────────────────────────────
-- 오더 착수 예정일 (pct_orders.planned_start_date)
--
-- 배경: 오더에는 "언제 시작하는가"를 담을 자리가 없었다. 포장일(제조팀 원본)과
--       완료예정일뿐이라, 휴가 충돌 판정도 그 둘로 만든 넓은 구간
--       (포장일~완료예정일)으로 했다. 그래서 담당자가 그 구간 안에 하루라도 휴가면
--       경고가 떴고, 관리자가 할 수 있는 선택은 「그대로 배정」과 「취소」뿐이었다.
--
--       현장에서 필요한 답은 셋째 것이다 — "월요일이 휴가니 화요일부터 시작".
--       그 날짜를 적어 둘 곳이 없어서 기능 자체가 성립하지 않았다.
--
-- 해결: 관리자가 정한 착수 예정일을 이 컬럼에 둔다.
--   - 휴가 충돌 판정(@shared/leave.orderTestWindow)이 이 날짜를 구간 시작으로 쓴다.
--     월요일 휴가 + 화요일 착수 → 구간이 화요일부터라 더 이상 겹치지 않는다.
--   - 월간 스케줄이 셀을 놓는 기준에도 들어간다.
--     실제 착수일(qc_jobs.work_start_date) > 착수 예정일 > 포장일 다음 근무일 > 납기 역산.
--     실제로 시작한 날이 있으면 그것이 계획을 이긴다 — 계획은 시작 전까지만 유효하다.
--
-- null = 지정 안 함(예전과 동일하게 포장일·납기로 추정). 기본값을 채우지 않는 이유는
-- "관리자가 정한 날"과 "시스템이 추정한 날"이 다른 사실이고, 화면이 그 둘을 구분해
-- 보여줘야 하기 때문이다(월간 상세의 '일정 근거').
--
-- ⚠️ 이 값은 사람이 정한 계획이라 **구글시트 재적재가 덮어쓰면 안 된다.**
--    앱에서 pctIngest 의 변경감지 대상 밖에 둔다(packaging_date·due_date 와 다른 점).
--
-- 의존: 0010_pct_workflow.sql (pct_orders)
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent)
--    `supabase db push` 금지 — 0028 헤더의 경고 참조.
-- ─────────────────────────────────────────────────────────────────────────────

alter table pct_orders
  add column if not exists planned_start_date date;

comment on column pct_orders.planned_start_date is
  '관리자가 정한 시험 착수 예정일. 휴가 충돌 판정의 구간 시작이자 월간 스케줄의 배치 기준. null = 미지정(포장일·납기로 추정). 구글시트 재적재가 덮어쓰지 않는다.';

-- 월간 스케줄이 "이 달에 걸린 오더"를 이 컬럼으로도 찾는다. 대부분 null 이라
-- 부분 인덱스가 훨씬 작다.
create index if not exists idx_pct_orders_planned_start
  on pct_orders(planned_start_date)
  where planned_start_date is not null;

notify pgrst, 'reload schema';
