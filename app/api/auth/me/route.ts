import { NextRequest } from 'next/server'
import { verifyAccessToken } from '@backend/lib/auth'
import { ACCESS_COOKIE } from '@backend/lib/auth-cookies'
import { findUserById } from '@backend/services/users'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const access = req.cookies.get(ACCESS_COOKIE)?.value
  if (!access) return Response.json({ error: '로그인이 필요합니다.' }, { status: 401 })

  const payload = await verifyAccessToken(access).catch(() => null)
  if (!payload) return Response.json({ error: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' }, { status: 401 })

  const user = await findUserById(payload.sub)
  if (!user) return Response.json({ error: '사용자를 찾을 수 없습니다.' }, { status: 404 })

  return Response.json({
    user: {
      id:          user.id,
      username:    user.username,
      displayName: user.displayName,
      avatarUrl:   user.avatarUrl,
      role:        user.role,
      customerNo:  user.customerNo,
    },
  })
}
