import { NextRequest } from 'next/server'
import { verifyAccessToken, verifyPassword } from '@backend/lib/auth'
import { ACCESS_COOKIE } from '@backend/lib/auth-cookies'
import { findUserByUsername, revokeAllUserTokens, updateUser } from '@backend/services/users'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const access = req.cookies.get(ACCESS_COOKIE)?.value
    if (!access) return Response.json({ error: 'unauthenticated' }, { status: 401 })

    const payload = await verifyAccessToken(access).catch(() => null)
    if (!payload) return Response.json({ error: 'invalid token' }, { status: 401 })

    const { currentPassword, newPassword } = await req.json()
    if (!currentPassword || !newPassword) {
      return Response.json({ error: '현재/새 비밀번호를 모두 입력하세요.' }, { status: 400 })
    }
    if (typeof newPassword !== 'string' || newPassword.length < 4) {
      return Response.json({ error: '비밀번호는 4자 이상이어야 합니다.' }, { status: 400 })
    }

    const user = await findUserByUsername(payload.username)
    if (!user) return Response.json({ error: 'user not found' }, { status: 404 })

    const ok = await verifyPassword(currentPassword, user.passwordHash)
    if (!ok) return Response.json({ error: '현재 비밀번호가 올바르지 않습니다.' }, { status: 400 })

    await updateUser(user.id, { password: newPassword })
    await revokeAllUserTokens(user.id)   // 모든 세션 무효화

    return Response.json({ ok: true })
  } catch (err) {
    console.error('[api/auth/change-password]', err)
    return Response.json({ error: '서버 오류' }, { status: 500 })
  }
}
