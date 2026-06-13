/**
 * [BACKEND] Next.js instrumentation — 서버 부팅 시 1회 실행
 *
 * node-cron 으로 PCT 구글시트 자동 적재 스케줄(9시/2시, Asia/Seoul)을 등록한다.
 * - 상시 구동 프로세스(`next start`)에서만 동작. 서버리스/빌드 단계에서는 등록하지 않는다.
 * - 수동 적재는 POST /api/cron/ingest-pct 로도 가능.
 */

export async function register() {
  // Node.js 런타임에서만 (edge/빌드 제외)
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  // 자동 적재 비활성 플래그
  if (process.env.DISABLE_PCT_CRON === '1') return

  // 중복 등록 가드 (HMR/리로드 대비)
  const g = globalThis as unknown as { __pctCronRegistered?: boolean }
  if (g.__pctCronRegistered) return
  g.__pctCronRegistered = true

  const cron = (await import('node-cron')).default
  const { ingestPctSheet } = await import('@backend/services/pctIngest')

  const run = async (label: string) => {
    try {
      const r = await ingestPctSheet()
      console.log(`[pct-cron:${label}] 적재 완료 — 신규 ${r.created} / 변경 ${r.updated} / 삭제 ${r.deleted} / 미동기화 ${r.unsynced}`)
    } catch (err) {
      console.error(`[pct-cron:${label}] 적재 실패`, err)
    }
  }

  const opts = { timezone: 'Asia/Seoul' }
  cron.schedule('0 9 * * *', () => void run('09:00'), opts)   // 매일 09:00
  cron.schedule('0 14 * * *', () => void run('14:00'), opts)  // 매일 14:00

  console.log('[pct-cron] PCT 자동 적재 스케줄 등록 완료 (09:00, 14:00 KST)')
}
