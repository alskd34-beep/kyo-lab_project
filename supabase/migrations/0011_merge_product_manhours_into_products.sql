-- ─────────────────────────────────────────────────────────────────────────────
-- 품목 마스터에 평균공수 통합
-- product_manhours 데이터를 products.avg_hours 로 이관 후 테이블 제거
-- ─────────────────────────────────────────────────────────────────────────────

alter table products
  add column if not exists avg_hours numeric(8,2);

with picked as (
  select distinct on (pm.product_id)
    pm.product_id,
    pm.avg_hours
  from product_manhours pm
  join products p on p.id = pm.product_id
  order by
    pm.product_id,
    case
      when pm.package_unit = coalesce(nullif(btrim(p.unit), ''), '') then 0
      when pm.package_unit = coalesce(nullif(btrim(p.package_spec), ''), '') then 1
      else 2
    end,
    pm.updated_at desc,
    pm.created_at desc,
    pm.id asc
)
update products p
set avg_hours = picked.avg_hours
from picked
where picked.product_id = p.id
  and p.avg_hours is null;

drop table if exists product_manhours cascade;

