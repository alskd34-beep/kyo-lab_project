'use client'

import { useEffect } from 'react'
import type { CSSProperties } from 'react'
import dynamic from 'next/dynamic'
import { usePathname, useRouter } from 'next/navigation'
import { isAdminOnlyPath } from '@shared/route-access'
import { useAuth } from '@frontend/lib/auth-context'
import Chatbot from '@frontend/components/dashboard/chatbot'
import NotificationBell from '@frontend/components/dashboard/notification-bell'
import { ThemeToggle } from '@frontend/components/common/theme-toggle'
import { Separator } from '@frontend/components/ui/separator'
import {
  SidebarInset, SidebarProvider, SidebarTrigger,
} from '@frontend/components/ui/sidebar'
import { cn } from '@frontend/lib/utils'

// Radix 메뉴 ID는 사용자 권한과 화면 폭에 따라 달라질 수 있어 클라이언트에서만 구성한다.
const AppSidebar = dynamic(
  () => import('@frontend/components/dashboard/app-sidebar').then(module => module.AppSidebar),
  { ssr: false },
)

/**
 * 관리자 전용 화면의 마지막 확인선.
 *
 * 차단은 미들웨어가 하지만, access 토큰이 만료되고 자동 로그인 쿠키만 남은 요청은
 * 세션 복구를 위해 미들웨어를 그대로 통과한다. 그 틈으로 시험자가 관리자 화면을
 * 열지 못하도록 역할이 확인되는 즉시 「할 일」로 돌려보낸다.
 */
function useAdminRouteGuard(): boolean {
  const { user, loading } = useAuth()
  const pathname = usePathname() ?? ''
  const router = useRouter()

  const blocked = !loading && !!user && user.role !== 'admin' && isAdminOnlyPath(pathname)

  useEffect(() => {
    if (blocked) router.replace('/my-tasks')
  }, [blocked, router])

  return blocked
}

export default function MenuLayout({ children }: { children: React.ReactNode }) {
  const blocked = useAdminRouteGuard()

  return (
    <SidebarProvider
      style={{ '--sidebar-width': 'calc(var(--spacing) * 68)' } as CSSProperties}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        본문으로 건너뛰기
      </a>
      <AppSidebar variant="inset" collapsible="icon" />
      <SidebarInset
        className={cn(
          'peer-data-[variant=inset]:border',
          '[--dashboard-header-height:--spacing(12)]',
          'min-h-0 min-w-0 overflow-hidden',
        )}
      >
        {/* ── 상단바 ─────────────────────────────────────────────────────── */}
        <header className="flex h-12 shrink-0 items-center gap-2 border-b">
          <div className="flex w-full items-center justify-between px-4 lg:px-6">
            <div className="flex items-center gap-1 lg:gap-2">
              <SidebarTrigger className="-ml-1" />
              <Separator
                orientation="vertical"
                className="mx-2 data-[orientation=vertical]:h-4 data-[orientation=vertical]:self-center"
              />
            </div>
            <div className="flex items-center gap-1">
              <ThemeToggle />
              <NotificationBell />
            </div>
          </div>
        </header>

        {/* 본문 — 높이를 고정해 각 페이지가 조회조건/목록 스크롤을 나눈다 */}
        <div id="main-content" tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden outline-none">
          {/* 권한 없는 화면은 이동이 끝날 때까지 내용을 그리지 않는다 */}
          {blocked ? null : children}
        </div>
      </SidebarInset>

      <Chatbot />
    </SidebarProvider>
  )
}
