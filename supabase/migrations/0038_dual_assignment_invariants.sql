-- ─────────────────────────────────────────────────────────────────────────────
-- 2인 배정 불변식 보강 (0037 후속)
--
-- 0037 이 건 제약은 "두 담당자가 서로 다르다" 하나뿐이었다. 그런데 2인 배정 상태는
-- 컬럼 3개(is_dual_assignment / assignee_tester_id / assignee_tester_id_2)가 함께
-- 만들어내는 상태라, 앱 레이어(updateOrderWithReason)만 믿으면 다른 경로 —
-- 수동 배정 API(pctAssign.assignManually), 운영 중 직접 SQL — 가 그대로 뚫는다.
--
-- 여기서 거는 것: is_dual_assignment = false 이면 담당자2는 반드시 비어 있다.
--   2인 배정을 껐는데 assignee_tester_id_2 가 남아 있으면, 그 사람은 어느 화면에도
--   담당자로 보이지 않으면서 slot=2 항목만 물고 있는 유령이 된다.
--
-- ⚠️ 일부러 걸지 **않은** 제약: "is_dual_assignment = true 이면 담당자 둘 다 not null".
--   assignee_tester_id_2 는 `on delete set null` 이라, 시험자를 하드 삭제하면
--   (backend/services/testers.ts 의 delete 경로) Postgres 가 이 컬럼을 null 로 만들려다
--   그 제약에 걸려 **DELETE 자체가 실패**한다. 즉 시험자 관리 화면이 깨진다.
--   이 불변식은 앱에서 다룬다 — updateOrderWithReason 은 "배정을 실제로 건드리는 수정"
--   일 때만 검증하므로, 담당자2가 삭제로 사라진 오더도 관리자가 다시 지정해 복구할 수 있다.
--
-- 의존: 0037_dual_assignment.sql
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

-- 제약을 걸기 전에 기존 데이터를 먼저 정리한다.
-- (0037 적용 후 ~ 이 마이그레이션 사이에 위반 행이 생겼을 수 있다. 정리하지 않으면
--  add constraint 가 통째로 실패한다.)
update pct_orders
   set assignee_tester_id_2 = null
 where is_dual_assignment = false
   and assignee_tester_id_2 is not null;

alter table pct_orders drop constraint if exists chk_pct_orders_dual_off_no_second;
alter table pct_orders add constraint chk_pct_orders_dual_off_no_second
  check (is_dual_assignment or assignee_tester_id_2 is null);

comment on column pct_orders.assignee_tester_id_2 is
  '2인 배정의 담당자2. is_dual_assignment=false 이면 항상 null (chk_pct_orders_dual_off_no_second).';

-- PostgREST 스키마 캐시 즉시 갱신
notify pgrst, 'reload schema';
