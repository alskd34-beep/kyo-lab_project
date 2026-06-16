-- ============================================================
-- 0017_equipment_master.sql
-- 장비 마스터 테이블 생성
--
-- [수동 적용 필요]
-- Supabase 대시보드 > SQL Editor 에서 아래 SQL을 직접 실행하세요.
-- 로컬 supabase CLI를 사용하는 경우: supabase db push
-- ============================================================

create table if not exists equipment_master (
  id                  uuid primary key default gen_random_uuid(),
  code                text unique not null,            -- 장비코드: test_item_equipment.required_equipment 토큰과 매칭
  name                text not null,
  category            text,
  status              text not null default 'active',  -- 'active' | 'calibrating' | 'out_of_service'
  calibration_date    date,                            -- 최근 검교정일
  calibration_due_date date,                           -- 차기 검교정 예정일 (이 날짜 < 작업시작일 → 만료)
  location            text,
  note                text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);
