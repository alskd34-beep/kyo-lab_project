'use client'

import type { CSSProperties } from 'react'
import dynamic from 'next/dynamic'
import Chatbot from '@frontend/components/dashboard/chatbot'
import NotificationBell from '@frontend/components/dashboard/notification-bell'
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

export default function MenuLayout({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider
      style={{ '--sidebar-width': 'calc(var(--spacing) * 68)' } as CSSProperties}
    >
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
            <div className="flex items-center gap-2">
              <NotificationBell />
            </div>
          </div>
        </header>

        {/* 본문 — 높이를 고정해 각 페이지가 조회조건/목록 스크롤을 나눈다 */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </SidebarInset>

      <Chatbot />
    </SidebarProvider>
  )
}
