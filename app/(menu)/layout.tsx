'use client'

import { useState, useEffect, useCallback } from 'react'
import Sidebar from '@frontend/components/dashboard/sidebar'
import Chatbot from '@frontend/components/dashboard/chatbot'
import { Avatar, AvatarFallback, AvatarImage } from '@frontend/components/ui/avatar'
import { Bell, ChevronDown, LogOut, Menu } from 'lucide-react'
import { useAuth } from '@frontend/lib/auth-context'

export default function MenuLayout({ children }: { children: React.ReactNode }) {
  const [activeNav, setActiveNav] = useState<string>('')
  const { user, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState<boolean>(false)
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false)
  const initial = (user?.displayName ?? user?.username ?? '?').charAt(0)

  const closeDrawer = useCallback(() => setDrawerOpen(false), [])

  // ESC closes the mobile drawer
  useEffect(() => {
    if (!drawerOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeDrawer()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drawerOpen, closeDrawer])

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100 font-sans">
      <Sidebar
        activeItem={activeNav}
        onNavigate={(navId) => setActiveNav(navId)}
        isOpen={drawerOpen}
        onClose={closeDrawer}
      />

      {/* Mobile/tablet backdrop — only when drawer open and below lg */}
      {drawerOpen && (
        <button
          type="button"
          aria-label="메뉴 닫기"
          onClick={closeDrawer}
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] lg:hidden"
        />
      )}

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ── Global top bar ──────────────────────────────────────────────── */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-3 sm:px-5 shadow-sm z-20">
          <div className="flex items-center gap-2">
            {/* Hamburger — only on mobile/tablet */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="메뉴 열기"
              aria-expanded={drawerOpen}
              className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors lg:hidden"
            >
              <Menu size={18} />
            </button>
          </div>

          <div className="flex items-center gap-2.5">
            <button className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors">
              <Bell size={16} />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-red-500" />
            </button>

            <div className="relative">
              <button
                onClick={() => setMenuOpen(o => !o)}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 sm:px-3 py-1.5 hover:bg-slate-100 transition-colors"
              >
                <Avatar className="h-6 w-6">
                  {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                  <AvatarFallback className="bg-blue-600 text-white text-[10px] font-bold">{initial}</AvatarFallback>
                </Avatar>
                <span className="hidden sm:inline text-xs font-medium text-slate-700">
                  {user?.displayName ?? user?.username ?? '게스트'}
                </span>
                {user?.role === 'admin' && (
                  <span className="hidden sm:inline rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">ADMIN</span>
                )}
                <ChevronDown size={12} className="text-slate-400" />
              </button>
              {menuOpen && (
                <div
                  className="absolute right-0 top-full z-30 mt-1 min-w-[160px] rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                  onMouseLeave={() => setMenuOpen(false)}
                >
                  <a
                    href="/settings/sys-settings"
                    className="block px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                  >
                    비밀번호 변경
                  </a>
                  {user?.role === 'admin' && (
                    <a
                      href="/settings/users"
                      className="block px-3 py-1.5 text-xs text-slate-700 hover:bg-slate-50"
                    >
                      사용자 관리
                    </a>
                  )}
                  <button
                    onClick={() => { setMenuOpen(false); void logout() }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-red-600 hover:bg-red-50"
                  >
                    <LogOut size={12} />
                    로그아웃
                  </button>
                </div>
              )}
            </div>
          </div>
        </header>

        <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>
      </div>

      <Chatbot />
    </div>
  )
}
