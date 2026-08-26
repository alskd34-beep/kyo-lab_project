/**
 * [API] 헬스체크 — Railway 배포 검증용.
 *
 * 새 배포로 트래픽을 넘기기 전에 Railway 가 이 경로를 찔러 본다. 200 이 돌아오지 않으면
 * 배포를 실패로 보고 이전 버전을 그대로 유지한다(부팅에 실패한 빌드로 갈아타지 않게).
 *
 * 이 경로만 사내망 IP 검사에서 제외된다(`middleware.ts` 의 `HEALTH_PATH`).
 * Railway 내부에서 오는 요청이라 사내 IP 가 아니기 때문이다. 그래서 상태 외에는
 * 아무것도 알려주지 않는다 — DB 연결이나 버전 정보를 여기 담지 않는다.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function GET() {
  return Response.json({ ok: true })
}
