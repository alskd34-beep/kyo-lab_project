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
    return { ok: false, response: Response.json({ error: '로그인이 필요합니다.' }, { status: 401 }) }
  }
  const payload = await verifyAccessToken(access).catch(() => null)
  if (!payload) {
    return { ok: false, response: Response.json({ error: '로그인 세션이 만료되었습니다. 다시 로그인해 주세요.' }, { status: 401 }) }
  }
  return { ok: true, payload }
}

export async function requireAdmin(req: NextRequest): Promise<GuardResult | GuardFail> {
  const r = await requireAuth(req)
  if (!r.ok) return r
  if (r.payload.role !== 'admin') {
    return { ok: false, response: Response.json({ error: '관리자 권한이 필요합니다.' }, { status: 403 }) }
  }
  return r
}
