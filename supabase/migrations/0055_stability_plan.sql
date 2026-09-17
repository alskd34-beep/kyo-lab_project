-- 안정성 시험계획 저장소. 운영 적용 전 검토 후 수동 적용한다.
begin;
create table if not exists stability_plans (
  id uuid primary key default gen_random_uuid(),
  source_key text not null unique,
  composite_key text,
  product_code text not null default 'N/A',
  product_name text not null default 'N/A',
  batch_no text not null default 'N/A',
  test_type text not null default 'N/A',
  period text not null default 'N/A',
  manufactured_at text,
  expiry_date text,
  period_end_date text,
  reason text,
  requested_at text,
  request_no text,
  sheet_status text not null default '미확인',
  plan_status text not null default '미전송' check (plan_status in ('미전송','전송됨','완료','시트 제외')),
  linked_order_id uuid references pct_orders(id) on delete set null,
  last_seen_at timestamptz,
  source jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table stability_plans add column if not exists composite_key text;
update stability_plans
set composite_key = 'composite:' || trim(product_code) || '|' || trim(batch_no) || '|' || trim(test_type) || '|' || trim(period)
where composite_key is null;
create index if not exists idx_stability_plans_status on stability_plans(plan_status);
create index if not exists idx_stability_plans_composite_key on stability_plans(composite_key);
alter table stability_plans enable row level security;
grant select, insert, update, delete on table stability_plans to service_role;
alter table pct_orders add column if not exists stability_plan_id uuid references stability_plans(id) on delete set null;
create index if not exists idx_pct_orders_stability_plan on pct_orders(stability_plan_id);
notify pgrst, 'reload schema';
commit;
