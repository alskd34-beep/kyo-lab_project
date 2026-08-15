import { NextRequest } from 'next/server'
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  generateJti,
} from '@backend/lib/auth'
import { buildAuthCookies, clearAuthCookies, REFRESH_COOKIE } from '@backend/lib/auth-cookies'
import {
  findUserById,
  isRefreshTokenValid,
  revokeRefreshToken,
  storeRefreshToken,
} from '@backend/services/users'

export const runtime = 'nodejs'

/**
 * 세션 복구 불가 응답. 남아 있는 인증 쿠키(자동 로그인 마커 포함)를 함께 제거해
 * 다음 페이지 요청부터 미들웨어가 곧바로 /login 으로 보내도록 한다.
 */
function sessionExpired(error: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  for (const c of clearAuthCookies()) headers.append('Set-Cookie', c)
  return new Response(JSON.stringify({ error }), { status: 401, headers })
}

/** Refresh token rotation: 기존 jti 무효화 + 새 access/refresh 발급 */
export async function POST(req: NextRequest) {
  try {
    const raw = req.cookies.get(REFRESH_COOKIE)?.value
    if (!raw) return sessionExpired('no refresh token')

    const payload = await verifyRefreshToken(raw).catch(() => null)
    if (!payload) return sessionExpired('invalid refresh')

    const ok = await isRefreshTokenValid(payload.jti, raw)
    if (!ok) return sessionExpired('revoked or expired')

    const user = await findUserById(payload.sub)
    if (!user || !user.isActive) {
      return sessionExpired('user inactive')
    }

    await revokeRefreshToken(payload.jti)

    const access  = await signAccessToken({ sub: user.id, username: user.username, role: user.role })
    const newJti  = generateJti()
    const refresh = await signRefreshToken({ sub: user.id, jti: newJti })
    await storeRefreshToken({ userId: user.id, jti: newJti, rawToken: refresh })

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
          customerNo:  user.customerNo,
        },
      }),
      { status: 200, headers },
    )
  } catch (err) {
    console.error('[api/auth/refresh]', err)
    return Response.json({ error: '서버 오류' }, { status: 500 })
  }
}
