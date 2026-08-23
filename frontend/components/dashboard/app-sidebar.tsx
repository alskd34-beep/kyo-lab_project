"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Home, FlaskConical, ShieldCheck, AlertTriangle, FileText, BarChart2, Cpu,
  Settings, Calendar, ClipboardList, SlidersHorizontal, ChevronRight, ChevronsUpDown, LogOut,
} from "lucide-react"

import { cn } from "@frontend/lib/utils"
import { useAuth } from "@frontend/lib/auth-context"
import { TesterAvatar } from "@frontend/lib/tester-profiles"
import { Skeleton } from "@frontend/components/ui/skeleton"
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@frontend/components/ui/collapsible"
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@frontend/components/ui/dropdown-menu"
import {
  Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel,
  SidebarHeader, SidebarMenu, SidebarMenuBadge, SidebarMenuButton,
  SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem,
  useSidebar,
} from "@frontend/components/ui/sidebar"

// ─── Types ────────────────────────────────────────────────────────────────────
interface SubItem { id: string; label: string; adminOnly?: boolean; live?: boolean }
interface NavItem {
  id: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  badge?: number
  subItems?: SubItem[]
  defaultPath?: string
  adminOnly?: boolean
  hidden?: boolean
}
interface NavSection { title: string; items: NavItem[] }

// ─── Nav Data ───────────────────────────────────────────────────────────────
const NAV_SECTIONS: NavSection[] = [
  {
    title: "메뉴",
    items: [
      { id: "home", icon: Home, label: "홈" },
      {
        id: "schedule", icon: Calendar, label: "스케줄", defaultPath: "/schedule/orders",
        subItems: [
          { id: "schedule-monthly", label: "월간 스케줄", live: true },
          { id: "schedule-orders", label: "AI 스케줄", adminOnly: true, live: true },
          { id: "schedule-vacation", label: "휴가 캘린더", live: true },
          { id: "schedule-reassign", label: "재배정 이력", adminOnly: true, live: true },
          { id: "schedule-dashboard", label: "관리자 대시보드", adminOnly: true, live: true },
        ],
      },
      { id: "my-tasks", icon: ClipboardList, label: "내 작업" },
      {
        id: "test-mgmt", icon: FlaskConical, label: "시험관리",
        subItems: [
          { id: "prod-status", label: "작업 현황", live: true },
          { id: "test-status", label: "시험현황", live: true },
          { id: "test-result", label: "결과입력", adminOnly: true },
          { id: "test-cert", label: "성적서관리", adminOnly: true },
          { id: "testers", label: "시험자 관리", adminOnly: true, live: true },
        ],
      },
      {
        id: "stability", icon: ShieldCheck, label: "안정성시험",
        subItems: [
          { id: "stab-status", label: "안정성현황" },
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
        id: "deviation", icon: AlertTriangle, label: "일탈관리", adminOnly: true,
        subItems: [
          { id: "oos", label: "OOS현황" },
          { id: "capa", label: "CAPA관리" },
          { id: "inv-report", label: "조사보고서" },
        ],
      },
      {
        id: "documents", icon: FileText, label: "문서관리", hidden: true,
        subItems: [
          { id: "doc-cert", label: "성적서" },
          { id: "doc-std", label: "기준서" },
          { id: "doc-sop", label: "SOP" },
          { id: "doc-checklist", label: "체크리스트" },
        ],
      },
      {
        id: "insights", icon: BarChart2, label: "인사이트",
        subItems: [
          { id: "dash", label: "대시보드", adminOnly: true },
          { id: "stats", label: "운영평가", adminOnly: true, live: true },
          { id: "workload", label: "품목별 시험공수 관리", adminOnly: true, live: true },
          { id: "ins-report", label: "리포트", adminOnly: true },
        ],
      },
      {
        id: "equipment", icon: Cpu, label: "장비관리",
        subItems: [
          { id: "equip-master", label: "장비 마스터", adminOnly: true, live: true },
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
        id: "master-settings", icon: SlidersHorizontal, label: "기준 설정", adminOnly: true,
        subItems: [
          { id: "products-master", label: "품목 마스터", live: true },
          { id: "test-master", label: "시험항목 마스터", live: true },
          { id: "test-items", label: "품목별 시험항목 관리", live: true },
          { id: "pretest-checklist", label: "시험 전 확인사항", live: true },
          { id: "concurrent-items", label: "동시분석 품목", adminOnly: true, live: true },
          { id: "schedule-holidays", label: "공휴일 캘린더", adminOnly: true, live: true },
        ],
      },
      {
        id: "settings", icon: Settings, label: "계정 설정", adminOnly: true,
        subItems: [
          { id: "users", label: "사용자 관리", adminOnly: true, live: true },
          { id: "roles", label: "권한 관리", adminOnly: true },
          { id: "sys-settings", label: "시스템 설정" },
        ],
      },
    ],
  },
]

const PATH_MAP: Record<string, string> = {
  home: "/home",
  "schedule-monthly": "/schedule/monthly",
  "schedule-orders": "/schedule/orders",
  "schedule-groups": "/schedule/groups",
  "schedule-vacation": "/schedule/vacation",
  "schedule-holidays": "/schedule/holidays",
  "schedule-reassign": "/schedule/reassignments",
  "schedule-dashboard": "/schedule/dashboard",
  "my-tasks": "/my-tasks",
  "prod-status": "/product-test/prod-status",
  "test-status": "/test-mgmt/test-status",
  "test-result": "/test-mgmt/test-result",
  "test-cert": "/test-mgmt/test-cert",
  testers: "/test-mgmt/testers",
  "products-master": "/product-test/products",
  "test-master": "/test-mgmt/test-master",
  "test-items": "/test-mgmt/test-items",
  "pretest-checklist": "/test-mgmt/pretest-checklist",
  "concurrent-items": "/settings/concurrent-items",
  "stab-status": "/stability/stab-status",
  "stab-plan": "/stability/stab-plan",
  "stab-report": "/stability/stab-report",
  oos: "/deviation/oos",
  capa: "/deviation/capa",
  "inv-report": "/deviation/inv-report",
  "doc-cert": "/documents/doc-cert",
  "doc-std": "/documents/doc-std",
  "doc-sop": "/documents/doc-sop",
  "doc-checklist": "/documents/doc-checklist",
  dash: "/insights/dash",
  stats: "/insights/stats",
  workload: "/insights/workload",
  "ins-report": "/insights/ins-report",
  "equip-master": "/equipment/master",
  "equip-reservation": "/equipment/reservation",
  "equip-operation": "/equipment/equip-operation",
  "equip-backup": "/equipment/equip-backup",
  "equip-usage": "/equipment/equip-usage",
  "equip-ai-maint": "/equipment/equip-ai-maint",
  users: "/settings/users",
  roles: "/settings/roles",
  "sys-settings": "/settings/sys-settings",
}

// ─── Component ────────────────────────────────────────────────────────────────
export function AppSidebar(props: React.ComponentProps<typeof Sidebar>) {
  const pathname = usePathname() ?? ""
  const { user, loading: authLoading, logout } = useAuth()
  const { isMobile, setOpenMobile } = useSidebar()
  const isAdmin = user?.role === "admin"

  /**
   * 반응형(모바일)에서는 사이드바가 Sheet 로 덮여 있어, 메뉴를 골라 이동해도
   * 열린 채로 화면을 가린다. 이동이 일어나는 링크에서만 닫는다.
   * (하위 메뉴를 펼치는 CollapsibleTrigger 는 이동이 아니므로 제외)
   */
  const closeOnMobile = () => {
    if (isMobile) setOpenMobile(false)
  }
  const name = user?.displayName ?? user?.username ?? "게스트"

  const subHref = (id: string) => PATH_MAP[id] ?? "#"
  const subActive = (id: string) => {
    const p = PATH_MAP[id]
    return !!p && pathname.startsWith(p)
  }
  const branchActive = (item: NavItem) =>
    item.subItems
      ? item.subItems.some(s => subActive(s.id))
      : !!PATH_MAP[item.id] && pathname.startsWith(PATH_MAP[item.id])

  const sections = NAV_SECTIONS.map(section => ({
    ...section,
    items: section.items
      .filter(item => !item.hidden && (!item.adminOnly || isAdmin))
      .map(item => ({ ...item, subItems: item.subItems?.filter(s => !s.adminOnly || isAdmin) })),
  })).filter(section => section.items.length > 0)

  return (
    <Sidebar collapsible="icon" variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton size="lg" asChild className="data-[slot=sidebar-menu-button]:!p-1.5">
              <Link href="/home" onClick={closeOnMobile}>
                <span className="flex aspect-square size-8 items-center justify-center rounded-md bg-primary text-sm font-bold text-primary-foreground">KD</span>
                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-bold">QC 관리</span>
                  <span className="truncate text-[11px] text-muted-foreground">Quality Control</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {sections.map(section => (
          <SidebarGroup key={section.title}>
            <SidebarGroupLabel>{section.title}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.items.map(item => {
                  const Icon = item.icon
                  const active = branchActive(item)
                  if (!item.subItems || item.subItems.length === 0) {
                    return (
                      <SidebarMenuItem key={item.id}>
                        <SidebarMenuButton asChild tooltip={item.label} isActive={active}>
                          <Link href={PATH_MAP[item.id] ?? "#"} onClick={closeOnMobile}>
                            <Icon />
                            <span>{item.label}</span>
                          </Link>
                        </SidebarMenuButton>
                        {item.badge != null && <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>}
                      </SidebarMenuItem>
                    )
                  }
                  return (
                    <Collapsible key={item.id} asChild defaultOpen={active} className="group/collapsible">
                      <SidebarMenuItem>
                        <CollapsibleTrigger asChild>
                          <SidebarMenuButton tooltip={item.label} isActive={active}>
                            <Icon />
                            <span>{item.label}</span>
                            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
                          </SidebarMenuButton>
                        </CollapsibleTrigger>
                        {item.badge != null && <SidebarMenuBadge>{item.badge}</SidebarMenuBadge>}
                        <CollapsibleContent>
                          <SidebarMenuSub>
                            {item.subItems.map(sub => {
                              const subIsActive = subActive(sub.id)
                              return (
                                <SidebarMenuSubItem key={sub.id}>
                                  <SidebarMenuSubButton asChild isActive={subIsActive}>
                                    <Link href={subHref(sub.id)} onClick={closeOnMobile}>
                                      {/* 개발 완료 표시: 완료(live)=초록 점, 미완료=회색 점 */}
                                      <span
                                        title={sub.live ? "개발 완료" : "개발 예정"}
                                        className={cn(
                                          "size-1.5 shrink-0 rounded-full",
                                          subIsActive ? "bg-sidebar-primary" : sub.live ? "bg-emerald-500" : "bg-muted-foreground/30",
                                        )}
                                      />
                                      <span>{sub.label}</span>
                                    </Link>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              )
                            })}
                          </SidebarMenuSub>
                        </CollapsibleContent>
                      </SidebarMenuItem>
                    </Collapsible>
                  )
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <SidebarMenu>
          <SidebarMenuItem>
            {authLoading ? (
              // 로그인 사용자 확인 전엔 "게스트"로 잘못 표시하지 않고 스켈레톤을 보여준다
              <div className="flex items-center gap-2 p-2">
                <Skeleton className="size-8 shrink-0 rounded-md" />
                <div className="grid flex-1 gap-1.5">
                  <Skeleton className="h-3.5 w-20" />
                  <Skeleton className="h-3 w-12" />
                </div>
              </div>
            ) : (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton size="lg" className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground">
                  <TesterAvatar
                    name={name}
                    avatarUrl={user?.avatarUrl}
                    size="md"
                    className="rounded-md"
                  />
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium">{name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      {isAdmin ? "관리자" : "시험자"}
                      {user?.customerNo != null && (
                        <span className="ml-1.5 font-mono text-[10px] opacity-70">
                          #{String(user.customerNo).padStart(5, '0')}
                        </span>
                      )}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-auto size-4" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="right" align="end" sideOffset={8} className="min-w-56 rounded-md">
                <DropdownMenuItem asChild>
                  <Link href="/settings/sys-settings" onClick={closeOnMobile}>비밀번호 변경</Link>
                </DropdownMenuItem>
                {isAdmin && (
                  <DropdownMenuItem asChild>
                    <Link href="/settings/users" onClick={closeOnMobile}>사용자 관리</Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onClick={() => void logout()}>
                  <LogOut />로그아웃
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  )
}
