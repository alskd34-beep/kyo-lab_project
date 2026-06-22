-- 0021_tester_user_link.sql
-- 시험자(testers) ↔ 사용자(users) 1:1 연결 정리
--
--   - 로그인 ID(username)를 사원번호(employee_no, 숫자만)로 통일 ('kyo-' 접두어 제거)
--   - users.tester_id 를 username(=사번)으로 재연결(이름 백필 보강)
--   - users.tester_id 에 1:1 유니크(부분) 인덱스 부여
--
-- 의존: 0010_pct_workflow.sql(users.tester_id 컬럼)
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) 'kyo-<숫자>' 형태의 시험자 계정 username 을 사번(숫자)으로 변경
--    (관리자 등 다른 계정은 건드리지 않는다. 변경 후 사번이 이미 존재하면 충돌하므로 미존재시에만)
update users u
   set username = regexp_replace(u.username, '^kyo-', '')
 where u.username ~ '^kyo-[0-9]+$'
   and not exists (
     select 1 from users x
      where x.username = regexp_replace(u.username, '^kyo-', '')
        and x.id <> u.id
   );

-- 2) tester_id 재연결 — username(사번) = testers.employee_no 매칭 우선
update users u
   set tester_id = t.id
  from testers t
 where t.employee_no = u.username
   and (u.tester_id is null or u.tester_id <> t.id);

-- 3) 이름 기반 백필(사번 매칭이 안 된 잔여분) — 아직 미연결 + 동명 1건일 때만
update users u
   set tester_id = t.id
  from testers t
 where u.tester_id is null
   and u.display_name = t.name
   and (select count(*) from testers t2 where t2.name = u.display_name) = 1;

-- 4) 1:1 보장 — 한 시험자가 여러 사용자에 연결돼 있으면 가장 오래된 계정만 남기고 해제
with ranked as (
  select id, tester_id,
         row_number() over (partition by tester_id order by created_at asc, id asc) as rn
    from users
   where tester_id is not null
)
update users u
   set tester_id = null
  from ranked r
 where u.id = r.id and r.rn > 1;

-- 5) 1:1 유니크(부분) 인덱스
create unique index if not exists ux_users_tester_id
  on users(tester_id) where tester_id is not null;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';
