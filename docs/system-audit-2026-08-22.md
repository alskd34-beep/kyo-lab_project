# 시스템 1차 점검 및 정합성 정비 — 2026-08-22

전체 시스템을 통일성·프로세스 관점에서 1차 점검하고, 발견된 16건을 정비한 기록이다.
발견 근거 · 수정 내용 · 남은 조치를 항목별로 남긴다.

- 점검 시점 기준 브랜치: `main` (`41a7cd7`)
- 검증 게이트: `npm run typecheck` · `npm run lint` · `npm run build`

## 사용자 결정 사항

| 안건 | 결정 |
|---|---|
| 커밋된 `.env.local` 처리 | 추적 해제 + 키 로테이션 안내까지. **히스토리 재작성은 하지 않음** |
| 중복 주간 스케줄 경로 4개 | 1차: 삭제 없이 정합성만 수정 → **2차(2026-08-22): `/schedule/orders` 로 통합하고 3경로 폐기** |
| 공수 단위 | **DAY 확정** (`product_workload.avg_workdays`) |

## 진행 현황

| # | 항목 | 심각도 | 상태 |
|---|---|---|---|
| 1 | `.env.local` 커밋 — 시크릿 노출 | P0 | ✅ 코드 조치 완료 · **키 로테이션은 운영자 필요** |
| 2 | 인증 가드 없는 API 10개 | P0 | ✅ 완료 |
| 3 | `/api/qc-scheduler` 스키마 불일치·무인증 | P0 | ✅ 완료 |
| 4 | 마이그레이션에 없는 테이블 3종 | P0 | ✅ 완료 · **마이그레이션 적용 필요** |
| 5 | 주간 스케줄 경로 4개 병존 + 규칙 불일치 | P1 | ✅ **통합 완료 — 4경로 → 1경로**, 3경로 폐기 |
| 6 | 배정 로직 클라이언트 상주 / localStorage 영속화 | P1 | ⚠️ 경고 표시 + 이관 경로 확보 (이관 자체는 미실시) |
| 7 | Codex CLI 의존 — **개발 단계 의도된 선택** | P2 | ✅ 성격 정정 + 운영 전환 체크리스트 명시 |
| 8 | 상태값 SSOT 미준수 + `'취소'` 쿼리 버그 | P1 | ✅ 완료 |
| 9 | 죽은 엔드포인트 5개 | P1 | ✅ `@deprecated` 표시 (삭제는 보류) |
| 10 | Supabase 1000행 limit 무방비 조회 | P2 | ✅ 완료 |
| 11 | 레이어 위반 — route에서 supabase 직접 호출 | P2 | ✅ 완료 (0건) |
| 12 | 공용 API 클라이언트 부재 · 401 처리 누락 | P2 | ✅ 전역 401 복구 + 클라이언트 도입 · 기존 호출부 이관은 점진 |
| 13 | 응답 shape 불일치 · 영문 에러 메시지 | P2 | ✅ 완료 |
| 14 | 브랜드 컬러 이탈 (violet/sky) | P2 | ✅ 완료 (157건 교체) |
| 15 | AI 공급자 4종 병존 + 문서 불일치 | P2 | ✅ 문서 교정 완료 |
| 16 | 마이그레이션 번호 충돌 위험 · 공수 단위 | P2 | ✅ 번호 규칙 문서화 · **공수 = DAY 확정**(2026-08-22 사용자 결정) |
| 17 | lint 에러 6건 검증 | P2 | ✅ 1건 수정 · 5건은 리팩터 회귀로 되돌리고 근거 기록 |
| 18 | 표 칸 붕괴 (colgroup vs 자동 펼침) | P1 | ✅ 12개 화면 전수 점검 · 6개 수정 · `noSplit` 신설 · 자가진단 추가 |

---

## 1. `.env.local` 커밋 — 시크릿 노출 ✅

### 근거
```
.gitignore:44   #.env*.local          ← 주석 처리되어 무효
git ls-files    .env.local            ← 추적 중
git log -- .env.local
  b092a15  chore: .env.local 추가 및 QC완료예정일 placeholder 수정
  ff27bd9  feat: 모바일/태블릿 반응형 전환 + 챗봇 DB 컨텍스트 강화
  77465bd  Update .env.local
```
`git show HEAD:.env.local` 기준 실값이 담긴 키: `SUPABASE_SERVICE_ROLE_KEY`(RLS 우회 전권),
`JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`(토큰 위조 가능).

### 수정
| 파일 | 내용 |
|---|---|
| `.gitignore` | `#.env*.local` → `.env*.local` |
| `.env.local` | `git rm --cached` 로 추적 해제 (로컬 파일 유지) |
| `supabase/README.md` | 커밋 금지 경고 추가 |

### 🔴 남은 조치 — 운영자 수행 필요
과거 커밋에 키가 그대로 남아 있어 **추적 해제만으로는 노출이 해소되지 않는다.**
1. Supabase 대시보드 → Settings → API → `service_role` 키 재발급
2. `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` 재생성 (`openssl rand -hex 32`) — 교체 시 전 사용자 재로그인
3. `ANTHROPIC_API_KEY` 재발급
4. 히스토리 재작성(`git filter-repo`)은 force push 가 필요해 이번 범위에서 제외

---

## 2. 인증 가드 없는 API 10개 ✅

### 근거
`middleware.ts:45` 가 `/api/*` 를 자체 가드에 위임하고 그대로 통과시킨다.
라우트에 가드가 없으면 완전 무인증으로 노출된다. 시험자·시험항목·품목 마스터가
**인증 없이 생성/수정/삭제** 가능한 상태였고, 이들은 배정 엔진의 입력 데이터다.

### 수정
사이드바에서 `기준 설정`·`시험자 관리` 메뉴가 이미 `adminOnly` 이므로
**조회 = `requireAuth`, 쓰기 = `requireAdmin`** 으로 맞췄다. 프론트는 same-origin fetch 라 화면 영향 없음.

| 파일 | GET | POST | PATCH | DELETE |
|---|---|---|---|---|
| `app/api/testers/route.ts` | AUTH | ADMIN | ADMIN | ADMIN |
| `app/api/test-items/route.ts` | AUTH | ADMIN | ADMIN | ADMIN |
| `app/api/products/route.ts` | AUTH | ADMIN | ADMIN | ADMIN |
| `app/api/product-test-items/route.ts` | AUTH | ADMIN | — | ADMIN |
| `app/api/product-test-items/reorder/route.ts` | — | ADMIN | — | — |
| `app/api/tester-capabilities/route.ts` | AUTH | — | ADMIN | — |
| `app/api/tests/route.ts` | AUTH | — | — | — |
| `app/api/batches/route.ts` | AUTH | ADMIN | — | — |
| `app/api/batches/[id]/route.ts` | AUTH | — | ADMIN | — |
| `app/api/dashboard/route.ts` | AUTH | — | — | — |

`/api/auth/*` 는 로그인 이전 경로라 무인증이 정상이며, `change-password` 는 자체 토큰 검증을 한다.

---

## 3. `/api/qc-scheduler` — 스키마 불일치 · 무인증 ✅

### 근거
`app/(menu)/schedule/weekly/page.tsx:135` 가 실제로 호출하는 라이브 엔드포인트인데:

| 문제 | 내용 |
|---|---|
| 인증 없음 | 가드 미적용 |
| 서비스롤 키 직접 사용 | 라우트에서 `createClient(..., SUPABASE_SERVICE_ROLE_KEY)` |
| `runtime` 미선언 | 전체 59개 라우트 중 유일 |
| `NextResponse` 혼용 | 전체 중 유일 |
| 269줄 로직이 라우트에 | thin 원칙 위반 |
| **없는 테이블 조회** | `holidays`(→`public_holidays`), `schedules`(어디에도 없음) |
| **없는 컬럼 조회** | `production_batches.product_name` / `.qc_completion_deadline` / `.dosage_form` |
| **없는 컬럼 조회** | `testers.hplc`, `.gc`, `.gcms` … (역량은 `tester_capability_matrix` 에 있다) |

즉 첫 쿼리부터 실패하는 상태로, **현재 스키마에서 한 번도 동작한 적이 없다.**

### 수정
| 파일 | 내용 |
|---|---|
| `backend/services/aiWeeklySchedule.ts` (신규) | 로직 전량 이관. 배치는 `products`/`dosage_forms` 조인, 역량은 `tester_capability_matrix`, 휴일은 `public_holidays` + `operator_schedule`(휴가) |
| `app/api/qc-scheduler/route.ts` | 45줄 thin 라우트로 축소 · `requireAdmin` · `runtime='nodejs'` · `Response.json` · 날짜 형식/순서 검증 |
| `app/(menu)/schedule/weekly/page.tsx` | `tester_id`/`batch_id`/`duo_partner_id` 타입 `number` → `string`(UUID) · `credentials` 추가 |

부가 정비: 모델을 `claude-sonnet-4-20250514` → `claude-opus-5` 로, `max_tokens` 8000 → 16000,
adaptive thinking 적용. 응답에서 text 블록을 `content[0]` 이 아니라 **스캔해서** 찾도록 수정
(thinking 블록이 앞에 올 수 있음). LLM 이 UUID 가 아닌 값을 넣어도 FK 위반이 나지 않도록
저장 전 UUID 형식을 검증한다.

---

## 4. 마이그레이션에 없는 테이블 3종 ✅

### 근거
```bash
# 코드가 참조하는 테이블 − 마이그레이션이 만드는 테이블
comm -23 /tmp/used.txt /tmp/created.txt
  holidays
  schedules
  test_item_equipment
```
`test_item_equipment` 는 `qcJobs` · `pctAssign` · `leaveSuggestions` · `pct-generate` 가 쓰는
**실사용 테이블인데 정의가 없다** — 운영 DB 에는 수기로 만들어져 있고, 신규 환경에서는 재현되지 않는다.

### 수정
`supabase/migrations/0028_schema_alignment.sql` 신설 (전부 `if not exists`, 재실행 안전):
- `test_item_equipment` — `test_item`, `required_equipment`, `is_universal` + unique 인덱스
- `ai_weekly_schedules` — AI 주간 배정 이력 (`schedules` 대체. 확정 배정 정본은 `pct_orders`)
- `holidays` 는 `public_holidays` 오타였으므로 **코드 쪽을 고쳤고 테이블은 만들지 않았다.**

### 🔴 남은 조치 — `supabase db push` 를 쓰면 안 된다

**대시보드 SQL Editor 에서 `0028_schema_alignment.sql` 만 실행한다.**

`supabase db push` 는 원격 마이그레이션 이력에 없는 파일을 **전부** 실행한다.
이 레포는 0001~0027 을 SQL Editor 에 붙여넣어 수동 적용해왔고(README 안내), 그러면 원격 이력이 비어 있다.
그 상태에서 push 하면 `0004_pqm_schema.sql` 이 재실행된다:

```sql
-- supabase/migrations/0004_pqm_schema.sql:21-30
drop table if exists product_test_items       cascade;
drop table if exists tester_capability_matrix cascade;
drop table if exists production_batches       cascade;
drop table if exists testers                  cascade;
drop table if exists products                 cascade;   -- 717행
drop table if exists test_items               cascade;
```
→ **운영 마스터 데이터가 통째로 삭제된다.** 그 밖에 `0011` 도 drop, `0014` 는 delete, `0002/0008/0016/0018` 은 시드 재삽입이다.

push 를 꼭 쓰려면 `supabase migration repair --status applied 0001 … 0027` 로
기존 마이그레이션을 "적용됨"으로 먼저 표시해야 한다.

### 0028 이 실제로 만드는 것 (운영 DB 확인 결과)
| 테이블 | 운영 상태 | 0028 |
|---|---|---|
| `test_item_equipment` | **이미 존재 (197행)** | `if not exists` 라 무해 — 정의만 레포에 남긴다 |
| `ai_weekly_schedules` | 없음 | **이것만 새로 생성된다** |
| `schedules` | 존재 (65행, `tester_id` 가 int) | 재생성하지 않음 — 레거시 동결 |

미적용 상태에서도 화면은 동작한다. `/api/schedules/monthly` 는 레거시 `schedules` 로 자동 폴백하고
(2026-04 조회 시 57행 정상 반환 확인), `/api/qc-scheduler` 는 결과를 반환하되
`meta.persisted: false` 로 이력 저장 실패만 알린다.

---

## 5. 주간 스케줄 경로 4개 병존 + 규칙 불일치 ✅(규칙) / 보류(통합)

### 근거
같은 "주간 배정"을 서로 다른 입력·알고리즘으로 4번 만들고 있었다.

| 경로 | 입력 | 엔진 | 저장 | 화면 |
|---|---|---|---|---|
| `pctAssign.autoAssign` | DB `pct_orders` | 규칙엔진 | `pct_orders` **(정본)** | `schedule/orders` |
| ↳ 내부 Codex 분기 | 동일 | Codex CLI | 동일 | 동일 |
| `weekly-planner.planWeekly` | 구글시트(클라이언트) | 클라 규칙엔진 | localStorage | `schedule/weekly-plan` |
| `/api/qc-scheduler` | `production_batches` | Anthropic | (없던 테이블) | `schedule/weekly` |

**핵심 문제는 경로 수보다 규칙 불일치였다.** 정본 규칙 문서
`.claude/commands/qc-schedule-process.md` 의 특수 규칙이 AI 주간 경로에 하나도 반영돼 있지 않았다:

| 규칙 | 규칙엔진(`assignRules.ts`) | AI 주간 경로(수정 전) |
|---|---|---|
| 향정신성 — 강지윤·김정호 제외 | ✅ | ❌ 없음 |
| 개별 중금속 — 금요일 3인 순환 | ✅ | ❌ 없음 |
| 긴급 — 공수 ≤3DAY 만 | ✅ | ❌ 없음 |
| 난이도 기반 후순위 | ✅ | ❌ 없음 |
| 동시분석 5개 OR 조건 | ✅ | ❌ 1개만 (품목명 동일) |
| 공수 = DAY 절대값 | ✅ | ❌ 명시 없음 |

### 수정
`aiWeeklySchedule.ts` 의 프롬프트가 `assignRules.ts` 의 상수를
**직접 import 해서 문자열을 만들도록** 바꿨다. 대상자·임계값이 코드 한 곳에만 존재하므로
규칙이 갈라질 수 없다.
```ts
import { PSYCHOTROPIC_PRODUCTS, PSYCHOTROPIC_EXCLUDED_NAMES,
         HEAVY_METAL_ROTATION, EMERGENCY_MAX_DAYS } from '@backend/services/assignRules'
```
프롬프트 규칙도 9개 → 14개로 확장해 정본 문서와 1:1 대응시켰다.

### 통합 실행 (2026-08-22, 사용자 승인)

**정본 = `/schedule/orders` (AI 스케줄).** DB `pct_orders` 기준 · 규칙엔진 · 확정/LOCK/재배정 이력까지 연결.
사이드바에 노출되는 유일한 배정 화면이었다.

폐기한 3경로 — **둘은 이미 사이드바 메뉴에 없었고**(라우트 매핑만 남아 URL 직접 접근만 가능),
하나는 호출부가 0건이었다.

| # | 경로 | 입력 | 엔진 | 함께 삭제 |
|---|---|---|---|---|
| 1 | `/schedule/weekly` (705줄) | `production_batches`(레거시) | Anthropic LLM | `app/api/qc-scheduler/`, `backend/services/aiWeeklySchedule.ts` |
| 2 | `/schedule/weekly-plan` (600줄) | 구글시트 클라이언트 직접 | 클라 규칙엔진 | `frontend/lib/weekly-planner.ts` |
| 3 | `/api/schedules/pct-generate` | 클라이언트 전달 행 | 규칙엔진 | `backend/services/pctScheduleDraft.ts` |

부수 정리: `sidebar.tsx` 죽은 라우트 매핑 2줄, `loading.tsx` 분기, AGENTS/ARCHITECTURE/PRD 문서 참조.

**유지한 것**(혼동 주의): `frontend/lib/pct-schedule-bridge.ts`(월간 화면이 사용) ·
`schedules` 테이블 65행(월간 화면이 읽음) · `/schedule/monthly`.

### 통합 효과
- 배정 경로 **4개 → 1개**, 삭제 약 1,300줄
- `@anthropic-ai/sdk` 를 import 하는 코드가 사라졌다(잔여 의존성만 남음)
- **마이그레이션 0028 이 사실상 불필요해졌다** — `ai_weekly_schedules` 가 필요 없어져
  `test_item_equipment`(운영 DB 에 이미 197행 존재) 정의만 남았다. DB 작업 없이도 전 기능이 동작한다.

### 배정 규칙 정본 위치 (변경 시 여기부터)
| 계층 | 위치 |
|---|---|
| 요구사항 정본 | `.claude/commands/qc-schedule-process.md` (`CLAUDE.md` 가 단일 기준으로 지정) |
| 구현 현황 | `docs/qc-schedule-status.md` |
| 규칙 구현(순수함수) | `backend/services/assignRules.ts` |
| 스케줄 엔진 | `backend/services/scheduleEngine.ts` |
| 확정 배정 | `backend/services/pctAssign.ts` |
| AI 주간 프롬프트 | `backend/services/aiWeeklySchedule.ts` (위 상수를 주입받음) |

---

## 6. 배정 로직 클라이언트 상주 / localStorage 영속화 ⚠️

### 근거
- `frontend/lib/weekly-planner.ts` — 13KB 배정 규칙 엔진이 브라우저 코드
- `frontend/lib/pct-schedule-bridge.ts` — 원문 주석: *"DB 영속화(Phase 4)는 별도 단계. 지금은 클라이언트 캐시"*

3계층 분리 위반이자, **배정 근거가 서버에 남지 않아 감사추적(GMP)이 불가**하다.

### 수정 (부분)
두 파일 상단에 정리 대상 경고와 이관 경로를 명시했다. 이관 대상 테이블(`ai_weekly_schedules`)과
조회 API(`/api/schedules/monthly`)는 이번에 확보했으므로, 이관 작업 자체는 바로 착수 가능하다.
**이관은 화면 동작 검증이 필요해 이번 범위에서 제외했다.**

---

## 7. Codex CLI 의존 — 개발 단계의 의도된 선택 ✅

> **정정(2026-08-22).** 최초 점검에서 이를 "배포 불가 구조"로 규정했으나, 확인 결과
> **개발 단계에서는 CLI(Codex) 기반이 의도된 선택**이고 API 기반은 운영 전환 시점의 과제다.
> 아래는 결함 목록이 아니라 **운영 전환 체크리스트**로 읽어야 한다.

### 배경
개발 중에는 API 키 과금 없이 구독 세션을 그대로 쓰기 위해 CLI 기반을 우선한다.
각 사용처는 전환 스위치를 이미 갖고 있어, 운영에서는 코드 변경 없이 API/규칙엔진 경로로 넘어간다.

| 사용처 | 스위치 | 기본값 | 운영 경로 |
|---|---|---|---|
| `chat.ts` (관리자 챗봇) | `CHAT_ADMIN_USE_CLI` | 비프로덕션에서만 CLI | Letsur |
| `pctAssign.ts` (오더 배정) | `ENABLE_CODEX_ASSIGN` | 꺼짐(옵트인) | 규칙엔진 (실패 시 폴백도 동일) |

### 운영 전환 시 해소할 제약
```ts
spawn('sh', ['-c', cmd])                              // Windows 서버 미동작
'--dangerously-bypass-approvals-and-sandbox'          // 승인·샌드박스 우회
homedir()/.vscode/extensions/openai.chatgpt-*/bin     // VS Code 확장 경로 탐색
```
- 서버에 설치·로그인된 CLI 세션에 의존해 배포 환경에서 재현이 어렵다.
- 호출 이력이 남지 않아 AI 배정 근거를 감사추적할 수 없다(GMP 관점) — 6번과 함께 다룬다.

### 수정
`backend/lib/codexCli.ts` 상단 주석을 "운영 승격 금지" → **"개발 단계 기본 경로 + 운영 전환 체크리스트"**
로 고쳐 의도를 정확히 남겼다. `AGENTS.md` 의 AI providers 항목도 같은 취지로 정정했다.

## 8. 상태값 SSOT 미준수 + `'취소'` 쿼리 버그 ✅

### 근거
`types/qc-status.ts` 는 *"화면·서비스마다 문자열을 따로 적지 말고 이 파일을 import"* 라고 선언했지만,
SSOT 를 import 하는 파일 12개 / 한글 리터럴을 하드코딩한 파일 12개로 반반이었다.

**버그**: `concurrentGroups.ts:310` 의 `.neq('status', '취소')` — `ORDER_STATUSES` 에 `'취소'` 는 없고
`'삭제'` 만 있다. 코드 어디에서도 `'취소'` 를 쓰지 않으므로 이 조건은 **아무 행도 거르지 못하는 no-op** 였다.

### 수정
| 파일 | 내용 |
|---|---|
| `types/qc-status.ts` | 단계별 이름 상수 추가(`IN_PROGRESS_STATUS` 등) · `UNASSIGNED_LABEL`(상태값 아님을 명시) |
| `concurrentGroups.ts` | 죽은 `.neq('status','취소')` 제거, 주석 정정 |
| 서비스 10개 | 하드코딩 리터럴 → SSOT 상수 (총 33건) |

대상: `chat` · `concurrentGroups` · `leaveSuggestions` · `pctOrders` · `qthinkAgent` · `tests` ·
`pctAssign` · `pctIngest` · `qcDashboard` · `qcJobs`

> `'미배정'` / `'미지정'` 은 **표시 라벨**이지 상태값이 아니다(미배정 판정은 `assignee_tester_id IS NULL`).
> 혼동을 막으려고 `UNASSIGNED_LABEL` 로 분리해 문서화했다.

---

## 9. 죽은 엔드포인트 5개 ✅(표시)

### 근거 — 호출부 0건
`/api/schedules/pct-generate` · `/api/reassignment-history` · `/api/tableau/summary` ·
`/api/batches`(+`[id]`) · `/api/dashboard`

특히 재배정 이력은 화면이 `/api/ai-schedule-history` 로 이미 이전했는데 구버전이 남아 정본이 불명확했다.

### 수정
**삭제하지 않고** `@deprecated` 헤더로 사유·대체 경로를 명시했다
(`/api/tableau/summary` 는 외부 Tableau 연동이 호출할 가능성이 있어 특히 보존).
`pct-generate` 는 서비스 분리 + `requireAdmin` 으로 정합성만 맞췄다(11번 참조).

---

## 10. Supabase 1000행 limit 무방비 조회 ✅

### 근거
`backend/lib/supabasePage.ts` 의 `selectAll` 헬퍼가 있고 주석에 *"1327행 → 327행 누락 → 미배정"*
사고 이력까지 적혀 있는데 **3곳에서만** 쓰고 있었다.

### 수정 — 누적/대용량 테이블 6곳에 적용
| 위치 | 테이블 | 영향 |
|---|---|---|
| `reassignmentHistory.ts` | `reassignment_history` | 누적 → 1000건 초과 시 재배정 통계 축소 |
| `qcDashboard.ts` | `reassignment_history` | 대시보드 재배정 건수 오류 |
| `pctIngest.ts` | `products` | 품목 1000개 초과 시 "미동기화" 오탐 |
| `equipmentReservation.ts` | `equipment_reservation` | 누적 → 장비 목록 누락 |
| `testers.ts` | `tester_capability_matrix` | 시험자×역량 조합 |
| `concurrentGroups.ts` | `concurrent_product_family_members` | 품목군 매핑 누락 |

또한 오류를 삼키지 않도록 `if (error) throw` 를 함께 넣었다(`pctIngest` 의 품목 조회는 무시되고 있었다).

---

## 11. 레이어 위반 — route 에서 supabase 직접 호출 ✅

### 근거 — 4곳
`qc-scheduler`(269줄) · `schedules/pct-generate`(263줄) · `schedules/monthly` · `equipment-reservation/[id]`

`schedules/monthly` 역시 **없는 `schedules` 테이블**을 조회하고 있었다(3·4번과 동일 원인).

### 수정 — 신규 서비스 3개로 이관
| 신규 서비스 | 대체한 라우트 |
|---|---|
| `backend/services/aiWeeklySchedule.ts` | `app/api/qc-scheduler` |
| `backend/services/monthlySchedule.ts` | `app/api/schedules/monthly` (→ `ai_weekly_schedules` 조회로 교정) |
| `backend/services/pctScheduleDraft.ts` | `app/api/schedules/pct-generate` |

`equipment-reservation/[id]` 는 `reservationOwnerId()` · `deleteReservation()` 를 서비스에 추가해 이관.

**결과: `app/api/**/route.ts` 에서 supabase 직접 참조 0건, `createClient` 직접 호출 0건.**
최장 라우트가 269줄 → 134줄로 줄었다.

> `monthlySchedule.ts` 의 반환 필드가 snake_case 인 것은 의도적 예외다 — 월간 화면이 이 응답과
> PCT 브릿지 행을 같은 배열에서 병합하므로 키가 같아야 한다. 6번 이관 시 함께 전환한다.

---

## 12. 공용 API 클라이언트 부재 · 401 처리 누락 ✅

### 근거
raw `fetch` 110개. 401 처리는 `my-tasks` · `pretest-checklist` **2개 화면에만** 있어
나머지에서는 세션 만료가 원인 불명의 실패로 보였다.

### 수정
| 파일 | 내용 |
|---|---|
| `frontend/lib/api-client.ts` (신규) | `api.get/post/patch/put/del` · 항상 credentials 전송 · `{ error }` → `ApiError` · 401/403 한국어 메시지 |
| `frontend/lib/auth-context.tsx` | **전역 401 복구** — `/api/*` 응답이 401 이면 refresh 1회 자동 시도 후 재요청, 실패하면 로그인 화면으로 이동 |

전역 처리라 **기존 110개 호출부를 고치지 않아도 모든 화면이 즉시 올바르게 동작한다.**
(`/api/auth/*` 는 401 이 정상 흐름이라 제외, 스트림 본문은 재전송 불가라 재시도 제외)

### 🟡 남은 작업
기존 호출부의 `api-client` 이관은 점진 진행. `res.json()` 결과가 `any` 라 타입체크가 잡아주지 못해
일괄 치환은 위험하다고 판단했다. 신규 코드는 `app/api/AGENTS.md` 규약대로 `api-client` 를 쓴다.

---

## 13. 응답 shape 불일치 · 영문 에러 메시지 ✅

### 근거
`rows`(18) / `row`(8) / `ok`(37) 외에 `users` · `batch` 등 리소스명을 키로 쓰는 곳이 섞여 있었고,
제품 언어가 한국어인데 `'unauthenticated'` · `'invalid token'` · `'forbidden'` · `'user not found'` 가 남아 있었다.

### 수정
| 파일 | 내용 |
|---|---|
| `backend/lib/guard.ts` | 401/403 메시지 한국어화 |
| `app/api/auth/me`, `auth/change-password` | 영문 메시지 한국어화 |
| `app/api/users`(+`[id]`) | `{ users }`→`{ rows }`, `{ user }`→`{ row }` |
| `app/api/batches`(+`[id]`) | `{ batch }`→`{ row }` |
| `app/(menu)/settings/users/page.tsx` | 소비처 동시 수정 |
| `app/api/AGENTS.md` | 규약 정밀화 + **문서화된 예외** 명시 |

**문서화된 예외**: `auth/*` 의 `{ user }`(세션 주체, `auth-context` 가 의존), 그리고
서로 다른 컬렉션을 여러 개 반환하는 응답(`{ rows, categories, classifications }`, `{ capabilities, matrix }` 등)은
각각 이름을 갖는다 — `rows` 로 뭉개면 오히려 의미가 사라지기 때문이다.

---

## 14. 브랜드 컬러 이탈 ✅

### 근거
`AGENTS.md` 는 브랜드 강조색을 파랑 하나로 통일하고 `indigo`/`violet`/`purple`/`sky` 를 금지하는데,
`schedule/monthly` · `schedule/weekly` 등이 **violet 을 페이지 강조색**으로 쓰고 있었다
(포커스 링 · 아이콘 칩 · 카드 헤더 · 활성 상태). 총 violet 169 · sky 21 · purple/indigo 3.

### 수정 — 157건 교체
16개 파일에서 금지색 → `blue-*`. 교체 후 겹친 색은 분리했다:
- 월간 요약 카드가 blue 3개가 되어 → 활동 시험자 `slate`, 듀오 `teal` 로 분리
- PCT 출처 셀이 듀오(blue)와 겹쳐 → PCT 출처 `amber`(dashed) 로 분리

**예외 유지(색 자체가 의미)**: `types/qc-status.ts` 단계 배지 팔레트,
`job-detail-modal`(진행중=violet, 단계 팔레트와 일치), `MondayBoard`/`SheetBoardSection` 카테고리 팔레트,
`tag.tsx` 의 `indigo`="공지", `BOARD_COLORS`/`COLORS` 배열.

> `rounded-md` 통일(457/522)과 `<DateField>` 규칙(raw `type="date"` 0건)은 이미 잘 지켜지고 있어 손대지 않았다.

---

## 15. AI 공급자 4종 병존 + 문서 불일치 ✅

### 근거 — 문서가 실제와 전혀 달랐다
`AGENTS.md` 는 *"챗봇은 OpenAI `gpt-4o-mini`, `@anthropic-ai/sdk` 는 legacy/unused"* 라고 기술했으나:
- **OpenAI 를 호출하는 코드가 한 줄도 없다.**
- `@anthropic-ai/sdk` 는 AI 주간 스케줄에서 **현역**이다.

### 실제 구성 (검증 완료)
| 경로 | 공급자 | 진입점 | Env |
|---|---|---|---|
| 챗봇 — 시험자 | MISO 앱 | `misoClient.ts` | `MISO_API_URL`, `MISO_API_KEY` |
| 챗봇 — 관리자(개발) | Codex CLI | `codexCli.ts` | `CODEX_*` |
| 챗봇 — 관리자(운영) | Letsur | `letsurClient.ts` | `LETSUR_*` |
| AI 주간 스케줄 | Anthropic `claude-opus-5` | `aiWeeklySchedule.ts` | `ANTHROPIC_API_KEY` |
| AI 오더 배정(옵트인) | Codex CLI → 규칙엔진 폴백 | `pctAssign.ts` | `ENABLE_CODEX_ASSIGN` |

### 수정
`AGENTS.md` 에 위 표를 추가하고, `backend/AGENTS.md` 의 chat.ts 설명을 역할별 분기 실제대로 고쳤다.

### 🔴 남은 조치
`.env.local` 에 `LETSUR_*` · `MISO_*` 키가 **없다** → 시험자 챗봇과 운영 관리자 챗봇은 현재 동작 불가.

---

## 16. 마이그레이션 번호 충돌 위험 · 공수 단위 ✅ / 🟡

### 근거
`main` 은 `0025 → 0027` 로 건너뛴다. `0026_workload_standard.sql` 은 미머지 브랜치
`feat/workload-standard-and-leave-guard` 가 점유 중이라, `main` 에서 다음 번호를 0026 으로 붙이면 머지 시 충돌한다.

### 수정
`supabase/README.md` 에 **마이그레이션 번호 규칙** 섹션 추가:
- 번호 재사용 금지, 새 번호 전 `git log --all` 로 미머지 브랜치까지 확인
- 모든 DDL 은 재실행 가능하게 (`if not exists`)
- **코드가 쓰는 테이블 − 마이그레이션이 만드는 테이블 = 공집합** 검증 명령 수록 (4번 재발 방지)

이번 신규 마이그레이션은 0026 을 피해 **0028** 로 채번했다.

### 공수 단위 = DAY 확정 (2026-08-22 사용자 결정) ✅
정본은 `product_workload.avg_workdays`(DAY, 절대값)다. `products.avg_hours`(Hour)는 레거시다.

| 위치 | 조치 |
|---|---|
| `qcDashboard.ts` | 이미 `avg_workdays` 단일 소스 — 변경 없음(문서의 "8h=1d 환산"은 낡은 서술이었다) |
| `schedule/monthly` 화면 | 공수 표시를 `workdays`(일) 우선으로 바꾸고 열 라벨 `공수(h)` → `공수(일)` |
| `products.ts` · `assignRules.ts` | `avgHours` 를 `@deprecated` 로 명시, 주석의 Hour 환산 서술 제거 |
| `docs/qc-schedule-status.md` | 미결 항목 → DAY 확정으로 갱신 |

### 🔴 그런데 공수 데이터가 비어 있다
운영 DB 확인(2026-08-22, 읽기 전용):

| 테이블 | 행 수 |
|---|---|
| `product_workload` (공수 DAY 정본) | **0** |
| `tester_capability_matrix` (시험자 역량) | **0** |
| `products.avg_hours` 값이 있는 행 | **0** |
| `products` | 717 |
| `test_item_equipment` | 197 |
| `pct_orders` | 30 |

즉 **자동배정의 핵심 입력 두 가지(공수·역량)가 등록돼 있지 않다.**
현재는 `qcDashboard` 의 `DEFAULT_WORKDAYS = 1`(미등록 시 1일 근사)로 넘어가고 있다.
공수·역량 등록이 선행되지 않으면 배정 품질을 논할 수 없다.

---

## 17. lint 에러 6건 검증 (기존 문제) ✅

최초 보고에서 "기존 문제라 손대지 않았다"고 한 6건을 실제로 검증했다. 결론은 **1건은 진짜 결함, 5건은 규칙은 맞지만 안전한 수정이 불가**였다.

### 17.1 `use-virtual-window.ts` — 진짜 결함 ✅ 수정
```
46:7  error  This value cannot be modified   react-hooks/immutability
50:7  error  Calling setState synchronously within an effect  react-hooks/set-state-in-effect
```
목록이 짧아졌을 때 스크롤을 끝으로 당기는 로직을 effect 안에서
`el.scrollTop = max` + `setScrollTop(max)` 로 처리하고 있었다. effect 가 다시 렌더를 유발해
(cascading render) 한 프레임 어긋난 창이 먼저 그려진다.

**수정**: 값 보정을 **렌더 중**으로 옮기고(`clampedTop`), effect 는 DOM 스크롤만 맞춘다.
최초 측정도 `ResizeObserver` 의 초기 콜백(사양상 `observe()` 직후 1회 호출)에 맡겨
effect 본문의 setState 를 없앴다.

### 17.2 `table.tsx` 5건 — 순수화 리팩터 시도 → **회귀 발생 → 되돌림** ⚠️
```
251,252,272  error  Cannot access refs during render   react-hooks/refs
273          error  Cannot update ref during render    react-hooks/refs
```
측정 캐시(`samplesRef`)와 분할 히스테리시스(`prevFlagsRef`)를 렌더 중에 읽고 쓴다.

**시도**: 둘 다 state 로 옮겨 렌더를 순수하게 만들었다.
**결과**: 타입체크·빌드·lint 는 통과했으나, 브라우저 검증에서
**장비 마스터(`/equipment/master`) 화면이 무한 렌더**에 빠졌다.
```
Maximum update depth exceeded
  at Table.useCallback[registerHeader]
  at TableHead.useLayoutEffect
```
계측 결과: 측정치 state 가 매 사이클 초기화되어(`prev.size` 가 0→1→2→3 을 반복)
`ctx` 재생성 → 자식 layout effect → setState 가 맞물려 수렴하지 않았다.

**A/B 로 회귀임을 확정**: 같은 화면·같은 조작에서 변경 전 0 에러 / 변경 후 무한 루프.
→ **되돌렸다.** 대신 억제 주석에 위 경위와 재시도 시 필요한 설계(측정 등록용 컨텍스트와
결과 컨텍스트 분리)를 남겼다.

> 부수 확인: 순수화 리팩터가 적응형 열 동작을 바꾸지는 않았다.
> 병합/펼침 임계값을 변경 전/후 같은 시퀀스로 측정해 결과가 동일함을 확인했다(4열/6열 일치).

### 17.3 남은 경고
`npm run lint` = **0 errors / 21 warnings**. 경고는 전부 기존 항목이며,
그중 `table.tsx:295` 의 `sampleRev` unnecessary-dependency 는 의도적이다
(ref 변경을 memo 에 알리는 신호로만 쓴다).

---

## 18. 시험자 화면 '2인 가능' 미표기 — 표 칸 붕괴 ✅

사용자 제보로 발견. 원인은 두 가지가 겹친 것이고 **둘 다 기존 문제**였다
(`git diff HEAD` 로 해당 파일 미변경 확인).

### 18.1 본문에 '상태' 칸이 없었다
헤더는 `순번 · 시험자(이름+사번) · 시험가능(단독+2인) · 상태` 4개 논리 열을 선언하는데
본문 행은 3칸만 그렸다. 펼쳐지면 헤더 6칸 / 본문 5칸으로 어긋난다.
설계 문서(`docs/table-adaptive-columns.md` §6)에도 시험자 표의 단독 열로 **상태**가 명시돼 있다.

**수정**: 본문에 상태 칸(`활성`/`비활성` Tag)을 추가. 헤더 6 / 본문 6 으로 일치.

### 18.2 `<colgroup>` 이 최대 칸 수를 못 따라간다 — **시스템 전반 문제**
`Table` 은 `layout="fluid"`에서 `table-fixed` 를 쓴다. 화면이 `<col>` 을 논리 열 수만큼만
선언하고 폭 합이 100% 이면, 자동 펼침으로 늘어난 칸은 **폭 0으로 접혀 사라진다.**

| 화면 | 증상 |
|---|---|
| `test-mgmt/testers` | `<col>` 4개 / 최대 6칸 → **2인·상태 폭 0** (제보 내용) |
| `home` | `<col>` 3개 / 최대 5칸 → **D-Day·상태 폭 0** |

**수정**: 두 화면 모두 `<col>` 을 최대 펼침 칸 수만큼 선언하고 폭을 재배분했다.
합쳐졌을 때는 뒤쪽 `<col>` 이 무시되고 남은 폭이 다시 나뉘므로 양쪽 모두 성립한다.
`<colgroup>` **안에 JSX 주석을 두면 공백 텍스트 노드가 생겨 hydration 오류**가 나므로 주석은 밖에 둔다.

브라우저 실측(1680 / 820 / 790px): 헤더·본문 칸 수 일치, 폭 0 칸 0개, 잘린 셀 0개, 콘솔 0 에러.

### 18.3 전 화면 정리 (2026-08-22 추가)

`<colgroup>` 을 쓰는 화면 12개를 전수 점검했다. **6개가 같은 사고 상태였다.**

| 화면 | `<col>` | 최대 칸 | 조치 |
|---|---|---|---|
| `page.tsx` (대시보드) | 6 | **10** | 10칸으로 재선언 — `수탁사`·`일정`·`진행상태` 가 사라져 있었다 |
| `home` | 3 | 5 | 5칸 — `D-Day`·`상태` 복구 |
| `test-mgmt/testers` | 4 | 6 | 6칸 + 본문 `상태` 칸 추가 |
| `equipment/master` | 4 | 7 | 7칸 |
| `equipment/reservation` | 4 | 5 | 5칸 |
| `test-mgmt/pretest-checklist` | 4 | 6 | 6칸 |
| `stability/stab-status` | 4 | 6 | 6칸 + `일자` 열 `noSplit` |
| `schedule/reassignments` | 5 | 5 | `오더`·`내용` 열 `noSplit` (본문이 합성 문자열) |
| `schedule/weekly-plan` | 2 | 2 | `품목` 열 `noSplit` |
| `insights/stats` · `schedule/holidays` · `test-mgmt/test-items` | — | — | 이미 정상 (변경 없음) |

`<colgroup>` 이 없는 화면은 이 사고가 날 수 없다(칸이 균등 분배되어 폭 0이 생기지 않는다).

### 18.4 `noSplit` 신설
칸이 나뉘는 조건이 **헤더 `fields` ≥ 2 OR 본문 `CellStack` 의 `secondary` 존재** 라서,
헤더만 손대면 본문이 유발하는 분할을 막을 수 없었다. `SortColumnDef.noSplit` 을 추가하고
`Table` 이 이를 열 단위로 존중하도록 했다(정렬 선택지는 유지, 칸만 합쳐 둔다).

적용 대상은 **설계 문서가 금지한 3필드 묶음**과 **합성 문자열 보조값**이다:
- `stability/stab-status` `일자` — 본문이 제조/기한/의뢰 3줄
- `schedule/reassignments` `오더`(코드·제조번호), `내용`(요약·사유)
- `schedule/weekly-plan` `품목`(코드·제조번호)

### 18.5 재발 방지
1. `Table` 에 **개발용 자가진단** 추가 — `<col>` 수 < 실제 칸 수면 콘솔 경고.
   상태를 바꾸지 않아 렌더에 영향이 없다.
2. `docs/table-adaptive-columns.md` 에 `<colgroup>` 규칙 · `noSplit` · JSX 주석 금지 명문화.

### 검증
브라우저 실측(1920px): 대시보드 · 홈 · 시험자 · 안정성현황 · 재배정이력 · 공휴일 · 장비예약 —
**폭 0 칸 0개, 헤더/본문 칸 수 일치, 빈 헤더 0개, 콘솔 0 에러.**
데이터가 없어 실측하지 못한 화면(`equipment/master` · `weekly-plan` · `pretest-checklist` ·
`insights/stats` · `test-items`)은 위 자가진단이 실행 시 알린다.

## 변경 파일 목록

### 신규
```
supabase/migrations/0028_schema_alignment.sql
backend/services/aiWeeklySchedule.ts
backend/services/monthlySchedule.ts
backend/services/pctScheduleDraft.ts
frontend/lib/api-client.ts
docs/system-audit-2026-08-22.md
```

### 수정 — 보안·가드
```
.gitignore                                   .env.local (추적 해제)
backend/lib/guard.ts
app/api/{testers,test-items,products,tests,dashboard}/route.ts
app/api/product-test-items/{route.ts,reorder/route.ts}
app/api/tester-capabilities/route.ts
app/api/batches/{route.ts,[id]/route.ts}
app/api/auth/{me,change-password}/route.ts
app/api/users/{route.ts,[id]/route.ts}
```

### 수정 — 레이어·스키마
```
app/api/qc-scheduler/route.ts                app/api/schedules/monthly/route.ts
app/api/schedules/pct-generate/route.ts      app/api/equipment-reservation/[id]/route.ts
backend/services/equipmentReservation.ts
```

### 수정 — 상태 SSOT · 1000행
```
types/qc-status.ts
backend/services/{chat,concurrentGroups,leaveSuggestions,pctOrders,qthinkAgent,tests}.ts
backend/services/{pctAssign,pctIngest,qcDashboard,qcJobs,reassignmentHistory,testers}.ts
```

### 수정 — 프론트·문서
```
frontend/lib/auth-context.tsx                frontend/lib/weekly-planner.ts
frontend/lib/pct-schedule-bridge.ts          backend/lib/codexCli.ts
app/(menu)/**/page.tsx  (색상 16파일)         frontend/components/schedule/assignee-detail-modal.tsx
AGENTS.md   backend/AGENTS.md   app/api/AGENTS.md   supabase/README.md
```

---

## 다음 착수 순서 (권장)

1. 🔴 **키 로테이션** (1번) — 다른 모든 작업보다 선행
2. 🔴 **`supabase db push`** 로 0028 적용 (4번)
3. 🔴 `LETSUR_*` / `MISO_*` 키 설정 (15번)
4. 🟡 주간 스케줄 화면 3개 중 현업 사용 화면 확인 → 통합/폐기 결정 (5·9번)
5. 🟡 공수 단위 DAY/Hour 정본 결정 (16번)
6. 🟡 배정 결과 서버 이관 — localStorage → `ai_weekly_schedules` (6번)
7. 🟡 운영 배포 시 Codex CLI → API 기반 전환 (7번) — 개발 단계에서는 현행 유지
