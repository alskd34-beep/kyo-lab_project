-- 담당자 구성과 시험항목 슬롯을 편집 모달의 한 저장으로 처리한다.
-- 내부 함수들이 모두 같은 트랜잭션에서 실행되므로 담당자만 반영되고 항목이 누락되는 상태를 만들지 않는다.
create or replace function set_order_assignment_bundle(
  p_order_id uuid, p_assignees jsonb, p_item_assignments jsonb, p_user_id uuid, p_reason text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_item jsonb;
  v_name text;
  v_slot int;
  v_assignees jsonb;
  v_primary uuid;
begin
  if p_item_assignments is null or jsonb_typeof(p_item_assignments) is distinct from 'array' then
    raise exception '시험항목 담당자 구성 형식이 올바르지 않습니다.' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_assignees) = 0 then
    select tester_id into v_primary from pct_order_assignees where order_id = p_order_id and slot = 1;
    if v_primary is null then
      raise exception '담당자 1(대표)을 지정해야 합니다.' using errcode = 'P0001';
    end if;
    -- 병렬 담당자 제거를 먼저 처리한 뒤 대표를 비운다(둘 다 이 함수 트랜잭션 안에서 실행).
    v_assignees := set_order_assignees(p_order_id, jsonb_build_array(jsonb_build_object('slot', 1, 'testerId', v_primary)), p_user_id, p_reason);
    perform set_order_primary_assignee(p_order_id, null, p_user_id, p_reason);
  else
    v_assignees := set_order_assignees(p_order_id, p_assignees, p_user_id, p_reason);
  end if;
  -- 담당자가 1명 이하가 되면 0049 함수가 병렬 오더가 아니라고 거절한다.
  -- 담당자 함수가 이미 슬롯을 1로 정리했으므로 이 경우 항목 루프를 건너뛴다.
  if jsonb_array_length(p_assignees) >= 2 then
    for v_item in select value from jsonb_array_elements(p_item_assignments)
    loop
      v_name := nullif(btrim(v_item->>'testItemName'), '');
      v_slot := (v_item->>'assigneeSlot')::int;
      if v_name is null or v_slot is null or v_slot < 1 or v_slot > 5 then -- 5 = MAX_PARALLEL_ASSIGNEES
        raise exception '시험항목 담당자 구성 형식이 올바르지 않습니다.' using errcode = 'P0001';
      end if;
      perform set_order_test_item_slot(p_order_id, v_name, v_slot, p_user_id);
    end loop;
  end if;
  return jsonb_build_object('orderId', p_order_id, 'assignees', v_assignees);
end;
$$;

revoke all on function set_order_assignment_bundle(uuid, jsonb, jsonb, uuid, text) from public, anon, authenticated;
grant execute on function set_order_assignment_bundle(uuid, jsonb, jsonb, uuid, text) to service_role;

comment on function set_order_assignment_bundle(uuid, jsonb, jsonb, uuid, text) is
  '담당자 구성과 시험항목 슬롯을 원자적으로 저장(0054). 내부 함수 호출은 한 트랜잭션으로 롤백된다.';
