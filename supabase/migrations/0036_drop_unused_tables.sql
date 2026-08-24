-- 0036_drop_unused_tables.sql
-- 미사용 테이블 정리 (drop 목록)
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요.
--
-- 판정 근거 (2026-08-24 운영 프로젝트 qyibsfsetraqzsttbcpw 기준)
--   1) PostgREST 스키마로 public 실제 테이블 49개 확인
--   2) 각 테이블 행 수 확인 (service_role, RLS 우회)
--   3) app / backend / frontend / scripts 전 범위에서 테이블명 문자열 참조 검색
--
-- 백업 권장: 실행 전 Supabase 대시보드에서 스냅샷을 남길 것.

-- ─────────────────────────────────────────────────────────────
-- [A] 즉시 drop — 코드 참조 0건 + 데이터 0행
-- ─────────────────────────────────────────────────────────────

-- 0001_init_qc_schema 의 초기 QC 스키마. 0004 PQM 스키마로 대체된 뒤 방치됨.
-- 현재 "시험현황" 화면은 pct_orders + qc_jobs 로 조립한다(backend/services/tests.ts).
-- FK 역순: deviations/stability_tests → tests → contractors/managers
drop table if exists deviations       cascade;  -- 0행
drop table if exists stability_tests  cascade;  -- 0행
drop table if exists tests            cascade;  -- 0행
drop table if exists contractors      cascade;  -- 0행
drop table if exists managers         cascade;  -- 0행

-- 레거시 시험자 휴무 테이블(id/date/type/tester_id/note).
-- 공휴일은 public_holidays(22행), 휴가는 operator_schedule 로 일원화됨.
drop table if exists holidays         cascade;  -- 0행

-- 0011_merge_product_manhours_into_products 가 drop 하기로 한 테이블.
-- 해당 마이그레이션이 운영에 미적용이라 테이블만 남아 있다. 공수는 products.avg_hours →
-- product_workload.avg_workdays 로 이관 완료.
drop table if exists product_manhours cascade;  -- 0행


-- ─────────────────────────────────────────────────────────────
-- [B] 코드 정리 후 drop — 데이터 0행이지만 아직 코드가 참조 중
--     아래 선행 정리를 끝낸 뒤 주석을 해제할 것.
--
--     선행 정리 목록 (레거시 PQM 배치 스키마)
--       - app/api/batches/route.ts        삭제 (프런트 호출 0건)
--       - app/api/batches/[id]/route.ts   삭제 (프런트 호출 0건)
--       - app/api/dashboard/route.ts      삭제 (프런트 호출 0건, /api/qc-dashboard 사용 중)
--       - backend/services/batches.ts     삭제
--       - backend/services/chat.ts        production_batches / batch_test_assignments
--                                         블록 제거 (L169-, L227-, L268)
--       - scripts/seed_pqm.ts             dosage_forms / production_batches /
--                                         batch_test_assignments 시드 제거
-- ─────────────────────────────────────────────────────────────

-- drop table if exists batch_test_assignments cascade;  -- 0행, chat.ts 참조
-- drop table if exists production_batches     cascade;  -- 0행, batches.ts / chat.ts 참조
-- drop table if exists dosage_forms           cascade;  -- 0행, seed_pqm.ts 만 참조
--                                                       -- (production_batches.dosage_form_id FK)


-- ─────────────────────────────────────────────────────────────
-- [C] drop 금지 — 미사용처럼 보이지만 현역
--   schedules (65행)  : /api/schedules/monthly 의 레거시 폴백 경로. 월간일정 화면이 의존.
--   아래는 "데이터가 0행일 뿐" 코드가 정상 사용 중이므로 건드리지 말 것.
--     app_settings, equipment_master, equipment_reservation, operator_schedule,
--     test_item_groups, test_item_group_items, product_pretest_notes,
--     concurrent_product_families, concurrent_product_family_members
-- ─────────────────────────────────────────────────────────────
