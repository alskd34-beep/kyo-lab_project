/**
 * [BACKEND] 실행 중인 배포 확인
 *   GET /api/version — 지금 이 서버가 어느 커밋으로 떠 있는지 (인증)
 *
 * "코드는 올렸는데 화면은 그대로"를 추측으로 다투지 않기 위한 계기판이다.
 * git 로그의 SHA 와 여기 SHA 가 다르면 배포가 아직 안 넘어온 것이고, 같은데도 화면이
 * 옛날이면 브라우저 캐시 쪽이다. 둘을 가르는 것이 이 엔드포인트의 유일한 목적이다.
 *
 * ⚠️ 헬스체크(/api/health)에는 넣지 않는다. 그 경로만 사내망 IP 검사에서 빠져 있어
 *    (Railway 내부에서 찌른다) 커밋 정보를 붙이면 밖으로 새어 나간다.
 *    여기는 IP 검사 + 로그인 뒤라 안전하다.
 *
 * 값은 Railway 가 빌드 때 넣어 주는 환경변수에서 읽는다. 로컬(`npm run dev`)에서는
 * 비어 있는 것이 정상이며, 그 사실 자체가 "여긴 배포가 아니다"를 말해 준다.
 */

import { NextRequest } from 'next/server'
import { requireAuth } from '@backend/lib/guard'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: NextRequest) {
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response

  const sha = process.env.RAILWAY_GIT_COMMIT_SHA ?? null
  return Response.json({
    commit: sha,
    commitShort: sha ? sha.slice(0, 7) : null,
    branch: process.env.RAILWAY_GIT_BRANCH ?? null,
    message: process.env.RAILWAY_GIT_COMMIT_MESSAGE ?? null,
    deploymentId: process.env.RAILWAY_DEPLOYMENT_ID ?? null,
    environment: process.env.NODE_ENV ?? null,
    // 배포가 아니면 위 값들이 전부 null 이다 — 로컬에서 본 것인지 바로 구분된다.
    deployed: Boolean(process.env.RAILWAY_DEPLOYMENT_ID),
    serverTime: new Date().toISOString(),
  })
}
