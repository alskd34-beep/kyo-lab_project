/**
 * Edge 미들웨어: 보호된 페이지 접근 시 access token을 검증하고
 * 없으면 /login 으로 리다이렉트합니다.
 *
 * 토큰 만료(짧은 access)는 클라이언트가 자동으로 /api/auth/refresh 를 호출하여
 * 새 access 쿠키를 받습니다 (frontend/lib/auth-context).
 */

import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

const ACCESS_COOKIE = 'kd_access'
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me'
const enc = new TextEncoder()

const PUBLIC_PATHS = ['/login']

function isPublic(path: string): boolean {
  if (PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '/'))) return true
  if (path.startsWith('/api/auth/'))      return true
  if (path.startsWith('/_next'))          return true
  if (path.startsWith('/favicon'))        return true
  if (path === '/')                        return false   // 루트는 보호
  return false
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (isPublic(pathname)) return NextResponse.next()

  // API는 자체 가드(requireAuth)에 위임 (단, 로그인된 경우 통과만 수행)
  const access = req.cookies.get(ACCESS_COOKIE)?.value
  if (access) {
    const ok = await jwtVerify(access, enc.encode(ACCESS_SECRET)).catch(() => null)
    if (ok) return NextResponse.next()
  }

  // 페이지 요청만 리다이렉트 (API는 401 반환되도록 통과)
  if (pathname.startsWith('/api/')) return NextResponse.next()

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('next', pathname)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
