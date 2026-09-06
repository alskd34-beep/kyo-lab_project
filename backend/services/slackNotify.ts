/**
 * [BACKEND] QC 작업 단계 전이 → 슬랙 알림 (도메인 계층)
 *
 * `notifications.ts` 의 `dispatch()` 를 확장하지 않고 별도 경로로 둔 이유:
 *   1. dispatch() 호출부 14곳이 전부 channel 을 넘기지 않아 항상 'in_app' 으로 들어온다.
 *      그 조건을 풀면 item_cleared(시험항목 1개마다 1건)·적재 루프(시트 행마다)·
 *      개인 대상 알림까지 전부 슬랙으로 나가 Incoming Webhook rate limit(≈1msg/s)에 걸린다.
 *   2. 슬랙 알림 대상은 "단계 전이" 5곳뿐이라 notifications 테이블의 범용 채널 스위치보다
 *      호출부를 명시적으로 한정하는 편이 안전하다.
 *   3. dispatch() 실패(행 적재 오류)와 슬랙 전송 성공 여부가 서로 영향을 주면 안 된다
 *      (아래 postSlack 은 절대 throw 하지 않는다).
 *
 * ⚠️ 적재(ingestPctSheet)·D-7 마감 알림 같은 대량 경로를 여기 연결하지 마라.
 *    슬랙 웹훅은 ≈1 msg/s 라 시트 한 번 적재에 수십 건이 몰리면 뒤로 갈수록 드롭된다.
 */

import { supabaseAdmin } from '@backend/lib/supabase'
import { escapeSlack, isSlackEnabled, maskWebhook, postSlack, type SlackBlock, warnOnce } from '@backend/lib/slack'

export interface StageNotice {
  jobId: string
  orderId: string | null
  fromStatus: string | null
  toStatus: string
  source: 'auto' | 'manual'
  note?: string | null
}

interface JobContext {
  qcNo: string
  testerName: string | null
  productName: string | null
  batchNo: string | null
  isDualAssignment: boolean
}

/** 단계별 이모지 — 그 외 상태(방어적)는 ⚪ */
const STAGE_EMOJI: Record<string, string> = {
  진행중: '🔵',
  검토전: '🟡',
  검토중: '🟠',
  승인전: '🟣',
  승인완료: '✅',
  지연: '🔴',
}

/**
 * qc_jobs 컨텍스트 1회 조회(임베디드 조인).
 *
 * ⚠️ `validation_type` 을 select 에 넣지 마라. 0039 는 수동 적용 대상이라 미적용
 * 환경에서 42703(컬럼 없음) 이 나고, PostgREST 는 select 전체를 실패시킨다 —
 * 그러면 알림이 조용히 전멸한다(`pctIngest.ts:153-158` 이 같은 컬럼을 런타임 probe
 * 로 방어하는 이유와 동일). 검증구분 필드는 1차 카드에서 뺀다.
 */
async function loadContext(jobId: string): Promise<JobContext | null> {
  try {
    const { data, error } = await supabaseAdmin
      .from('qc_jobs')
      .select('qc_no, assignee_tester_id, order_id, testers(name), pct_orders(product_name, batch_no, is_dual_assignment)')
      .eq('id', jobId)
      .maybeSingle()
    if (error || !data) throw error ?? new Error('작업을 찾을 수 없습니다')

    const row = data as unknown as Record<string, unknown>
    const tester = row.testers as { name: string | null } | null
    const order = row.pct_orders as { product_name: string | null; batch_no: string | null; is_dual_assignment: boolean | null } | null

    return {
      qcNo: row.qc_no as string,
      testerName: tester?.name ?? null,
      productName: order?.product_name ?? null,
      batchNo: order?.batch_no ?? null,
      isDualAssignment: !!order?.is_dual_assignment,
    }
  } catch (err) {
    // 조회 실패는 대개 일시적이 아니라 스키마·권한 문제라 계속 재발한다.
    // 전이마다 찍으면 전이 100건에 로그 100줄이 되므로 프로세스당 1회로 억제한다.
    warnOnce('load-context', `[slack] 컨텍스트 조회 실패 — 축약 카드로 보냅니다: ${String(err)}`)
    return null
  }
}

/** source 표시 라벨 */
function sourceLabel(source: StageNotice['source']): string {
  return source === 'auto' ? '자동 전환' : '수동'
}

/** Slack `<!date^...>` 태그 — 표시 포맷은 수신자 로케일이 처리한다(kstDate.ts 헤더 참고) */
function slackDateTag(): string {
  const epochSec = Math.floor(Date.now() / 1000)
  return `<!date^${epochSec}^{date_short_pretty} {time_secs}|${new Date().toISOString()}>`
}

function buildCard(notice: StageNotice, ctx: JobContext | null): { text: string; blocks: SlackBlock[] } {
  const emoji = STAGE_EMOJI[notice.toStatus] ?? '⚪'
  const from = notice.fromStatus ?? '신규'
  const transition = `${from} → ${notice.toStatus}`
  const timeTag = slackDateTag()

  if (!ctx) {
    // 컨텍스트 조회 실패 — QC번호 대신 jobId 앞 8자로 축약
    const text = `[${notice.toStatus}] 작업 ${notice.jobId.slice(0, 8)} — ${transition}`
    return {
      text,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: `${emoji} ${notice.toStatus}`, emoji: true } },
        { type: 'section', text: { type: 'mrkdwn', text: `작업 \`${notice.jobId.slice(0, 8)}\`\n${transition}` } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: timeTag }] },
      ],
    }
  }

  const productName = escapeSlack(ctx.productName ?? '-')
  const batchNo = escapeSlack(ctx.batchNo ?? '-')
  const testerName = escapeSlack(ctx.testerName ?? '미배정')

  // 폴백 text 도 mrkdwn 파싱을 탄다(푸시 미리보기·검색결과). 위에서 만든
  // 이스케이프된 변수를 그대로 쓴다 — 원본을 쓰면 'A&D정' 같은 품목명에서
  // 카드 본문과 미리보기 표시가 어긋난다.
  const text = `[${notice.toStatus}] ${productName} ${batchNo} — ${transition}`

  const blocks: SlackBlock[] = [
    { type: 'header', text: { type: 'plain_text', text: `${emoji} ${notice.toStatus}`, emoji: true } },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*품목*\n${productName}` },
        { type: 'mrkdwn', text: `*제조번호*\n${batchNo}` },
        { type: 'mrkdwn', text: `*담당자*\n${testerName}` },
        { type: 'mrkdwn', text: `*QC번호*\n${ctx.qcNo}` },
      ],
    },
  ]

  if (ctx.isDualAssignment) {
    blocks.push({
      type: 'context',
      elements: [{ type: 'mrkdwn', text: '2인 배정 — 담당자별 작업입니다' }],
    })
  }

  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: transition } })

  const contextElements = [`${sourceLabel(notice.source)} · ${timeTag}`]
  if (notice.note) contextElements.push(`사유: ${escapeSlack(notice.note)}`)
  blocks.push({
    type: 'context',
    elements: contextElements.map(el => ({ type: 'mrkdwn', text: el })),
  })

  return { text, blocks }
}

/**
 * 단계 전이를 슬랙으로 알린다. 실패해도 절대 예외를 던지지 않는다(반환값도 없다) —
 * 호출부는 `void notifyStageChangeToSlack(...).catch(() => {})` 로 fire-and-forget 한다.
 */
export async function notifyStageChangeToSlack(notice: StageNotice): Promise<void> {
  if (!isSlackEnabled()) return   // DB 조회조차 하지 않는다

  try {
    const ctx = await loadContext(notice.jobId)
    const payload = buildCard(notice, ctx)
    await postSlack(payload)
  } catch (err) {
    console.error('[slack] 단계 알림 실패:', maskWebhook(String(err)))
  }
}
