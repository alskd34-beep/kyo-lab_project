-- ─────────────────────────────────────────────────────────────────────────────
-- 동시분석 그룹 단계 일괄 진행 — group_review_apply(내부)
--                               + group_item_review_action / group_item_review_bulk_action
--
-- 배경: 동시분석 그룹은 여러 배치를 함께 시험하는 묶음인데, 관리자 쪽 검토는 배치 하나씩이었다.
--       같은 시험항목의 검토 시작·검토 완료를 배치 수(병렬 배정이면 담당자별 작업 수)만큼 반복했다.
--       이제 한 배치에서 누른 검토를 **조작 시점의 그룹 구성** 전 배치에 같은 판정으로 적용한다.
--       규칙 전문: intent/2026-09-15-group-stage-progress-spec.md (감독 결정 temp/decisions-t1-t3.md 「T1」)
--
-- 전파하는 것: 항목 검토 시작·완료(그룹, 항목명) · 그룹 일괄 검토 시작(완료 항목 전체)/완료(검토 중 항목 전체).
-- 전파하지 않는 것: 검토 취소·재실시·관리자 직접 변경(배치별 사정·사유가 다른 정정).
-- 그룹 승인은 DB 함수가 아니다 — 서버(TS)가 배치마다 기존 승인 경로를 부른다(원자적이지 않음, spec §6).
--
-- 부분 불충족: 조건이 맞지 않는 (작업, 항목)은 **건너뛰고 계속**, 사유를 skipped[] 로 돌려준다.
--   처리 0건이면 "처리할 시험항목이 없습니다." 로 거절. DB 오류는 전체 롤백(함수 본문 = 한 트랜잭션).
--
-- 규칙 두 벌 금지: 항목 갱신·검토 이력은 0048 apply_item_review_step, 단계 재도출·상태 이력은 0048
--   recompute_job_stage 를 그대로 부른다. 이 파일의 사전 판정(skip)은 apply_item_review_step 의 전제 검사와
--   같은 조건이며, 그 함수가 거절하면(규칙 불일치 버그) 그룹 전체가 롤백된다.
--
-- GMP: 검토 이력은 처리한 (작업, 항목)마다 1행(배치의 qc_job_id·order_id·qc_no, 요청 관리자) — "그룹 1건" 기록은 없다.
--      단계 이력은 단계가 실제로 바뀐 작업마다 1행(source auto).
--
-- 잠금 순서(교착 방지 — 바꾸지 않는다):
--   1) 그룹의 모든 qc_jobs 행 — id 오름차순, 하나씩
--   2) 잠근 작업마다 그 작업의 qc_job_items 행
--   전역 순서 qc_jobs < pct_orders < pct_order_assignees < pct_order_test_items < qc_job_items (0050) 를 따른다.
--   작업 행을 **모두** 잡은 뒤에 항목 행을 잡으므로, 항목을 쥔 채 작업 행을 기다리지 않는다.
--   recompute_job_stage 는 이미 잡은 작업·항목 행을 재진입한다(새 잠금 없음).
--   그룹 테이블(concurrent_analysis_group_items)은 잠그지 않는다 — 함수 시작 시점 구성으로 처리한다(spec §5.4).
--   ⚠️ 트랜잭션 밖 notifications insert 의 FK 공유 잠금과 순환해 40P01 이 날 수 있다(0050 헤더 참조).
--      서버(backend/lib/rpcRetry.ts)가 한 번 재시도한다.
--
-- 상태 문자열은 이 파일 안에서만 리터럴로 쓴다.
-- ⚠️ types/qc-status.ts 와 반드시 같은 값이어야 한다.
--    '승인완료' APPROVED_STATUS(CLOSED_STAGE) · 'cleared' ITEM_CLEARED ·
--    'none' ITEM_REVIEW_NONE · 'reviewing' ITEM_REVIEW_REVIEWING · 'reviewed' ITEM_REVIEW_REVIEWED ·
--    'review_start'·'review_complete' ITEM_REVIEW_BULK_ACTIONS
-- ⚠️ skipped 사유 문자열은 spec §3 전문과 같아야 한다.
--
-- 거절 메시지는 errcode P0001 — 서비스(backend/services/qcJobGroupStage.ts)가 메시지를 그대로 화면에 보여 준다.
--
-- 보안: p_user_id 는 서버가 로그인 토큰에서 꺼내 넘긴다고 믿되, 역할은 users 에서 다시 확인한다(0048 방식).
--       실행 권한은 service_role(서버)에만 준다.
--
-- 의존: 0013_concurrent_groups.sql (concurrent_analysis_groups·_items), 0010_pct_workflow.sql (qc_jobs·qc_job_items·pct_orders),
--       **0048_item_review.sql** (review_status·apply_item_review_step·recompute_job_stage)
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent — 다시 실행해도 안전)
--    `supabase db push` 금지 — 0028 헤더의 경고 참조.
--    테이블 구조·기존 데이터 변경 없음(함수 3개·실행 권한).
--    적용 전에는 그룹 검토가 "DB 설치(0051 마이그레이션)가 아직 적용되지 않았습니다" 로 거절된다
--    (배치 단건 검토·승인과 그룹 승인은 영향 없음).
--    배포 순서: SQL 0051 적용 → 앱 배포.
--    파일 전체를 한 트랜잭션(begin … commit)으로 감쌌다.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ⓪ 의존 확인 — 0048 이 없으면 적용 자체를 중단한다(트랜잭션 전체가 롤백된다).
do $$
begin
  if to_regprocedure('public.apply_item_review_step(uuid, text, uuid, text, text)') is null
     or to_regprocedure('public.recompute_job_stage(uuid, uuid, text)') is null
     or to_regclass('public.concurrent_analysis_group_items') is null
     or not exists (
       select 1 from information_schema.columns
        where table_schema = 'public' and table_name = 'qc_job_items' and column_name = 'review_status') then
    raise exception '0048_item_review.sql 을 먼저 적용하세요.';
  end if;
end
$$;


-- ① 그룹 검토 본문 (내부용) ────────────────────────────────────────────────────
-- p_test_item_name 이 null 이면 일괄(검토 시작 = cleared+none 항목 전부 / 검토 완료 = reviewing 항목 전부),
-- 아니면 그 이름의 항목만.
-- 판정 순서(spec §4·§3): 0 동작 값 → 0' 항목명 → 1 관리자 → 2 그룹 존재 → 3 오더 2건 이상
--   → [작업 id 오름차순 잠금] → 작업마다 [항목 잠금 → S1~S7 판정 → apply_item_review_step → recompute_job_stage]
--   → 4 처리 0건 거절
-- 반환: { groupId, action, testItemName, count, processed[], skipped[], stages[] }
create or replace function group_review_apply(
  p_group_id uuid, p_test_item_name text, p_user_id uuid, p_action text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_bulk       boolean := p_test_item_name is null;
  v_name       text;
  v_role       text;
  v_actor_name text;
  v_order_ids  uuid[];
  v_job_ids    uuid[];
  v_job_id     uuid;
  v_job        qc_jobs%rowtype;
  v_batch_no   text;
  v_item       record;
  v_reason     text;
  v_step       jsonb;
  v_job_count  int;
  v_processed  jsonb := '[]'::jsonb;
  v_skipped    jsonb := '[]'::jsonb;
  v_stages     jsonb := '[]'::jsonb;
  v_total      int := 0;
  v_verb       text;
  v_note       text;
begin
  -- 0 동작 값 (단건 문구와 같다)
  if p_action is null or p_action not in ('review_start', 'review_complete') then
    raise exception '알 수 없는 검토 동작입니다.' using errcode = 'P0001';
  end if;

  -- 0' 항목명 (항목 단위만)
  if not v_bulk then
    v_name := btrim(p_test_item_name);
    if v_name = '' then
      raise exception '시험항목명을 입력해 주세요.' using errcode = 'P0001';
    end if;
  end if;

  -- 1 관리자 (라우트 requireAdmin 을 DB 에서 한 번 더)
  select role::text, coalesce(display_name, username) into v_role, v_actor_name
    from users where id = p_user_id and is_active;
  if v_role is distinct from 'admin' then
    raise exception '관리자만 시험항목을 검토할 수 있습니다.' using errcode = 'P0001';
  end if;

  -- 2 그룹 존재
  if not exists (select 1 from concurrent_analysis_groups where id = p_group_id) then
    raise exception '동시분석 그룹을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;

  -- 3 조작 시점의 그룹 구성 — 오더 2건 이상
  select coalesce(array_agg(order_id), '{}'::uuid[]) into v_order_ids
    from concurrent_analysis_group_items where group_id = p_group_id;
  if coalesce(array_length(v_order_ids, 1), 0) < 2 then
    raise exception '동시분석 그룹에 배치가 2건 이상일 때만 그룹으로 처리할 수 있습니다.' using errcode = 'P0001';
  end if;

  -- 그 오더들의 모든 작업(담당자 무관) — 잠그기 전에 id 오름차순으로 정한다
  v_job_ids := array(select id from qc_jobs where order_id = any(v_order_ids) order by id);

  -- 잠금 ① 작업 행 전부 — id 오름차순, 하나씩 (다른 그룹 조작·F2 와 같은 방향)
  foreach v_job_id in array v_job_ids loop
    perform 1 from qc_jobs where id = v_job_id for update;
  end loop;

  v_verb := case when p_action = 'review_start' then '검토 시작으로' else '검토 완료로' end;

  foreach v_job_id in array v_job_ids loop
    select * into v_job from qc_jobs where id = v_job_id;
    -- S1 잠그려는 사이 작업 시작 취소(0047)로 사라짐
    if not found then
      v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
        'jobId', v_job_id, 'qcNo', null, 'batchNo', null,
        'testItemName', v_name, 'reason', '작업이 삭제되었습니다'));
      continue;
    end if;

    select batch_no into v_batch_no from pct_orders where id = v_job.order_id;

    -- 잠금 ② 이 작업의 항목 행 전부
    perform 1 from qc_job_items where qc_job_id = v_job_id for update;

    v_job_count := 0;
    for v_item in
      select id, test_item_name, status, review_status
        from qc_job_items
       where qc_job_id = v_job_id
         and case
               when not v_bulk then test_item_name = v_name
               when p_action = 'review_start' then status = 'cleared' and review_status = 'none'
               else review_status = 'reviewing'
             end
       order by sequence_order, created_at
    loop
      -- S2(대상 없음)는 루프가 돌지 않는 것으로 조용히 건너뛴다.
      v_reason := null;
      if v_job.status = '승인완료' then
        v_reason := '승인완료 작업';                                         -- S3
      elsif p_action = 'review_start' then
        if v_item.status is distinct from 'cleared' then
          v_reason := '시험이 끝나지 않음';                                   -- S4
        elsif v_item.review_status = 'reviewing' then
          v_reason := '이미 검토 중';                                         -- S5
        elsif v_item.review_status = 'reviewed' then
          v_reason := '이미 검토 완료';                                       -- S6
        end if;
      else
        if v_item.review_status = 'reviewed' then
          v_reason := '이미 검토 완료';                                       -- S6
        elsif v_item.review_status is distinct from 'reviewing' then
          v_reason := '검토를 시작하지 않음';                                 -- S7
        end if;
      end if;

      if v_reason is not null then
        v_skipped := v_skipped || jsonb_build_array(jsonb_build_object(
          'jobId', v_job.id, 'qcNo', v_job.qc_no, 'batchNo', v_batch_no,
          'testItemName', v_item.test_item_name, 'reason', v_reason));
        continue;
      end if;

      -- 항목 갱신 + 검토 이력 1행(배치별) — 0048 과 같은 규칙
      v_step := apply_item_review_step(v_item.id, p_action, p_user_id, v_actor_name, null);
      v_processed := v_processed || jsonb_build_array(v_step || jsonb_build_object(
        'jobId', v_job.id, 'orderId', v_job.order_id, 'qcNo', v_job.qc_no, 'batchNo', v_batch_no));
      v_job_count := v_job_count + 1;
    end loop;

    -- 건드린 작업마다 단계 재도출 1회 (바뀌면 상태 이력도 여기서)
    if v_job_count > 0 then
      v_total := v_total + v_job_count;
      v_note := case
        when v_bulk then format('시험항목 %s개 %s 서버가 자동 전환했습니다. (동시분석 그룹 일괄)', v_job_count, v_verb)
        else format('시험항목 "%s" %s 서버가 자동 전환했습니다. (동시분석 그룹 일괄)', v_name, v_verb)
      end;
      v_stages := v_stages || jsonb_build_array(recompute_job_stage(v_job_id, p_user_id, v_note));
    end if;
  end loop;

  -- 4 처리 0건 — 아무것도 쓰지 않았다
  if v_total = 0 then
    raise exception '처리할 시험항목이 없습니다.' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'groupId',      p_group_id,
    'action',       p_action,
    'testItemName', v_name,
    'count',        v_total,
    'processed',    v_processed,
    'skipped',      v_skipped,
    'stages',       v_stages);
end;
$$;

comment on function group_review_apply(uuid, text, uuid, text) is
  '내부용: 동시분석 그룹 검토 본문. 잠금: 그룹 qc_jobs(id 오름차순) → 작업별 qc_job_items. 배치별 판정 뒤 apply_item_review_step·recompute_job_stage 재사용, 부분 불충족은 skipped. service_role 전용.';


-- ② 그룹 항목 검토 시작·완료 (한 트랜잭션) ────────────────────────────────────
create or replace function group_item_review_action(
  p_group_id uuid, p_test_item_name text, p_user_id uuid, p_action text
)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  -- null 이면 내부 함수가 일괄로 읽으므로 여기서 빈 문자열로 바꿔 항목명 거절(0')로 보낸다.
  return group_review_apply(p_group_id, coalesce(p_test_item_name, ''), p_user_id, p_action);
end;
$$;

comment on function group_item_review_action(uuid, text, uuid, text) is
  '동시분석 그룹의 같은 이름 시험항목 검토 시작·완료(원자적, 조건 불충족 배치는 skipped). 잠금: qc_jobs(id 오름차순) → qc_job_items. service_role 전용.';


-- ③ 그룹 일괄 검토 (완료 항목 전체 검토 시작 / 검토 중 항목 전체 검토 완료, 한 트랜잭션) ──────
create or replace function group_item_review_bulk_action(p_group_id uuid, p_user_id uuid, p_action text)
returns jsonb
language plpgsql
set search_path = public
as $$
begin
  return group_review_apply(p_group_id, null, p_user_id, p_action);
end;
$$;

comment on function group_item_review_bulk_action(uuid, uuid, text) is
  '동시분석 그룹 전 배치의 완료 항목 전체 검토 시작 / 검토 중 항목 전체 검토 완료(원자적). 잠금: qc_jobs(id 오름차순) → qc_job_items. service_role 전용.';


-- ④ 실행 권한 — 서버(service_role)에만 ─────────────────────────────────────────
revoke all on function group_review_apply(uuid, text, uuid, text)          from public, anon, authenticated;
revoke all on function group_item_review_action(uuid, text, uuid, text)    from public, anon, authenticated;
revoke all on function group_item_review_bulk_action(uuid, uuid, text)     from public, anon, authenticated;

grant execute on function group_review_apply(uuid, text, uuid, text)       to service_role;
grant execute on function group_item_review_action(uuid, text, uuid, text) to service_role;
grant execute on function group_item_review_bulk_action(uuid, uuid, text)  to service_role;

commit;

notify pgrst, 'reload schema';
