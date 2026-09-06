/**
 * [BACKEND] Slack Incoming Webhook 전송 계층 — 도메인 지식 없음
 *
 * 환경변수 3개
 *   - SLACK_WEBHOOK_URL : Incoming Webhook URL. 없으면 슬랙 기능 전체가 꺼진다(킬 스위치).
 *   - SLACK_TIMEOUT_MS  : 응답 타임아웃 ms. 기본 1500(실측 599ms 의 2.5배).
(주의: SLACK_WEBHOOK_URL 이 비어 있으면 slackNotify 가
 *     전송 경로에 진입하기 전에 조기 종료하므로 DRY_RUN 로그도 안 나온다)
 *   - SLACK_DRY_RUN     : '1' 이면 실제 전송 없이 콘솔에만 페이로드를 찍는다.
 *
 * 계약: **이 모듈은 절대 throw 하지 않는다.** 슬랙 알림은 부가 기능이라, 웹훅 URL
 * 오설정·네트워크 장애·타임아웃이 QC 작업 전이(HTTP 응답)를 막아서는 안 된다.
 * 모든 실패는 콘솔 로그 + false 반환으로 그친다.
 *
 * URL 마스킹: Incoming Webhook URL 자체가 자격증명이다(URL 을 아는 사람 누구나 그
 * 채널에 쓸 수 있음). 에러 로그에 URL 전체가 남으면 로그 수집기·이슈트래커를 보는
 * 사람 누구나 웹훅을 획득하게 되므로, 로그에 남기기 전에 반드시 마스킹한다.
 */

/** 외부 SDK 도입 없이 Slack Block Kit 블록을 표현하는 최소 타입 */
export type SlackBlock = Record<string, unknown>

/** 같은 경고를 반복 로그하지 않기 위한 모듈 스코프 캐시 — 전이마다 찍으면 그게 새 노이즈다 */
const warnedKeys = new Set<string>()

export function warnOnce(key: string, msg: string): void {
  if (warnedKeys.has(key)) return
  warnedKeys.add(key)
  console.warn(msg)
}

/** `hooks.slack.com/services/xxxxx` 형태의 웹훅 경로를 `***` 로 가린다 */
export function maskWebhook(text: string): string {
  return text.replace(/hooks\.slack\.com\/services\/\S+/g, 'hooks.slack.com/services/***')
}

function slackWebhookUrl(): string | null {
  const url = process.env.SLACK_WEBHOOK_URL?.trim()
  if (!url) return null
  if (!url.startsWith('https://hooks.slack.com/')) {
    warnOnce('invalid-webhook', '[slack] SLACK_WEBHOOK_URL 형식이 올바르지 않습니다(https://hooks.slack.com/ 로 시작해야 함) — 슬랙 알림을 비활성화합니다.')
    return null
  }
  return url
}

/** 슬랙 알림 기능이 켜져 있는가 (킬 스위치: SLACK_WEBHOOK_URL) */
export function isSlackEnabled(): boolean {
  return slackWebhookUrl() != null
}

/** 응답 타임아웃 ms — 기본 1500(실측 왕복 599ms 의 2.5배) */
function envTimeoutMs(): number {
  const raw = process.env.SLACK_TIMEOUT_MS?.trim()
  const parsed = raw ? Number(raw) : NaN
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1500
}

/**
 * Slack Incoming Webhook 으로 1건 전송한다.
 * 성공(2xx) 시 true, 그 외(비활성/설정오류/타임아웃/네트워크오류/비2xx) 는 false.
 * 절대 throw 하지 않는다.
 */
export async function postSlack(payload: { text: string; blocks: SlackBlock[] }): Promise<boolean> {
  if (process.env.SLACK_DRY_RUN === '1') {
    console.log('[slack] DRY_RUN', JSON.stringify(payload))
    return true
  }

  const url = slackWebhookUrl()
  if (!url) return false

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(new Error('Slack 웹훅 타임아웃')), envTimeoutMs())
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    })
    if (!res.ok) {
      // ⚠️ res.url 을 로그에 넣지 않는다 — 전체 웹훅 URL(=자격증명)이 그대로 남는다.
      console.error('[slack] 전송 실패:', res.status, (await res.text()).slice(0, 200))
      return false
    }
    return true
  } catch (err) {
    console.error('[slack] 전송 실패:', maskWebhook(String(err)))
    return false
  } finally {
    clearTimeout(timer)
  }
}

/** Slack mrkdwn 특수문자 이스케이프 — 이 순서를 반드시 지킨다(& 를 먼저) */
export function escapeSlack(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
