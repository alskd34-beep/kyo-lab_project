# 광동제약 QC 관리 시스템 — 워크플로우 (As-Built)

> 현재 구현된 시스템의 **단계별 동작 흐름**을 정리한 문서. 기능 정의·상태표는 `docs/PRD-current-system.md`,
> 요구사항 원본은 `.claude/commands/qc-schedule-process.md`, 구현 현황 체크리스트는 `docs/qc-schedule-status.md`.
> 최종 갱신: 2026-06-22

이 문서는 "누가 / 어떤 화면에서 / 어떤 API·서비스를 거쳐 / DB의 무엇이 바뀌는가"를 흐름 단위로 설명한다. 각 흐름은 실제 코드(`backend/services/*`, `app/api/**`)를 기준으로 한다.

---

## 0. 등장 요소 (Actors & Systems)

| 구분 | 주체 | 역할 |
|------|------|------|
| 사람 | **관리자(admin)** | 배정 검토·수정·확정·LOCK, 마스터/공수/그룹/공휴일 관리, 이력·대시보드 조회 |
| 사람 | **시험자(tester)** | 휴가 등록, 장비 예약, 내 작업 수행(시험 시작/완료) |
| 시스템 | **제조팀 Google Sheet** | 생산계획(PCT) 단일 소스 |
| 시스템 | **Cron / instrumentation** | 시트 적재(9시/14시), 장비 WAITING 24h 자동취소(매시) |
| 시스템 | **배정 엔진** | Codex CLI(선택) → 규칙엔진(`scheduleEngine.ts`) 폴백 |
| 시스템 | **공휴일 API** | data.go.kr 특일정보(한국천문연구원) |

전체 데이터 흐름은 `Google Sheet → pct_orders → (그룹) → 배정 → qc_jobs/qc_job_items → 시험 수행 → 대시보드/이력`.

---

## 1. 인증 · 세션 수명주기

```
[로그인 화면] /login
  │ username(사번) + password
  ▼ POST /api/auth/login  → bcrypt 검증 (users.ts)
  │ 발급: kd_access(15분) · refresh(7일) httpOnly 쿠키 + kd_auto_login 마커
  ▼ AuthProvider.setUser → /home
  │
  ├─ 부팅(앱 진입)   : GET /api/auth/me 실패 → POST /api/auth/refresh → 재시도 (자동 로그인)
  │                    일시적 실패(네트워크·5xx·재시작 직후 컴파일 지연)는 1회 재시도
  ├─ 13분 주기       : POST /api/auth/refresh (access 만료 전 선제 갱신)
  │                    성공 시 kd_auto_login 마커도 7일로 재연장 (쿠키 수명 어긋남 방지)
  ├─ 포커스/탭복귀   : visibilitychange/focus → 즉시 refresh (절전 복귀 대응)
  └─ 페이지 요청     : middleware.ts 가 kd_access 검증, 미인증 → /login?next=…
  ▼
[로그아웃] POST /api/auth/logout → kd_auto_login 제거 → /login
```

- 근거: `frontend/lib/auth-context.tsx`, `middleware.ts`, `app/api/auth/*`, `backend/lib/auth.ts`·`auth-cookies.ts`·`guard.ts`.
- **권한 분기**: `user.role === 'admin'`이면 전 메뉴. 시험자는 `adminOnly` 메뉴 비노출 + API `requireAdmin`에서 403.
- **계정 ↔ 시험자**: `users.tester_id` 1:1. 내 작업/휴가/예약은 이 연결로 "본인" 데이터를 식별.

---

## 2. 생산계획 적재 (Ingest)

**트리거**: 크론 9시/14시(`instrumentation.ts`) 또는 관리자 수동 `POST /api/cron/ingest-pct`.
**서비스**: `backend/services/pctIngest.ts` → `ingestPctSheet()`.

```
Google Sheet 행 읽기 (googleSheet.ts)
  ▼ 키(품목코드+제조번호 등)로 기존 pct_orders 와 diff
  ├─ 신규(new)     → pct_orders insert (+ 미등록 품목은 products 자동등록, product_synced=false)
  ├─ 변경(updated) → 단, 대상 오더가 LOCK/IN_PROGRESS/검토중/완료/지연이면 ▶ 차단(blocked)
  │                   변경 전/후를 pct_order_edits(field/old_value/new_value)에 기록 + 관리자 경고 알림
  ├─ 삭제(deleted) → 시트에서 사라진 행 표시/정리
  ▼ 각 변경은 pct_ingest_log 에 적재(runAt, changeType, productCode, batchNo, status, fileId)
  ▼ rebuildGroups() 자동 호출 (잠긴 동시분석 그룹 보존)
  ▼ D-7 마감 임박 알림 + 적재 요약 알림(신규/변경/삭제/차단/그룹 수)
```

- **불변 원칙 2·3 구현 지점**: LOCK/IN_PROGRESS 계열 상태는 시트가 바뀌어도 자동 반영하지 않고 **알림만**. 차단 카운트(`IngestResult.blocked`)로 집계.
- 적재 이력은 **AI 스케줄 화면의 "적재 이력 모달"**과 **AI 스케줄 이력 타임라인**(§7)에서 조회.

---

## 3. 동시분석 그룹 생성

**서비스**: `backend/services/concurrentGroups.ts`(union-find) + `concurrentProductFamilies.ts`(품목군 마스터/AI 보완).
**트리거**: 적재 말미 자동 `rebuildGroups()`, 또는 `/schedule/groups`·`/settings/concurrent-items`에서 관리자 수동.

```
대기 오더 집합
  ▼ 그룹 판정 기준 (OR — 하나라도 충족 시 동일 그룹)
  │   ① 품목코드 동일 AND 완료요청일 동일   ② 품목명 동일
  │   ③ 품목코드 다름 + 품목명 동일          ④ 품목코드 동일 + 품목명 다름
  │   ⑤ 품목명 포함관계(베니톨정/베니톨에스정/베니톨플러스정)
  │   + 동시분석 품목군 마스터(concurrent_product_families) 우선 매칭, 유사명/AI 보완
  ▼ union-find 로 그룹 구성, 시작일 = MAX(포장완료일) + 1일
  ├─ GROUP_LOCK=TRUE 그룹은 보존(재생성 대상 제외)
  └─ 그룹 일부 취소 시 기존 그룹 유지·재생성 금지 + 관리자 알림
```

- 배정 시 **대표 오더만 엔진에 투입**하고 결과를 그룹 멤버 전 오더에 전파(1회 공수로 묶음 배정).

---

## 4. AI 자동배정 → 검토 → 확정 → LOCK

**화면**: `/schedule/orders`("AI 스케줄", admin). **서비스**: `pctAssign.ts` → (`codexCli.ts` | `scheduleEngine.ts`) + `assignRules.ts`.

```
① [AI 자동배정] 클릭  → POST /api/pct-orders/assign
   ▼ 후보 시험자 = 활성 testers − (휴가/출장 기간자: operator_schedule)
   ▼ 엔진 선택: ENABLE_CODEX_ASSIGN ? Codex CLI → 실패 시 scheduleEngine 폴백
   ▼ 자격매칭(역량매트릭스 Y/O · solo/duo) → 일정(포장일+1, avg_workdays 연속근무일,
     주말+공휴일 스킵, 완료예정일 역순 ALAP → dense 패킹) → 부하분산(load·count)
   ▼ 특수규칙 강제(withForcedRules): 난이도penalty / 긴급≤3DAY / 향정신성 제외 / 중금속 금요일 순환
   ▼ 동시분석 그룹 묶음 · 개별항목 분산
   ▼ 결과: 각 오더에 추천 시험자/기간/항목 + 미배정 사유 + deadlineRisk

② [관리자 검토·수정]
   ├─ 개별 수동 배정/변경 → assignManually (사유 필수)
   │    → reassignment_history(before_user/after_user/reason/changed_by) 자동 로깅
   │    → 필드 변경은 pct_order_edits 기록
   └─ 미확정 건 일괄 담당자 배정(미확정 상태 오더만 대상)

③ [확정] → 상태 전이(검토 → 확정)

④ [LOCK 토글] → POST /api/pct-orders/[id]/lock (locked/locked_by/locked_at)
   ▼ 이후 적재 diff 자동반영 차단(§2), 알림만

⑤ 확정 시 qc_jobs + qc_job_items 생성, QC번호 채번(qcNumber.ts: YYYYMMDDHHMM + 2자리)
```

- **불변 원칙 1**: AI는 추천만, 상태 전이(확정·LOCK)는 관리자 행위로만 발생.
- 휴가 기간 미배정 잔여 오더는 `leaveSuggestions.ts`가 "가능/휴가로불가(복귀시가능)/자격자없음"으로 분류해 **휴가 캘린더에서 제안**.

---

## 5. 시험 수행 (내 작업)

**화면**: `/my-tasks`(시험자). **서비스**: `qcJobs.ts`, API `/api/qc-jobs/*`.

```
본인 배정 qc_jobs 조회 (대기 / 진행중 / 종료 3단)
  ▼ 시작 전 장비 준비상태 검증 — getStartReadiness
  │   (필요 장비의 검교정 유효성·가용성 확인 → 부적합 시 시작 차단/경고)
  ▼ [항목 시작] qc_job_items 진행중
  ▼ [항목 완료] cleared_at·elapsed_minutes 기록
  ▼ 모든 항목 완료 → 잡 상태: 진행중 → 검토중 → 완료
  ▼ 상태 변경 시 알림 적재
```

- 장비 가용성은 장비 예약(§6)·장비 마스터(검교정일/status)와 연동.

---

## 6. 부가 흐름

### 6.1 휴가 (operator_schedule)
```
[휴가 캘린더] /schedule/vacation
  ▼ 시험자: 본인 휴가 등록(ANNUAL|HALF_DAY|BUSINESS_TRIP), start/end
  ▼ 관리자: manager_checked 확인 처리
  ▼ AI 자동배정이 해당 기간 시험자를 후보에서 제외(§4)
  ▼ 기간 가용성 "가능 품목 제안"(leaveSuggestions) 표시, 공휴일 음영
```

### 6.2 장비 예약 (equipment_reservation)
```
[장비 예약] /equipment/reservation
  ▼ 선착순 예약(RESERVED). 이미 예약 존재 → 대기 등록(WAITING, wait_order) + 대기 알림
  ▼ WAITING 24h 초과 → 매시 크론이 자동취소(CANCELLED)
  ▼ 예약/검교정 상태가 내 작업 시작검증(getStartReadiness)에 반영
```

### 6.3 공휴일 동기화 (public_holidays)
```
[공휴일 캘린더] /schedule/holidays (admin)
  ├─ 수동 추가/삭제 → public_holidays(source='manual')
  └─ [공공데이터 수집] → /api/holidays/import
       ▼ holiday.ts getRestHolidaysForYear(연도) — data.go.kr 특일정보 1~12월 순회
       ▼ public_holidays upsert(source='api') — 기존 'manual' 행은 보존(덮어쓰기 금지)
  ▼ 배정 엔진·월간/휴가 캘린더가 공휴일을 비근무일로 처리
```
- 키: `HOLIDAY_API_KEY`(.env.local, Decoding 키). 인증 실패 시 XML 에러를 감지해 명시적 throw.

### 6.4 알림 (notifications)
- 적재 + 헤더 벨 60s 폴링. 주요 이벤트: 적재 요약/변경 차단 경고, D-7 마감 임박, 향정신성 배정, 장비 대기, 상태 변경, 배정/재배정, 항목 클리어 등. 근거 `notifications.ts`.

### 6.5 AI 챗봇
- `/api/chat` SSE 스트리밍(OpenAI gpt-4o-mini, `chat.ts`). 권한 스코프·날짜 의도·PCT 오더·시험 전 확인사항을 컨텍스트로 주입, 이력은 `chatHistory.ts`.

---

## 7. 감사·이력 (AI 스케줄 이력 통합 타임라인)

**화면**: `/schedule/reassignments`(admin). **서비스**: `aiScheduleHistory.ts` → `listAiScheduleHistory(limit, {from,to})`.

3개 소스를 하나의 시간순 타임라인으로 병합하고 **날짜범위(from/to) 필터**를 제공한다.

| type | 소스 테이블 | 표기 |
|------|------------|------|
| `edit` | `pct_order_edits` | "〈필드〉 수정" + 전→후(담당자는 시험자명, 긴급은 긴급/일반으로 표시) |
| `reassign` | `reassignment_history` | "담당자 배정 변경" + before→after(미배정 포함) |
| `ingest` | `pct_ingest_log` | "자동 적재 신규/변경/삭제/차단" + 제조번호·품목코드·상태 |

- 통계: `total / edits / reassignments / ingests`. 행에는 품목명·품목코드·제조번호·사유·작업자(또는 "시스템")가 함께 표기.
- 같은 화면에서 기존 **재배정 이력 통계**(시험자별/품목별)도 제공.

---

## 8. 상태값 참조 (현행)

> ⚠️ 요구사항의 영문 상태 enum(`AUTO_ASSIGNED → … → COMPLETED` + `DELAY/CANCEL`)은 **아직 미전환**. 현재 운영 상태값은 한글이다(`docs/qc-schedule-status.md` 참조). 차단 로직(`LOCKED_STATUSES`)은 한/영 양쪽을 미리 포함한다.

| 단계 | 현행(한글) | 목표(영문 enum) |
|------|-----------|----------------|
| 자동배정 직후 | 자동배정 | AUTO_ASSIGNED |
| 관리자 검토 | 검토중 | MANAGER_REVIEW |
| 확정 | 확정 | CONFIRMED |
| 잠금 | 잠금(locked 플래그) | LOCKED |
| 시험 진행 | 진행중 | IN_PROGRESS |
| 검토 | 검토중 | REVIEW |
| 완료 | 완료 | COMPLETED |
| 기타 | 지연 / 취소 | DELAY / CANCEL |

생산계획 변경 처리: `자동배정/검토중/확정`은 재계산 가능, `진행중/LOCK`은 재계산 금지·알림만(§2·불변 원칙 2·3).

---

## 9. 검증

- `npm run dev`(포트 3300) → 로그인 → 적재(`/api/cron/ingest-pct`) → `/schedule/orders` AI 자동배정 → 확정·LOCK → `/my-tasks` 수행 → `/schedule/reassignments` 이력 확인.
- `npm run typecheck`(필수) · `npm run lint` · 운영 영향 시 `npm run build`.
