-- ─────────────────────────────────────────────────────────────────────────────
-- 진행 중 시험항목 담당자 변경 — reassign_job_item(p_order_id, p_test_item_name,
--                                               p_expected_from_slot, p_to_slot, p_user_id, p_reason)
--
-- 배경: 병렬 배정(0049) 오더에서 어느 시험항목을 누가 할지는 **작업 시작 전에만** 정할 수 있었다.
--       담당자 한 명이라도 [작업 시작] 을 누르면 배분이 통째로 잠겨, 시험 도중 장비·일정·휴가 사정으로
--       남은 항목을 동료에게 넘길 방법이 없었다. 이제 **아직 손대지 않은** 항목 하나를 같은 오더의
--       다른 담당자(슬롯)에게 넘긴다. 규칙 전문: intent/2026-09-15-in-progress-item-reassign-spec.md
--       (감독 결정 F2-1~F2-8 반영)
--
-- 네 경우(F2-1) — 보내는 쪽 A·받는 쪽 B 는 슬롯 번호로 식별하고, "작업 有" = 그 슬롯 담당자의 이 오더 qc_jobs 행이 있음
--   (A 有, B 有) 항목 행의 qc_job_id 를 B 작업으로 이동(행 id 유지)          → mode 'moved'
--   (A 有, B 無) A 작업에서 항목 행 삭제(흔적 0 행만)                       → mode 'released'
--   (A 無, B 有) B 작업에 pending 행 추가(sequence_order 는 스냅샷 값)       → mode 'attached'
--   (A 無, B 無) 스냅샷만 변경                                              → mode 'snapshot'
--   네 경우 모두 스냅샷 pct_order_test_items.assignee_slot 을 B 슬롯으로 바꾸고, 감사 1행을 남기며,
--   작업이 있는 쪽은 같은 트랜잭션에서 recompute_job_stage(0048)로 단계를 다시 도출한다.
--   B 작업은 자동 생성하지 않는다(QC번호·작업 시작 시각은 본인이 [작업 시작] 할 때만 생긴다).
--
-- GMP: 시작·완료 시각·소요시간·검토 기록이 있는 항목은 어떤 경우에도 옮기거나 지우지 않는다
--      (옮기면 A 의 실적이 B 의 실적으로 집계된다). 행 삭제 경로는 흔적 0 항목만 탄다.
--      검토·재실시 이력(qc_job_item_review_history)은 0048 에서 항목 FK 가 on delete set null 이라 남는다.
--
-- 왜 함수인가: 스냅샷(오더 상태·시작 대기·월간 스케줄이 읽는다)과 실제 체크리스트(qc_job_items)가
--   어긋나는 순간이 있으면 항목이 두 사람에게 중복되거나 아무의 체크리스트에도 없게 된다. 판정·이동·스냅샷·
--   감사·단계 재도출을 한 트랜잭션으로 처리한다(0047 선례). 서버는 사유 검사 + rpc + 오류 번역 +
--   (커밋 뒤) 오더 상태 동기화·단계 전환 알림·받는 사람 알림만 한다. 함수가 없으면 비원자 폴백 없이 거절한다.
--
-- 잠금 순서(교착 방지 — 바꾸지 않는다):
--   1) qc_jobs 행 — A·B 작업(있는 것만), id 오름차순   2) pct_orders 행   3) pct_order_assignees 행(for share)
--   4) pct_order_test_items 대상 행   5) 대상 이름의 qc_job_items 행
--   근거: 기존 함수들의 순서를 모두 만족하는 **하나의 전역 순서** qc_jobs < pct_orders < pct_order_assignees
--         < pct_order_test_items < qc_job_items 를 따른다.
--     · 0047/0048 cancel_job_start      : qc_jobs → pct_orders → qc_job_items
--     · 0048 recompute_job_stage·검토 RPC : qc_jobs → qc_job_items
--     · 0049 set_order_assignees·set_order_test_item_slot : pct_orders → pct_order_assignees → pct_order_test_items
--       (qc_jobs 는 읽기만 하고 잠그지 않는다)
--   오더를 먼저 잠그는 0049 방식을 이 함수에 그대로 쓰면 "pct_orders → qc_jobs" 가 되어 0047 과 역방향이 된다
--   (0047 이 작업을 잡고 오더를 기다리는 동안 이 함수가 오더를 잡고 작업을 기다리면 교착).
--   그래서 작업을 가장 먼저 잡되, 어떤 작업을 잡을지는 잠그기 전에 읽은 값으로 정하고, 오더·담당자 행을
--   잠근 뒤 다시 읽어 **그 사이 담당자·작업 구성이 바뀌었으면 거절**한다(잠금 뒤에 새 작업을 추가로 잠그면
--   순서가 깨지므로 잠그지 않고 거절한다). recompute_job_stage 는 이미 잡은 작업 행을 재진입하고
--   항목 행(전역 순서의 마지막)만 새로 잡으므로 순서를 어기지 않는다.
--   ⚠️ 트랜잭션 밖의 단일 INSERT 도 FK 검사로 부모 행 여러 개에 공유 잠금(key share)을 건다. notifications insert 는
--      related_order_id → related_qc_job_id 순서로 pct_orders → qc_jobs 를 잡으므로 이 함수(qc_jobs → pct_orders)와
--      **순환해 교착(40P01)이 날 수 있다**(0047 cancel_job_start 도 같다). 같은 이름 항목이 제3 작업에 있는 이상 데이터에서도
--      그 작업의 검토·재도출과 순환할 수 있다(어차피 거절될 요청). Postgres 가 한쪽을 중단하고 이 함수는 통째로 롤백되므로,
--      서버(backend/lib/rpcRetry.ts)가 40P01 이면 한 번 재시도하고, 그래도 실패하면 "잠시 후 다시 시도" 로 안내한다.
--
-- 상태 문자열은 이 함수 안에서만 리터럴로 쓴다.
-- ⚠️ types/qc-status.ts 와 반드시 같은 값이어야 한다. 그 파일의 값을 바꾸면 이 함수도 함께 바꾼다.
--    '진행중' IN_PROGRESS_STATUS · '지연' DELAYED_STATUS · '검토전' REVIEW_READY_STATUS · '검토중' REVIEWING_STATUS
--    (넷 = ITEM_EDITABLE_JOB_STATUSES) · '승인완료' APPROVED_STATUS(CLOSED_STAGE) · '삭제' DELETED_STATUS ·
--    'pending' ITEM_PENDING · 'in_progress' ITEM_IN_PROGRESS · 'cleared' ITEM_CLEARED · 'none' ITEM_REVIEW_NONE
-- ⚠️ 슬롯 상한 5 = types/assignment.ts MAX_PARALLEL_ASSIGNEES
--
-- 거절 메시지는 errcode P0001 로 던진다 — 서비스(backend/services/jobItemReassign.ts)가 메시지를 그대로 화면에 보여 준다.
--
-- 보안: 이 함수는 p_user_id 를 서버가 로그인 토큰에서 꺼내 넘긴다고 믿는다. 그래도 역할·시험자 연결은
--       users 에서 다시 읽어 판정한다(0048 의 관리자 재확인 방식). 실행 권한은 service_role(서버) 에만 준다.
--
-- 의존: 0003_auth.sql (users), 0010_pct_workflow.sql (pct_orders·qc_jobs·qc_job_items·pct_order_edits),
--       0027/0029 (pct_order_test_items·is_excluded), 0030 (elapsed_total_minutes), 0040 (started_at),
--       **0048_item_review.sql**(review_status·recompute_job_stage), **0049_parallel_assignment.sql**(pct_order_assignees·slot 1~5)
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent — 다시 실행해도 안전)
--    `supabase db push` 금지 — 0028 헤더의 경고 참조.
--    테이블 구조·기존 데이터 변경 없음(함수 1개·인덱스 1개·실행 권한).
--    인덱스 생성 동안 qc_job_items 쓰기가 잠시 막힌다 — 업무 시간 외에 적용한다.
--    적용 전에는 항목별 [담당자 변경]·[넘기기] 가 "DB 설치(0050 마이그레이션)가 아직 적용되지 않았습니다" 로 거절된다.
--    배포 순서: SQL 0048 → 0049 → 0050 적용 → 앱 배포 → 0049 맨 끝 재동기화 블록 실행.
--    파일 전체를 한 트랜잭션(begin … commit)으로 감쌌다.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ⓪ 의존 확인 — 0048·0049 가 없으면 적용 자체를 중단한다(트랜잭션 전체가 롤백된다).
do $$
begin
  if to_regprocedure('public.recompute_job_stage(uuid, uuid, text)') is null
     or to_regclass('public.pct_order_assignees') is null
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'qc_job_items' and column_name = 'review_status') then
    raise exception '0048_item_review.sql·0049_parallel_assignment.sql 을 먼저 적용하세요.';
  end if;
end
$$;


-- ⓪' 설계 초안의 5인자 시그니처(p_to_tester_id uuid)가 먼저 적용된 환경이면 옛 오버로드를 지운다(없으면 무시).
drop function if exists reassign_job_item(uuid, text, uuid, uuid, text);


-- ① 이름 매칭 조회 인덱스 — 이 함수와 동시분석 그룹 일괄 조작이 (작업, 항목명)으로 찾는다.
create index if not exists idx_qc_job_items_job_name
  on qc_job_items(qc_job_id, test_item_name);


-- ② 항목 담당자 변경 ─────────────────────────────────────────────────────────
-- 판정 순서(spec §3):
--   0 입력(사유·항목명·슬롯) → 1 요청자(users 재확인)
--   → [잠금 전 읽기: 두 슬롯의 담당자·작업 → 작업 행 잠금(id 오름차순)]
--   → 2 오더(잠금): 존재·삭제·승인완료 → 3 담당자 행(잠금): 받는 슬롯 존재·보내는 슬롯 존재·권한·받는 사람 활성
--   → 4 잠금 전 읽기와 같은가(담당자·작업) → 5 오더에 작업 1건 이상 → 6 작업 단계(A 편집 가능·B 받을 수 있음)
--   → 7 스냅샷 행(잠금): 존재·제외 아님·현재 슬롯 = 기대 슬롯(F2-7)
--   → 8 항목 행(잠금): 중복·B 에 같은 이름·A 작업에 있음·흔적 0·마지막 항목 아님
--   → 이동/삭제/추가 + 스냅샷 → 감사 → 단계 재도출 → 반환
-- 반환: { orderId, productName, batchNo, testItemName, mode,
--         from:{slot,testerId,testerName,jobId,qcNo}, to:{slot,testerId,testerName,jobId,qcNo,userId},
--         stages:{from: recompute_job_stage 반환 | null, to: … | null} }
create or replace function reassign_job_item(
  p_order_id uuid, p_test_item_name text, p_expected_from_slot int, p_to_slot int,
  p_user_id uuid, p_reason text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_name             text := p_test_item_name;
  v_role             text;
  v_user_tester      uuid;
  v_is_admin         boolean;
  v_pre_from_tester  uuid;
  v_pre_to_tester    uuid;
  v_pre_from_job     uuid;
  v_pre_to_job       uuid;
  v_lock_ids         uuid[];
  v_lock_id          uuid;
  v_order            pct_orders%rowtype;
  v_from_tester      uuid;
  v_to_tester        uuid;
  v_from_name        text;
  v_to_name          text;
  v_to_active        boolean;
  v_from_job         qc_jobs%rowtype;
  v_to_job           qc_jobs%rowtype;
  v_has_from_job     boolean;
  v_has_to_job       boolean;
  v_snap             pct_order_test_items%rowtype;
  v_item             qc_job_items%rowtype;
  v_has_item         boolean := false;
  v_in_from_cnt      int := 0;
  v_in_to_cnt        int := 0;
  v_other_cnt        int := 0;
  v_remaining        int;
  v_mode             text;
  v_note             text;
  v_stage_from       jsonb := null;
  v_stage_to         jsonb := null;
  v_to_user          uuid;
begin
  -- 0 입력 ────────────────────────────────────────────────────────────────
  if p_reason is null then
    raise exception '담당자 변경 사유를 입력해 주세요.' using errcode = 'P0001';
  end if;
  if length(btrim(p_reason)) < 2 then
    raise exception '담당자 변경 사유를 2자 이상 입력해 주세요.' using errcode = 'P0001';
  end if;
  if v_name is null or btrim(v_name) = '' then
    raise exception '시험항목을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;
  -- ⚠️ 5 = types/assignment.ts MAX_PARALLEL_ASSIGNEES
  if p_expected_from_slot is null or p_expected_from_slot < 1 or p_expected_from_slot > 5
     or p_to_slot is null or p_to_slot < 1 or p_to_slot > 5 then
    raise exception '담당자 번호는 1~5 사이여야 합니다.' using errcode = 'P0001';
  end if;
  if p_expected_from_slot = p_to_slot then
    raise exception '현재 담당자와 같은 사람에게는 넘길 수 없습니다.' using errcode = 'P0001';
  end if;

  -- 1 요청자 — 서버가 넘긴 id 라도 역할·시험자 연결은 DB 에서 다시 읽는다(비활성 계정 거절)
  select role::text, tester_id into v_role, v_user_tester
    from users where id = p_user_id and is_active;
  if not found then
    raise exception '로그인 사용자를 확인할 수 없습니다. 다시 로그인해 주세요.' using errcode = 'P0001';
  end if;
  v_is_admin := (v_role = 'admin');

  -- 잠금 전 읽기 — 어떤 작업 행을 잠글지 정한다(잠금 뒤 4 에서 다시 확인)
  select tester_id into v_pre_from_tester
    from pct_order_assignees where order_id = p_order_id and slot = p_expected_from_slot;
  select tester_id into v_pre_to_tester
    from pct_order_assignees where order_id = p_order_id and slot = p_to_slot;
  if v_pre_from_tester is not null then
    select id into v_pre_from_job
      from qc_jobs where order_id = p_order_id and assignee_tester_id = v_pre_from_tester;
  end if;
  if v_pre_to_tester is not null then
    select id into v_pre_to_job
      from qc_jobs where order_id = p_order_id and assignee_tester_id = v_pre_to_tester;
  end if;

  -- 잠금 ① 작업 행 — id 오름차순(두 요청이 같은 두 작업을 반대 순서로 잡지 않게)
  v_lock_ids := array(
    select x from unnest(array[v_pre_from_job, v_pre_to_job]) as x
     where x is not null order by x);
  foreach v_lock_id in array v_lock_ids loop
    perform 1 from qc_jobs where id = v_lock_id for update;
  end loop;

  -- 2 오더 (잠금 ②) — LOCK(locked) 은 보지 않는다(일정 자동변경 금지이지 실행 금지가 아니다)
  select * into v_order from pct_orders where id = p_order_id for update;
  if not found then
    raise exception '오더를 찾을 수 없습니다.' using errcode = 'P0001';
  end if;
  if v_order.status = '삭제' then
    raise exception '삭제된 오더의 시험항목은 담당자를 변경할 수 없습니다.' using errcode = 'P0001';
  end if;
  if v_order.status = '승인완료' then
    raise exception '승인완료된 오더의 시험항목은 담당자를 변경할 수 없습니다.' using errcode = 'P0001';
  end if;

  -- 3 담당자 행 (잠금 ③, 공유 잠금 — 읽기만 하되 그 사이 빠지지 않게)
  perform 1 from pct_order_assignees where order_id = p_order_id for share;

  select a.tester_id, t.name, t.is_active into v_to_tester, v_to_name, v_to_active
    from pct_order_assignees a left join testers t on t.id = a.tester_id
   where a.order_id = p_order_id and a.slot = p_to_slot;
  if v_to_tester is null then
    raise exception '같은 오더에 병렬 배정된 담당자에게만 넘길 수 있습니다.' using errcode = 'P0001';
  end if;

  select a.tester_id, t.name into v_from_tester, v_from_name
    from pct_order_assignees a left join testers t on t.id = a.tester_id
   where a.order_id = p_order_id and a.slot = p_expected_from_slot;
  if v_from_tester is null then
    raise exception '그 사이 담당자가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.' using errcode = 'P0001';
  end if;

  -- 권한: 관리자 또는 보내는 슬롯의 담당자 본인(받는 사람의 가져오기·그룹 밖 사람은 거절)
  if not v_is_admin and v_user_tester is distinct from v_from_tester then
    raise exception '본인 시험항목만 넘길 수 있습니다.' using errcode = 'P0001';
  end if;

  if not coalesce(v_to_active, false) then
    raise exception '비활성 시험자(%)에게는 배정할 수 없습니다.', coalesce(v_to_name, '이름 없음') using errcode = 'P0001';
  end if;

  -- 4 잠금 전 읽기와 같은가 — 담당자 교체·작업 시작/취소가 끼어들었으면 거절(잠금 순서를 깨고 새로 잠그지 않는다)
  select * into v_from_job from qc_jobs where order_id = p_order_id and assignee_tester_id = v_from_tester;
  v_has_from_job := found;
  select * into v_to_job from qc_jobs where order_id = p_order_id and assignee_tester_id = v_to_tester;
  v_has_to_job := found;

  if v_from_tester is distinct from v_pre_from_tester
     or v_to_tester is distinct from v_pre_to_tester
     or v_from_job.id is distinct from v_pre_from_job
     or v_to_job.id is distinct from v_pre_to_job then
    raise exception '다른 사용자가 먼저 변경했습니다. 새로고침 후 다시 시도하세요.' using errcode = 'P0001';
  end if;

  -- 시험자는 자기가 시작한 작업의 항목만(qcJobs.assertOwner 와 같은 기준)
  if not v_is_admin and v_has_from_job and v_from_job.assignee_user_id is distinct from p_user_id then
    raise exception '본인 시험항목만 넘길 수 있습니다.' using errcode = 'P0001';
  end if;

  -- 5 작업이 시작된 오더만 — 시작 전 배분은 오더 수정의 일괄 배분(set_order_test_item_slot)이 맡는다(F3-7)
  if not exists (select 1 from qc_jobs where order_id = p_order_id) then
    raise exception '작업이 시작되지 않은 오더는 오더 수정의 시험항목 배분에서 담당자를 바꾸세요.' using errcode = 'P0001';
  end if;

  -- 6 작업 단계 — ITEM_EDITABLE_JOB_STATUSES = 진행중·지연·검토전·검토중
  if v_has_from_job and v_from_job.status not in ('진행중', '지연', '검토전', '검토중') then
    raise exception '"%" 단계의 작업은 시험항목을 변경할 수 없습니다.', v_from_job.status using errcode = 'P0001';
  end if;
  if v_has_to_job and v_to_job.status not in ('진행중', '지연', '검토전', '검토중') then
    raise exception '받는 담당자의 작업(QC %)이 "%" 단계라 시험항목을 받을 수 없습니다.', v_to_job.qc_no, v_to_job.status
      using errcode = 'P0001';
  end if;

  -- 7 스냅샷 행 (잠금 ④)
  select * into v_snap
    from pct_order_test_items
   where order_id = p_order_id and test_item_name = v_name
   for update;
  if not found then
    raise exception '오더 시험항목 배분 정보가 없어 담당자를 변경할 수 없습니다. 관리자에게 확인을 요청하세요.' using errcode = 'P0001';
  end if;
  if coalesce(v_snap.is_excluded, false) then
    raise exception '제외된 시험항목은 담당자를 바꿀 수 없습니다.' using errcode = 'P0001';
  end if;
  if v_snap.assignee_slot is distinct from p_expected_from_slot then
    raise exception '그 사이 담당자가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.' using errcode = 'P0001';
  end if;

  -- 8 항목 행 (잠금 ⑤) — 이 오더의 모든 작업에서 같은 이름의 행을 잠근다(동시 항목 시작·완료는 여기서 대기)
  perform 1 from qc_job_items
   where test_item_name = v_name
     and qc_job_id in (select id from qc_jobs where order_id = p_order_id)
   for update;

  if v_has_from_job then
    select count(*) into v_in_from_cnt
      from qc_job_items where qc_job_id = v_from_job.id and test_item_name = v_name;
    select * into v_item
      from qc_job_items where qc_job_id = v_from_job.id and test_item_name = v_name
     order by created_at limit 1;
    v_has_item := found;
  end if;
  if v_has_to_job then
    select count(*) into v_in_to_cnt
      from qc_job_items where qc_job_id = v_to_job.id and test_item_name = v_name;
  end if;
  select count(*) into v_other_cnt
    from qc_job_items i
    join qc_jobs j on j.id = i.qc_job_id
   where j.order_id = p_order_id
     and i.test_item_name = v_name
     and i.qc_job_id is distinct from v_from_job.id
     and i.qc_job_id is distinct from v_to_job.id;

  if v_in_from_cnt > 1 or v_other_cnt > 0 then
    raise exception '같은 이름의 시험항목이 여러 담당자 작업에 있어 변경할 수 없습니다. 관리자에게 확인을 요청하세요.' using errcode = 'P0001';
  end if;
  if v_in_to_cnt > 0 then
    raise exception '받는 담당자의 작업에 같은 이름의 시험항목이 이미 있습니다. 관리자에게 확인을 요청하세요.' using errcode = 'P0001';
  end if;
  -- 보내는 담당자가 작업을 시작했는데 체크리스트에 이 항목이 없다 = 배분과 체크리스트가 이미 어긋난 데이터
  if v_has_from_job and not v_has_item then
    raise exception '보내는 담당자의 작업에 이 시험항목이 없어 변경할 수 없습니다. 관리자에게 확인을 요청하세요.' using errcode = 'P0001';
  end if;

  if v_has_item then
    -- 실행 흔적 0 (0047 과 같은 기준) + 검토 흔적 0
    if v_item.status = 'in_progress' then
      raise exception '진행 중인 시험항목은 넘길 수 없습니다. 시작 취소 후 다시 시도해 주세요.' using errcode = 'P0001';
    end if;
    if v_item.status = 'cleared' then
      raise exception '이미 완료된 시험항목은 넘길 수 없습니다.' using errcode = 'P0001';
    end if;
    if v_item.status is distinct from 'pending'
       or v_item.started_at is not null or v_item.cleared_at is not null
       or v_item.elapsed_minutes is not null or v_item.elapsed_total_minutes is not null then
      raise exception '시작·완료 기록이 남아 있는 시험항목은 넘길 수 없습니다. 관리자에게 확인을 요청하세요.' using errcode = 'P0001';
    end if;
    if v_item.review_status is distinct from 'none' then
      raise exception '검토 기록이 있는 시험항목은 넘길 수 없습니다.' using errcode = 'P0001';
    end if;

    select count(*) into v_remaining
      from qc_job_items where qc_job_id = v_from_job.id and id <> v_item.id;
    if v_remaining = 0 then
      raise exception '마지막 항목은 넘길 수 없습니다. 작업 시작 취소 후 배분하세요.' using errcode = 'P0001';
    end if;
  end if;

  -- 쓰기 ─────────────────────────────────────────────────────────────────
  if v_has_item and v_has_to_job then
    -- (A 有, B 有) 행 이동 — id·sequence_order 유지
    update qc_job_items set qc_job_id = v_to_job.id where id = v_item.id;
    v_mode := 'moved';
  elsif v_has_item then
    -- (A 有, B 無) 흔적 0 행 삭제 — B 가 [작업 시작] 할 때 스냅샷으로 포함된다
    delete from qc_job_items where id = v_item.id;
    v_mode := 'released';
  elsif v_has_to_job then
    -- (A 無, B 有) B 체크리스트에 pending 행 추가 — status·review_status 는 기본값(pending·none)
    insert into qc_job_items (qc_job_id, test_item_id, test_item_name, sequence_order)
    values (v_to_job.id, v_snap.test_item_id, v_snap.test_item_name, v_snap.sequence_order);
    v_mode := 'attached';
  else
    -- (A 無, B 無) 스냅샷만
    v_mode := 'snapshot';
  end if;

  update pct_order_test_items set assignee_slot = p_to_slot where id = v_snap.id;

  -- 감사 — 항목당 1행, 사람 이름과 QC번호(작업 없으면 미시작)로 남긴다(번호 라벨만으로는 담당자가 바뀐 뒤 추적이 끊긴다)
  insert into pct_order_edits (order_id, field, old_value, new_value, reason, edited_by)
  values (
    p_order_id, 'testItemAssignee',
    v_name || ': ' || coalesce(v_from_name, '이름 없음')
      || case when v_has_from_job then '(QC ' || v_from_job.qc_no || ')' else '(미시작)' end,
    v_name || ': ' || coalesce(v_to_name, '이름 없음')
      || case when v_has_to_job then '(QC ' || v_to_job.qc_no || ')' else '(미시작)' end,
    btrim(p_reason), p_user_id);

  -- 단계 재도출 (같은 트랜잭션 — 바뀌면 qc_job_status_history(source auto)도 함수가 남긴다)
  v_note := format('시험항목 "%s" 담당자 변경으로 서버가 자동 전환했습니다.', v_name);
  if v_has_from_job then
    v_stage_from := recompute_job_stage(v_from_job.id, p_user_id, v_note);
  end if;
  if v_has_to_job then
    v_stage_to := recompute_job_stage(v_to_job.id, p_user_id, v_note);
  end if;

  -- 받는 사람 알림 대상(F2-3) — 작업을 시작한 계정, 없으면 그 시험자에 연결된 활성 계정
  v_to_user := case when v_has_to_job then v_to_job.assignee_user_id end;
  if v_to_user is null then
    select id into v_to_user from users where tester_id = v_to_tester and is_active order by id limit 1;
  end if;

  return jsonb_build_object(
    'orderId',      p_order_id,
    'productName',  v_order.product_name,
    'batchNo',      v_order.batch_no,
    'testItemName', v_name,
    'mode',         v_mode,
    'from', jsonb_build_object(
      'slot', p_expected_from_slot, 'testerId', v_from_tester, 'testerName', v_from_name,
      'jobId', v_from_job.id, 'qcNo', v_from_job.qc_no),
    'to', jsonb_build_object(
      'slot', p_to_slot, 'testerId', v_to_tester, 'testerName', v_to_name,
      'jobId', v_to_job.id, 'qcNo', v_to_job.qc_no, 'userId', v_to_user),
    'stages', jsonb_build_object('from', v_stage_from, 'to', v_stage_to)
  );
end;
$$;

comment on function reassign_job_item(uuid, text, int, int, uuid, text) is
  '진행 중 시험항목 담당자 변경(원자적, 0050). 잠금: qc_jobs(id 오름차순) → pct_orders → pct_order_assignees(share) → pct_order_test_items → qc_job_items. 네 경우(행 이동·삭제·추가·스냅샷만) + 스냅샷 슬롯 + pct_order_edits(testItemAssignee) 감사 + A·B recompute_job_stage. service_role 전용.';


-- ③ 실행 권한 — 서버(service_role)에만. 사용자 id 를 받는 함수다. ─────────────
revoke all on function reassign_job_item(uuid, text, int, int, uuid, text) from public, anon, authenticated;
grant execute on function reassign_job_item(uuid, text, int, int, uuid, text) to service_role;

commit;

notify pgrst, 'reload schema';
