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

  // 적재는 읽기-판정-쓰기가 분리돼 있어 동시 실행 시 중복 로그/알림/이력이 생긴다.
  // 크론 두 개와 수동 트리거(POST /api/cron/ingest-pct)가 겹치지 않도록 프로세스 내 잠금을 건다.
  // ⚠️ 다중 인스턴스 배포에서는 이것만으로 부족하다 — DB advisory lock 이 필요하다.
  const g2 = globalThis as unknown as { __pctIngestRunning?: boolean }

  const run = async (label: string) => {
    if (g2.__pctIngestRunning) {
      console.warn(`[pct-cron:${label}] 이전 적재가 아직 진행 중이라 이번 회차를 건너뜁니다.`)
      return
    }
    g2.__pctIngestRunning = true
    try {
      const r = await ingestPctSheet()
      const failed = r.failures.length
      const line = `[pct-cron:${label}] 적재 완료 — 신규 ${r.created} / 변경 ${r.updated} / 삭제 ${r.deleted} / 미동기화 ${r.unsynced}`
      if (failed > 0) {
        // 실패를 성공 로그에 묻으면 적재 누락이 무증상으로 지나간다.
        console.error(`${line} / ⚠ 실패 ${failed}`, r.failures)
      } else {
        console.log(line)
      }
    } catch (err) {
      console.error(`[pct-cron:${label}] 적재 실패`, err)
    } finally {
      g2.__pctIngestRunning = false
    }
  }

  const opts = { timezone: 'Asia/Seoul' }
  cron.schedule('0 9 * * *', () => void run('09:00'), opts)   // 매일 09:00
  cron.schedule('0 14 * * *', () => void run('14:00'), opts)  // 매일 14:00

  // 장비 예약 대기(WAITING) 24시간 초과분 자동 취소 — 매시 정각
  cron.schedule('0 * * * *', () => void (async () => {
    try {
      const { autoCancelStaleWaiting } = await import('@backend/services/equipmentReservation')
      const n = await autoCancelStaleWaiting()
      if (n > 0) console.log(`[equip-cron] 대기 예약 자동취소 ${n}건 (24h 초과)`)
    } catch (err) {
      console.error('[equip-cron] 자동취소 실패', err)
    }
  })(), opts)

  console.log('[pct-cron] PCT 자동 적재 스케줄 등록 완료 (09:00, 14:00 KST) + 장비 대기 자동취소(매시)')
}
