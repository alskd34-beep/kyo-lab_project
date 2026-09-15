/**
 * 외부 시스템 링크 — 이 앱 밖에서 도는 사내 화면으로 보내는 주소를 한곳에 둔다.
 *
 * 사내망 주소는 http 라서, https 로 서비스되는 이 앱 안에 iframe 으로 넣으면 브라우저가
 * 혼합 콘텐츠로 막는다. 그래서 메뉴에서 **새 탭으로 연다.** 주소가 바뀌면 배포 환경변수로 덮는다.
 */

/** 일탈관리 · OOT 현황조회 (사내 조회 화면) */
export const OOT_STATUS_URL = process.env.NEXT_PUBLIC_OOT_STATUS_URL || "http://172.17.5.41:8502/"
