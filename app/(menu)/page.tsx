import { redirect } from 'next/navigation'

/**
 * 루트(`/`) 진입 → 홈(`/home`)으로 보낸다.
 *
 * 이 자리에는 원래 시험현황 화면의 목업(하드코딩 KPI + 가상 시험 8건)이 있었다.
 * 실 데이터를 쓰는 `/test-mgmt/test-status` 로 이관된 뒤에도 목업이 라우트에 남아 있어,
 * 주소창에 서버 주소만 입력하면
 *   `/` → middleware가 `/login?next=/` → 로그인 후 `next` 를 따라 다시 `/`
 * 경로로 가짜 화면에 도착하는 문제가 있었다. (이전 구현은 git 이력 참조)
 *
 * 서버에서 리다이렉트하므로 목업이 잠깐이라도 렌더링되지 않는다.
 */
export default function RootPage() {
  redirect('/home')
}
