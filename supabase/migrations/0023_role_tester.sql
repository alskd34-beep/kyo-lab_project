-- 0023_role_tester.sql
-- 사용자 역할 개선: 'user' → 'tester' 일괄 변경
--
--   users.role: 'admin' | 'user' → 'admin' | 'tester'
--   'user' 역할은 사라지고 'tester' 로 통합.
--   role='tester' 저장 시 앱 레이어에서 testers 레코드 자동 생성·연결.
--
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent)
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. enum 에 'tester' 값 추가 (없는 경우에만)
alter type user_role add value if not exists 'tester';

-- 2. 기존 'user' 역할 → 'tester' 일괄 전환
update users set role = 'tester' where role = 'user';

notify pgrst, 'reload schema';
