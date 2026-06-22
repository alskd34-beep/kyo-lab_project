-- 0022_user_customer_no.sql
-- 사용자 내부 고객번호 — 시리얼(5자리 표기, 1000부터 시작)
--
--   users.customer_no: 정수, 유니크. 기존 사용자는 가입순(created_at)으로 1000부터 부여.
--   신규 사용자는 시퀀스(users_customer_no_seq)로 자동 부여.
--   표기는 앱에서 5자리 zero-pad('01000').
--
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

alter table users add column if not exists customer_no integer;

-- 기존 미부여 사용자에 가입순으로 1000부터 시리얼 부여
with ordered as (
  select id, row_number() over (order by created_at asc, id asc) - 1 as rn
    from users
   where customer_no is null
)
update users u
   set customer_no = 1000 + o.rn
  from ordered o
 where u.id = o.id;

create unique index if not exists ux_users_customer_no on users(customer_no);

-- 신규 사용자 자동 부여용 시퀀스 (현재 최대값 + 1 부터, 최소 1000)
do $$
declare next_start bigint;
begin
  select greatest(coalesce(max(customer_no), 999), 999) + 1 into next_start from users;
  if not exists (select 1 from pg_class where relname = 'users_customer_no_seq') then
    execute format('create sequence users_customer_no_seq start with %s', next_start);
  else
    execute format('alter sequence users_customer_no_seq restart with %s', next_start);
  end if;
end $$;

alter table users alter column customer_no set default nextval('users_customer_no_seq');

notify pgrst, 'reload schema';
