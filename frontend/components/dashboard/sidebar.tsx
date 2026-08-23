"use client"

import { useState } from "react"
import { useRouter, usePathname } from "next/navigation"
import { cn } from "@frontend/lib/utils"
import { useAuth } from "@frontend/lib/auth-context"
import {
  Home,
  FlaskConical,
  ShieldCheck,
  AlertTriangle,
  FileText,
  BarChart2,
  Cpu,
  Settings,
  Calendar,
  ChevronDown,
  PanelLeftClose,
  PanelLeft,
  HelpCircle,
  LogOut,
  ClipboardList,
  SlidersHorizontal,
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────
interface SubItem {
  id: string
  label: string
  live?: boolean
  adminOnly?: boolean
}

interface NavItem {
  id: string
  icon: React.ReactNode
  label: string
  badge?: number
  live?: boolean
  subItems?: SubItem[]
  /** subItems가 있어도 상단 클릭 시 이 경로로 바로 이동 (서브메뉴도 함께 열림) */
  defaultPath?: string
  adminOnly?: boolean
  /** 개발 보류 등으로 메뉴에서 임시 숨김 (true면 사이드바에 미표시) */
  hidden?: boolean
}

interface NavSection {
  title: string
  items: NavItem[]
}

// ─── Nav Data ─────────────────────────────────────────────────────────────────
const NAV_SECTIONS: NavSection[] = [
  {
    title: "메뉴",
    items: [
      { id: "home", icon: <Home size={18} />, label: "홈", live: true },
      {
        id: "schedule",
        icon: <Calendar size={18} />,
        label: "스케줄",
        live: true,
        defaultPath: "/schedule/orders",
        subItems: [
          { id: "schedule-monthly", label: "월간 스케줄", live: true },
          { id: "schedule-orders", label: "AI 스케줄", live: true, adminOnly: true },
          { id: "schedule-vacation", label: "휴가 캘린더", live: true },
          { id: "schedule-holidays", label: "공휴일 캘린더", live: true, adminOnly: true },
          { id: "schedule-reassign", label: "재배정 이력", live: true, adminOnly: true },
          { id: "schedule-dashboard", label: "관리자 대시보드", live: true, adminOnly: true },
        ],
      },
      { id: "my-tasks", icon: <ClipboardList size={18} />, label: "내 작업", live: true },
      {
        id: "test-mgmt",
        icon: <FlaskConical size={18} />,
        label: "시험관리",
        subItems: [
          { id: "prod-status", label: "제품시험현황", live: true },
          { id: "test-result", label: "결과입력", adminOnly: true },
          { id: "test-cert", label: "성적서관리", adminOnly: true },
          { id: "testers", label: "시험자 관리", live: true, adminOnly: true },
        ],
      },
      {
        id: "stability",
        icon: <ShieldCheck size={18} />,
        label: "안정성시험",
        subItems: [
          // 안정성현황은 구글시트(안정성시험 계획) 연동으로 실제 데이터가 표시된다 → live
          { id: "stab-status", label: "안정성현황", live: true },
          { id: "stab-plan", label: "시험계획" },
          { id: "stab-report", label: "결과보고" },
        ],
      },
    ],
  },
  {
    title: "관리",
    items: [
      {
        id: "deviation",
        icon: <AlertTriangle size={18} />,
        label: "일탈관리",
        adminOnly: true,
        subItems: [
          { id: "oos", label: "OOS현황" },
          { id: "capa", label: "CAPA관리" },
          { id: "inv-report", label: "조사보고서" },
        ],
      },
      {
        id: "documents",
        icon: <FileText size={18} />,
        label: "문서관리",
        hidden: true,  // 개발 보류로 임시 숨김 (2026-06-15). 재개 시 이 줄을 제거하거나 false로.
        subItems: [
          { id: "doc-cert", label: "성적서" },
          { id: "doc-std", label: "기준서" },
          { id: "doc-sop", label: "SOP" },
          { id: "doc-checklist", label: "체크리스트" },
        ],
      },
      {
        id: "insights",
        icon: <BarChart2 size={18} />,
        label: "인사이트",
        subItems: [
          { id: "dash", label: "대시보드", adminOnly: true },
          { id: "stats", label: "운영평가", live: true, adminOnly: true },
          { id: "workload", label: "품목별 시험공수 관리", live: true, adminOnly: true },
          { id: "ins-report", label: "리포트", adminOnly: true },
        ],
      },
      {
        id: "equipment",
        icon: <Cpu size={18} />,
        label: "장비관리",
        subItems: [
          { id: "equip-master", label: "장비 마스터", live: true, adminOnly: true },
          { id: "equip-reservation", label: "장비 예약", live: true },
          { id: "equip-operation", label: "장비 가동 현황", adminOnly: true },
          { id: "equip-backup", label: "장비 백업 현황", adminOnly: true },
          { id: "equip-usage", label: "장비 사용현황", adminOnly: true },
          { id: "equip-ai-maint", label: "장비 예측 정비 AI", adminOnly: true },
        ],
      },
    ],
  },
  {
    title: "설정",
    items: [
      {
        id: "master-settings",
        icon: <SlidersHorizontal size={18} />,
        label: "기준 설정",
        adminOnly: true,
        subItems: [
          { id: "products-master", label: "품목 마스터", live: true },
          { id: "test-master", label: "시험항목 마스터", live: true },
          { id: "test-item-groups", label: "시험항목 그룹", live: true },
          { id: "test-items", label: "품목별 시험항목 관리", live: true },
          { id: "pretest-checklist", label: "시험 전 확인사항", live: true },
          { id: "concurrent-items", label: "동시분석 품목", live: true, adminOnly: true },
        ],
      },
      {
        id: "settings",
        icon: <Settings size={18} />,
        label: "계정 설정",
        adminOnly: true,
        subItems: [
          { id: "users", label: "사용자 관리", live: true, adminOnly: true },
          { id: "roles", label: "권한 관리", adminOnly: true },
          { id: "sys-settings", label: "시스템 설정" },
        ],
      },
    ],
  },
]

const ALL_NAV = NAV_SECTIONS.flatMap((s) => s.items)

// ─── Route map ────────────────────────────────────────────────────────────────
// Maps nav IDs (top-level + sub) to actual app router paths.
const PATH_MAP: Record<string, string> = {
  home: "/home",
  // 스케줄 — 주간 배정은 'AI 스케줄'(schedule-orders) 하나로 통합됐다(2026-08-22).
  "schedule-monthly": "/schedule/monthly",
  "schedule-orders": "/schedule/orders",
  "schedule-groups": "/schedule/groups",
  "schedule-vacation": "/schedule/vacation",
  "schedule-holidays": "/schedule/holidays",
  "schedule-reassign": "/schedule/reassignments",
  "schedule-dashboard": "/schedule/dashboard",
  "my-tasks": "/my-tasks",
  // 시험관리
  "test-status": "/test-mgmt/test-status",
  "test-result": "/test-mgmt/test-result",
  "test-cert": "/test-mgmt/test-cert",
  testers: "/test-mgmt/testers",
  // 제품시험
  "prod-status": "/product-test/prod-status",
  "prod-reg": "/product-test/prod-reg",
  "prod-std": "/product-test/prod-std",
  manhours: "/product-test/products",
  "products-master": "/product-test/products",
  "test-master": "/test-mgmt/test-master",
  "test-item-groups": "/test-mgmt/test-item-groups",
  "test-items": "/test-mgmt/test-items",
  "pretest-checklist": "/test-mgmt/pretest-checklist",
  "concurrent-items": "/settings/concurrent-items",
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
  workload: "/insights/workload",
  "ins-report": "/insights/ins-report",
  // 장비관리
  "equip-master": "/equipment/master",
  "equip-reservation": "/equipment/reservation",
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

// ─── Active route resolution ──────────────────────────────────────────────────
function resolveActive(pathname: string): {
  navId: string | null
  subId: string | null
} {
  for (const nav of ALL_NAV) {
    if (nav.subItems) {
      for (const sub of nav.subItems) {
        const p = PATH_MAP[sub.id]
        if (p && pathname.startsWith(p)) return { navId: nav.id, subId: sub.id }
      }
    }
    const np = PATH_MAP[nav.id]
    if (np && pathname.startsWith(np)) return { navId: nav.id, subId: null }
  }
  return { navId: null, subId: null }
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function Sidebar({
  onNavigate,
  isOpen = false,
  onClose,
}: SidebarProps) {
  const router = useRouter()
  const pathname = usePathname()
  const { logout, user } = useAuth()
  const isAdmin = user?.role === "admin"

  // 역할 기반 메뉴 필터 (adminOnly 항목은 admin에게만)
  const sections = NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items
      .filter((item) => !item.hidden && (!item.adminOnly || isAdmin))
      .map((item) => ({
        ...item,
        subItems: item.subItems?.filter((sub) => !sub.adminOnly || isAdmin),
      })),
  })).filter((section) => section.items.length > 0)

  const { navId: activeNavId, subId: activeSubId } = resolveActive(pathname ?? "")

  const [openMenus, setOpenMenus] = useState<Set<string>>(
    () => new Set(activeNavId ? [activeNavId] : [])
  )
  const [collapsed, setCollapsed] = useState(false)

  // 경로가 바뀌면 현재 경로가 속한 상위 메뉴를 자동으로 펼친다.
  // (effect 대신 렌더 중 이전 경로와 비교 — React 권장 패턴)
  const [prevPath, setPrevPath] = useState(pathname)
  if (pathname !== prevPath) {
    setPrevPath(pathname)
    if (activeNavId) {
      setOpenMenus((prev) =>
        prev.has(activeNavId) ? prev : new Set(prev).add(activeNavId)
      )
    }
  }

  const toggleMenu = (id: string) => {
    setOpenMenus((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleNavClick = (item: NavItem) => {
    // 접힌 상태에서 클릭 → 사이드바를 펼치고 해당 메뉴를 연다.
    if (collapsed) {
      setCollapsed(false)
      if (item.subItems) {
        setOpenMenus((prev) => new Set(prev).add(item.id))
        if (item.defaultPath) {
          onNavigate?.(item.id)
          router.push(item.defaultPath)
          onClose?.()
        }
        return
      }
    }

    if (!item.subItems) {
      onNavigate?.(item.id)
      const path = PATH_MAP[item.id]
      if (path) router.push(path)
      onClose?.()
      return
    }

    const willOpen = !openMenus.has(item.id)
    toggleMenu(item.id)
    if (willOpen && item.defaultPath) {
      onNavigate?.(item.id)
      router.push(item.defaultPath)
      onClose?.()
    }
  }

  const handleSubSelect = (navId: string, subId: string) => {
    onNavigate?.(navId, subId)
    const path = PATH_MAP[subId]
    if (path) router.push(path)
    onClose?.()
  }

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col border-r border-slate-200 bg-white text-slate-900",
        "transition-[width] duration-300 ease-out",
        // Desktop width (expand/collapse)
        collapsed ? "lg:w-[68px]" : "lg:w-[252px]",
        // Mobile drawer
        "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:w-[min(88vw,20rem)]",
        "max-lg:shadow-[20px_0_50px_rgba(15,23,42,0.18)]",
        "max-lg:transition-transform max-lg:duration-300",
        isOpen ? "max-lg:translate-x-0" : "max-lg:-translate-x-full",
        "lg:relative lg:z-40 lg:translate-x-0"
      )}
    >
      {/* ── Brand / header ────────────────────────────────────────────────── */}
      <div
        className={cn(
          "flex h-16 shrink-0 items-center border-b border-slate-100",
          collapsed ? "lg:justify-center lg:px-0" : "justify-between px-4"
        )}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-blue-600 text-sm font-bold tracking-tight text-white shadow-sm">
            KD
          </div>
          {!collapsed && (
            <div className="leading-tight">
              <p className="text-sm font-bold text-slate-900">QC 관리</p>
              <p className="text-[11px] font-medium text-slate-400">
                Quality Control
              </p>
            </div>
          )}
        </div>
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            title="사이드바 접기"
            className="hidden rounded-md p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 lg:block"
          >
            <PanelLeftClose size={18} />
          </button>
        )}
      </div>

      {/* Collapsed-state expand button */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          title="사이드바 펼치기"
          className="mx-auto mt-2 hidden rounded-md p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 lg:block"
        >
          <PanelLeft size={18} />
        </button>
      )}

      {/* ── Nav ───────────────────────────────────────────────────────────── */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-3 py-3">
        {sections.map((section) => (
          <div key={section.title} className="mb-4 last:mb-0">
            {!collapsed && (
              <p className="mb-1.5 px-2 text-[11px] font-semibold tracking-[0.12em] text-slate-400">
                {section.title.toUpperCase()}
              </p>
            )}
            <div className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const isOpenMenu = openMenus.has(item.id)
                const isActiveParent =
                  activeNavId === item.id && activeSubId === null
                const isActiveBranch = activeNavId === item.id

                return (
                  <div key={item.id}>
                    {/* Parent row */}
                    <button
                      onClick={() => handleNavClick(item)}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "group relative flex w-full items-center rounded-md text-left transition-colors",
                        collapsed
                          ? "lg:h-10 lg:w-10 lg:justify-center lg:mx-auto lg:px-0 px-3 py-2.5 gap-3"
                          : "gap-3 px-3 py-2.5",
                        isActiveParent
                          ? "bg-blue-50 text-blue-700"
                          : "text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                      )}
                    >
                      <span
                        className={cn(
                          "relative shrink-0",
                          isActiveBranch ? "text-blue-600" : "text-slate-500"
                        )}
                      >
                        {item.icon}
                        {item.badge != null && (
                          <span className="absolute -top-1.5 -right-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-bold leading-none text-white">
                            {item.badge}
                          </span>
                        )}
                      </span>
                      {!collapsed && (
                        <>
                          <span
                            className={cn(
                              "flex-1 truncate text-sm",
                              isActiveParent ? "font-semibold" : "font-medium"
                            )}
                          >
                            {item.label}
                          </span>
                          {item.subItems && (
                            <ChevronDown
                              size={15}
                              className={cn(
                                "shrink-0 text-slate-400 transition-transform duration-200",
                                isOpenMenu && "rotate-180"
                              )}
                            />
                          )}
                        </>
                      )}
                    </button>

                    {/* Sub-items (expanded only) */}
                    {!collapsed && item.subItems && isOpenMenu && (
                      <div className="mt-0.5 mb-1 ml-[22px] flex flex-col gap-0.5 border-l border-slate-200 pl-3">
                        {item.subItems.map((sub) => {
                          const isActiveSub = activeSubId === sub.id
                          return (
                            <button
                              key={sub.id}
                              onClick={() => handleSubSelect(item.id, sub.id)}
                              className={cn(
                                "flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors",
                                isActiveSub
                                  ? "bg-blue-50 font-semibold text-blue-700"
                                  : "font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
                              )}
                            >
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 shrink-0 rounded-full",
                                  isActiveSub
                                    ? "bg-blue-600"
                                    : sub.live
                                      ? "bg-emerald-400"
                                      : "bg-slate-300"
                                )}
                              />
                              <span className="truncate">{sub.label}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* ── Footer ────────────────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-slate-100 px-3 py-3">
        <div className="flex flex-col gap-0.5">
          <button
            title={collapsed ? "도움말" : undefined}
            className={cn(
              "flex items-center rounded-md text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900",
              collapsed
                ? "lg:h-10 lg:w-10 lg:justify-center lg:mx-auto lg:px-0 gap-3 px-3 py-2.5"
                : "gap-3 px-3 py-2.5"
            )}
          >
            <HelpCircle size={18} className="shrink-0 text-slate-500" />
            {!collapsed && <span className="text-sm font-medium">도움말</span>}
          </button>
          <button
            onClick={() => void logout()}
            title={collapsed ? "로그아웃" : undefined}
            className={cn(
              "flex items-center rounded-md text-slate-700 transition-colors hover:bg-red-50 hover:text-red-600",
              collapsed
                ? "lg:h-10 lg:w-10 lg:justify-center lg:mx-auto lg:px-0 gap-3 px-3 py-2.5"
                : "gap-3 px-3 py-2.5"
            )}
          >
            <LogOut size={18} className="shrink-0 text-slate-500" />
            {!collapsed && <span className="text-sm font-medium">로그아웃</span>}
          </button>
        </div>
      </div>
    </aside>
  )
}
