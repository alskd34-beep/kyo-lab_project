/**
 * [BACKEND] 인증 쿠키 헬퍼
 */

import { ACCESS_TTL_SEC, REFRESH_TTL_SEC } from '@backend/lib/auth'

export const ACCESS_COOKIE     = 'kd_access'
export const REFRESH_COOKIE    = 'kd_refresh'
/** 자동 로그인 마커 — 미들웨어가 "세션 복구 가능"으로 판단하는 근거 (로그인 페이지에서 JS로 발급) */
export const AUTO_LOGIN_COOKIE = 'kd_auto_login'

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

/**
 * 인증 쿠키 전체 제거.
 * 자동 로그인 마커까지 함께 지운다. 마커만 남으면 미들웨어가 "복구 가능한 세션"으로
 * 오판해 페이지를 통과시키고, 정작 API는 401을 내는 죽은 세션 상태가 된다.
 */
export function clearAuthCookies(): string[] {
  return [
    cookieString(ACCESS_COOKIE,     '', { maxAge: 0, httpOnly: false }),
    cookieString(REFRESH_COOKIE,    '', { maxAge: 0, httpOnly: true  }),
    cookieString(AUTO_LOGIN_COOKIE, '', { maxAge: 0, httpOnly: false }),
  ]
}
