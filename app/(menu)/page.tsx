import { redirect } from 'next/navigation'

/**
 * 루트(`/`)는 홈 화면의 별칭이다.
 *
 * 예전에는 여기에 시험현황 대시보드 사본이 있었는데, 정본이
 * `/test-mgmt/test-status` 로 옮겨간 뒤에도 남아 있어서
 * 로그인 직후 `next=/` 로 돌아오면 홈이 아닌 옛 화면이 열렸다.
 */
export default function RootPage() {
  redirect('/home')
}
