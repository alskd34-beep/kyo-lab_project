-- ============================================================
-- 0028_schema_alignment.sql
-- 코드는 참조하는데 마이그레이션에 정의가 없던 테이블을 보강한다.
--
-- 배경(2026-08-22 점검): 코드가 조회하는 테이블 중 3개가 마이그레이션에 없었다.
--   - test_item_equipment : 운영 DB 에는 존재(197행)하나 정의가 없어 신규 환경 재현 불가 → 아래에서 보강
--   - holidays            : public_holidays 오타였다 → 코드 쪽을 수정, 테이블은 만들지 않는다
--   - schedules           : 운영 DB 에 존재(65행, 2026-04). tester_id/batch_id 가 int 라
--                           현재 uuid 체계와 맞지 않는 레거시다. 월간 화면이 읽기 전용으로만 쓰므로
--                           **동결**하고 재생성하지 않는다.
--
-- [적용 방법] ⚠️ `supabase db push` 를 쓰지 말 것.
--   이 저장소는 0001~0027 을 대시보드 SQL Editor 에 붙여넣어 수동 적용해왔다.
--   원격 마이그레이션 이력이 비어 있는 상태에서 push 하면 0004 가 재실행되어
--   products / testers / product_test_items 등을 drop cascade 로 삭제한다.
--   → 대시보드 SQL Editor 에서 **이 파일만** 실행한다. if not exists 라 재실행해도 안전하다.
--
--   운영 DB 에는 이미 test_item_equipment 가 있으므로, 이 마이그레이션은 사실상
--   "정의를 저장소에 남기는" 용도다. 실행해도 아무것도 바뀌지 않는다.
-- ============================================================

-- ─── 시험항목 → 필요장비 매핑 ────────────────────────────────────────────────
-- required_equipment 는 equipment_master.code / test_capabilities.code 토큰과 매칭된다.
-- is_universal = true 면 장비 제약이 없어 전 시험자 배정 가능(육안·이화학 등).
create table if not exists test_item_equipment (
  id                 bigserial primary key,
  test_item          text    not null,
  required_equipment text    not null default '',
  is_universal       boolean not null default false,
  created_at         timestamptz not null default now()
);

create unique index if not exists uq_test_item_equipment
  on test_item_equipment(test_item, required_equipment);
