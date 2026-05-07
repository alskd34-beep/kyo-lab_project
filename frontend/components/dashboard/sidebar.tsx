'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Home,
  FlaskConical,
  Box,
  ShieldCheck,
  AlertTriangle,
  FileText,
  BarChart2,
  Cpu,
  Settings,
  Star,
  X,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────
interface SubItem {
  id: string
  label: string
  live?: boolean
}

interface NavItem {
  id: string
  icon: React.ReactNode
  label: string
  badge?: number
  live?: boolean
  subItems?: SubItem[]
}

// ─── Nav Data ─────────────────────────────────────────────────────────────────
const NAV_ITEMS: NavItem[] = [
  { id: 'home', icon: <Home size={17} />, label: '홈', live: true },
  {
    id: 'test-mgmt',
    icon: <FlaskConical size={17} />,
    label: '시험관리',
    subItems: [
      { id: 'test-status', label: '시험현황',   live: true },
      { id: 'test-reg',    label: '시험등록',   live: true },
      { id: 'test-result', label: '결과입력' },
      { id: 'test-cert',   label: '성적서관리' },
      { id: 'test-items',  label: '시험항목관리', live: true },
      { id: 'test-master', label: '시험항목마스터', live: true },
      { id: 'testers',     label: '시험자 관리',   live: true },
    ],
  },
  {
    id: 'product-test',
    icon: <Box size={17} />,
    label: '제품시험',
    subItems: [
      { id: 'prod-status', label: '제품시험현황', live: true },
      { id: 'prod-reg',    label: '완제품등록' },
      { id: 'prod-std',    label: '기준서관리' },
      { id: 'manhours',       label: '평균공수관리', live: true },
      { id: 'products-master', label: '품목마스터관리', live: true },
    ],
  },
  {
    id: 'stability',
    icon: <ShieldCheck size={17} />,
    label: '안정성시험',
    subItems: [
      { id: 'stab-status', label: '안정성현황' },
      { id: 'stab-plan',   label: '시험계획' },
      { id: 'stab-report', label: '결과보고' },
    ],
  },
  {
    id: 'deviation',
    icon: <AlertTriangle size={17} />,
    label: '일탈관리',
    badge: 3,
    subItems: [
      { id: 'oos',        label: 'OOS현황' },
      { id: 'capa',       label: 'CAPA관리' },
      { id: 'inv-report', label: '조사보고서' },
    ],
  },
  {
    id: 'documents',
    icon: <FileText size={17} />,
    label: '문서관리',
    subItems: [
      { id: 'doc-cert',      label: '성적서' },
      { id: 'doc-std',       label: '기준서' },
      { id: 'doc-sop',       label: 'SOP' },
      { id: 'doc-checklist', label: '체크리스트' },
    ],
  },
  {
    id: 'insights',
    icon: <BarChart2 size={17} />,
    label: '인사이트',
    subItems: [
      { id: 'dash',       label: '대시보드' },
      { id: 'stats',      label: '통계분석' },
      { id: 'ins-report', label: '리포트' },
    ],
  },
  {
    id: 'equipment',
    icon: <Cpu size={17} />,
    label: '장비관리',
    subItems: [
      { id: 'equip-operation', label: '장비 가동 현황' },
      { id: 'equip-backup',    label: '장비 백업 현황' },
      { id: 'equip-usage',     label: '장비 사용현황' },
      { id: 'equip-ai-maint',  label: '장비 예측 정비 AI' },
    ],
  },
]

const BOTTOM_NAV: NavItem[] = [
  {
    id: 'settings',
    icon: <Settings size={17} />,
    label: '설정',
    subItems: [
      { id: 'users',        label: '사용자관리', live: true },
      { id: 'roles',        label: '권한관리' },
      { id: 'sys-settings', label: '시스템설정' },
    ],
  },
]

const ALL_NAV = [...NAV_ITEMS, ...BOTTOM_NAV]

// ─── Route map ────────────────────────────────────────────────────────────────
// Maps nav IDs (top-level + sub) to actual app router paths.
const PATH_MAP: Record<string, string> = {
  home: '/home',
  // 시험관리
  'test-status': '/test-mgmt/test-status',
  'test-reg':    '/test-mgmt/test-reg',
  'test-result': '/test-mgmt/test-result',
  'test-cert':   '/test-mgmt/test-cert',
  'test-items':  '/test-mgmt/test-items',
  'test-master': '/test-mgmt/test-master',
  'testers':     '/test-mgmt/testers',
  // 제품시험
  'prod-status': '/product-test/prod-status',
  'prod-reg':    '/product-test/prod-reg',
  'prod-std':    '/product-test/prod-std',
  'manhours':        '/product-test/manhours',
  'products-master': '/product-test/products',
  // 안정성시험
  'stab-status': '/stability/stab-status',
  'stab-plan':   '/stability/stab-plan',
  'stab-report': '/stability/stab-report',
  // 일탈관리
  'oos':        '/deviation/oos',
  'capa':       '/deviation/capa',
  'inv-report': '/deviation/inv-report',
  // 문서관리
  'doc-cert':      '/documents/doc-cert',
  'doc-std':       '/documents/doc-std',
  'doc-sop':       '/documents/doc-sop',
  'doc-checklist': '/documents/doc-checklist',
  // 인사이트
  'dash':       '/insights/dash',
  'stats':      '/insights/stats',
  'ins-report': '/insights/ins-report',
  // 장비관리
  'equip-operation': '/equipment/equip-operation',
  'equip-backup':    '/equipment/equip-backup',
  'equip-usage':     '/equipment/equip-usage',
  'equip-ai-maint':  '/equipment/equip-ai-maint',
  // 설정
  'users':        '/settings/users',
  'roles':        '/settings/roles',
  'sys-settings': '/settings/sys-settings',
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface SidebarProps {
  activeItem?: string
  onNavigate?: (navId: string, subId?: string) => void
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Sidebar({ activeItem = 'test-mgmt', onNavigate }: SidebarProps) {
  const router = useRouter()
  const [openMenu,   setOpenMenu]   = useState<string | null>(activeItem)
  const [hoverMenu,  setHoverMenu]  = useState<string | null>(null)
  const [favorites,  setFavorites]  = useState<Set<string>>(new Set())
  const [panelOpen,  setPanelOpen]  = useState(true)

  const hoverTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef   = useRef<HTMLDivElement>(null)

  // 사이드바 외부 클릭 시 서브메뉴 패널 자동 닫힘
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpenMenu(null)
        setHoverMenu(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Load favorites from localStorage
  useEffect(() => {
    try {
      const stored = localStorage.getItem('kd-qc-favorites')
      if (stored) setFavorites(new Set(JSON.parse(stored) as string[]))
    } catch {}
  }, [])

  const toggleFavorite = (subItemId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setFavorites(prev => {
      const next = new Set(prev)
      next.has(subItemId) ? next.delete(subItemId) : next.add(subItemId)
      localStorage.setItem('kd-qc-favorites', JSON.stringify([...next]))
      return next
    })
  }

  const handleNavClick = (item: NavItem) => {
    if (!item.subItems) {
      setOpenMenu(null)
      setHoverMenu(null)
      onNavigate?.(item.id)
      const path = PATH_MAP[item.id]
      if (path) router.push(path)
      return
    }
    // Toggle: clicking active item closes it
    setOpenMenu(prev => {
      const next = prev === item.id ? null : item.id
      setPanelOpen(next !== null)
      return next
    })
    setHoverMenu(null)
  }

  const handleSubItemSelect = (navId: string, subId: string) => {
    onNavigate?.(navId, subId)
    const path = PATH_MAP[subId]
    if (path) router.push(path)
  }

  const clearTimers = () => {
    if (hoverTimer.current) clearTimeout(hoverTimer.current)
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
  }

  const handleItemMouseEnter = (itemId: string, hasSubItems: boolean) => {
    clearTimers()
    if (hasSubItems && openMenu !== itemId) {
      hoverTimer.current = setTimeout(() => {
        setHoverMenu(itemId)
        setPanelOpen(true)
      }, 180)
    }
  }

  const handleSidebarMouseLeave = () => {
    clearTimers()
    leaveTimer.current = setTimeout(() => setHoverMenu(null), 350)
  }

  const handlePanelMouseEnter = () => clearTimers()

  const handlePanelMouseLeave = () => {
    clearTimers()
    leaveTimer.current = setTimeout(() => setHoverMenu(null), 300)
  }

  const togglePanel = () => {
    setPanelOpen(prev => {
      const next = !prev
      if (!next) {
        setOpenMenu(null)
        setHoverMenu(null)
      }
      return next
    })
  }

  // Panel to display: explicit click wins over hover
  const visibleMenuId   = openMenu ?? hoverMenu
  const activeMenuData  = visibleMenuId ? ALL_NAV.find(n => n.id === visibleMenuId) : null
  // Panel visibility controlled by user toggle
  const isPanelOpen     = panelOpen

  // Aggregated favorites across all categories (for the always-on favorites view)
  const favoritesByCategory = ALL_NAV
    .map(nav => ({
      nav,
      favItems: nav.subItems?.filter(si => favorites.has(si.id)) ?? [],
    }))
    .filter(group => group.favItems.length > 0)

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>

      {/*
        ── Flex row wrapper ───────────────────────────────────────────────────
        Both the icon-rail and the submenu panel live here as flex siblings.
        The wrapper's total width expands/contracts → main content auto-adjusts.
      */}
      <div ref={wrapperRef} className="relative flex h-full shrink-0 z-40">

        {/* Floating expand button — visible when 2nd panel is collapsed */}
        {!isPanelOpen && (
          <button
            onClick={togglePanel}
            title="패널 펼치기"
            className="absolute left-[65px] top-1/2 z-50 -translate-y-1/2 flex h-10 w-5 items-center justify-center rounded-r-lg bg-slate-700 text-slate-300 shadow-xl hover:bg-slate-600 transition-colors"
          >
            <ChevronRight size={14} />
          </button>
        )}

        {/* ── Icon rail ──────────────────────────────────────────────────── */}
        <aside
          onMouseLeave={handleSidebarMouseLeave}
          className="flex flex-col shrink-0 h-full transition-[width] duration-300 overflow-hidden"
          style={{ width: 65, backgroundColor: '#1a1f2e' } as React.CSSProperties}
        >
          {/* Logo */}
          <div className="flex items-center justify-center py-3.5 shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-blue-600 shadow-lg shadow-blue-900/50">
              <span className="text-xs font-bold tracking-tight text-white">KD</span>
            </div>
          </div>

          <div className="mx-3 mb-1 h-px bg-white/8 shrink-0" />

          {/* Main nav */}
          <nav className="flex flex-1 flex-col items-center gap-0.5 px-2 py-1 overflow-y-auto overflow-x-hidden">
            {NAV_ITEMS.map(item => {
              const isOpen        = openMenu    === item.id
              const isHighlighted = visibleMenuId === item.id
              const hasLive       = item.live || item.subItems?.some(s => s.live)

              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item)}
                  onMouseEnter={() => handleItemMouseEnter(item.id, !!item.subItems)}
                  className={`
                    relative flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2.5
                    transition-all duration-150 cursor-pointer select-none
                    ${isHighlighted
                      ? 'bg-white/14 text-white'
                      : 'text-slate-400 hover:bg-white/7 hover:text-slate-200'}
                  `}
                >
                  {isOpen && (
                    <span className="absolute left-0 top-3 bottom-3 w-0.5 rounded-r-full bg-blue-500" />
                  )}
                  <div className="relative">
                    {item.icon}
                    {item.badge != null && (
                      <span className="absolute -right-1.5 -top-1.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] font-bold text-white leading-none">
                        {item.badge}
                      </span>
                    )}
                    {hasLive && item.badge == null && (
                      <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-[#1a1f2e]" />
                    )}
                  </div>
                  <span className="text-[9.5px] font-medium leading-none tracking-tight text-center w-full truncate">
                    {item.label}
                  </span>
                </button>
              )
            })}
          </nav>

          {/* Bottom nav */}
          <div className="flex flex-col items-center gap-0.5 px-2 py-2 border-t border-white/8 shrink-0">
            {BOTTOM_NAV.map(item => {
              const hasLive = item.live || item.subItems?.some(s => s.live)
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item)}
                  onMouseEnter={() => handleItemMouseEnter(item.id, !!item.subItems)}
                  className={`
                    relative flex w-full flex-col items-center gap-1 rounded-xl px-1 py-2
                    transition-colors cursor-pointer select-none
                    ${visibleMenuId === item.id
                      ? 'bg-white/14 text-white'
                      : 'text-slate-500 hover:bg-white/7 hover:text-slate-300'}
                  `}
                >
                  <div className="relative">
                    {item.icon}
                    {hasLive && (
                      <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-[#1a1f2e]" />
                    )}
                  </div>
                  <span className="text-[9.5px] font-medium leading-none">{item.label}</span>
                </button>
              )
            })}

          </div>
        </aside>

        {/* ── Submenu panel (inline flex sibling, not fixed) ─────────────── */}
        <div
          onMouseEnter={handlePanelMouseEnter}
          onMouseLeave={handlePanelMouseLeave}
          className="flex flex-col shrink-0 bg-white border-r border-slate-100 shadow-[2px_0_12px_-2px_rgba(0,0,0,0.08)] overflow-hidden transition-[width] duration-200"
          style={{ width: isPanelOpen ? 210 : 0 }}
        >
          {/* Fixed-width inner prevents layout jitter during transition */}
          <div className="flex flex-col h-full" style={{ width: 210 }}>
            {/* Panel header — always shows. Title reflects selected menu, defaults to 즐겨찾기 */}
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3.5 shrink-0">
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 items-center justify-center text-slate-400">
                  {activeMenuData ? activeMenuData.icon : <Star size={14} fill="currentColor" className="text-amber-400" />}
                </span>
                <span className="text-sm font-semibold text-slate-800">
                  {activeMenuData ? activeMenuData.label : '즐겨찾기'}
                </span>
              </div>
              <button
                onClick={() => { setOpenMenu(null); setHoverMenu(null); setPanelOpen(false) }}
                title="패널 닫기"
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-colors"
              >
                <X size={13} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto py-2 px-2">
              {/* ── Favorites: always visible, shared across all menus ──────── */}
              <div className="mb-1">
                <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                  즐겨찾기
                </p>
                {favoritesByCategory.length === 0 ? (
                  <p className="px-2 py-1.5 text-[11px] text-slate-400">
                    별표를 눌러 즐겨찾기에 추가하세요
                  </p>
                ) : (
                  favoritesByCategory.map(({ nav, favItems }) =>
                    favItems.map(sub => (
                      <SubItemRow
                        key={`fav-${sub.id}`}
                        sub={sub}
                        isFav
                        onFavToggle={toggleFavorite}
                        onSelect={() => handleSubItemSelect(nav.id, sub.id)}
                      />
                    ))
                  )
                )}
                <div className="my-2 mx-2 border-t border-slate-100" />
              </div>

              {/* ── Selected menu's sub-items (when a menu is open) ─────────── */}
              {activeMenuData?.subItems && (
                <div>
                  <p className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                    {activeMenuData.label}
                  </p>
                  {activeMenuData.subItems.map(sub => (
                    <SubItemRow
                      key={sub.id}
                      sub={sub}
                      isFav={favorites.has(sub.id)}
                      onFavToggle={toggleFavorite}
                      onSelect={() => handleSubItemSelect(activeMenuData.id, sub.id)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Sub-item Row ─────────────────────────────────────────────────────────────
interface SubItemRowProps {
  sub: SubItem
  isFav: boolean
  onFavToggle: (id: string, e: React.MouseEvent) => void
  onSelect: () => void
}

function SubItemRow({ sub, isFav, onFavToggle, onSelect }: SubItemRowProps) {
  return (
    <div className="group relative flex w-full items-center rounded-lg transition-colors hover:bg-slate-50 active:bg-slate-100">
      <button
        onClick={onSelect}
        className="flex-1 min-w-0 rounded-lg px-2.5 py-2 text-left flex items-center gap-2"
      >
        {sub.live && (
          <span className="shrink-0 h-2 w-2 rounded-full bg-emerald-400" />
        )}
        <span className="text-sm text-slate-600 group-hover:text-slate-900 transition-colors">
          {sub.label}
        </span>
      </button>
      <button
        onClick={e => onFavToggle(sub.id, e)}
        className={`
          shrink-0 rounded p-0.5 mr-2 transition-all
          ${isFav
            ? 'text-amber-400 hover:text-amber-500'
            : 'text-transparent group-hover:text-slate-300 hover:!text-amber-400'}
        `}
      >
        <Star size={12} fill={isFav ? 'currentColor' : 'none'} />
      </button>
    </div>
  )
}
