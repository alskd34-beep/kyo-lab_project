-- ─────────────────────────────────────────────────────────────────────────────
-- 인증 / 사용자 관리
-- ─────────────────────────────────────────────────────────────────────────────

do $$ begin
  create type user_role as enum ('admin', 'user');
exception when duplicate_object then null; end $$;

create table if not exists users (
  id              uuid primary key default gen_random_uuid(),
  username        text not null unique,
  password_hash   text not null,
  display_name    text,
  role            user_role not null default 'user',
  is_active       boolean not null default true,
  last_login_at   timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists idx_users_role on users(role);

drop trigger if exists trg_users_updated_at on users;
create trigger trg_users_updated_at
  before update on users
  for each row execute procedure set_updated_at();

-- Refresh token rotation을 위한 저장소 (선택적이지만 토큰 폐기/탈취 대응에 권장)
create table if not exists auth_refresh_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  token_hash   text not null unique,        -- refresh token의 SHA-256 해시
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  created_at   timestamptz not null default now(),
  user_agent   text,
  ip           text
);

create index if not exists idx_refresh_user      on auth_refresh_tokens(user_id);
create index if not exists idx_refresh_expires   on auth_refresh_tokens(expires_at);
