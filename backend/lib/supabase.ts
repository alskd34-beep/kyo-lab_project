/**
 * [BACKEND] Supabase 클라이언트 - 서버 전용
 *
 * 환경변수 설정 필요 (.env.local):
 *   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
 *
 * ⚠️ 이 모듈은 서버 전용이다. 클라이언트 컴포넌트에서 import 하지 말 것.
 *
 * 2026-08-23 보안 수정 (2건):
 *
 *  1. anon 클라이언트 export 제거.
 *     예전에는 `supabase`(anon) 와 `supabaseAdmin`(service-role) 두 개를 export 했고
 *     8개 서비스가 anon 쪽을 쓰고 있었다. anon 키는 설계상 공개 키이고 이 프로젝트의
 *     DB 접근은 전부 `requireAuth`/`requireAdmin` 가드를 통과한 서버 라우트에서만
 *     일어나므로, 서버 코드가 anon 키를 쓸 이유가 없다. RLS 를 켜면 anon 경로는
 *     전부 깨지기도 한다. 이제 서버는 service-role 하나만 쓴다.
 *
 *  2. service-role 키 부재 시 anon 으로 조용히 폴백하던 코드를 제거.
 *     폴백은 "RLS 도 없고 권한도 없는" 최악 조합을 무증상으로 만들었다.
 *     키가 없으면 부팅 시점에 즉시 실패시킨다.
 */

import { createClient } from '@supabase/supabase-js'

const supabaseUrl    = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl) {
  throw new Error('NEXT_PUBLIC_SUPABASE_URL 환경변수가 설정되지 않았습니다.')
}
if (!serviceRoleKey) {
  throw new Error(
    'SUPABASE_SERVICE_ROLE_KEY 환경변수가 설정되지 않았습니다. ' +
    '서버는 service-role 키로만 DB 에 접근합니다(anon 폴백은 보안상 제거됨).',
  )
}

/**
 * 서버 전용 클라이언트 (RLS 우회 - API Route / 크론에서만 사용).
 * 실제 접근 제어는 `@backend/lib/guard` 의 requireAuth/requireAdmin 과
 * 각 서비스의 소유권 검사가 담당한다.
 */
export const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
