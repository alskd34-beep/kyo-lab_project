/**
 * [BACKEND] 인증 쿠키 헬퍼
 */

import { ACCESS_TTL_SEC, REFRESH_TTL_SEC } from '@backend/lib/auth'

export const ACCESS_COOKIE  = 'kd_access'
export const REFRESH_COOKIE = 'kd_refresh'

interface CookieOpts {
  maxAge:   number
  httpOnly: boolean
}

function cookieString(name: string, value: string, opts: CookieOpts): string {
  const parts = [
    `${name}=${value}`,
    `Path=/`,
    `Max-Age=${opts.maxAge}`,
    `SameSite=Lax`,
  ]
  if (opts.httpOnly) parts.push('HttpOnly')
  if (process.env.NODE_ENV === 'production') parts.push('Secure')
  return parts.join('; ')
}

export function buildAuthCookies(access: string, refresh: string): string[] {
  return [
    cookieString(ACCESS_COOKIE,  access,  { maxAge: ACCESS_TTL_SEC,  httpOnly: false }),
    cookieString(REFRESH_COOKIE, refresh, { maxAge: REFRESH_TTL_SEC, httpOnly: true  }),
  ]
}

export function clearAuthCookies(): string[] {
  return [
    cookieString(ACCESS_COOKIE,  '', { maxAge: 0, httpOnly: false }),
    cookieString(REFRESH_COOKIE, '', { maxAge: 0, httpOnly: true  }),
  ]
}
