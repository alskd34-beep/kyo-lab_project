import { NextRequest } from 'next/server'
import { verifyRefreshToken } from '@backend/lib/auth'
import { clearAuthCookies, REFRESH_COOKIE } from '@backend/lib/auth-cookies'
import { revokeRefreshToken } from '@backend/services/users'

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const raw = req.cookies.get(REFRESH_COOKIE)?.value
    if (raw) {
      const payload = await verifyRefreshToken(raw).catch(() => null)
      if (payload?.jti) await revokeRefreshToken(payload.jti)
    }
  } catch {}

  const headers = new Headers({ 'Content-Type': 'application/json' })
  for (const c of clearAuthCookies()) headers.append('Set-Cookie', c)
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers })
}
