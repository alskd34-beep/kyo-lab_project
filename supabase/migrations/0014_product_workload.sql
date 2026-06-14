-- ─────────────────────────────────────────────────────────────────────────────
-- 공수(일) 단일 소스: product_workload 버전관리
--
-- 배경: product_workload 는 라이브 DB 에 수동 생성되어 운영 중이었으나(약 272행)
--   마이그레이션으로 관리되지 않아 신규 환경 배포 시 누락되는 문제가 있었다.
--   본 마이그레이션으로 스키마를 버전관리한다. (기존 DB 에는 IF NOT EXISTS 로 무영향)
--
-- 정책(PRD 원칙4): 공수는 DAY 단위, 품목마스터 공수가 절대값.
--   - 평균공수관리 화면 / 자동배정 / 관리자 대시보드 모두 이 테이블의 avg_workdays(일)을 단일 소스로 사용.
--   - product_code 가 자연키. 화면 저장은 product_code 기준 upsert.
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists product_workload (
  id            bigserial primary key,
  product_code  text not null,
  product_name  text,
  package_unit  text,
  avg_workdays  numeric(5,1) not null default 1,   -- 공수(일, DAY) — 절대값
  created_at    timestamptz not null default now()
);

-- 과거 이중적재로 동일 product_code 가 복수 존재할 수 있어, code 당 1행만 남기고 정리.
-- (라이브 데이터: 136코드 × 2행, 값 완전 동일 — 최신 id 1건 유지)
delete from product_workload a
  using product_workload b
 where a.product_code = b.product_code
   and a.id < b.id;

-- product_code 자연키: upsert/중복방지
create unique index if not exists ux_product_workload_code on product_workload(product_code);
