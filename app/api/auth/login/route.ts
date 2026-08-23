import { NextRequest } from 'next/server'
import {
  signAccessToken,
  signRefreshToken,
  generateJti,
  verifyPassword,
} from '@backend/lib/auth'
import { buildAuthCookies } from '@backend/lib/auth-cookies'
import {
  findUserByUsername,
  storeRefreshToken,
  touchLastLogin,
} from '@backend/services/users'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    // 2026-08-23 보안 수정: 여기서 ensureAdminSeed() 를 호출하던 코드를 제거했다.
    // 공개 엔드포인트에서 하드코딩 관리자 계정을 자동 생성하던 경로였다.
    // 부트스트랩은 `npx tsx scripts/seed_admin.ts` 로만 수행한다.
    const { username, password } = await req.json()
    if (typeof username !== 'string' || typeof password !== 'string' || !username || !password) {
      return Response.json({ error: '아이디와 비밀번호를 입력하세요.' }, { status: 400 })
    }

    const user = await findUserByUsername(username)
    if (!user || !user.isActive) {
      return Response.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 })
    }

    const ok = await verifyPassword(password, user.passwordHash)
    if (!ok) {
      return Response.json({ error: '아이디 또는 비밀번호가 올바르지 않습니다.' }, { status: 401 })
    }

    const access  = await signAccessToken({ sub: user.id, username: user.username, role: user.role })
    const jti     = generateJti()
    const refresh = await signRefreshToken({ sub: user.id, jti })

    await storeRefreshToken({
      userId:    user.id,
      jti,
      rawToken:  refresh,
      userAgent: req.headers.get('user-agent') ?? undefined,
      ip:        req.headers.get('x-forwarded-for') ?? undefined,
    })
    await touchLastLogin(user.id)

    const headers = new Headers({ 'Content-Type': 'application/json' })
    for (const c of buildAuthCookies(access, refresh)) headers.append('Set-Cookie', c)

    return new Response(
      JSON.stringify({
        user: {
          id:          user.id,
          username:    user.username,
          displayName: user.displayName,
          avatarUrl:   user.avatarUrl,
          role:        user.role,
        },
      }),
      { status: 200, headers },
    )
  } catch (err) {
    // 원인은 서버 로그에만 남긴다. DB 오류 메시지를 로그인 응답으로 흘리면
    // 스키마·테이블명 등이 미인증 사용자에게 노출된다.
    console.error('[api/auth/login]', err)
    return Response.json({ error: '로그인 처리 중 오류가 발생했습니다.' }, { status: 500 })
  }
}
