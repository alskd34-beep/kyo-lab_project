# Railway 배포 가이드 — 사내망 전용

QC 시험 스케줄 시스템을 Railway 에 올려 사내에서만 접속하도록 구성하는 절차다.
지금까지 `local-server.bat` 으로 사무실 PC 에서 띄우던 것을 클라우드의 상시 구동
컨테이너로 옮기는 것이며, **DB(Supabase)는 이미 클라우드라 이관 대상이 아니다.**

---

## 왜 Railway 인가

이 앱은 **항상 켜져 있는 Node 프로세스**를 전제로 짜여 있다.

- `instrumentation.ts` 가 `node-cron` 으로 스케줄을 등록한다 — PCT 구글시트 적재(09:00 · 14:00 KST),
  장비 대기예약 24시간 초과 자동취소(매시). 서버리스에서는 아예 등록되지 않는다.
- 적재 중복 방지가 `globalThis` 기반 **프로세스 내 잠금**이다. 인스턴스가 둘이면 무력화된다.

Vercel 같은 서버리스로 가려면 크론을 플랫폼 크론으로 옮기고 잠금을 DB advisory lock 으로
바꿔야 한다. Railway 는 `next start` 를 그대로 돌리므로 그 작업이 필요 없다.

---

## 1. 사전 준비

### 사내 공인 IP 확인

사내망 PC 에서:

```bash
curl ifconfig.me
```

여기서 나온 주소가 허용목록에 넣을 값이다. 회선이 여러 개거나 대역으로 나간다면
CIDR (`203.0.113.0/24`) 로 적는다.

> ⚠️ **회선이 유동 IP 면 이 방식은 오래가지 못한다.** IP 가 바뀔 때마다 접속이 끊긴다.
> 통신사에 고정 IP 를 신청하거나, Cloudflare Access 같은 인증 프록시를 앞에 두는 편이 낫다.

### 🔐 키 로테이션 (권장)

`.env.example` 머리말에 적힌 대로 `.env.local` 이 과거 3개 커밋에 추적된 적이 있고
**히스토리에는 아직 남아 있다.** 인터넷에 노출되는 환경으로 나가기 전에
Supabase service-role 키와 JWT 시크릿을 새로 발급해 쓰는 것을 권한다.

```bash
openssl rand -hex 32   # JWT_ACCESS_SECRET / JWT_REFRESH_SECRET 각각
```

---

## 2. 배포 절차

1. **Railway 프로젝트 생성** → `New Project` → `Deploy from GitHub repo`
   → `KSSEO-HUUS/kyo-project` 선택
2. **환경변수 입력** (아래 표) — `Variables` 탭
   - ⚠️ `NEXT_PUBLIC_*` 은 **빌드 시점에 번들에 박히므로 첫 배포 전에** 넣어야 한다.
3. **배포** — 저장소의 `railway.json` 이 빌드·실행·헬스체크를 정의하므로 추가 설정이 필요 없다.
4. **도메인 발급** — `Settings` → `Networking` → `Generate Domain`
5. **사내망에서 접속 확인** → 로그인 화면이 뜨면 성공
6. **[3. 배포 후 검증](#3-배포-후-검증-필수)** 을 반드시 수행

---

## 환경변수

### 필수

| 변수 | 설명 |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project Settings → API |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 〃 |
| `SUPABASE_SERVICE_ROLE_KEY` | 〃 (없으면 서버가 부팅 시 실패) |
| `JWT_ACCESS_SECRET` | 32바이트 이상 랜덤값 |
| `JWT_REFRESH_SECRET` | 〃 |
| `IP_ALLOWLIST` | 사내 공인 IP. 쉼표 구분, CIDR 가능 |

### 운영 기능용

| 변수 | 설명 |
|---|---|
| `LETSUR_BASE_URL` · `LETSUR_API_KEY` | 관리자 챗봇. 없으면 챗봇만 동작하지 않는다 |
| `GOOGLE_SHEETS_PCT_FILE_ID` | PCT 적재 대상 시트. DB 설정값이 우선이고 없으면 이 값을 쓴다 |
| `SLACK_WEBHOOK_URL` | 시험 단계 전이 슬랙 알림. 없으면 알림만 조용히 비활성이고 전이는 정상 동작한다. Slack App → Incoming Webhooks 에서 발급 |

### 선택

| 변수 | 기본값 | 설명 |
|---|---|---|
| `IP_CLIENT_HEADER` | (비움) | 앞단 프록시의 발신 IP 전용 헤더. [검증](#3-배포-후-검증-필수) 결과에 따라 설정 |
| `DISABLE_PCT_CRON` | (비움) | `1` 이면 자동 적재 중단 |
| `LETSUR_MODEL` | `gpt-5-mini` | |
| `LETSUR_TIMEOUT_MS` | `180000` | |
| `SLACK_TIMEOUT_MS` | `1500` | 슬랙 응답 대기 상한(ms). 초과하면 알림을 포기하고 전이는 그대로 진행한다 |

### 설정하면 안 되는 것

| 변수 | 이유 |
|---|---|
| `PORT` | Railway 가 주입한다. 직접 넣으면 헬스체크가 실패한다 |
| `CHAT_ADMIN_USE_CLI` | 운영에서는 자동으로 꺼지고 Letsur 를 쓴다. `1` 로 켜면 컨테이너에 없는 CLI 를 찾다 실패한다 |
| `CODEX_*` · `CLAUDE_*` | CLI 경로용. 컨테이너에 해당 실행 파일이 없다 |

---

## 3. 배포 후 검증 (필수)

### ① 사내망 차단이 실제로 막는가

**사외 네트워크**(휴대폰 테더링 등)에서:

```bash
curl -o /dev/null -w "%{http_code}\n" https://<앱주소>/login
# 기대값: 403
```

### ② IP 위조로 뚫리지 않는가 ← 가장 중요

Railway 가 서버로 넘기는 체인은 이 모양이다(2026-08-26 실측):

```
x-forwarded-for: 221.138.234.85, 152.233.68.97
                 └ 엣지가 넣는 실제 발신 IP   └ Railway 내부 홉(요청마다 바뀜)
```

그래서 판정에는 **맨 왼쪽** 값을 쓴다. 왼쪽 끝은 보통 클라이언트가 위조할 수 있어
위험하지만, Railway 엣지는 클라이언트가 보낸 `x-forwarded-for` 를 **덮어쓴다** —
위조 값을 실어 보내도 서버가 받은 체인에는 남지 않는 것을 확인했다.
이 전제가 유지되는지 배포할 때마다 확인한다. **사외 네트워크**에서:

```bash
curl -o /dev/null -w "%{http_code}\n" \
     -H "x-forwarded-for: <사내공인IP>" https://<앱주소>/login
```

- `403` → 정상. 엣지가 실제 IP 를 덧붙이고 있다.
- `200` → **뚫린다.** 앞단에 Cloudflare 를 두고 프록시를 켠 뒤
  `IP_CLIENT_HEADER=cf-connecting-ip` 를 설정한다.

> 이 검사가 뚫려도 로그인(JWT) 이 한 겹 더 있어 즉시 데이터가 새지는 않는다.
> 다만 "사내망 전용" 이라는 전제가 깨지므로 반드시 확인하고 넘어간다.

### ③ 크론이 등록됐는가

Railway `Deployments` → `Logs` 에서 부팅 로그 확인:

```
[pct-cron] PCT 자동 적재 스케줄 등록 완료 (09:00, 14:00 KST) + 장비 대기 자동취소(매시)
```

수동 적재로 동작을 확인하려면 사내망에서 `POST /api/cron/ingest-pct`.

### ④ 차단 로그 확인

허용되지 않은 접근은 Railway 로그에 남는다. 사내 IP 가 바뀌었는지 여기서 확인한다.

```
[ip-allowlist] 차단 (blocked) — ip=1.2.3.4 xff=... path=/login
```

---

## 주의사항

### 인스턴스는 반드시 1개

`railway.json` 의 `numReplicas: 1` 을 늘리면 안 된다.
크론이 인스턴스마다 돌아 **적재가 중복되고**(중복 로그·알림·이력),
프로세스 내 잠금이 무력화된다. 늘리려면 먼저 DB advisory lock 을 도입해야 한다.

### IP_ALLOWLIST 를 비우면 전부 막힌다

운영에서 이 값이 비어 있으면 **모든 접근이 차단된다**(fail-closed).
설정을 깜빡한 것이 곧 전면 공개가 되지 않게 한 의도된 동작이다.
차단 화면이 이유와 요청자 IP 를 알려 주므로 그 값을 그대로 허용목록에 넣으면 된다.

### 채팅 첨부 이미지

`tmpdir()` 아래 1시간 TTL 임시 캐시라 **영구 볼륨이 필요 없다.**
재배포 시 사라지지만 최대 1시간 이내의 첨부라 영향이 없다.

### 로컬 실행은 그대로

`local-server.bat` 은 `npm run dev` 를 쓰므로 변경 없이 동작한다.
로컬에서 운영 빌드를 3300 포트로 띄우려면 `npm run start:local`.

---

## 롤백

Railway `Deployments` 에서 이전 배포의 `⋯` → `Redeploy`.
헬스체크(`/api/health`)가 실패하면 트래픽이 넘어가지 않으므로
부팅에 실패한 빌드로 갈아타는 일은 자동으로 막힌다.
