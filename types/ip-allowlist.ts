/**
 * [SHARED] 사내망 전용 접근 제한 — 허용 IP 판정의 단일 기준.
 *
 * Railway 는 서비스를 공개 URL 로만 노출한다(네트워크 수준 차단 기능이 없다).
 * 그래서 "사내망 전용" 을 앱 앞단에서 만든다 — `middleware.ts` 가 모든 요청의
 * 발신 IP 를 여기서 검사하고, 사내 공인 IP 가 아니면 로그인 화면조차 주지 않는다.
 *
 * 운영 기본은 fail-closed 다. `IP_ALLOWLIST` 를 깜빡하고 배포하면 전부 막힌다 —
 * "설정을 안 했더니 전 세계에 열려 있었다" 보다 "아무도 못 들어온다" 가 낫다.
 * 대신 차단 응답이 이유와 요청자 IP 를 알려 주므로 무엇을 고쳐야 할지 바로 안다.
 *
 * Edge 런타임에서 돌기 때문에 Node API 를 쓰지 않는다(순수 계산만).
 */

export type IpAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: 'not-configured' | 'no-ip' | 'blocked'; ip: string | null }

const IPV4_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/

/** IPv4 문자열을 32비트 정수로. 형식이 아니면 null. */
function toIpv4Number(ip: string): number | null {
  const m = IPV4_PATTERN.exec(ip)
  if (!m) return null
  let n = 0
  for (let i = 1; i <= 4; i++) {
    const part = Number(m[i])
    if (!Number.isInteger(part) || part > 255) return null
    n = n * 256 + part
  }
  return n >>> 0
}

/**
 * 비교 전에 표기를 하나로 맞춘다.
 * 프록시마다 `1.2.3.4:5678`, `[::1]:5678`, `::ffff:1.2.3.4` 처럼 다르게 넘겨서
 * 그대로 문자열 비교하면 같은 주소를 다른 주소로 본다.
 */
export function normalizeIp(raw: string): string {
  let ip = raw.trim().toLowerCase()

  if (ip.startsWith('[')) {
    // [::1]:5678 — 대괄호 안이 주소
    const close = ip.indexOf(']')
    if (close > 0) ip = ip.slice(1, close)
  }

  // ::ffff:1.2.3.4 — IPv4 를 IPv6 로 감싼 표기.
  // 포트 판정보다 **먼저** 벗겨야 한다. 콜론과 점이 함께 있어서 아래 규칙에 걸리면
  // 맨 앞 콜론에서 잘려 빈 문자열이 된다(허용 IP 가 통째로 차단되는 버그였다).
  if (ip.startsWith('::ffff:')) ip = ip.slice(7)

  // 1.2.3.4:5678 — 콜론이 하나뿐이고 점이 있을 때만 포트로 본다(IPv6 는 콜론이 여럿).
  const colon = ip.indexOf(':')
  if (colon > 0 && ip.indexOf(':', colon + 1) === -1 && ip.includes('.')) {
    ip = ip.slice(0, colon)
  }

  return ip
}

/** 쉼표로 구분된 허용목록 문자열을 항목 배열로. */
export function parseAllowlist(raw: string | undefined | null): string[] {
  if (!raw) return []
  return raw.split(',').map(entry => entry.trim()).filter(Boolean)
}

/**
 * 허용목록 한 항목과 대조한다.
 * 지원 형식: `*`(전체 허용) · 단일 IP · IPv4 CIDR(`203.0.113.0/24`).
 * IPv6 는 CIDR 없이 정확히 일치할 때만 통과한다(사내 회선은 대개 IPv4 고정이라 충분하다).
 */
function matchesEntry(ip: string, entry: string): boolean {
  if (entry === '*') return true

  const slash = entry.indexOf('/')
  if (slash < 0) return normalizeIp(entry) === ip

  const base = toIpv4Number(normalizeIp(entry.slice(0, slash)))
  const target = toIpv4Number(ip)
  const bits = Number(entry.slice(slash + 1))
  if (base === null || target === null) return false
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false
  if (bits === 0) return true

  const mask = (0xffffffff << (32 - bits)) >>> 0
  return ((base & mask) >>> 0) === ((target & mask) >>> 0)
}

/**
 * 요청자의 IP 를 헤더에서 뽑는다.
 *
 * `x-forwarded-for` 는 **맨 왼쪽**을 쓴다. Railway 의 체인이 이 모양이기 때문이다.
 *
 *     x-forwarded-for: 221.138.234.85, 152.233.68.97
 *                      └ 엣지가 넣는 실제 발신 IP   └ 내부 홉(요청마다 바뀜)
 *
 * 오른쪽 끝은 Railway 내부 프록시 주소라 허용목록과 영영 맞지 않는다.
 *
 * 왼쪽 끝은 보통 클라이언트가 위조할 수 있어 위험하지만, **Railway 엣지는 클라이언트가
 * 실어 보낸 `x-forwarded-for` 를 덮어쓴다.** 2026-08-26 실제 배포에서 확인했다 —
 * 위조 값(`1.2.3.4`, `8.8.8.8`)을 보내도 서버가 받은 체인에는 흔적조차 없었다.
 * 그래서 이 환경에서는 왼쪽 끝이 신뢰할 수 있는 값이다.
 *
 * ⚠️ 앞단 구성을 바꾸면(다른 PaaS, 프록시 추가) 이 전제가 깨진다.
 *    `docs/deploy-railway.md` 의 위조 검증을 다시 돌리고, 뚫리면 `IP_CLIENT_HEADER` 로
 *    발신 IP 전용 헤더(예: `cf-connecting-ip`)를 지정한다.
 */
export function clientIpFromHeaders(headers: Headers, trustedHeader?: string | null): string | null {
  // 프록시가 "실제 발신 IP" 만 담아 주는 전용 헤더가 있으면 그쪽이 더 안전하다.
  // (예: Cloudflare 를 앞에 두면 `cf-connecting-ip`. 체인이 아니라 단일 값이라 위조 여지가 없다)
  // `IP_CLIENT_HEADER` 로 지정한다 — 앞단 구성이 바뀌어도 코드를 고칠 필요가 없게.
  const trusted = trustedHeader?.trim()
  if (trusted) {
    const value = headers.get(trusted)
    return value ? normalizeIp(value.split(',')[0]!) : null
  }

  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim()
    if (first) return normalizeIp(first)
  }

  const real = headers.get('x-real-ip')
  return real ? normalizeIp(real) : null
}

/**
 * 접근 허용 여부를 판정한다.
 *
 * - 허용목록 미설정 + 운영  → 차단(fail-closed). 설정 누락이 곧 전면 공개가 되지 않게.
 * - 허용목록 미설정 + 개발  → 허용. 로컬에서 매번 IP 를 넣게 만들 이유가 없다.
 */
export function evaluateIpAccess(
  ip: string | null,
  rawAllowlist: string | undefined | null,
  isProduction: boolean,
): IpAccessDecision {
  const entries = parseAllowlist(rawAllowlist)

  if (entries.length === 0) {
    return isProduction ? { allowed: false, reason: 'not-configured', ip } : { allowed: true }
  }
  if (entries.some(entry => entry === '*')) return { allowed: true }
  if (!ip) return { allowed: false, reason: 'no-ip', ip: null }

  return entries.some(entry => matchesEntry(ip, entry))
    ? { allowed: true }
    : { allowed: false, reason: 'blocked', ip }
}
