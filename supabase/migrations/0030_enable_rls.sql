-- ─────────────────────────────────────────────────────────────────────────────
-- 0030_enable_rls.sql — public 스키마 전 테이블 Row Level Security 활성화
--                       (deny-by-default: 정책을 만들지 않는다)
--
-- 배경 (2026-08-23 보안 점검):
--   0001~0029 어느 마이그레이션에도 RLS 정책이 한 건도 없었다.
--   Supabase 의 보안 모델은 "anon 키는 설계상 공개 키이고 RLS 가 유일한 방어선"이므로,
--   RLS 부재는 anon 키를 가진 누구나 REST API 로 전 테이블을 읽고 쓸 수 있다는 뜻이다.
--
--   실제로 확인된 노출 (anon 키만으로, 응답 HTTP 200):
--     GET /rest/v1/users?select=username,password_hash  → bcrypt 해시를 그대로 반환
--     GET /rest/v1/pct_orders?select=id                 → 오더 전량 반환
--   즉 app/api/** 의 requireAuth / requireAdmin 가드가 통째로 우회되고 있었다.
--
-- 정책 설계:
--   이 앱의 DB 접근은 전부 서버 라우트(service_role)를 경유한다. 브라우저가 Supabase 에
--   직접 붙는 경로는 존재하지 않는다(NEXT_PUBLIC_SUPABASE_ANON_KEY 는 서버 코드에서만
--   참조됐고, 이번 커밋에서 그 참조도 제거했다).
--   따라서 anon / authenticated 역할에는 **어떤 정책도 부여하지 않는다**.
--   RLS 가 켜져 있고 정책이 없으면 기본 동작이 deny 이므로 이것으로 충분하다.
--   service_role 은 bypassrls 속성을 가지므로 서버 동작에는 영향이 없다.
--
-- ⚠️ 선행 조건 (반드시 먼저 확인):
--   1. 배포 환경에 SUPABASE_SERVICE_ROLE_KEY 가 설정되어 있을 것.
--      없으면 backend/lib/supabase.ts 가 부팅 시 즉시 실패한다(의도된 동작 — 조용한
--      anon 폴백은 "RLS 도 없고 권한도 없는" 최악 조합을 만들기 때문에 제거했다).
--   2. 서버 코드가 anon 클라이언트를 쓰지 않을 것.
--      동일 커밋에서 8개 서비스(batches, chat, chatHistory, holidays, products,
--      productTestItems, testers, testItems)를 service-role 로 전환했다.
--
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 실행하세요. (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

-- public 스키마의 모든 일반 테이블에 RLS 를 건다.
-- 테이블 목록을 손으로 관리하면 신규 테이블이 누락되므로 카탈로그를 직접 순회한다.
do $$
declare
  r record;
  n int := 0;
begin
  for r in
    select c.relname
      from pg_class c
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relkind = 'r'          -- 일반 테이블만 (뷰·시퀀스·파티션 제외)
       and not c.relrowsecurity     -- 이미 켜진 것은 건너뜀 (idempotent)
     order by c.relname
  loop
    execute format('alter table public.%I enable row level security', r.relname);
    -- FORCE: 테이블 소유자에게도 RLS 를 적용한다.
    -- service_role 은 bypassrls 라 영향을 받지 않는다.
    execute format('alter table public.%I force row level security', r.relname);
    raise notice 'RLS 활성화: %', r.relname;
    n := n + 1;
  end loop;
  raise notice '총 % 개 테이블에 RLS 를 활성화했습니다.', n;
end $$;

-- ── 적용 후 검증 ─────────────────────────────────────────────────────────────
-- 아래 쿼리가 0행이어야 한다. 행이 남으면 그 테이블은 여전히 무방비다.
--
--   select c.relname
--     from pg_class c join pg_namespace ns on ns.oid = c.relnamespace
--    where ns.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
--
-- anon 키로 아래가 401/403 또는 빈 배열을 반환해야 한다(적용 전에는 200 + 데이터였다):
--   curl "$SUPABASE_URL/rest/v1/users?select=username,password_hash&limit=1" \
--        -H "apikey: $ANON_KEY" -H "Authorization: Bearer $ANON_KEY"

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
