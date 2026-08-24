/**
 * [SHARED] 화면 접근 권한 — 관리자 전용 경로의 단일 기준(single source of truth).
 *
 * 사이드바에서 메뉴만 감추면 주소를 직접 친 시험자는 그대로 들어온다.
 * 그래서 세 곳이 모두 이 목록 하나를 본다.
 *   - `middleware.ts`         서버에서 차단(주소 직접 입력·새로고침)
 *   - `app-sidebar.tsx`       메뉴에서 감춤
 *   - `app/(menu)/layout.tsx` 클라이언트 최종 확인
 *                             (access 토큰이 만료돼 미들웨어를 그냥 통과한 요청 대비)
 *
 * 경로를 넣으면 하위 경로까지 함께 막힌다(`/insights` → `/insights/dash`).
 *
 * 예외 — `/settings/sys-settings`
 *   메뉴상 「계정 설정」은 관리자 전용이지만 이 화면은 사용자 메뉴의 「비밀번호 변경」이
 *   가리키는 곳이라 시험자도 열어야 한다. 화면 안의 관리자 전용 항목은 페이지가 역할로 가린다.
 */
export const ADMIN_ONLY_ROUTES: readonly string[] = [
  // 스케줄 — 계획을 짜고 배정을 바꾸는 화면
  '/schedule/orders',
  '/schedule/reassignments',
  '/schedule/dashboard',
  '/schedule/holidays',

  // 시험관리 — 전사 현황·결과 확정·시험자 관리
  '/test-mgmt/test-status',
  '/test-mgmt/test-result',
  '/test-mgmt/test-cert',
  '/test-mgmt/testers',

  // 기준 설정(마스터 데이터)
  '/product-test/products',
  '/product-test/manhours',
  '/test-mgmt/test-master',
  '/test-mgmt/test-item-groups',
  '/test-mgmt/test-items',
  '/test-mgmt/pretest-checklist',
  '/test-mgmt/test-capabilities',
  '/settings/concurrent-items',

  // 일탈관리·인사이트 — 하위가 전부 관리자 전용
  '/deviation',
  '/insights',

  // 장비관리 — 「장비 예약」(`/equipment/reservation`)만 시험자에게 열려 있다
  '/equipment/master',
  '/equipment/equip-operation',
  '/equipment/equip-backup',
  '/equipment/equip-usage',
  '/equipment/equip-ai-maint',

  // 계정 설정 — 비밀번호 변경(`/settings/sys-settings`)은 위 예외대로 제외한다
  '/settings/users',
  '/settings/roles',
]

/** 해당 경로가 관리자 전용인지 — 목록에 있는 경로와 그 하위 경로 전부를 뜻한다. */
export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_ROUTES.some(base => pathname === base || pathname.startsWith(base + '/'))
}
