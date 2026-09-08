import { NextRequest } from 'next/server'
import {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken,
  generateJti,
} from '@backend/lib/auth'
import { buildAuthCookies, clearSessionCookies, REFRESH_COOKIE } from '@backend/lib/auth-cookies'
import { toAuthUser } from '@backend/lib/authUser'
import {
  findUserById,
  isRefreshTokenValid,
  revokeRefreshToken,
  storeRefreshToken,
} from '@backend/services/users'

export const runtime = 'nodejs'

/**
 * 세션 복구 불가 응답. access·refresh 쿠키만 제거한다. 자동 로그인 체크는 사용자 설정이므로
 * 남겨 둔다 — 미들웨어는 마커와 refresh 를 둘 다 요구하므로 다음 요청은 /login 으로 간다.
 */
function sessionExpired(error: string): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' })
  for (const c of clearSessionCookies()) headers.append('Set-Cookie', c)
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
      // ⚠️ 여기서 손으로 조립하지 말 것. auth-context 의 refresh() 는 이 응답으로
      // user 를 **통째로 교체**하고, 창 포커스마다 돈다. 필드가 하나라도 빠지면 화면이
      // 그 값에 매달린 UI 를 조용히 잃는다(testerId 누락 → 월간 그리드 [+] 실종).
      JSON.stringify({ user: await toAuthUser(user) }),
      { status: 200, headers },
    )
  } catch (err) {
    console.error('[api/auth/refresh]', err)
    return Response.json({ error: '서버 오류' }, { status: 500 })
  }
}
