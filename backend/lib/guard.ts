/**
 * [BACKEND] API Route용 인증/인가 가드
 */

import { NextRequest } from 'next/server'
import { verifyAccessToken, type AccessPayload } from '@backend/lib/auth'
import { ACCESS_COOKIE } from '@backend/lib/auth-cookies'

export interface GuardResult {
  ok: true
  payload: AccessPayload
}
export interface GuardFail {
  ok: false
  response: Response
}

export async function requireAuth(req: NextRequest): Promise<GuardResult | GuardFail> {
  const access = req.cookies.get(ACCESS_COOKIE)?.value
  if (!access) {
    return { ok: false, response: Response.json({ error: 'unauthenticated' }, { status: 401 }) }
  }
  const payload = await verifyAccessToken(access).catch(() => null)
  if (!payload) {
    return { ok: false, response: Response.json({ error: 'invalid token' }, { status: 401 }) }
  }
  return { ok: true, payload }
}

export async function requireAdmin(req: NextRequest): Promise<GuardResult | GuardFail> {
  const r = await requireAuth(req)
  if (!r.ok) return r
  if (r.payload.role !== 'admin') {
    return { ok: false, response: Response.json({ error: 'forbidden' }, { status: 403 }) }
  }
  return r
}
