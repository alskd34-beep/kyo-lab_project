/**
 * Edge 미들웨어: 보호된 페이지 접근 시 access token을 검증하고
 * 없으면 /login 으로 리다이렉트합니다.
 *
 * 토큰 만료(짧은 access) 상태라도 자동 로그인 + refresh 쿠키가 남아 있으면
 * 클라이언트가 /api/auth/refresh 로 세션을 복구할 수 있도록 페이지 요청은 통과시킵니다.
 *
 * 그 앞에 사내망 전용 IP 검사가 한 겹 더 있다(`@shared/ip-allowlist` 참고).
 * 클라우드(Railway)는 공개 URL 로만 서비스를 노출하므로 "사내에서만 접속" 을
 * 여기서 만든다 — 인증보다 먼저 걸러 로그인 화면 자체를 보여주지 않는다.
 */

import { NextRequest, NextResponse } from 'next/server'
import { jwtVerify } from 'jose'

import { isAdminOnlyPath } from '@shared/route-access'
import { clientIpFromHeaders, evaluateIpAccess, type IpAccessDecision } from '@shared/ip-allowlist'

const ACCESS_COOKIE = 'kd_access'
const REFRESH_COOKIE = 'kd_refresh'
const AUTO_LOGIN_COOKIE = 'kd_auto_login'
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET ?? 'dev-access-secret-change-me'
const enc = new TextEncoder()

/** 헬스체크는 Railway 내부에서 오므로 IP 검사 대상이 아니다(막으면 배포가 실패한다). */
const HEALTH_PATH = '/api/health'

/** IP 는 헤더에서 온 값이라 그대로 HTML 에 넣으면 스크립트가 실려 들어온다. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

type DenyReason = Extract<IpAccessDecision, { allowed: false }>['reason']

const DENY_MESSAGES: Record<DenyReason, string> = {
  'not-configured': '서버에 허용 IP 목록(IP_ALLOWLIST)이 설정되지 않아 모든 접근을 막고 있습니다.',
  'no-ip': '요청자의 IP 주소를 확인할 수 없어 접근을 막았습니다.',
  blocked: '사내망에서만 접속할 수 있는 시스템입니다.',
}

/**
 * 차단 응답. 무엇이 문제인지 화면에서 바로 알 수 있게 이유와 요청자 IP 를 보여준다.
 * (요청자 본인의 IP 라 노출로 새는 정보가 없고, 허용목록에 넣을 값이 곧 이 값이다)
 * 프록시 체인 전체는 Railway 로그로만 남긴다 — 사내 IP 구성을 밖에 내보이지 않기 위해.
 */
function blockedResponse(decision: Extract<IpAccessDecision, { allowed: false }>, req: NextRequest) {
  console.warn(
    `[ip-allowlist] 차단 (${decision.reason}) — ip=${decision.ip ?? '알 수 없음'} ` +
    `xff=${req.headers.get('x-forwarded-for') ?? '없음'} path=${req.nextUrl.pathname}`,
  )

  const message = DENY_MESSAGES[decision.reason]
  const detected = decision.ip ? `<p class="ip">확인된 IP · <code>${escapeHtml(decision.ip)}</code></p>` : ''

  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>접근이 제한되었습니다</title>
<style>
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
         font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background:#f8fafc; color:#0f172a; }
  main { max-width:30rem; padding:2rem; text-align:center; }
  h1 { font-size:1.25rem; margin:0 0 .75rem; }
  p { margin:0 0 .5rem; font-size:.9375rem; line-height:1.6; color:#475569; }
  .ip { margin-top:1.25rem; font-size:.875rem; }
  code { background:#e2e8f0; padding:.15rem .4rem; border-radius:.375rem; }
</style></head>
<body><main>
  <h1>접근이 제한되었습니다</h1>
  <p>${escapeHtml(message)}</p>
  <p>사내 네트워크에서 다시 시도하시거나 시스템 관리자에게 문의하세요.</p>
  ${detected}
</main></body></html>`

  return new NextResponse(html, {
    status: 403,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  })
}

const PUBLIC_PATHS = ['/login']

/** 로그인 직후 첫 화면(루트)만 역할로 가른다.
 *  관리자가 아닌 사용자는 「할 일」로 보내 오늘 처리할 작업부터 보게 한다.
 *  (`/home` 개인 대시보드는 누구나 사이드바에서 열 수 있다) */
const LANDING_PATH = '/'
const MY_TASKS_PATH = '/my-tasks'

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

  // 사내망 전용 검사가 인증보다 먼저다. 허용 IP 가 아니면 로그인 화면도 주지 않는다.
  if (pathname !== HEALTH_PATH) {
    const decision = evaluateIpAccess(
      clientIpFromHeaders(req.headers, process.env.IP_CLIENT_HEADER),
      process.env.IP_ALLOWLIST,
      process.env.NODE_ENV === 'production',
    )
    if (!decision.allowed) return blockedResponse(decision, req)
  }

  if (isPublic(pathname)) return NextResponse.next()

  // API는 자체 가드(requireAuth)에 위임 (단, 로그인된 경우 통과만 수행)
  const access = req.cookies.get(ACCESS_COOKIE)?.value
  if (access) {
    const ok = await jwtVerify(access, enc.encode(ACCESS_SECRET)).catch(() => null)
    if (ok) {
      const role = (ok.payload as { role?: string }).role
      if (role !== 'admin') {
        // 관리자 전용 화면은 메뉴에서 감추는 것으로 끝나지 않는다.
        // 주소를 직접 치거나 북마크로 들어와도 「할 일」로 돌려보낸다.
        // (API 는 각 라우트의 requireAdmin 가드가 403 으로 답해야 하므로 건드리지 않는다)
        const blocked = !pathname.startsWith('/api/') && isAdminOnlyPath(pathname)
        if (blocked || pathname === LANDING_PATH) {
          const url = req.nextUrl.clone()
          url.pathname = MY_TASKS_PATH
          // 막힌 화면의 조회조건을 「할 일」까지 끌고 가지 않는다
          if (blocked) url.search = ''
          return NextResponse.redirect(url)
        }
      }
      return NextResponse.next()
    }
  }

  const hasAutoLogin = req.cookies.get(AUTO_LOGIN_COOKIE)?.value === '1'
  const hasRefresh = Boolean(req.cookies.get(REFRESH_COOKIE)?.value)

  // 페이지 요청만 리다이렉트 (API는 401 반환되도록 통과)
  if (pathname.startsWith('/api/')) return NextResponse.next()

  if (hasAutoLogin && hasRefresh) {
    return NextResponse.next()
  }

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.searchParams.set('next', pathname)
  return NextResponse.redirect(url)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}
