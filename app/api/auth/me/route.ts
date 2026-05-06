import { NextRequest } from 'next/server'
import { verifyAccessToken } from '@backend/lib/auth'
import { ACCESS_COOKIE } from '@backend/lib/auth-cookies'
import { findUserById } from '@backend/services/users'

export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const access = req.cookies.get(ACCESS_COOKIE)?.value
  if (!access) return Response.json({ error: 'unauthenticated' }, { status: 401 })

  const payload = await verifyAccessToken(access).catch(() => null)
  if (!payload) return Response.json({ error: 'invalid token' }, { status: 401 })

  const user = await findUserById(payload.sub)
  if (!user) return Response.json({ error: 'user not found' }, { status: 404 })

  return Response.json({
    user: {
      id:          user.id,
      username:    user.username,
      displayName: user.displayName,
      role:        user.role,
    },
  })
}
