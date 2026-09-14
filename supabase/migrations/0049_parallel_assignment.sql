-- ─────────────────────────────────────────────────────────────────────────────
-- 병렬 배정(최대 5인) — pct_order_assignees + set_order_assignees / set_order_primary_assignee
--
-- 배경: 한 오더를 여러 시험자가 나눠 시험하는 방법이 "2인 배정"(0037/0038) 하나뿐이었고 정확히 2명까지만
--       됐다. 담당자2를 pct_orders 의 컬럼(assignee_tester_id_2)으로 뒀기 때문에 3명 이상은 담을 곳이 없다.
--       현장 요구가 "한 품목을 최대 5명이 나눠 진행" 으로 넓어져, 담당자를 오더당 **슬롯(1~5) 행**으로 옮긴다.
--       규칙 전문: intent/2026-09-15-parallel-assignment-spec.md (감독 결정 F3-1~F3-7 반영)
--
-- 모델
--   · 슬롯 번호는 안정 식별자다 — 사람을 빼도 번호를 당기지 않는다(구멍 허용). 시험항목 배분
--     (pct_order_test_items.assignee_slot)과 감사 이력이 번호를 가리키기 때문이다. 추가 시 비어 있는 가장 작은 번호.
--   · 슬롯 1 = 대표 담당자. pct_orders.assignee_tester_id 는 **슬롯 1 의 미러로 영구 유지**한다
--     (미배정 판정·휴가 추천·AI 자동배정 대상·알림 표시가 이 컬럼을 읽는다).
--   · 병렬 여부는 플래그 없이 **슬롯 행 수 ≥ 2** 로 파생한다.
--   · 1인 배정 오더도 담당자가 있으면 슬롯 1 행 1개를 가진다.
--
-- 하위 호환(이중 기록): is_dual_assignment · assignee_tester_id_2 와 0037/0038 제약은 **이번 릴리스에서 지우지 않는다.**
--   담당자 구성이 바뀌는 모든 쓰기(아래 두 함수)가 같은 트랜잭션·한 UPDATE 문으로 함께 기록한다.
--     assignee_tester_id   = 슬롯 1 의 tester_id (행 없으면 null)
--     assignee_tester_id_2 = 슬롯 2 의 tester_id (슬롯 2 행 없으면 null)
--     is_dual_assignment   = 행 수 ≥ 2
--   0038 의 chk_pct_orders_dual_off_no_second 때문에 세 컬럼은 반드시 한 UPDATE 문으로 쓴다.
--   한계: 슬롯 2 가 비고 3 이 차 있으면 구 코드(롤백 시)에는 "담당자2 없는 2인 배정" 으로 보이고, 슬롯 3~5 는 안 보인다.
--   새 앱 코드의 **읽기는 전부 새 테이블**에서 한다. 구 두 컬럼은 쓰기만 한다.
--
-- 왜 함수인가: 담당자 구성·미러·구 컬럼·항목 슬롯 되돌림·감사 기록이 함께 성공하거나 함께 실패해야 한다
--   (대표 담당자 값과 새 담당자 구성이 어긋나는 순간이 있으면 안 된다). 함수 본문 전체가 한 트랜잭션이다(0047 선례).
--   서버는 사유 검사 + rpc + 오류 번역 + (커밋 뒤) 재배정 이력·휴가 겹침 알림만 한다. 함수가 없으면 비원자 폴백 없이 거절한다.
--
-- 잠금 순서(교착 방지 — 바꾸지 않는다): 1) pct_orders 행  2) 그 오더의 pct_order_assignees 행  3) pct_order_test_items 행
--   qc_jobs 는 잠그지 않고 읽기만 한다. F2 reassign_job_item(qc_jobs → pct_orders → …)·0047 cancel_job_start
--   (qc_jobs → pct_orders → …)와 pct_orders 이후 순서가 같다.
--
-- 최대 인원 5 는 앱 상수와 짝이다.
-- ⚠️ types/assignment.ts 의 MAX_PARALLEL_ASSIGNEES(= 5) 와 이 파일의 숫자 5(두 check 제약·함수 검증)는
--    반드시 같은 값이어야 한다. 한쪽을 바꾸면 다른 쪽도 함께 바꾼다.
--
-- 거절 메시지는 errcode P0001 로 던진다 — 서비스(backend/services/orderAssignees.ts)가 메시지를 그대로 화면에 보여 준다.
--
-- 보안: 두 함수는 p_user_id 를 그대로 믿는다. 실행 권한은 service_role(서버) 에만 준다.
--       사용자 id 는 서버가 로그인 토큰에서 꺼내 넘긴다(AI 자동배정·시트 적재는 null).
--
-- 의존: 0003_auth.sql (users), 0010_pct_workflow.sql (pct_orders·qc_jobs·pct_order_edits), 0015 (pct_orders.locked),
--       0027_pct_order_test_items.sql, 0037_dual_assignment.sql, 0038_dual_assignment_invariants.sql
--       **0048_item_review.sql 이 먼저 적용돼 있어야 한다**(전체 적용 순서 고정).
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent — 다시 실행해도 안전)
--    `supabase db push` 금지 — 0028 헤더의 경고 참조.
--    적용 전에는 담당자 구성 변경이 "병렬 배정 기능의 DB 설치(0049 마이그레이션)가 아직 적용되지 않았습니다" 로 거절되고,
--    새 테이블을 읽는 화면은 이 파일을 실행하라는 안내를 보인다.
--    배포 순서: SQL 0048 → 0049 → 0050 적용 → 앱 배포 → **이 파일 맨 끝의 「배포 직후 재동기화」 주석 블록을 한 번 실행**.
--    ⚠️ **F2(0050_item_reassign.sql · 항목별 담당자 변경)와 반드시 같은 릴리스로 배포한다.** 이 파일은 작업 시작 뒤 담당자 추가를
--       허용하는데, 새 담당자가 항목을 넘겨받는 길은 F2 뿐이다.
--    ⚠️ **앱 배포 직후 재동기화 블록을 즉시 실행한다. 실행 전에는 오더 수정·수동 배정·AI 자동배정 등 담당자 변경을 하지 않는다.**
--       (그 사이 구 앱이 바꾼 대표와 슬롯 행이 어긋나 있으면 두 함수가 "재동기화가 필요합니다" 로 거절한다)
--    파일 전체를 한 트랜잭션(begin … commit)으로 감쌌다 — 중간 실패 시 "테이블은 있고 함수는 없는" 부분 적용을 막는다.
--
-- ── 적용 전 점검 (먼저 따로 실행해 이관 규모와 기존 불일치를 본다) ────────────────
--   -- ① 배정 현황: 1인 배정 / 2인 배정 / 미배정 오더 수
--   select case when assignee_tester_id is null then '미배정'
--               when is_dual_assignment then '2인 배정' else '1인 배정' end as kind, count(*)
--     from pct_orders group by 1 order by 1;
--
--   -- ② 이관에서 슬롯 2 가 만들어지지 않을 2인 배정 오더(담당자2 비었음·담당자1과 같음) — 수동 확인 대상
--   select id, product_name, batch_no, assignee_tester_id, assignee_tester_id_2
--     from pct_orders
--    where is_dual_assignment
--      and (assignee_tester_id_2 is null or assignee_tester_id_2 is not distinct from assignee_tester_id);
--
--   -- ③ **[필수] 담당자1이 비어 있는 2인 배정 오더** — 이 SELECT 가 1행이라도 나오면 이 파일은 ⓪ 에서 **적용을 거부**한다.
--   select id, product_name, batch_no, status, assignee_tester_id_2 from pct_orders where is_dual_assignment and assignee_tester_id is null;
--   --    결과가 있으면 구 앱(오더 수정)이나 아래 문장으로 **해당 오더를 먼저 정리**한 뒤 이 파일을 실행한다.
--   --    담당자2를 대표로 올리는 경우(0038 제약 때문에 한 문장으로):
--   --      update pct_orders set assignee_tester_id = assignee_tester_id_2, assignee_tester_id_2 = null, is_dual_assignment = false
--   --       where id = '<오더 id>';
--   --    그 오더 항목 배분(assignee_slot=2)은 이관 ③ 의 고아 슬롯 정리가 슬롯 1 로 되돌린다.
--
-- ── 적용 뒤·재동기화 뒤 점검 (0행이어야 정상) ───────────────────────────────────
--   -- 미러 불일치: assignee_tester_id 와 슬롯 1 행이 다른 오더
--   select o.id from pct_orders o
--     left join pct_order_assignees a on a.order_id = o.id and a.slot = 1
--    where o.assignee_tester_id is distinct from a.tester_id;
--
--   -- 2인 불일치: 행 수 ≥ 2 인데 is_dual_assignment=false, 또는 is_dual_assignment 인데 행이 1개 이하
--   select o.id from pct_orders o
--     left join (select order_id, count(*) n from pct_order_assignees group by order_id) c on c.order_id = o.id
--    where o.is_dual_assignment is distinct from (coalesce(c.n, 0) >= 2);
--
--   -- 고아 슬롯 항목: 담당자 행이 없는 슬롯을 가리키는 활성(제외 아님) 시험항목 — 아무도 시험하지 않게 된다
--   select i.order_id, i.test_item_name, i.assignee_slot
--     from pct_order_test_items i
--    where not coalesce(i.is_excluded, false)
--      and i.assignee_slot > 1
--      and not exists (select 1 from pct_order_assignees a
--                       where a.order_id = i.order_id and a.slot = i.assignee_slot);
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ⓪ 필수 점검 — 담당자1 없이 담당자2만 있는 2인 배정 오더가 있으면 적용하지 않는다(머리 주석 ③ 참고).
--    그대로 이관하면 슬롯 1 없는 오더가 생겨 시트 복구·AI 자동배정·대표 변경이 계속 실패한다.
do $$
declare
  v_cnt int;
begin
  -- 이미 적용된 DB 에서 다시 실행할 때는 새 앱이 쓴 상태라 해당 행이 없다(대표가 늘 있다).
  select count(*) into v_cnt from pct_orders where is_dual_assignment and assignee_tester_id is null;
  if v_cnt > 0 then
    raise exception '[0049] 담당자1이 비어 있는 2인 배정 오더가 %건 있습니다. 파일 머리 주석 「적용 전 점검 ③」으로 먼저 정리한 뒤 다시 실행하세요.', v_cnt;
  end if;
end
$$;

-- ① 오더-담당자 슬롯 테이블 ────────────────────────────────────────────────────
create table if not exists pct_order_assignees (
  order_id    uuid        not null references pct_orders(id) on delete cascade,
  slot        smallint    not null,
  -- on delete restrict: 시험자 하드 삭제로 담당자가 조용히 사라지면 안 된다(0037 의 set null 이 만든
  -- "담당자2 없는 2인 배정" 문제의 재발 방지). 앱은 23503 을 "배정된 오더가 있어 삭제할 수 없습니다. 비활성화하세요." 로 번역한다.
  tester_id   uuid        not null references testers(id) on delete restrict,
  assigned_at timestamptz not null default now(),
  assigned_by uuid        references users(id) on delete set null,
  primary key (order_id, slot)
);

-- 슬롯 1~5 — ⚠️ types/assignment.ts MAX_PARALLEL_ASSIGNEES(= 5) 와 같은 값
alter table pct_order_assignees drop constraint if exists chk_pct_order_assignees_slot;
alter table pct_order_assignees add constraint chk_pct_order_assignees_slot
  check (slot between 1 and 5);

-- 같은 사람을 한 오더의 두 슬롯에 넣지 않는다
create unique index if not exists uq_pct_order_assignees_tester
  on pct_order_assignees(order_id, tester_id);
-- "내 오더" 조회
create index if not exists idx_pct_order_assignees_tester
  on pct_order_assignees(tester_id);

comment on table pct_order_assignees is
  '오더별 담당자 슬롯(1~5). 슬롯 1=대표이며 pct_orders.assignee_tester_id 에 미러된다. 행 2개 이상=병렬 배정.';
comment on column pct_order_assignees.slot is
  '담당자 번호(1~5, types/assignment.ts MAX_PARALLEL_ASSIGNEES). 사람을 빼도 번호를 당기지 않는다 — pct_order_test_items.assignee_slot 이 이 번호를 가리킨다.';
comment on column pct_orders.assignee_tester_id is
  '대표 담당자(= pct_order_assignees 슬롯 1 미러). 0049 이후 set_order_assignees / set_order_primary_assignee 만 쓴다.';


-- ② 항목 배분 슬롯 1~5 로 확장 (0037 의 in (1, 2) 대체) ────────────────────────
-- ⚠️ types/assignment.ts MAX_PARALLEL_ASSIGNEES(= 5) 와 같은 값
alter table pct_order_test_items drop constraint if exists chk_pct_order_test_items_slot;
alter table pct_order_test_items add constraint chk_pct_order_test_items_slot
  check (assignee_slot between 1 and 5);


-- ③ 이관 (재실행 안전 — 빠진 행만 넣는다) ──────────────────────────────────────
--   담당자1 → 슬롯 1, 2인 배정의 담당자2 → 슬롯 2. 항목 assignee_slot(1/2)은 그대로 유효하다(항목 이관 없음).
--   적용~앱 배포 사이에 구 코드가 담당자를 교체·해제한 것은 이 문장으로 흡수되지 않는다 → 맨 끝 재동기화 블록(F3-4).
insert into pct_order_assignees (order_id, slot, tester_id)
select id, 1, assignee_tester_id
  from pct_orders
 where assignee_tester_id is not null
on conflict do nothing;

insert into pct_order_assignees (order_id, slot, tester_id)
select id, 2, assignee_tester_id_2
  from pct_orders
 where is_dual_assignment
   and assignee_tester_id_2 is not null
   and assignee_tester_id_2 is distinct from assignee_tester_id
on conflict do nothing;

-- 고아 슬롯 항목 정리 — 담당자 행이 없는 슬롯(예: 0037 set null 로 담당자2가 사라진 오더의 slot=2)을 가리키는 항목은 슬롯 1 로.
-- 남겨 두면 나중에 그 번호로 새 담당자를 추가하는 순간 옛 항목이 확인 없이 새 사람 몫이 된다.
-- 구 앱은 1인 배정 오더의 슬롯 값을 보지 않으므로 안전하다. 재실행 안전.
update pct_order_test_items i
   set assignee_slot = 1
 where i.assignee_slot > 1
   and not exists (select 1 from pct_order_assignees a
                    where a.order_id = i.order_id and a.slot = i.assignee_slot);


-- ④ RLS (0033·0041 원칙: 기본 차단, 정책 없음 → service_role 만 통과) ──────────
alter table pct_order_assignees enable row level security;
alter table pct_order_assignees force row level security;


-- ⑤ 담당자 구성 변경 — set_order_assignees(p_order_id, p_assignees jsonb, p_user_id, p_reason) ──
-- p_assignees = [{"slot":1,"testerId":"…"}, {"slot":3,"testerId":"…"}, …] 명시 슬롯(F3-1).
--   · 배열에 없는 기존 슬롯 = 삭제 요청(삭제 규칙 적용) · 슬롯 1 필수 · slot 1~5 · testerId 중복·null 금지
--   · 기존 슬롯의 사람이 다르면 교체(그 슬롯의 항목 배분은 그대로 — 사람이 아니라 번호에 붙는다)
-- 규칙(spec §3):
--   · 추가: 작업 시작 뒤에도 허용(5명 이하). 새 슬롯은 시험항목 0개로 시작한다(항목은 F2 로 넘겨받는다).
--   · 삭제(슬롯 2~5): 그 슬롯 담당자의 작업이 없어야 하고, 오더에 작업이 1건 이상이면 그 슬롯의 활성 항목도 0개여야 한다.
--     남은 항목(제외 항목 포함)은 슬롯 1 로 되돌린다.
--   · 슬롯 1 은 삭제 불가·교체만. 시작한 슬롯의 사람 교체·해제 금지. LOCK 오더 변경 금지.
-- 구성이 현재와 같으면 쓰기·감사 없이 changed=false.
-- 반환: { orderId, changed, hasJobs, before:[{slot,testerId,testerName}], after:[…], addedSlots, removedSlots, replacedSlots }
create or replace function set_order_assignees(
  p_order_id uuid, p_assignees jsonb, p_user_id uuid, p_reason text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_order        pct_orders%rowtype;
  v_n            int;
  v_elem         jsonb;
  v_slot_num     numeric;
  v_slot         int;
  v_tester_txt   text;
  v_slots        int[]  := '{}';
  v_testers      uuid[] := '{}';
  v_old_slots    int[]  := '{}';
  v_old_testers  uuid[] := '{}';
  v_added        int[]  := '{}';
  v_removed      int[]  := '{}';
  v_replaced     int[]  := '{}';
  v_idx          int;
  v_i            int;
  v_tester       uuid;
  v_name         text;
  v_active       boolean;
  v_qc_no        text;
  v_has_jobs     boolean;
  v_cnt          int;
  v_before       jsonb;
  v_after        jsonb;
  v_before_txt   text;
  v_after_txt    text;
  v_slot1        uuid;
  v_slot2        uuid;
  v_rows         int;
  r              record;
begin
  -- 조건 0: 사유
  if p_reason is null or length(btrim(p_reason)) < 1 then
    raise exception '수정 사유는 필수입니다.' using errcode = 'P0001';
  end if;

  -- 조건 1: 1~5명 (⚠️ 5 = types/assignment.ts MAX_PARALLEL_ASSIGNEES)
  if p_assignees is null or jsonb_typeof(p_assignees) is distinct from 'array'
     or jsonb_array_length(p_assignees) = 0 then
    raise exception '담당자를 1명 이상 지정해야 합니다.' using errcode = 'P0001';
  end if;
  v_n := jsonb_array_length(p_assignees);
  if v_n > 5 then
    raise exception '병렬 배정은 최대 5명까지입니다.' using errcode = 'P0001';
  end if;

  -- 원소 해석 — 조건 2(null 금지)·슬롯 번호 검증
  for v_elem in select value from jsonb_array_elements(p_assignees) loop
    if jsonb_typeof(v_elem) is distinct from 'object' then
      raise exception '담당자 구성 형식이 올바르지 않습니다.' using errcode = 'P0001';
    end if;
    if jsonb_typeof(v_elem -> 'slot') is distinct from 'number' then
      raise exception '담당자 번호는 1~5 사이여야 합니다.' using errcode = 'P0001';
    end if;
    v_slot_num := (v_elem ->> 'slot')::numeric;
    if v_slot_num <> trunc(v_slot_num) or v_slot_num < 1 or v_slot_num > 5 then   -- ⚠️ 5 = MAX_PARALLEL_ASSIGNEES
      raise exception '담당자 번호는 1~5 사이여야 합니다.' using errcode = 'P0001';
    end if;
    v_slot := v_slot_num::int;
    if v_slot = any(v_slots) then
      raise exception '같은 담당자 번호가 두 번 들어 있습니다.' using errcode = 'P0001';
    end if;

    v_tester_txt := nullif(btrim(coalesce(v_elem ->> 'testerId', '')), '');
    if v_tester_txt is null then
      raise exception '담당자를 선택하지 않은 자리가 있습니다.' using errcode = 'P0001';
    end if;
    if v_tester_txt !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      raise exception '존재하지 않는 시험자입니다.' using errcode = 'P0001';
    end if;

    v_slots   := v_slots || v_slot;
    v_testers := v_testers || v_tester_txt::uuid;
  end loop;

  -- 조건 3: 같은 사람 두 번 금지
  if (select count(distinct t) from unnest(v_testers) as t) <> v_n then
    raise exception '같은 담당자를 두 번 배정할 수 없습니다.' using errcode = 'P0001';
  end if;

  -- ② 오더 행 잠금 → 조건 4·5
  select * into v_order from pct_orders where id = p_order_id for update;
  if not found then
    raise exception '오더를 찾을 수 없습니다.' using errcode = 'P0001';
  end if;
  if coalesce(v_order.locked, false) then
    raise exception '확정(LOCK)된 오더는 담당자를 변경할 수 없습니다. 확정 해제 후 다시 시도해 주세요.' using errcode = 'P0001';
  end if;
  -- 종결 오더에는 담당자를 새로 붙이지 않는다. ⚠️ '승인완료' = types/qc-status.ts APPROVED_STATUS(CLOSED_STAGE)
  -- ('삭제' 오더는 시트 복구가 담당자를 비우는 데 이 함수를 쓰므로, 추가·교체만 아래 ③ 뒤에서 막는다)
  if v_order.status = '승인완료' then
    raise exception '승인완료된 오더는 담당자 구성을 바꿀 수 없습니다.' using errcode = 'P0001';
  end if;

  -- ③ 담당자 슬롯 행 잠금 → 변경 전 구성 확정
  perform 1 from pct_order_assignees where order_id = p_order_id for update;

  -- 적용~재동기화 사이 구 앱이 대표만 바꾼 오더 — 슬롯 행 기준으로 덮어쓰면 구 앱의 변경이 되돌려진다
  if exists (select 1 from pct_order_assignees where order_id = p_order_id and slot = 1)
     and v_order.assignee_tester_id is distinct from
         (select tester_id from pct_order_assignees where order_id = p_order_id and slot = 1) then
    raise exception '이 오더의 담당자 기록이 아직 재동기화되지 않았습니다. 관리자에게 0049 재동기화 실행을 요청하세요.' using errcode = 'P0001';
  end if;

  for r in select slot, tester_id from pct_order_assignees where order_id = p_order_id order by slot loop
    v_old_slots   := v_old_slots || r.slot::int;
    v_old_testers := v_old_testers || r.tester_id;
    v_idx := array_position(v_slots, r.slot::int);
    if v_idx is null then
      v_removed := v_removed || r.slot::int;
    elsif v_testers[v_idx] is distinct from r.tester_id then
      v_replaced := v_replaced || r.slot::int;
    end if;
  end loop;
  foreach v_slot in array v_slots loop
    if not (v_slot = any(v_old_slots)) then
      v_added := v_added || v_slot;
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object('slot', a.slot, 'testerId', a.tester_id, 'testerName', t.name) order by a.slot), '[]'::jsonb),
         string_agg('담당자 ' || a.slot || ': ' || coalesce(t.name, a.tester_id::text), ', ' order by a.slot)
    into v_before, v_before_txt
    from pct_order_assignees a
    left join testers t on t.id = a.tester_id
   where a.order_id = p_order_id;

  -- 삭제 오더는 담당자를 빼는 것(시트 복구)만 허용한다. ⚠️ '삭제' = types/qc-status.ts DELETED_STATUS
  if v_order.status = '삭제' and (cardinality(v_added) > 0 or cardinality(v_replaced) > 0) then
    raise exception '삭제된 오더에는 담당자를 추가하거나 바꿀 수 없습니다.' using errcode = 'P0001';
  end if;

  -- 구성이 현재와 같으면 쓰지 않는다
  if cardinality(v_added) = 0 and cardinality(v_removed) = 0 and cardinality(v_replaced) = 0 then
    return jsonb_build_object(
      'orderId', p_order_id, 'changed', false,
      'hasJobs', exists (select 1 from qc_jobs where order_id = p_order_id),
      'before', v_before, 'after', v_before,
      'addedSlots', '[]'::jsonb, 'removedSlots', '[]'::jsonb, 'replacedSlots', '[]'::jsonb);
  end if;

  -- ④ 조건 6: 새로 들어오는(기존 구성에 없던) 시험자만 존재·활성 검사 — 배정을 실제로 건드릴 때만 검증
  for v_i in 1 .. v_n loop
    v_tester := v_testers[v_i];
    if v_tester = any(v_old_testers) then
      continue;
    end if;
    select name, is_active into v_name, v_active from testers where id = v_tester;
    if not found then
      raise exception '존재하지 않는 시험자입니다.' using errcode = 'P0001';
    end if;
    if not coalesce(v_active, false) then
      raise exception '비활성 시험자(%)에게는 배정할 수 없습니다.', v_name using errcode = 'P0001';
    end if;
  end loop;

  -- 조건 7: 이미 작업을 시작한 담당자의 교체·해제 금지 (qc_jobs 는 읽기만 — 잠그지 않는다)
  foreach v_slot in array (v_removed || v_replaced) loop
    v_tester := v_old_testers[array_position(v_old_slots, v_slot)];
    select qc_no into v_qc_no
      from qc_jobs
     where order_id = p_order_id and assignee_tester_id = v_tester
     order by created_at
     limit 1;
    if found then
      raise exception '이미 작업을 시작한 담당자(QC %)는 변경할 수 없습니다. 작업을 먼저 정리하세요.', v_qc_no using errcode = 'P0001';
    end if;
  end loop;

  -- 조건 7': 슬롯 1(대표)은 뺄 수 없다 — 교체만
  if not (1 = any(v_slots)) then
    if 1 = any(v_old_slots) then
      raise exception '담당자 1(대표)은 뺄 수 없습니다. 다른 사람으로 교체만 할 수 있습니다.' using errcode = 'P0001';
    end if;
    raise exception '담당자 1(대표)을 지정해야 합니다.' using errcode = 'P0001';
  end if;

  -- 조건 8: 작업이 1건 이상인 오더에서 삭제되는 슬롯의 활성 항목은 0개여야 한다
  v_has_jobs := exists (select 1 from qc_jobs where order_id = p_order_id);
  if v_has_jobs then
    foreach v_slot in array v_removed loop
      select count(*) into v_cnt
        from pct_order_test_items
       where order_id = p_order_id and assignee_slot = v_slot and not coalesce(is_excluded, false);
      if v_cnt > 0 then
        raise exception '담당자 %에게 배분된 시험항목이 %개 남아 있어 뺄 수 없습니다.', v_slot, v_cnt using errcode = 'P0001';
      end if;
    end loop;
  end if;

  -- ⑤ 삭제 슬롯의 항목(제외 항목 포함)을 슬롯 1 로 되돌린다 + 슬롯마다 요약 감사 1행
  if cardinality(v_removed) > 0 then
    perform 1 from pct_order_test_items
     where order_id = p_order_id and assignee_slot = any(v_removed)
     for update;
    foreach v_slot in array v_removed loop
      update pct_order_test_items
         set assignee_slot = 1
       where order_id = p_order_id and assignee_slot = v_slot;
      get diagnostics v_cnt = row_count;
      if v_cnt > 0 then
        insert into pct_order_edits (order_id, field, old_value, new_value, reason, edited_by)
        values (p_order_id, 'testItemAssignee',
                v_cnt || '개 항목: 담당자 ' || v_slot,
                '담당자 1 (담당자 ' || v_slot || ' 해제)',
                btrim(p_reason), p_user_id);
      end if;
    end loop;
  end if;

  -- ⑥ 슬롯 행 반영 — 빠지는·바뀌는 슬롯을 먼저 지우고 새로 넣는다
  --    (같은 사람이 다른 번호로 옮겨 가는 요청에서 unique(order_id, tester_id) 가 중간에 부딪히지 않게)
  delete from pct_order_assignees
   where order_id = p_order_id and slot = any(v_removed || v_replaced);

  for v_i in 1 .. v_n loop
    if v_slots[v_i] = any(v_added || v_replaced) then
      insert into pct_order_assignees (order_id, slot, tester_id, assigned_by)
      values (p_order_id, v_slots[v_i], v_testers[v_i], p_user_id);
    end if;
  end loop;

  -- ⑦ 미러 + 구 컬럼 이중 기록 — 0038 제약 때문에 한 UPDATE 문으로
  select tester_id into v_slot1 from pct_order_assignees where order_id = p_order_id and slot = 1;
  select tester_id into v_slot2 from pct_order_assignees where order_id = p_order_id and slot = 2;
  select count(*)  into v_rows  from pct_order_assignees where order_id = p_order_id;

  update pct_orders
     set assignee_tester_id   = v_slot1,
         assignee_tester_id_2 = v_slot2,
         is_dual_assignment   = (v_rows >= 2)
   where id = p_order_id;

  -- ⑧ 감사 — field 'assignees', 값 "담당자 1: 홍길동, 담당자 3: 김철수" (슬롯 오름차순, F3-3)
  select coalesce(jsonb_agg(jsonb_build_object('slot', a.slot, 'testerId', a.tester_id, 'testerName', t.name) order by a.slot), '[]'::jsonb),
         string_agg('담당자 ' || a.slot || ': ' || coalesce(t.name, a.tester_id::text), ', ' order by a.slot)
    into v_after, v_after_txt
    from pct_order_assignees a
    left join testers t on t.id = a.tester_id
   where a.order_id = p_order_id;

  insert into pct_order_edits (order_id, field, old_value, new_value, reason, edited_by)
  values (p_order_id, 'assignees', v_before_txt, v_after_txt, btrim(p_reason), p_user_id);

  return jsonb_build_object(
    'orderId',       p_order_id,
    'changed',       true,
    'hasJobs',       v_has_jobs,
    'before',        v_before,
    'after',         v_after,
    'addedSlots',    to_jsonb(v_added),
    'removedSlots',  to_jsonb(v_removed),
    'replacedSlots', to_jsonb(v_replaced)
  );
end;
$$;

comment on function set_order_assignees(uuid, jsonb, uuid, text) is
  '병렬 배정 담당자 구성 변경(원자적, 0049). 잠금: pct_orders → pct_order_assignees → pct_order_test_items. 슬롯 추가·삭제·교체 + 삭제 슬롯 항목 슬롯1 되돌림 + 미러(assignee_tester_id)·구 컬럼 이중 기록 + pct_order_edits(assignees) 감사. service_role 전용.';


-- ⑥ 대표 담당자(슬롯 1)만 바꾸는 경로 — set_order_primary_assignee(p_order_id, p_tester_id, p_user_id, p_reason) ──
-- AI 자동배정·수동 배정·해제·시트 적재 복구·동시분석 그룹 전파·수동 오더 생성이 모두 이 함수로 쓴다(F3-2).
--   · p_tester_id null = 슬롯 1 삭제(배정 해제). 슬롯 2 이상이 남아 있으면 거절.
--   · 이미 같은 오더의 슬롯 2~5 에 있는 사람을 대표로 넣으면 거절.
--   · 기존 대표가 이 오더에서 작업을 시작했으면 교체·해제 금지. LOCK 오더 거절.
--   · 감사는 기존 키 field='assigneeTesterId' 를 계속 쓴다(이력 연속성, F3-3).
-- 대표가 이미 그 사람이면(테이블·미러 모두) 쓰기·감사 없이 changed=false — LOCK 오더에서도 거절하지 않는다.
-- 반환: { orderId, changed, beforeTesterId, afterTesterId }
create or replace function set_order_primary_assignee(
  p_order_id uuid, p_tester_id uuid, p_user_id uuid, p_reason text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_order    pct_orders%rowtype;
  v_row_old  uuid;
  v_old      uuid;
  v_others   int;
  v_name     text;
  v_active   boolean;
  v_qc_no    text;
  v_slot1    uuid;
  v_slot2    uuid;
  v_rows     int;
begin
  if p_reason is null or length(btrim(p_reason)) < 1 then
    raise exception '수정 사유는 필수입니다.' using errcode = 'P0001';
  end if;

  -- ① 오더 행 잠금
  select * into v_order from pct_orders where id = p_order_id for update;
  if not found then
    raise exception '오더를 찾을 수 없습니다.' using errcode = 'P0001';
  end if;

  -- ② 담당자 슬롯 행 잠금
  perform 1 from pct_order_assignees where order_id = p_order_id for update;
  select tester_id into v_row_old from pct_order_assignees where order_id = p_order_id and slot = 1;
  -- 슬롯 행이 있는데 미러와 다르면(적용~재동기화 사이 구 앱이 대표를 바꿈) 어느 쪽이 기존 대표인지 믿을 수 없다 —
  -- 작업 시작 검사를 엉뚱한 사람에게 하게 되므로 거절한다. 슬롯 행이 아예 없고 미러만 있으면 미러를 기존 대표로 본다.
  if v_row_old is not null and v_row_old is distinct from v_order.assignee_tester_id then
    raise exception '이 오더의 담당자 기록이 아직 재동기화되지 않았습니다. 관리자에게 0049 재동기화 실행을 요청하세요.' using errcode = 'P0001';
  end if;
  v_old := coalesce(v_row_old, v_order.assignee_tester_id);

  if v_row_old is not distinct from p_tester_id and v_order.assignee_tester_id is not distinct from p_tester_id then
    return jsonb_build_object('orderId', p_order_id, 'changed', false,
                              'beforeTesterId', v_old, 'afterTesterId', p_tester_id);
  end if;

  if coalesce(v_order.locked, false) then
    raise exception '확정(LOCK)된 오더는 담당자를 변경할 수 없습니다. 확정 해제 후 다시 시도해 주세요.' using errcode = 'P0001';
  end if;

  select count(*) into v_others from pct_order_assignees where order_id = p_order_id and slot > 1;
  if p_tester_id is null and v_others > 0 then
    raise exception '병렬 담당자가 있는 오더는 대표 담당자를 비울 수 없습니다. 병렬 담당자를 먼저 빼세요.' using errcode = 'P0001';
  end if;

  if p_tester_id is not null then
    select name, is_active into v_name, v_active from testers where id = p_tester_id;
    if not found then
      raise exception '존재하지 않는 시험자입니다.' using errcode = 'P0001';
    end if;
    if not coalesce(v_active, false) then
      raise exception '비활성 시험자(%)에게는 배정할 수 없습니다.', v_name using errcode = 'P0001';
    end if;
    if exists (select 1 from pct_order_assignees
                where order_id = p_order_id and slot > 1 and tester_id = p_tester_id) then
      raise exception '이미 이 오더의 병렬 담당자로 배정된 시험자입니다.' using errcode = 'P0001';
    end if;
  end if;

  -- 기존 대표가 이미 작업을 시작했으면 교체·해제 금지 (qc_jobs 는 읽기만)
  if v_old is not null and v_old is distinct from p_tester_id then
    select qc_no into v_qc_no
      from qc_jobs
     where order_id = p_order_id and assignee_tester_id = v_old
     order by created_at
     limit 1;
    if found then
      raise exception '이미 작업을 시작한 담당자(QC %)는 변경할 수 없습니다. 작업을 먼저 정리하세요.', v_qc_no using errcode = 'P0001';
    end if;
  end if;

  -- ③ 슬롯 1 반영
  delete from pct_order_assignees where order_id = p_order_id and slot = 1;
  if p_tester_id is not null then
    insert into pct_order_assignees (order_id, slot, tester_id, assigned_by)
    values (p_order_id, 1, p_tester_id, p_user_id);
  end if;

  -- ④ 미러 + 구 컬럼 이중 기록 — 한 UPDATE 문
  select tester_id into v_slot1 from pct_order_assignees where order_id = p_order_id and slot = 1;
  select tester_id into v_slot2 from pct_order_assignees where order_id = p_order_id and slot = 2;
  select count(*)  into v_rows  from pct_order_assignees where order_id = p_order_id;

  update pct_orders
     set assignee_tester_id   = v_slot1,
         assignee_tester_id_2 = v_slot2,
         is_dual_assignment   = (v_rows >= 2)
   where id = p_order_id;

  -- ⑤ 감사 — 기존 키 assigneeTesterId (값은 시험자 id, 화면이 이름으로 바꿔 보인다)
  if v_old is distinct from p_tester_id then
    insert into pct_order_edits (order_id, field, old_value, new_value, reason, edited_by)
    values (p_order_id, 'assigneeTesterId', v_old::text, p_tester_id::text, btrim(p_reason), p_user_id);
  end if;

  return jsonb_build_object('orderId', p_order_id, 'changed', v_old is distinct from p_tester_id,
                            'beforeTesterId', v_old, 'afterTesterId', p_tester_id);
end;
$$;

comment on function set_order_primary_assignee(uuid, uuid, uuid, text) is
  '대표 담당자(슬롯 1) 배정·교체·해제(원자적, 0049). 잠금: pct_orders → pct_order_assignees. 슬롯 1 upsert/삭제 + 미러·구 컬럼 이중 기록 + pct_order_edits(assigneeTesterId) 감사. 병렬 담당자가 남아 있으면 해제 거절. service_role 전용.';


-- ⑦ 시험항목 담당자 배분(작업 시작 전 일괄 배분) — set_order_test_item_slot(p_order_id, p_test_item_name, p_slot, p_user_id) ──
-- 항목 하나를 담당자 슬롯으로 옮긴다. 판정·쓰기·감사가 한 트랜잭션이다.
-- 왜 함수인가: 앱에서 "슬롯 존재 확인 → UPDATE" 를 따로 하면, 그 사이 다른 관리자가 그 담당자를 빼는
--   set_order_assignees 가 끼어들어 **담당자 행이 없는 슬롯에 항목이 남는다**(아무도 시험하지 않는 항목, GMP).
--   set_order_assignees 와 같은 잠금 대상·순서(pct_orders → pct_order_assignees → pct_order_test_items)로 직렬화한다.
-- 규칙: 오더 존재 → 병렬 배정(슬롯 행 ≥ 2) → LOCK 아님 → 그 오더에 있는 슬롯 → 오더에 작업 0건 → 항목 존재.
--   작업이 1건이라도 있으면 일괄 배분 이동은 금지 — 진행 중 이동은 항목별 담당자 변경(F2 reassign_job_item)으로만.
-- 감사: pct_order_edits field 'testItemAssignee', "항목명: 담당자 N" (과거 기록과 같은 키).
-- 반환: { orderId, testItemName, changed, beforeSlot, afterSlot }
create or replace function set_order_test_item_slot(
  p_order_id uuid, p_test_item_name text, p_slot int, p_user_id uuid
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_order  pct_orders%rowtype;
  v_rows   int;
  v_before int;
begin
  if p_slot is null or p_slot < 1 or p_slot > 5 then   -- ⚠️ 5 = types/assignment.ts MAX_PARALLEL_ASSIGNEES
    raise exception '담당자 번호는 1~5 사이여야 합니다.' using errcode = 'P0001';
  end if;

  -- ① 오더 행 잠금 — 담당자 구성 변경(set_order_assignees)과 직렬화
  select * into v_order from pct_orders where id = p_order_id for update;
  if not found then
    raise exception '오더를 찾을 수 없습니다.' using errcode = 'P0001';
  end if;

  -- ② 담당자 슬롯 행 잠금
  perform 1 from pct_order_assignees where order_id = p_order_id for update;
  select count(*) into v_rows from pct_order_assignees where order_id = p_order_id;
  if v_rows < 2 then
    raise exception '병렬 배정 오더에서만 시험항목 담당자를 나눌 수 있습니다.' using errcode = 'P0001';
  end if;
  if coalesce(v_order.locked, false) then
    raise exception '확정(LOCK)된 오더는 담당자 배분을 변경할 수 없습니다. 확정 해제 후 다시 시도해 주세요.' using errcode = 'P0001';
  end if;
  if not exists (select 1 from pct_order_assignees where order_id = p_order_id and slot = p_slot) then
    raise exception '이 오더에 없는 담당자 번호입니다.' using errcode = 'P0001';
  end if;
  -- qc_jobs 는 읽기만 한다(작업 시작은 오더 행을 잠그지 않는다 — spec §5.3 알려진 한계)
  if exists (select 1 from qc_jobs where order_id = p_order_id) then
    raise exception '이미 작업이 시작된 오더는 항목별 담당자를 바꿀 수 없습니다. 담당자 배분은 작업 시작 전에 확정해야 합니다.' using errcode = 'P0001';
  end if;

  -- ③ 항목 행 잠금
  select assignee_slot into v_before
    from pct_order_test_items
   where order_id = p_order_id and test_item_name = p_test_item_name
   for update;
  if not found then
    raise exception '시험항목을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;
  if v_before = p_slot then
    return jsonb_build_object('orderId', p_order_id, 'testItemName', p_test_item_name,
                              'changed', false, 'beforeSlot', v_before, 'afterSlot', p_slot);
  end if;

  update pct_order_test_items
     set assignee_slot = p_slot
   where order_id = p_order_id and test_item_name = p_test_item_name;

  insert into pct_order_edits (order_id, field, old_value, new_value, reason, edited_by)
  values (p_order_id, 'testItemAssignee',
          p_test_item_name || ': 담당자 ' || v_before,
          p_test_item_name || ': 담당자 ' || p_slot,
          '항목별 담당자 배분 변경', p_user_id);

  return jsonb_build_object('orderId', p_order_id, 'testItemName', p_test_item_name,
                            'changed', true, 'beforeSlot', v_before, 'afterSlot', p_slot);
end;
$$;

comment on function set_order_test_item_slot(uuid, text, int, uuid) is
  '병렬 배정 시험항목 담당자 배분(작업 시작 전, 원자적, 0049). 잠금: pct_orders → pct_order_assignees → pct_order_test_items. 슬롯 존재·작업 0건 판정 + 쓰기 + pct_order_edits(testItemAssignee) 감사. service_role 전용.';


-- ⑧ 실행 권한 — 서버(service_role)에만. 사용자 id 를 믿는 함수들이다. ─────────────
revoke all on function set_order_assignees(uuid, jsonb, uuid, text)          from public, anon, authenticated;
revoke all on function set_order_primary_assignee(uuid, uuid, uuid, text)    from public, anon, authenticated;
revoke all on function set_order_test_item_slot(uuid, text, int, uuid)       from public, anon, authenticated;
grant execute on function set_order_assignees(uuid, jsonb, uuid, text)       to service_role;
grant execute on function set_order_primary_assignee(uuid, uuid, uuid, text) to service_role;
grant execute on function set_order_test_item_slot(uuid, text, int, uuid)    to service_role;

commit;

notify pgrst, 'reload schema';


-- ─────────────────────────────────────────────────────────────────────────────
-- 배포 직후 재동기화 (F3-4) — **앱 배포가 끝난 직후 한 번만** 아래 주석을 풀어 실행한다.
--
-- 왜: 이 SQL 적용 ~ 앱 배포 사이에는 구 앱이 계속 돈다. 구 앱은 새 테이블을 모르고 구 컬럼
--     (assignee_tester_id · assignee_tester_id_2 · is_dual_assignment)만 바꾼다. 위 ③ 이관은
--     "빠진 행만 넣기" 라 그 사이의 **교체·해제**를 흡수하지 못한다. 배포 뒤 새 앱은 두 함수로
--     이중 기록하므로 구 컬럼이 곧 정답이고, 이 블록이 슬롯 1·2 를 구 컬럼에 맞춘다. 이후엔 필요 없다.
-- 범위: 슬롯 1·2 만. 슬롯 3~5 는 새 앱만 만들고, 새 앱은 구 컬럼과 어긋나게 쓰지 않으므로 건드리지 않는다.
-- 실행 뒤 파일 머리의 「적용 뒤·재동기화 뒤 점검」 두 SELECT 가 0행인지 확인한다.
--
-- begin;
--
-- -- ① 구 컬럼과 다른 슬롯 1·2 행을 지운다 (교체·해제 흡수 — 아래 insert 가 unique(order_id, tester_id) 에 부딪히지 않게)
-- delete from pct_order_assignees a
--  using pct_orders o
--  where a.order_id = o.id
--    and ((a.slot = 1 and a.tester_id is distinct from o.assignee_tester_id)
--      or (a.slot = 2 and a.tester_id is distinct from
--            (case when o.is_dual_assignment and o.assignee_tester_id_2 is distinct from o.assignee_tester_id
--                  then o.assignee_tester_id_2 end))
--      -- 배포가 겹치는 동안 구 앱이 슬롯 3~5 의 사람을 대표·담당자2로 쓴 경우 — 아래 insert 의 unique 충돌 방지
--      or (a.slot > 2 and (a.tester_id = o.assignee_tester_id
--                          or (o.is_dual_assignment and a.tester_id = o.assignee_tester_id_2))));
--
-- -- ② 구 컬럼 → 슬롯 1·2 (on conflict do update)
-- insert into pct_order_assignees (order_id, slot, tester_id)
-- select id, 1, assignee_tester_id from pct_orders where assignee_tester_id is not null
-- on conflict (order_id, slot) do update set tester_id = excluded.tester_id;
--
-- insert into pct_order_assignees (order_id, slot, tester_id)
-- select id, 2, assignee_tester_id_2 from pct_orders
--  where is_dual_assignment and assignee_tester_id_2 is not null
--    and assignee_tester_id_2 is distinct from assignee_tester_id
-- on conflict (order_id, slot) do update set tester_id = excluded.tester_id;
--
-- -- ③ 구 앱이 2인 배정을 끄면서 되돌리지 못한 항목 배분 정리 — 담당자 행이 없는 슬롯의 항목은 슬롯 1 로
-- update pct_order_test_items i
--    set assignee_slot = 1
--  where i.assignee_slot > 1
--    and not exists (select 1 from pct_order_assignees a
--                     where a.order_id = i.order_id and a.slot = i.assignee_slot);
--
-- commit;
-- ─────────────────────────────────────────────────────────────────────────────
