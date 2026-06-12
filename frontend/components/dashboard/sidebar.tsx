"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { cn } from "@frontend/lib/utils"
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
  ChevronRight,
  Calendar,
} from "lucide-react"

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
  /** subItems가 있어도 상단 클릭 시 이 경로로 바로 이동 (서브패널도 함께 열림) */
  defaultPath?: string
}

// ─── Nav Data ─────────────────────────────────────────────────────────────────
const NAV_ITEMS: NavItem[] = [
  { id: "home", icon: <Home size={17} />, label: "홈", live: true },
  {
    // 스케줄 — 홈 바로 아래로 이동. 클릭 시 PCT로 바로 이동.
    id: "schedule",
    icon: <Calendar size={17} />,
    label: "스케줄",
    live: true,
    defaultPath: "/schedule/pct",
    subItems: [
      { id: "schedule-pct", label: "AI 스케줄", live: true },
      // 주간 계획(자동) — 블라인드 처리. 추후 미사용 확정 시 page/유틸/route map까지 삭제.
      // { id: 'schedule-weekly-plan', label: '주간 계획 (자동)', live: true },
      // 주간 스케줄(AI) — 미사용. 숨김 처리 (월간 스케줄의 "주간 보드" 탭으로 대체). 추후 불필요 시 삭제.
      // { id: 'schedule-weekly',      label: '주간 스케줄 (AI)', live: true },
      { id: "schedule-monthly", label: "월간 스케줄", live: true },
    ],
  },
  {
    id: "test-mgmt",
    icon: <FlaskConical size={17} />,
    label: "시험관리",
    subItems: [
      { id: "test-status", label: "시험현황", live: true },
      { id: "test-reg", label: "시험등록", live: true },
      { id: "test-result", label: "결과입력" },
      { id: "test-cert", label: "성적서관리" },
      { id: "test-items", label: "시험항목관리", live: true },
      { id: "test-master", label: "시험항목마스터", live: true },
      { id: "testers", label: "시험자 관리", live: true },
    ],
  },
  {
    id: "product-test",
    icon: <Box size={17} />,
    label: "제품시험",
    subItems: [
      { id: "prod-status", label: "제품시험현황", live: true },
      { id: "prod-reg", label: "완제품등록" },
      { id: "prod-std", label: "기준서관리" },
      { id: "manhours", label: "평균공수관리", live: true },
      { id: "products-master", label: "품목마스터관리", live: true },
    ],
  },
  {
    id: "stability",
    icon: <ShieldCheck size={17} />,
    label: "안정성시험",
    subItems: [
      { id: "stab-status", label: "안정성현황" },
      { id: "stab-plan", label: "시험계획" },
      { id: "stab-report", label: "결과보고" },
    ],
  },
  {
    id: "deviation",
    icon: <AlertTriangle size={17} />,
    label: "일탈관리",
    badge: 3,
    subItems: [
      { id: "oos", label: "OOS현황" },
      { id: "capa", label: "CAPA관리" },
      { id: "inv-report", label: "조사보고서" },
    ],
  },
  {
    id: "documents",
    icon: <FileText size={17} />,
    label: "문서관리",
    subItems: [
      { id: "doc-cert", label: "성적서" },
      { id: "doc-std", label: "기준서" },
      { id: "doc-sop", label: "SOP" },
      { id: "doc-checklist", label: "체크리스트" },
    ],
  },
  {
    id: "insights",
    icon: <BarChart2 size={17} />,
    label: "인사이트",
    subItems: [
      { id: "dash", label: "대시보드" },
      { id: "stats", label: "통계분석" },
      { id: "ins-report", label: "리포트" },
    ],
  },
  {
    id: "equipment",
    icon: <Cpu size={17} />,
    label: "장비관리",
    subItems: [
      { id: "equip-operation", label: "장비 가동 현황" },
      { id: "equip-backup", label: "장비 백업 현황" },
      { id: "equip-usage", label: "장비 사용현황" },
      { id: "equip-ai-maint", label: "장비 예측 정비 AI" },
    ],
  },
]

const BOTTOM_NAV: NavItem[] = [
  {
    id: "settings",
    icon: <Settings size={17} />,
    label: "설정",
    subItems: [
      { id: "users", label: "사용자관리", live: true },
      { id: "roles", label: "권한관리" },
      { id: "sys-settings", label: "시스템설정" },
    ],
  },
]

const ALL_NAV = [...NAV_ITEMS, ...BOTTOM_NAV]

// ─── Route map ────────────────────────────────────────────────────────────────
// Maps nav IDs (top-level + sub) to actual app router paths.
const PATH_MAP: Record<string, string> = {
  home: "/home",
  // 스케줄
  "schedule-pct": "/schedule/pct",
  "schedule-weekly-plan": "/schedule/weekly-plan",
  "schedule-weekly": "/schedule/weekly",
  "schedule-monthly": "/schedule/monthly",
  // 시험관리
  "test-status": "/test-mgmt/test-status",
  "test-reg": "/test-mgmt/test-reg",
  "test-result": "/test-mgmt/test-result",
  "test-cert": "/test-mgmt/test-cert",
  "test-items": "/test-mgmt/test-items",
  "test-master": "/test-mgmt/test-master",
  testers: "/test-mgmt/testers",
  // 제품시험
  "prod-status": "/product-test/prod-status",
  "prod-reg": "/product-test/prod-reg",
  "prod-std": "/product-test/prod-std",
  manhours: "/product-test/manhours",
  "products-master": "/product-test/products",
  // 안정성시험
  "stab-status": "/stability/stab-status",
  "stab-plan": "/stability/stab-plan",
  "stab-report": "/stability/stab-report",
  // 일탈관리
  oos: "/deviation/oos",
  capa: "/deviation/capa",
  "inv-report": "/deviation/inv-report",
  // 문서관리
  "doc-cert": "/documents/doc-cert",
  "doc-std": "/documents/doc-std",
  "doc-sop": "/documents/doc-sop",
  "doc-checklist": "/documents/doc-checklist",
  // 인사이트
  dash: "/insights/dash",
  stats: "/insights/stats",
  "ins-report": "/insights/ins-report",
  // 장비관리
  "equip-operation": "/equipment/equip-operation",
  "equip-backup": "/equipment/equip-backup",
  "equip-usage": "/equipment/equip-usage",
  "equip-ai-maint": "/equipment/equip-ai-maint",
  // 설정
  users: "/settings/users",
  roles: "/settings/roles",
  "sys-settings": "/settings/sys-settings",
}

// ─── Props ────────────────────────────────────────────────────────────────────
interface SidebarProps {
  activeItem?: string
  onNavigate?: (navId: string, subId?: string) => void
  /** Mobile drawer open state. Ignored on lg+ breakpoint (always visible). */
  isOpen?: boolean
  /** Called when the drawer requests close (backdrop click, ESC, sub-item nav). */
  onClose?: () => void
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Sidebar({
  activeItem = "test-mgmt",
  onNavigate,
  isOpen = false,
  onClose,
}: SidebarProps) {
  const router = useRouter()
  const [openMenu, setOpenMenu] = useState<string | null>(activeItem)
  const [hoverMenu, setHoverMenu] = useState<string | null>(null)
  const [favorites, setFavorites] = useState<Set<string>>(new Set())
  const [panelOpen, setPanelOpen] = useState(true)

  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // 사이드바 외부 클릭 시 hover 미리보기만 닫고 선택된 메뉴는 유지한다.
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setHoverMenu(null)
      }
    }
    document.addEventListener("mousedown", handleClickOutside)
    return () => document.removeEventListener("mousedown", handleClickOutside)
  }, [])

  // 저장된 즐겨찾기는 렌더 이후에 복원해 하이드레이션 표시 차이를 피한다.
  useEffect(() => {
    let mounted = true

    queueMicrotask(() => {
      try {
        const stored = localStorage.getItem("kd-qc-favorites")
        if (mounted && stored)
          setFavorites(new Set(JSON.parse(stored) as string[]))
      } catch {}
    })

    return () => {
      mounted = false
    }
  }, [])

  const toggleFavorite = (subItemId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setFavorites((prev) => {
      const next = new Set(prev)
      if (next.has(subItemId)) {
        next.delete(subItemId)
      } else {
        next.add(subItemId)
      }
      localStorage.setItem("kd-qc-favorites", JSON.stringify([...next]))
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
      onClose?.()
      return
    }
    // Toggle: clicking active item closes it
    const nextOpenMenu = openMenu === item.id ? null : item.id
    setOpenMenu(nextOpenMenu)
    setPanelOpen(nextOpenMenu !== null)

    // 메뉴를 "여는" 클릭이고 defaultPath가 있으면 해당 기본 페이지로 바로 이동
    if (nextOpenMenu !== null && item.defaultPath) {
      onNavigate?.(item.id)
      router.push(item.defaultPath)
      onClose?.()
    }
    setHoverMenu(null)
  }

  const handleSubItemSelect = (navId: string, subId: string) => {
    onNavigate?.(navId, subId)
    const path = PATH_MAP[subId]
    if (path) router.push(path)
    onClose?.()
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
    setPanelOpen((prev) => {
      const next = !prev
      if (!next) {
        setOpenMenu(null)
        setHoverMenu(null)
      }
      return next
    })
  }

  // Panel to display: explicit click wins over hover
  const visibleMenuId = openMenu ?? hoverMenu
  const activeMenuData = visibleMenuId
    ? ALL_NAV.find((n) => n.id === visibleMenuId)
    : null
  // Panel visibility controlled by user toggle
  const isPanelOpen = panelOpen

  // Aggregated favorites across all categories (for the always-on favorites view)
  const favoritesByCategory = ALL_NAV.map((nav) => ({
    nav,
    favItems: nav.subItems?.filter((si) => favorites.has(si.id)) ?? [],
  })).filter((group) => group.favItems.length > 0)

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <>
      {/*
        ── Flex row wrapper ───────────────────────────────────────────────────
        Both the icon-rail and the submenu panel live here as flex siblings.
        The wrapper's total width expands/contracts → main content auto-adjusts.

        Responsive:
        - lg+ (≥1024px): inline flex sibling — pushes main content (existing behavior).
        - <lg: fixed left drawer, slides in/out via `isOpen` prop, z-50 overlay.
      */}
      <div
        ref={wrapperRef}
        className={cn(
          "flex h-full shrink-0",
          "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:w-[min(92vw,24rem)]",
          "max-lg:rounded-r-[24px] max-lg:border-r max-lg:border-slate-800/80 max-lg:bg-slate-950 max-lg:shadow-[24px_0_60px_rgba(15,23,42,0.32)]",
          "max-lg:transition-transform max-lg:duration-300 max-lg:ease-out",
          isOpen ? "max-lg:translate-x-0" : "max-lg:-translate-x-full",
          "lg:relative lg:z-40 lg:translate-x-0"
        )}
      >
        {/* Floating expand button — visible when 2nd panel is collapsed */}
        {!isPanelOpen && (
          <button
            onClick={togglePanel}
            title="패널 펼치기"
            className="absolute top-1/2 left-[72px] z-50 flex h-10 w-5 -translate-y-1/2 items-center justify-center rounded-r-lg border border-slate-700 bg-slate-800 text-slate-200 shadow-[0_10px_24px_rgba(15,23,42,0.28)] transition-colors hover:bg-slate-700"
          >
            <ChevronRight size={14} />
          </button>
        )}

        {/* ── Icon rail ──────────────────────────────────────────────────── */}
        <aside
          onMouseLeave={handleSidebarMouseLeave}
          className="flex h-full w-[72px] shrink-0 flex-col overflow-hidden border-r border-slate-800/80 bg-slate-950 text-slate-300 transition-[width] duration-300"
        >
          {/* Brand */}
          <div className="flex shrink-0 flex-col items-center gap-2 px-2 py-4">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg ring-1 shadow-blue-900/40 ring-white/10">
              <span className="text-sm font-bold tracking-tight">KD</span>
            </div>
            <div className="text-center leading-none">
              <p className="text-[9px] font-semibold tracking-[0.28em] text-slate-500 uppercase">
                QC
              </p>
              <p className="mt-1 text-[10px] font-medium text-slate-400">
                관리
              </p>
            </div>
          </div>

          <div className="mx-3 mb-2 h-px shrink-0 bg-white/5" />

          <div className="px-3 pb-1">
            <p className="text-[10px] font-semibold tracking-[0.26em] text-slate-500 uppercase">
              MENU
            </p>
          </div>

          {/* Main nav */}
          <nav className="flex flex-1 flex-col items-center gap-1 overflow-x-hidden overflow-y-auto px-2 py-1">
            {NAV_ITEMS.map((item) => {
              const isOpen = openMenu === item.id
              const isHighlighted = visibleMenuId === item.id
              const hasLive = item.live || item.subItems?.some((s) => s.live)

              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item)}
                  onMouseEnter={() =>
                    handleItemMouseEnter(item.id, !!item.subItems)
                  }
                  className={cn(
                    "relative flex w-full cursor-pointer flex-col items-center gap-1 rounded-2xl px-2 py-3 text-center transition-all duration-200 select-none",
                    "overflow-hidden border border-transparent",
                    isHighlighted
                      ? "bg-white text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.28)] ring-1 ring-white/10"
                      : "text-slate-400 hover:border-white/5 hover:bg-white/[0.06] hover:text-slate-100"
                  )}
                >
                  {isOpen && (
                    <span className="absolute top-3 bottom-3 left-0 w-1 rounded-r-full bg-blue-500" />
                  )}
                  <div className="relative">
                    {item.icon}
                    {item.badge != null && (
                      <span className="absolute -top-1.5 -right-1.5 flex h-[14px] min-w-[14px] items-center justify-center rounded-full bg-red-500 px-0.5 text-[9px] leading-none font-bold text-white">
                        {item.badge}
                      </span>
                    )}
                    {hasLive && item.badge == null && (
                      <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-[#1a1f2e]" />
                    )}
                  </div>
                  <span className="w-full truncate text-center text-[9.5px] leading-none font-medium tracking-tight">
                    {item.label}
                  </span>
                </button>
              )
            })}
          </nav>

          {/* Bottom nav */}
          <div className="flex shrink-0 flex-col items-center gap-1 border-t border-white/5 px-2 py-2">
            <div className="mb-1 w-full px-1">
              <p className="text-[10px] font-semibold tracking-[0.26em] text-slate-500 uppercase">
                SETTINGS
              </p>
            </div>
            {BOTTOM_NAV.map((item) => {
              const hasLive = item.live || item.subItems?.some((s) => s.live)
              return (
                <button
                  key={item.id}
                  onClick={() => handleNavClick(item)}
                  onMouseEnter={() =>
                    handleItemMouseEnter(item.id, !!item.subItems)
                  }
                  className={cn(
                    "relative flex w-full cursor-pointer flex-col items-center gap-1 rounded-2xl border border-transparent px-2 py-3 text-center transition-all select-none",
                    visibleMenuId === item.id
                      ? "bg-white text-slate-900 shadow-[0_10px_24px_rgba(15,23,42,0.28)] ring-1 ring-white/10"
                      : "text-slate-500 hover:border-white/5 hover:bg-white/[0.06] hover:text-slate-100"
                  )}
                >
                  <div className="relative">
                    {item.icon}
                    {hasLive && (
                      <span className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-emerald-400 ring-1 ring-[#1a1f2e]" />
                    )}
                  </div>
                  <span className="text-[9.5px] leading-none font-medium tracking-tight">
                    {item.label}
                  </span>
                </button>
              )
            })}
          </div>
        </aside>

        {/* ── Submenu panel (inline flex sibling, not fixed) ─────────────── */}
        <div
          onMouseEnter={handlePanelMouseEnter}
          onMouseLeave={handlePanelMouseLeave}
          className="flex shrink-0 flex-col overflow-hidden border-r border-slate-200 bg-white/95 shadow-[8px_0_30px_rgba(15,23,42,0.08)] backdrop-blur transition-[width] duration-200"
          style={{ width: isPanelOpen ? 246 : 0 }}
        >
          {/* Fixed-width inner prevents layout jitter during transition */}
          <div className="flex h-full flex-col" style={{ width: 246 }}>
            {/* Panel header — always shows. Title reflects selected menu, defaults to 즐겨찾기 */}
            <div className="flex shrink-0 items-start justify-between border-b border-slate-100 bg-slate-50/80 px-4 py-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center text-slate-500">
                    {activeMenuData ? (
                      activeMenuData.icon
                    ) : (
                      <Star
                        size={15}
                        fill="currentColor"
                        className="text-amber-400"
                      />
                    )}
                  </span>
                  <span className="truncate text-sm font-semibold text-slate-900">
                    {activeMenuData ? activeMenuData.label : "즐겨찾기"}
                  </span>
                  {activeMenuData?.badge != null && (
                    <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-semibold text-red-600">
                      {activeMenuData.badge}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-[11px] leading-tight text-slate-500">
                  {activeMenuData
                    ? "선택한 영역의 세부 메뉴입니다."
                    : "자주 쓰는 항목을 빠르게 열 수 있습니다."}
                </p>
              </div>
              <button
                onClick={() => {
                  setOpenMenu(null)
                  setHoverMenu(null)
                  setPanelOpen(false)
                }}
                title="패널 닫기"
                className="rounded-full border border-slate-200 bg-white p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <X size={14} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 py-3">
              {/* ── Favorites: always visible, shared across all menus ──────── */}
              <div className="mb-2">
                <p className="mb-2 px-2 text-[10px] font-semibold tracking-[0.26em] text-slate-400 uppercase">
                  즐겨찾기
                </p>
                {favoritesByCategory.length === 0 ? (
                  <p className="px-2 py-2 text-[11px] leading-relaxed text-slate-400">
                    별표를 눌러 즐겨찾기에 추가하세요
                  </p>
                ) : (
                  favoritesByCategory.map(({ nav, favItems }) =>
                    favItems.map((sub) => (
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
                <div className="mx-2 my-3 border-t border-slate-100" />
              </div>

              {/* ── Selected menu's sub-items (when a menu is open) ─────────── */}
              {activeMenuData?.subItems && (
                <div>
                  <p className="mb-2 px-2 text-[10px] font-semibold tracking-[0.26em] text-slate-400 uppercase">
                    {activeMenuData.label}
                  </p>
                  {activeMenuData.subItems.map((sub) => (
                    <SubItemRow
                      key={sub.id}
                      sub={sub}
                      isFav={favorites.has(sub.id)}
                      onFavToggle={toggleFavorite}
                      onSelect={() =>
                        handleSubItemSelect(activeMenuData.id, sub.id)
                      }
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
    <div className="group relative flex w-full items-center rounded-xl border border-transparent transition-all hover:border-slate-200 hover:bg-slate-50 active:bg-slate-100">
      <button
        onClick={onSelect}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-3 py-2.5 text-left"
      >
        {sub.live && (
          <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-400 ring-2 ring-white" />
        )}
        <span className="text-sm font-medium text-slate-600 transition-colors group-hover:text-slate-900">
          {sub.label}
        </span>
      </button>
      <button
        onClick={(e) => onFavToggle(sub.id, e)}
        className={cn(
          "mr-2 shrink-0 rounded-full p-1 transition-all",
          isFav
            ? "text-amber-400 hover:bg-amber-50 hover:text-amber-500"
            : "text-transparent group-hover:text-slate-300 hover:bg-slate-100 hover:!text-amber-400"
        )}
      >
        <Star size={12} fill={isFav ? "currentColor" : "none"} />
      </button>
    </div>
  )
}
