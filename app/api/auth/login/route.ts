import { NextRequest } from 'next/server'
import {
  signAccessToken,
  signRefreshToken,
  generateJti,
  verifyPassword,
} from '@backend/lib/auth'
import { buildAuthCookies } from '@backend/lib/auth-cookies'
import {
  ensureAdminSeed,
  findUserByUsername,
  storeRefreshToken,
  touchLastLogin,
} from '@backend/services/users'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    await ensureAdminSeed()

    const { username, password } = await req.json()
    if (!username || !password) {
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
          role:        user.role,
        },
      }),
      { status: 200, headers },
    )
  } catch (err) {
    console.error('[api/auth/login]', err)
    const msg = err instanceof Error ? err.message : '서버 오류'
    return Response.json({ error: msg }, { status: 500 })
  }
}
