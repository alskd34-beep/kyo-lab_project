-- 사용자가 삭제한 자동 적재 오더를 다음 PCT 적재에서 복구하지 않기 위한 영속 표식.
-- 배포 순서: 이 SQL을 운영 DB에 먼저 적용한 뒤 앱을 배포한다.
-- 앱은 미적용 DB에서 수동 오더 삭제는 유지하고 자동 오더 삭제에는 적용 안내를 표시한다.
-- 운영 DB에 직접 실행하지 말고 마이그레이션 절차로 적용한다.
begin;

alter table pct_orders
  add column if not exists user_deleted boolean not null default false;
alter table pct_orders
  add column if not exists user_deleted_by uuid references users(id) on delete set null;

create index if not exists idx_pct_orders_user_deleted
  on pct_orders(user_deleted)
  where user_deleted = true;

notify pgrst, 'reload schema';
commit;
