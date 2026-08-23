# 광동제약 QC 관리 시스템 — 현재 시스템 PRD (As-Built)

> 현재 구현된 시스템 전체를 문서화한 기준선(as-built) PRD.
> 프로세스 정의(요구사항 원본): `.claude/commands/qc-schedule-process.md` · 구현 현황: `docs/qc-schedule-status.md` · 상세 흐름: `docs/WORKFLOW-current-system.md`
> 최종 갱신: 2026-06-22

**상태 범례**: ✅ 구현·운영 / 🟡 부분 구현 / 🧩 플레이스홀더(화면만) / ⬜ 계획

---

## 1. Context — 왜 이 문서인가

광동제약 QC(품질관리) 부서의 시험 업무를 디지털화한 사내 웹 시스템이다. 핵심 가치는 **제조팀 생산계획(Google Sheet)을 단일 소스로, QC 시험 스케줄을 자동 생성하고 AI가 시험자 배정을 추천하면 관리자가 확정·LOCK 하는 end-to-end 워크플로우**다. 기존에 수기/엑셀로 관리하던 배정·공수·휴가·장비를 한 시스템에서 다루며, 향후 안정성시험·일탈관리·문서관리로 확장할 토대를 갖춘다.

이 PRD는 신규 기능 개발 전 합의된 기준선(as-built spec)으로, "지금 무엇이 동작하고 / 무엇이 비어 있는지"를 한눈에 보여 의사결정과 온보딩을 돕는다. 단계별 동작 흐름은 동반 문서 `docs/WORKFLOW-current-system.md`를 참고한다.

원천 요구사항: `QC 시험 스케줄 자동배정 시스템 요구사항 정의서.pdf`(2026-06-14 확정) → `.claude/commands/qc-schedule-process.md`.

---

## 2. 사용자 & 권한

현재 역할은 **2종**이다(`type UserRole = 'admin' | 'tester'`, `frontend/lib/auth-context.tsx`). 구 `'user'` 역할은 마이그레이션 `0023_role_tester.sql`로 `'tester'`에 통합됐다.

| 역할 | 식별 | 권한 요약 |
|------|------|-----------|
| **관리자(admin)** | `user.role === 'admin'` | 전 메뉴. 공수 수정, 배정 수정/재배정/일괄배정, 확정·LOCK 설정/해제, 동시분석 그룹·품목군 마스터 관리, 재배정·AI 스케줄 이력·운영평가·관리자 대시보드 조회, 사용자 관리, 휴가 확인 처리, 공휴일/공휴일 API 수집 |
| **시험자(tester)** | 그 외 로그인 사용자 | 본인 휴가 등록, 장비 예약, 내 작업(시험 수행/항목 진행/결과), 마스터 조회. 공수/배정/LOCK/그룹잠금 변경 불가 |

- **계정 ↔ 시험자 연결**: `users.tester_id`가 `testers`와 **1:1**로 연결(부분 유니크 인덱스 `ux_users_tester_id`). 로그인 ID(`username`)는 **사번(employee_no, 숫자)**으로 통일됐다(`0021_tester_user_link.sql`). `role='tester'` 저장 시 앱 레이어가 `testers` 레코드를 자동 생성·연결한다.
- **내부 고객번호(customerNo)**: `users.customer_no` 정수 시리얼(1000부터, 유니크). UI는 5자리 zero-pad(`#01000`)로 헤더/사이드바 풋터에 표기(`0022_user_customer_no.sql`, `app-sidebar.tsx`).
- **메뉴 게이팅**: 사이드바 `adminOnly` 항목은 admin에게만 노출(`frontend/components/dashboard/app-sidebar.tsx`, shadcn `AppSidebar` 아이콘 접기). API는 `requireAuth`/`requireAdmin` 가드(`backend/lib/guard.ts`)로 이중 방어. (구 `frontend/components/dashboard/sidebar.tsx`는 미사용 레거시)

---

## 3. 시스템 아키텍처 (비기능 기준)

- **스택**: Next.js 16 App Router, React 19, Tailwind v4, TypeScript(strict), shadcn/ui. DB: Supabase(Postgres). dev 포트 **3300**(`next dev --turbopack`).
- **3-레이어 (불변 규칙)**: `페이지/컴포넌트(frontend)` → `app/api/**/route.ts`(thin) → `backend/services/*.ts`(로직+Supabase) → Supabase. 클라이언트에서 `@backend/*` import 금지(서버 전용).
- **네이밍**: DB snake_case ↔ 앱 camelCase, 서비스의 `mapRow`가 단일 매핑 지점. 경로 별칭 `@/* @frontend/* @backend/* @shared/*`, 깊은 상대경로 금지.
- **인증**: 커스텀 JWT(jose HS256, bcrypt 검증). `kd_access`(15분) + refresh(7일) httpOnly 쿠키 + 자동 로그인 마커 `kd_auto_login`. 페이지는 Edge 미들웨어가 검증, API는 `requireAuth`. 클라이언트 `AuthProvider`가 부팅 시 자동 로그인 및 주기 갱신 수행(§5.2).
- **언어**: 한국어가 제품 언어(UI/주석/에러), 코드 식별자는 영어.
- **디자인 표준**: `DESIGN_GUIDE.md` / `.claude/commands/design-standard.md` — 블루 액센트, slate 팔레트, rounded-lg/xl, 상태색 3종(50/700/200), 반응형(p-3 md:p-5). 내비게이션은 shadcn `AppSidebar`(inset·아이콘 접기, `SidebarProvider/Inset/Trigger`).

---

## 4. 운영 원칙 (불변 4원칙)

1. **AI는 추천, 관리자가 확정** — `AI 자동배정 → 관리자 검토 → 확정 → LOCK`. AI에 최종 결정권 없음.
2. **시험 시작 후 일정 변경 금지** — 진행중/완료 오더는 생산계획이 바뀌어도 재계산·재배정 금지, **알림만**.
3. **LOCK 상태 존중** — 확정·LOCK 오더는 자동 재배정/시트 자동반영 차단, 알림만.
4. **공수는 DAY 단위** — 품목마스터 `product_workload.avg_workdays`(일)가 절대값. 동시분석/LOT 수량과 무관.

---

## 5. 핵심 워크플로우 (End-to-End) ✅

### 5.1 생산계획 → 배정 → 시험 수행

```
제조팀 Google Sheet
  │ ① 크론(9시/14시) 또는 수동 — pctIngest.ts
  ▼ 신규/수정/삭제 diff 감지 · 미등록 품목 자동등록(product_synced=false) · D-7 마감 알림
pct_orders (DB 영속)  ── pct_ingest_log / pct_order_edits(field·before·after)
  │ ② 동시분석 그룹 자동 재생성(잠금 그룹 보존) — concurrentGroups.ts
  ▼
AI 스케줄(오더 배정) 화면(관리자)  /schedule/orders
  │ ③ AI 자동배정 — pctAssign.ts (Codex CLI 우선 → scheduleEngine 규칙엔진 폴백)
  │    휴가 시험자 제외 · 역량/부하/난이도/특수규칙 · 동시분석 묶음 · dense 패킹 일정
  │    (+ 미확정 건 일괄 담당자 배정)
  ▼ ④ 관리자 검토·수정(사유 필수 → pct_order_edits/reassignment_history) → 확정·LOCK
qc_jobs + qc_job_items 생성 (QC번호 채번 qcNumber.ts)
  ▼ ⑤ 시작 전 장비 검교정·가용성 검증(getStartReadiness)
내 작업 화면(시험자)  /my-tasks
  │ ⑥ 항목별 시작/완료 기록(elapsed) · 상태 진행중→검토중→완료
  ▼
대시보드 · 인사이트(운영평가) · 알림 · AI 스케줄 이력(통합 타임라인)
```

### 5.2 인증 & 세션 영속성 ✅

- **로그인**: bcrypt 검증 → `kd_access`(15분)·refresh(7일) httpOnly 쿠키 발급 + 자동 로그인 마커 `kd_auto_login` 설정.
- **부팅 자동 로그인**: `AuthProvider`가 `/api/auth/me`(access) 시도 → 실패 시 `/api/auth/refresh`로 재발급 후 재시도(`auth-context.tsx`).
- **자동 갱신**: 로그인 상태에서 **13분 주기** 자동 refresh(access TTL 15분 대비 여유). 절전/탭 비활성으로 타이머가 멈췄다 복귀하면(`focus`/`visibilitychange`) 즉시 refresh.
- **로그아웃**: `/api/auth/logout` 호출 후 `kd_auto_login` 쿠키 제거 → `/login` 이동.
- **페이지 가드**: `middleware.ts`가 `kd_access`를 검증, 미인증 페이지 요청은 `/login?next=…`로 리다이렉트. API는 각 라우트의 `requireAuth`/`requireAdmin`이 401/403 처리.

---

## 6. 기능 요구사항 (메뉴별)

> 사이드바 출처: `frontend/components/dashboard/app-sidebar.tsx`. 각 하위 항목의 녹색 점(`live:true`)이 "개발 완료" 표시, `adminOnly`는 admin 전용, `hidden`은 메뉴 비노출.

### 6.1 인증 & 계정 ✅
- 로그인/로그아웃/비밀번호 변경/세션 갱신 — `app/api/auth/*`, `backend/lib/auth*.ts`.
- **사용자 관리**(admin) ✅ — 계정 CRUD, 역할(admin/tester), tester 연결, 고객번호. `/settings/users`, `users.ts`.
- 권한 관리 🧩 `/settings/roles`(admin), 시스템 설정 🧩 `/settings/sys-settings`(비밀번호 변경 진입점).

### 6.2 홈 ✅
- 진입 대시보드/요약 — `/home`, `app/api/dashboard`.

### 6.3 스케줄 (핵심 도메인)
| 화면(사이드바 라벨) | 경로 | 권한 | 상태 | 내용 |
|------|------|------|------|------|
| 월간 스케줄 | `/schedule/monthly` | 전체 | ✅ | 월간 그리드·주간·개인별 탭, 제조번호/개별항목 표기 |
| **AI 스케줄**(오더 배정) | `/schedule/orders` | admin | ✅ | pct_orders 목록(상태/검색/필터), AI 자동배정, 수동·**일괄 담당자 배정(미확정 건)**, 확정·LOCK 토글, 재배정 이력 + **적재 이력 모달**(생산계획 가져오기 diff 상세) |
| 휴가 캘린더 | `/schedule/vacation` | 전체 | ✅ | Monday 스타일 연속 막대·빠른 등록·상세 드로어 + 기간 가용성 "가능 품목 제안", 공휴일 음영 표시 |
| 공휴일 캘린더 | `/schedule/holidays` | admin | ✅ | 공휴일 관리(수동) + **공공데이터 API 수집**(§9), 배정 엔진이 비근무일로 건너뜀 |
| 재배정 이력 | `/schedule/reassignments` | admin | ✅ | **AI 스케줄 이력 통합 타임라인**(수정·재배정·자동적재 3소스) + 날짜범위 필터, 시험자별/품목별 통계 |
| 관리자 대시보드 | `/schedule/dashboard` | admin | ✅ | 전체/진행중/완료/지연/미배정/향정신성/신규품목/재배정 + 보유 DAY·난이도 분포 |
| (비노출) 동시분석 그룹 | `/schedule/groups` | admin | 🟡 | OR 5조건 union-find 그룹·그룹 잠금/보존/재생성 API는 운영. 현재 사이드바 메뉴 비노출(오더/품목군 마스터 경유) |
| ~~(비노출) 주간/주간계획~~ | ~~`/schedule/weekly`,`/weekly-plan`~~ | — | ✅ | **2026-08-22 폐기** — 주간 배정은 `/schedule/orders` 로 통합 |

### 6.4 내 작업(시험자) ✅
- 본인 배정 qc_jobs 조회 — 대기/진행중/종료 3단. 시작 전 장비 준비상태 표시(`getStartReadiness`).
- 항목별 시작/완료(`cleared_at`, `elapsed_minutes`), 상태 진행중→검토전→검토중→승인전→승인완료. `qcJobs.ts`, `/api/qc-jobs/*`.
- **상태 변경 이력**(2026-08-23) — 모든 전이를 `qc_job_status_history` 에 적재(변경자·사유·자동/수동 구분).
  조회 `GET /api/qc-jobs/[id]/history`(관리자 전체·담당자 본인), 관리자 직접 변경 `PATCH /api/qc-jobs/[id]/status`(사유 필수).
  마이그레이션 `supabase/migrations/0035_qc_job_status_history.sql`.

### 6.5 시험관리 & 기준 설정 (마스터)
사이드바상 **"시험관리"**(작업/시험 현황·결과·성적서·시험자)와 **"기준 설정"**(마스터) 2개 그룹으로 분리돼 있다.

| 화면(라벨) | 경로 | 그룹 | 상태 | 내용 |
|------|------|------|------|------|
| 작업 현황 | `/product-test/prod-status` | 시험관리 | ✅ | 작업자별 진행 현황 + **완료 작업 보기**(작업 있는 인원/전체/완료 작업 · 오늘~전체 기간, 작업자당 최근 50건). 카드 클릭 → 작업 상세(시험항목·단계·상태 이력) |
| 시험현황 | `/test-mgmt/test-status` | 시험관리 | ✅ | 시험 상태 현황(`tests.ts`). 행 클릭 → **미리보기 패널**(요약·시험항목·상태 변경·상태 이력), 관리자는 단계 전이·상태 직접 변경(사유 필수) |
| 시험자 관리 | `/test-mgmt/testers` | 시험관리 | ✅ | 시험자 CRUD, can_solo/can_duo, 역량 매트릭스(Y/N/X/O) |
| 결과입력 | `/test-mgmt/test-result` | 시험관리 | 🧩 | 화면만 |
| 성적서관리 | `/test-mgmt/test-cert` | 시험관리 | 🧩 | 화면만 |
| 품목 마스터 | `/product-test/products` | 기준 설정 | ✅ | 품목 CRUD + 공수(avg_workdays) 편집(`upsertWorkload`) |
| 시험항목 마스터 | `/test-mgmt/test-master` | 기준 설정 | ✅ | test_items 마스터 |
| 품목별 시험항목 관리 | `/test-mgmt/test-items` | 기준 설정 | ✅ | product_test_items 매핑·정렬(reorder) |
| 시험 전 확인사항 | `/test-mgmt/pretest-checklist` | 기준 설정 | ✅ | 품목별 사전 확인 노트(`productPretestNotes`) |
| 동시분석 품목 | `/settings/concurrent-items` | 기준 설정 | ✅(admin) | 동시에 시험할 품목군 직접 묶기(품목코드 기준, 1코드=1군). 자동 그룹핑이 "마스터 우선 + 유사명/AI 보완"으로 사용. `seedFromProducts` 초기 시드 |

> **삭제됨**: 구 `/schedule/pct`(AI 스케줄 보드)·`/test-mgmt/test-reg`(시험등록) 페이지는 제거됐다(이전 PRD의 ✅ 항목 정정).

### 6.6 장비관리
| 화면 | 경로 | 상태 | 내용 |
|------|------|------|------|
| 장비 마스터 | `/equipment/master` | ✅ | 장비 CRUD, 검교정일/차기검교정/status, 시작검증 연동 |
| 장비 예약 | `/equipment/reservation` | ✅ | 선착순·대기열(wait_order)·대기 알림·WAITING 24h 자동취소 크론 |
| 가동/백업/사용현황·예측정비 AI | `/equipment/equip-*` | 🧩 | 화면만 |

### 6.7 인사이트
- **시험자 운영평가**(admin) ✅ — 공수 준수율·처리량·가동률. `/insights/stats`, `testerEvaluation.ts`, `/api/insights/tester-evaluation`.
- 대시보드 🧩 `/insights/dash`, 리포트 🧩 `/insights/ins-report`. (Tableau 요약 API `tableau.ts` 보조)

### 6.8 AI 챗봇 ✅
- OpenAI gpt-4o-mini 기반 사내 비서. 권한 스코프·날짜 의도·PCT/시험 전 확인사항 컨텍스트 주입. `chat.ts`, `chatHistory.ts`, `/api/chat*`, `dashboard/chatbot`.

### 6.9 알림 ✅
- DB 적재 + 헤더 벨 60s 폴링. 향정신성/차단/마감/클리어/상태변경/장비대기 등 10+ 이벤트. `notifications.ts`, `dashboard/notification-bell`.

### 6.10 플레이스홀더 / 계획 메뉴
- **안정성시험** 🧩 (현황/계획/보고) — 구글시트 안정성 연동 API(`google-sheet/stability`)는 존재.
- **일탈관리** 🧩 (OOS/CAPA/조사보고서, 사이드바 배지 3).
- **문서관리** ⬜ (성적서/기준서/SOP/체크리스트) — 사이드바 `hidden`으로 임시 숨김.

---

## 7. 비즈니스 규칙 — 배정 엔진 (`scheduleEngine.ts` / `pctAssign.ts` / `assignRules.ts`)

- **자격 매칭**: 품목 → product_test_items(시험항목) → test_item_equipment(필요장비) → tester_capability_matrix(Y/O 보유) → solo/duo 조 구성. 1000행 캡 대응 `selectAll`(`supabasePage.ts`).
- **일정**: 시작일=포장일+1근무일, 기간=avg_workdays 연속 근무일. **완료예정일 기준 역순 ALAP → 시험자별 dense 패킹**(빈틈/겹침 제거), 주말+공휴일 스킵, 초과 시 `deadlineRisk`.
- **부하 분산**: 누적 근무일(load) 최소 우선, 동률 시 배정건수(count) 적은 사람.
- **난이도**: 최근 2주 HIGH 난이도 부담 → `difficultyPenalty`를 `initialLoad`로 주입(차주 MEDIUM/LOW 우선).
- **긴급**: 공수 ≤3DAY 품목만 허용(`emergencyAllowed`).
- **향정신성**(자이렌정·아디펙스정): 강지윤·김정호 배정 제외 + 관리자 알림.
- **개별 중금속**: 금요일 주차 순환(박성호→이영남→정예찬), 공수 1DAY 고정(`isoWeekIndex`).
- **동시분석 그룹**: 동일/유사 품목을 한 시험자에게 묶어 1회 공수로 배정(대표 오더만 엔진 투입, 멤버 전파). 시작일 = MAX(포장완료일)+1일. 그룹핑은 **동시분석 품목군 마스터(`concurrent_product_families`) 우선 + 유사명/AI 규칙 보완**.
- **개별항목 분산**: 키워드 품목(`INDIVIDUAL_ITEM_PRODUCT_KEYWORDS`)은 시험항목 단위로 여러 시험자에 분산.
- **휴가 제외 + 가능 품목 제안**: 휴가/출장 기간 시험자는 배정 후보 제외. `leaveSuggestions.ts`가 남은 인원 역량으로 대기 오더를 가능/휴가로불가(복귀시가능)/자격자없음 으로 분류해 휴가 캘린더에서 제안.
- **엔진 선택**: `ENABLE_CODEX_ASSIGN`이면 Codex CLI(`codexCli.ts`) 우선, 실패/미설정 시 순수 규칙엔진(`scheduleEngine.ts`) 폴백. 양쪽 모두 `withForcedRules`로 특수규칙 강제.

---

## 8. 데이터 모델 (핵심 테이블)

- **품목/시험**: `products`(난이도 difficulty, 레거시 avg_hours), `product_categories/classifications`, `test_items`, `product_test_items`, `test_item_equipment`, `product_pretest_notes`.
- **공수**: `product_workload.avg_workdays`(단일 소스, product_code 자연키).
- **시험자/역량**: `testers`(employee_no, can_solo/can_duo), `test_capabilities`, `tester_capability_matrix`(Y/N/X/O).
- **사용자/인증**: `users`(role admin|tester, tester_id 1:1, customer_no 시리얼), `auth_refresh_tokens`.
- **PCT 워크플로우**: `pct_orders`(+locked/locked_by/at), `pct_ingest_log`, `pct_order_edits`(field/old_value/new_value/reason), `qc_jobs`, `qc_job_items`, `notifications`, `app_settings`.
- **스케줄 부가**: `operator_schedule`(휴가), `equipment_reservation`(예약), `reassignment_history`(재배정), 동시분석 그룹, `concurrent_product_families`/`concurrent_product_family_members`(동시분석 품목군 마스터, product_code unique), `holidays`/`public_holidays`(source api|manual), `equipment_master`.
- **마이그레이션**: **0001~0024**. ⚠️ 라이브 DB가 일부 마이그레이션과 불일치 — 특히 **0021~0024는 수동 적용 대상**(Supabase 대시보드 SQL Editor, idempotent). 0011/0014~0018·0020도 수동 적용 필요분 존재(graceful 폴백 내장).

---

## 9. 외부 연동 & 자동화 ✅
- **Google Sheet**: PCT 오더 적재 + 안정성/마스터 시트. `backend/lib/googleSheet.ts`.
- **공휴일 공공데이터 API**: data.go.kr 특일정보(`SpcdeInfoService getRestDeInfo`, 한국천문연구원). `backend/lib/holiday.ts`(`getRestHolidays`/`getRestHolidaysForYear`, 월 단위 12회 순회) → `/api/holidays/import`로 연 단위 수집 → `public_holidays`에 저장(`source='api'`, 수동 `manual` 행은 보존). 키 `HOLIDAY_API_KEY`(.env.local).
- **Cron**: PCT 시트 적재(9시/14시), 장비 예약 WAITING 24h 자동취소(매시). `instrumentation.ts`, 수동 트리거 `POST /api/cron/ingest-pct`(admin).
- **OpenAI** gpt-4o-mini(챗봇) / **Codex CLI**(선택적 배정, `ENABLE_CODEX_ASSIGN`).

---

## 10. 비기능 요구사항
- **보안**: JWT httpOnly 쿠키, requireAuth/requireAdmin, service-role는 서버 전용. RLS 테이블은 service-role로 읽기.
- **성능/안정성**: PostgREST 1000행 캡 → `selectAll` 페이지네이션, 신규 테이블 부재(42P01) graceful 폴백.
- **검증 규칙**: `npm run typecheck`(필수)·`npm run lint`·운영 영향 시 `npm run build`. dev 포트 3300.

---

## 11. 구현 현황 요약 & 알려진 부채 (부록)

**✅ 운영 중**: 인증/계정(역할 admin·tester, 고객번호, 세션 영속성)·홈·스케줄(월간/AI스케줄/휴가/공휴일/재배정·AI스케줄이력/관리자대시보드)·내 작업·마스터(품목/시험항목/시험자/공수/사전확인/동시분석 품목)·장비(마스터/예약)·운영평가·챗봇·알림·구글시트/크론·공휴일 API.
**🧩 플레이스홀더**: 안정성시험, 일탈관리, 문서관리(숨김), 결과입력/성적서, 인사이트 대시보드/리포트, 장비 가동/백업/사용/예측, 권한관리/시스템설정.
**알려진 부채/계획**: ① 상태값 한글→영문 enum 상태머신 전환(데이터 마이그레이션 동반) ② Phase 2 그룹 라우팅(A/B/C group_code + product_group_rules + 자격=역량 AND 그룹) ③ 레거시 정리(products.avg_hours, 구 product_manhours, 미사용 `sidebar.tsx`, 비노출 `/schedule/groups`·`/schedule/weekly*`) ④ 미적용 마이그레이션 정리(0021~0024 등 수동 적용) ⑤ 보안 정리(.env.local 추적 해제, git PAT/HOLIDAY_API_KEY 노출 점검 — 기능 완료 후).

---

## 12. 검증 (문서 정확성 & 시스템 동작 확인)
- **문서 교차검증**: 사이드바 `live`/`adminOnly`/`hidden` 플래그 ↔ 본 PRD 상태표, `docs/qc-schedule-status.md`, `docs/WORKFLOW-current-system.md`, `.claude/commands/qc-schedule-process.md` 와 대조.
- **시스템 구동**: `npm run dev`(포트 3300) → 로그인 → 각 ✅ 화면 진입 확인. AI 배정은 `/schedule/orders`에서 자동배정 실행.
- **타입/린트**: `npm run typecheck`, `npm run lint` 무에러 유지.
