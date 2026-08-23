-- ─────────────────────────────────────────────────────────────────────────────
-- 0034_reservation_no_overlap.sql — 장비 예약 기간 겹침을 DB 레벨에서 차단
--
-- 배경 (2026-08-23 점검):
--   createReservation 은 "겹치는 RESERVED 조회 → 판정 → insert" 3단계로 나뉘어 있고
--   테이블에는 겹침을 막는 제약이 없었다(0012 는 check (end_date >= start_date) 뿐).
--   동시에 들어온 두 요청이 모두 "겹침 없음"으로 판정해 **둘 다 RESERVED** 로 생성될 수 있다
--   → 같은 장비가 동일 기간에 이중 예약되어 시험이 충돌한다.
--
--   애플리케이션 레벨의 재검사로는 이 경쟁을 없앨 수 없다. 직렬화가 가능한 유일한
--   지점은 DB 이므로 배제 제약(EXCLUDE)으로 못박는다.
--
-- 적용 후 동작:
--   겹치는 RESERVED insert 는 23P01(exclusion_violation)로 실패한다.
--   equipmentReservation.createReservation 이 이 코드를 잡아 WAITING 으로 강등한다.
--
-- ⚠️ 선행 확인: 이미 겹쳐 있는 RESERVED 행이 있으면 제약 생성이 실패한다.
--   아래 점검 쿼리로 먼저 정리할 것.
--
--     select a.id, b.id, a.equipment_id, a.start_date, a.end_date, b.start_date, b.end_date
--       from equipment_reservation a
--       join equipment_reservation b
--         on a.equipment_id = b.equipment_id
--        and a.id < b.id
--        and a.status = 'RESERVED' and b.status = 'RESERVED'
--        and daterange(a.start_date, a.end_date, '[]') && daterange(b.start_date, b.end_date, '[]');
--
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 실행하세요. (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

-- daterange 배제 제약에 필요한 확장
create extension if not exists btree_gist;

do $$ begin
  alter table equipment_reservation
    add constraint ux_equipment_reservation_no_overlap
    exclude using gist (
      equipment_id with =,
      daterange(start_date, end_date, '[]') with &&
    )
    where (status = 'RESERVED');
exception
  when duplicate_object then
    raise notice '제약이 이미 존재합니다 — 건너뜁니다.';
  when others then
    -- 기존 데이터가 이미 겹쳐 있으면 여기로 온다. 위 점검 쿼리로 정리 후 재실행할 것.
    raise exception '제약 생성 실패(기존 겹침 데이터 확인 필요): %', sqlerrm;
end $$;

notify pgrst, 'reload schema';
