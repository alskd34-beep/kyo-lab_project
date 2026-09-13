-- ─────────────────────────────────────────────────────────────────────────────
-- 작업 시작 취소를 한 트랜잭션으로 — cancel_job_start(p_job_id, p_user_id, p_reason)
--
-- 배경: 시험자가 잘못 누른 [작업 시작] 을 되돌린다. 되돌리기는 qc_jobs 행 삭제(원복)이고
--       시험항목 체크리스트(qc_job_items)는 on delete cascade 로 함께 지워진다.
--       감사 기록은 작업과 함께 사라지지 않는 pct_order_edits 에 남긴다.
--       규칙 전문: intent/2026-09-13-tester-cancel-job-start-spec.md
--
-- 왜 함수인가: 앱에서 Supabase 호출을 여러 번 나눠 하면 트랜잭션이 없다.
--   · "전 항목 미실행" 검사 뒤, 삭제 전에 들어온 항목 시작·완료 기록이 삭제와 함께 사라질 수 있고
--   · 감사 기록만 남고 취소는 안 되거나(롤백 실패), 취소는 됐는데 감사 기록이 지워질 수 있으며
--   · 오더 상태 산정과 쓰기 사이에 다른 담당자의 시작·오더 삭제가 끼어들 수 있다.
--   "실측시간은 어떤 경우에도 지우지 않는다" 와 "감사 기록이 없으면 취소도 없다"(GMP/ALCOA+)를
--   **보장**하려면 검사·감사·삭제·오더 상태가 한 트랜잭션이어야 한다. 함수 본문 전체가 한 트랜잭션이다.
--
-- 잠금 순서(교착 방지 — 이 순서를 바꾸지 않는다):
--   1) qc_jobs 행  2) pct_orders 행  3) 그 작업의 qc_job_items 행 전부
--   3) 이 핵심이다. 동시에 들어온 항목 시작·완료 UPDATE 는 이 트랜잭션이 끝날 때까지 대기하고,
--   끝난 뒤에는 행이 이미 지워져 0행 갱신이 된다. 항목 쓰기가 먼저 커밋됐다면 잠근 뒤의 검사가
--   그것을 보고 거절한다. 어느 순서든 기록된 실적이 지워지는 경우는 없다.
--
-- 상태 문자열('진행중'·'대기'·'삭제'·'pending')은 이 함수 안에서만 리터럴로 쓴다.
-- ⚠️ types/qc-status.ts (IN_PROGRESS_STATUS · PENDING_STATUS · DELETED_STATUS · ITEM_PENDING) 와
--    반드시 같은 값이어야 한다. 그 파일의 값을 바꾸면 이 함수도 함께 바꾼다.
--
-- 거절 메시지는 errcode P0001 로 던진다 — 서비스(cancelJobStart)가 메시지를 그대로 화면에 보여 준다.
--
-- 보안: 이 함수는 p_user_id 를 그대로 믿는다. anon/authenticated 가 PostgREST 로 부르면 남의 작업을
--       지울 수 있으므로 실행 권한은 service_role(서버) 에만 준다. 사용자 id 는 서버가 토큰에서 꺼내 넘긴다.
--
-- 의존: 0010_pct_workflow.sql (pct_orders·qc_jobs·qc_job_items·pct_order_edits),
--       0030_qc_item_elapsed_from_start.sql (qc_job_items.elapsed_total_minutes),
--       0040_qc_job_item_start.sql (qc_job_items.started_at)
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent)
--    `supabase db push` 금지 — 0028 헤더의 경고 참조.
--    적용 전에는 화면의 [시작 취소] 가 "DB 설치(0047 마이그레이션)가 아직 적용되지 않았습니다" 로 거절된다.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function cancel_job_start(p_job_id uuid, p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_job           qc_jobs%rowtype;
  v_order         pct_orders%rowtype;
  v_item_count    int;
  v_touched_count int;
  v_remaining     int;
  v_status_after  text;
begin
  -- 사유 2자 검사는 서비스가 먼저 한다. 여기서는 비어 있는 호출만 막는다.
  if p_reason is null or length(btrim(p_reason)) < 2 then
    raise exception '시작 취소 사유를 2자 이상 입력해 주세요.' using errcode = 'P0001';
  end if;

  -- ① 작업 행 잠금
  select * into v_job from qc_jobs where id = p_job_id for update;
  if not found then
    raise exception '작업을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;
  if v_job.assignee_user_id is distinct from p_user_id then
    raise exception '본인 작업만 수정할 수 있습니다.' using errcode = 'P0001';
  end if;
  if v_job.status is distinct from '진행중' then
    raise exception '"%" 상태의 작업은 시작을 취소할 수 없습니다. 시작 취소는 ''진행중'' 상태이고 시험항목을 하나도 시작하지 않은 작업만 가능합니다.',
      v_job.status using errcode = 'P0001';
  end if;

  -- ② 오더 행 잠금 — LOCK(locked) 은 보지 않고 건드리지도 않는다(일정 자동변경 금지이지 실행 금지가 아니다).
  select * into v_order from pct_orders where id = v_job.order_id for update;
  if not found then
    raise exception '오더를 찾을 수 없습니다.' using errcode = 'P0001';
  end if;
  if v_order.status = '삭제' then
    raise exception '삭제된 오더의 작업은 시작을 취소할 수 없습니다. 관리자에게 문의하세요.' using errcode = 'P0001';
  end if;

  -- ③ 시험항목 행 전부 잠금 — 동시 항목 시작·완료는 여기서 대기한다.
  perform 1 from qc_job_items where qc_job_id = p_job_id for update;

  select count(*),
         count(*) filter (where status <> 'pending'
                             or started_at is not null
                             or cleared_at is not null
                             or elapsed_minutes is not null
                             or elapsed_total_minutes is not null)
    into v_item_count, v_touched_count
    from qc_job_items
   where qc_job_id = p_job_id;

  if v_item_count = 0 then
    raise exception '시험항목 체크리스트가 없는 작업은 시작을 취소할 수 없습니다. 관리자에게 확인을 요청하세요.' using errcode = 'P0001';
  end if;
  if v_touched_count > 0 then
    raise exception '이미 시작했거나 완료한 시험항목이 있어 작업 시작을 취소할 수 없습니다.' using errcode = 'P0001';
  end if;

  -- 감사 기록 — 사실만 적는다. 작업 시작 취소 사건은 항상 1행.
  insert into pct_order_edits (order_id, field, old_value, new_value, reason, edited_by)
  values (v_order.id, 'jobStart', 'QC ' || v_job.qc_no || ' · 진행중', '시작 취소', btrim(p_reason), p_user_id);

  -- 작업 삭제 — 시험항목·작업 상태 이력은 cascade, 알림의 related_qc_job_id 는 set null.
  delete from qc_jobs where id = p_job_id;

  -- 오더 상태 결정
  --  · 남은 작업 0건 → '대기' (이미 '대기' 면 쓰지 않는다)
  --  · 남은 작업 1건 이상(2인 배정) → 건드리지 않는다. 취소 대상은 '진행중' + 실행 흔적 0 인
  --    가장 덜 진행된 작업이라, 취소 전 오더 상태(지연 또는 진행중)와 취소 후 재산정 결과
  --    (미시작 담당자 상한이 걸려 지연 또는 진행중)가 같다. 증명은 spec §4.
  select count(*) into v_remaining from qc_jobs where order_id = v_order.id;

  v_status_after := v_order.status;
  if v_remaining = 0 and v_order.status is distinct from '대기' then
    update pct_orders set status = '대기' where id = v_order.id;
    v_status_after := '대기';

    -- 오더 상태가 실제로 바뀐 경우에만 status 이력을 남긴다.
    insert into pct_order_edits (order_id, field, old_value, new_value, reason, edited_by)
    values (v_order.id, 'status', v_order.status, '대기', '작업 시작 취소 (QC ' || v_job.qc_no || ')', p_user_id);
  end if;

  return jsonb_build_object(
    'qcNo',              v_job.qc_no,
    'orderId',           v_order.id,
    'productName',       v_order.product_name,
    'batchNo',           v_order.batch_no,
    'orderStatusBefore', v_order.status,
    'orderStatusAfter',  v_status_after
  );
end;
$$;

comment on function cancel_job_start(uuid, uuid, text) is
  '작업 시작 취소(원자적). 잠금: qc_jobs → pct_orders → qc_job_items. 검사·감사(pct_order_edits)·작업 삭제·오더 상태를 한 트랜잭션으로 처리한다. service_role 전용.';

-- 실행 권한은 서버(service_role)에만 — p_user_id 를 믿는 함수다.
revoke all on function cancel_job_start(uuid, uuid, text) from public, anon, authenticated;
grant execute on function cancel_job_start(uuid, uuid, text) to service_role;

notify pgrst, 'reload schema';
