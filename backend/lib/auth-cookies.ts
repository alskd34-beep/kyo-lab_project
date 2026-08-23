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
 * 세션 쿠키(access·refresh)만 제거하고 자동 로그인 마커는 남긴다.
 *
 * 세션 복구 실패에 쓴다. 미들웨어는 마커와 refresh 쿠키를 **둘 다** 요구하므로
 * (middleware.ts 의 `hasAutoLogin && hasRefresh`), refresh 가 지워진 이상 마커만
 * 남아도 페이지가 통과되는 "죽은 세션" 은 생기지 않는다.
 *
 * 2026-08-23 수정: 예전에는 여기서 마커까지 지웠다. 자동 로그인은 자격증명이 아니라
 * 사용자 설정인데, 회전된 refresh 토큰이 한 번 중복 제출되는 것만으로(탭 2개, 새로고침,
 * 요청 재시도 등 흔한 상황) 설정이 영구히 꺼져 다시 로그인해도 자동 로그인이 안 되는
 * 상태가 됐다. 설정은 사용자가 끄거나 로그아웃할 때만 지운다.
 */
export function clearSessionCookies(): string[] {
  return [
    cookieString(ACCESS_COOKIE,  '', { maxAge: 0, httpOnly: false }),
    cookieString(REFRESH_COOKIE, '', { maxAge: 0, httpOnly: true  }),
  ]
}

/**
 * 인증 쿠키 전체 제거 (자동 로그인 마커 포함).
 * 사용자가 명시적으로 로그아웃할 때만 쓴다.
 */
export function clearAuthCookies(): string[] {
  return [
    ...clearSessionCookies(),
    cookieString(AUTO_LOGIN_COOKIE, '', { maxAge: 0, httpOnly: false }),
  ]
}
