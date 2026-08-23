/**
 * 부트스트랩 관리자 계정 생성 스크립트 (1회성)
 *
 * 실행:
 *   BOOTSTRAP_ADMIN_USERNAME=kyo-admin BOOTSTRAP_ADMIN_PASSWORD='<12자 이상>' npx tsx scripts/seed_admin.ts
 *
 * 배경(2026-08-23 보안 점검):
 *   예전에는 `kyo-admin`/`kyo-admin` 이 소스에 하드코딩된 채 **공개 로그인 엔드포인트에서
 *   요청마다** 자동 시드됐다. 자격증명이 저장소에 평문으로 있어 누구나 관리자로 로그인할 수
 *   있었고, 운영 DB 에서 지워도 다음 로그인 요청에 다시 생성됐다.
 *   이제 시드는 이 스크립트를 명시적으로 실행할 때만 일어난다.
 *
 * 주의: 생성 후 해당 계정으로 로그인해 즉시 비밀번호를 변경하고,
 *       BOOTSTRAP_ADMIN_PASSWORD 는 셸 히스토리에서 지울 것.
 */

import { ensureAdminSeed } from '../backend/services/users'

async function main(): Promise<void> {
  const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim()
  if (!username || !process.env.BOOTSTRAP_ADMIN_PASSWORD) {
    console.error('BOOTSTRAP_ADMIN_USERNAME 과 BOOTSTRAP_ADMIN_PASSWORD 를 모두 지정하세요.')
    process.exit(1)
  }

  await ensureAdminSeed()
  console.log(`관리자 계정 '${username}' 시드를 완료했습니다. 첫 로그인 후 즉시 비밀번호를 변경하세요.`)
}

main().catch(err => {
  console.error('관리자 시드 실패:', err instanceof Error ? err.message : err)
  process.exit(1)
})
