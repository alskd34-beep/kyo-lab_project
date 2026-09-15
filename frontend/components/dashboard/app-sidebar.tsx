"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Home, FlaskConical, ShieldCheck, AlertTriangle, FileText, BarChart2, Cpu,
  Settings, Calendar, ClipboardList, SlidersHorizontal, ChevronRight, ChevronsUpDown, LogOut, ExternalLink,
} from "lucide-react"
import { OOT_STATUS_URL } from "@frontend/lib/external-links"

import { isAdminOnlyPath } from "@shared/route-access"
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
interface SubItem {
  id: string; label: string; adminOnly?: boolean; live?: boolean
  /** 앱 밖 화면으로 보내는 메뉴 — 지금 창에서 이동한다(frontend/lib/external-links.ts) */
  externalHref?: string
}
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
          { id: "test-status", label: "시험현황", adminOnly: true, live: true },
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
          { id: "capa", label: "OOT 현황조회", live: true, externalHref: OOT_STATUS_URL },
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
          // 「운영평가」와 「운영 결과 리포트」를 합친 화면이다(2026-09-08).
          // 둘이 같은 기간·같은 시험자를 두 벌로 재고 '가동률'이 서로 다른 뜻이었다.
          { id: "stats", label: "시험자 운영 분석", adminOnly: true, live: true },
          { id: "workload", label: "품목별 시험공수 관리", adminOnly: true, live: true },
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
          { id: "test-item-groups", label: "시험항목 그룹", live: true },
          { id: "test-items", label: "품목별 시험항목 관리", live: true },
          { id: "pretest-checklist", label: "시험 전 확인사항", live: true },
          { id: "test-capabilities", label: "시험 역량 마스터", adminOnly: true, live: true },
          { id: "concurrent-items", label: "동시분석 품목", adminOnly: true, live: true },
          { id: "side-work-categories", label: "부업무 분류", adminOnly: true, live: true },
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
  "test-item-groups": "/test-mgmt/test-item-groups",
  "test-items": "/test-mgmt/test-items",
  "pretest-checklist": "/test-mgmt/pretest-checklist",
  "test-capabilities": "/test-mgmt/test-capabilities",
  "concurrent-items": "/settings/concurrent-items",
  "side-work-categories": "/settings/side-work-categories",
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
  // 메뉴에서는 내렸지만 경로는 살아 있다(stats 로 리다이렉트) — 공유된 링크 보호.
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

/**
 * 시험자 화면의 「메뉴」 배치 — 관리자는 위 순서를 그대로 쓴다.
 *
 * 시험자는 하루를 "내 상황 → 오늘 처리할 일 → 시험 → 안정성 → 계획" 순으로 움직인다.
 * 스케줄은 관리자가 짜 주는 계획이라 시험자에게는 마지막이 맞다.
 * 「내 작업」도 시험자에게는 업무 명칭보다 「할 일」이 곧바로 읽힌다.
 */
const TESTER_MENU_ORDER = ["home", "my-tasks", "test-mgmt", "stability", "schedule"]
const TESTER_LABEL_OVERRIDE: Record<string, string> = { "my-tasks": "할 일" }

/**
 * 권한 확인 전에 자리만 잡아 둘 메뉴 묶음의 항목 수.
 *
 * 목적이 "목록이 들어올 때 사이드바가 늘거나 줄어 덜컥이지 않게" 하는 것이라 **개수가 곧 높이다.**
 * `NAV_SECTIONS` 를 세는 대신 관리자 화면에 실제로 그려지는 수(메뉴 5 · 관리 3 · 설정 2)에 맞췄다 —
 * 원본에는 `hidden` 항목이 섞여 있어 그대로 세면 한 칸 더 잡고 나중에 줄어든다.
 */
const SKELETON_GROUPS = [5, 3, 2]

function menuSectionsFor(isAdmin: boolean): NavSection[] {
  if (isAdmin) return NAV_SECTIONS
  const rank = (id: string) => {
    const i = TESTER_MENU_ORDER.indexOf(id)
    return i === -1 ? TESTER_MENU_ORDER.length : i
  }
  return NAV_SECTIONS.map(section =>
    section.title !== "메뉴" ? section : {
      ...section,
      items: [...section.items]
        .sort((a, b) => rank(a.id) - rank(b.id))
        .map(item => {
          const label = TESTER_LABEL_OVERRIDE[item.id]
          return label ? { ...item, label } : item
        }),
    },
  )
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

  // 현재 경로가 속한 상위 메뉴 (하위 메뉴가 있는 항목만)
  const activeMenuId =
    NAV_SECTIONS.flatMap(section => section.items)
      .find(item => item.subItems?.some(sub => subActive(sub.id)))?.id ?? null

  /**
   * 하위 메뉴는 한 번에 하나만 펼친다(아코디언).
   * 다른 메뉴를 펼치면 이미 열려 있던 메뉴는 닫힌다.
   */
  const [openMenuId, setOpenMenuId] = useState<string | null>(activeMenuId)

  // 다른 상위 메뉴의 화면으로 이동하면 그 메뉴만 펼친다.
  // (effect 대신 렌더 중 상태 보정 — 여분의 렌더 없이 즉시 반영된다)
  const [syncedMenuId, setSyncedMenuId] = useState<string | null>(activeMenuId)
  if (activeMenuId && activeMenuId !== syncedMenuId) {
    setSyncedMenuId(activeMenuId)
    setOpenMenuId(activeMenuId)
  }

  /**
   * 메뉴에서 감추는 기준은 `@shared/route-access` 의 관리자 전용 경로와 같다.
   * 목록에 경로를 추가하면 미들웨어가 막는 화면이 메뉴에서도 자동으로 사라진다
   * (막혀 있는데 메뉴에는 남아 눌러도 되돌려보내지는 링크를 없앤다).
   */
  const adminOnlyId = (id: string, flagged?: boolean) =>
    Boolean(flagged) || isAdminOnlyPath(PATH_MAP[id] ?? "")

  const sections = menuSectionsFor(isAdmin).map(section => ({
    ...section,
    items: section.items
      .filter(item => !item.hidden && (isAdmin || !adminOnlyId(item.id, item.adminOnly)))
      .map(item => ({
        ...item,
        subItems: item.subItems?.filter(s => isAdmin || !adminOnlyId(s.id, s.adminOnly)),
      }))
      // 하위가 전부 관리자 전용이면 상위 메뉴도 감춘다.
      // (남겨 두면 「인사이트」처럼 펼칠 것도, 갈 곳도 없는 메뉴가 된다)
      .filter(item => !item.subItems || item.subItems.length > 0),
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
                  <span className="truncate text-xs leading-normal text-muted-foreground">Quality Control</span>
                </div>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        {/* 권한이 확인되기 전에는 목록을 그리지 않는다.
            사이드바는 이제 서버에서도 그려지는데(`app/(menu)/layout.tsx` 참고), 그 시점의
            `user` 는 아직 null 이라 그대로 그리면 **관리자에게 시험자 메뉴를 잠깐 보여준 뒤
            항목이 우르르 끼어드는** 모양이 된다. 자리와 개수만 잡아 두고 기다린다.
            (아래 사용자 칸이 authLoading 에 쓰는 스켈레톤과 같은 방침이다) */}
        {authLoading ? (
          SKELETON_GROUPS.map((rows, gi) => (
            <SidebarGroup key={gi}>
              <SidebarGroupLabel>
                <Skeleton className="h-3 w-14" />
              </SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {Array.from({ length: rows }).map((_, i) => (
                    <SidebarMenuItem key={i}>
                      {/* 실제 메뉴 버튼과 같은 높이(h-8)·여백으로 두어야 목록이 들어올 때 안 밀린다 */}
                      <div className="flex h-8 items-center gap-2 px-2">
                        <Skeleton className="size-4 shrink-0" />
                        <Skeleton className="h-3 flex-1" />
                      </div>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          ))
        ) : sections.map(section => (
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
                    <Collapsible
                      key={item.id}
                      asChild
                      open={openMenuId === item.id}
                      onOpenChange={open => setOpenMenuId(open ? item.id : null)}
                      className="group/collapsible"
                    >
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
                              // 앱 밖 화면 — 사내망 http 주소라 iframe 으로 넣지 못하고 **지금 창에서** 그 주소로 이동한다.
                              // next/link 는 앱 안 경로용이라 일반 <a> 를 쓴다. 돌아올 때는 브라우저 뒤로 가기.
                              if (sub.externalHref) {
                                return (
                                  <SidebarMenuSubItem key={sub.id}>
                                    <SidebarMenuSubButton asChild isActive={subIsActive}>
                                      <a href={sub.externalHref} onClick={closeOnMobile}>
                                        <span title="개발 완료" className="size-1.5 shrink-0 rounded-full bg-muted-foreground" />
                                        <span>{sub.label}</span>
                                        <ExternalLink className="ml-auto size-3.5 text-muted-foreground" aria-label="사내 외부 화면으로 이동" />
                                      </a>
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                )
                              }
                              return (
                                <SidebarMenuSubItem key={sub.id}>
                                  <SidebarMenuSubButton asChild isActive={subIsActive}>
                                    <Link href={subHref(sub.id)} onClick={closeOnMobile}>
                                      {/* 개발 완료 표시 — 초록을 쓰면 '선택됨(브랜드 파랑)'과
                                          색이 둘로 갈려 메뉴가 신호등이 된다. 세 상태를 색이 아니라
                                          농도로 가른다: 선택됨=파랑 · 완료=진한 회색 · 예정=옅은 회색 */}
                                      <span
                                        title={sub.live ? "개발 완료" : "개발 예정"}
                                        className={cn(
                                          "size-1.5 shrink-0 rounded-full",
                                          subIsActive ? "bg-sidebar-primary" : sub.live ? "bg-muted-foreground" : "bg-muted-foreground/30",
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
                        <span className="ml-1.5 font-mono text-xs leading-normal opacity-70">
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
