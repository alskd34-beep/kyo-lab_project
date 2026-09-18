-- ─── 동시분석 그룹 대표 로트 ────────────────────────────────────────────────
-- 배경: 관리자가 선택한 그룹의 담당자·시험항목 배분 기준을 대표 로트로 고정한다.
-- 의존: 0013_concurrent_groups.sql, pct_orders
-- 배포 순서: 이 SQL을 운영 DB에 먼저 적용한 뒤 앱을 배포한다.
-- 미적용 운영 DB에서도 앱은 대표 기능만 폴백하고 그룹 지정 자체를 계속 허용한다.
begin;

alter table concurrent_analysis_groups
  add column if not exists representative_order_id uuid references pct_orders(id) on delete set null;
create index if not exists idx_concurrent_groups_representative
  on concurrent_analysis_groups(representative_order_id)
  where representative_order_id is not null;
notify pgrst, 'reload schema';
comment on column concurrent_analysis_groups.representative_order_id is '동시분석 담당자 복제의 기준이 되는 대표 오더';
commit;
