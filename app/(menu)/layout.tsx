'use client'

import { useState } from 'react'
import Sidebar from '@frontend/components/dashboard/sidebar'
import Chatbot from '@frontend/components/dashboard/chatbot'
import { Avatar, AvatarFallback } from '@frontend/components/ui/avatar'
import { Bell, ChevronDown, LogOut } from 'lucide-react'
import { useAuth } from '@frontend/lib/auth-context'

export default function MenuLayout({ children }: { children: React.ReactNode }) {
  const [activeNav, setActiveNav] = useState<string>('')
  const { user, logout } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)
  const initial = (user?.displayName ?? user?.username ?? '?').charAt(0)

  return (
    <div className="flex h-screen overflow-hidden bg-slate-100 font-sans">
      <Sidebar
        activeItem={activeNav}
        onNavigate={(navId) => setActiveNav(navId)}
      />

      <div className="flex flex-1 flex-col overflow-hidden">
        {/* ── Global top bar ──────────────────────────────────────────────── */}
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 shadow-sm z-20">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-400 leading-none">광동제약</p>
            <h1 className="text-[14px] font-semibold text-slate-800 leading-tight mt-0.5">QC 시험 관리 시스템</h1>
          </div>

          <div className="flex items-center gap-2.5">
            <button className="relative rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-700 transition-colors">
              <Bell size={16} />
              <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-red-500" />
            </button>

            <div className="relative">
              <button
                onClick={() => setMenuOpen(o => !o)}
                className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 hover:bg-slate-100 transition-colors"
              >
                <Avatar className="h-6 w-6">
                  <AvatarFallback className="bg-blue-600 text-white text-[10px] font-bold">{initial}</AvatarFallback>
                </Avatar>
                <span className="text-xs font-medium text-slate-700">
                  {user?.displayName ?? user?.username ?? '게스트'}
                </span>
                {user?.role === 'admin' && (
                  <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[9px] font-semibold text-violet-700">ADMIN</span>
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
