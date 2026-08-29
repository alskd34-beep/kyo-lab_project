# QC 시험 스케줄 자동배정 — 구현 현황

프로세스 정의: `.claude/commands/qc-schedule-process.md` (`/qc-schedule-process`)
현재 시스템 전체 PRD(as-built): [`docs/PRD-current-system.md`](./PRD-current-system.md)
최종 갱신: 2026-06-14

## ✅ 완료 (PCT 1차 구현)
- 구글시트 자동 적재(9시/14시 크론) + 신규/수정/삭제 diff 감지 — `backend/services/pctIngest.ts`, `instrumentation.ts`
- 품목마스터 동기화(`product_synced` 플래그) — `pctIngest.ts`
- AI 자동배정(역량·부하분산, Codex CLI 우선→규칙엔진 폴백) — `pctAssign.ts`, `scheduleEngine.ts`
- 감독관 배정/수정 화면 — `app/(menu)/schedule/orders/page.tsx`
- 담당자 실행 화면 — `app/(menu)/my-tasks/page.tsx`
- QC번호 채번(YYYYMMDDHHMM+2자리) — `backend/lib/qcNumber.ts`, `qcJobs.ts`
- 알림(DB 적재 + 헤더 벨 60s 폴링) — `notifications.ts`
- 수정 사유 이력 — `pct_order_edits`, `pctOrders.ts`
- 품목 난이도 컬럼(`products.difficulty`: Low/Medium/High) — `0004` 마이그레이션
- 긴급 플래그(`pct_orders.is_urgent`), 공수 컬럼(`products.avg_hours`)
- 휴가 관리(`operator_schedule`): 휴가 캘린더 화면 + 등록/확인/삭제 + **AI 자동배정 시 휴가 기간 시험자 제외** — `0012`, `operatorSchedule.ts`, `app/(menu)/schedule/vacation/page.tsx`, `pctAssign.ts`
- 장비 예약(`equipment_reservation`): 선착순/대기열(wait_order)/대기 알림 + **WAITING 24h 자동취소 크론(매시)** + 예약 캘린더 화면 — `0012`, `equipmentReservation.ts`, `app/(menu)/equipment/reservation/page.tsx`, `instrumentation.ts`
- 재배정 이력(`reassignment_history`): **수동 배정 변경 시 자동 로깅**(`assignManually`) + 관리자 조회 화면(시험자별/품목별 통계) — `0012`, `reassignmentHistory.ts`, `app/(menu)/schedule/reassignments/page.tsx`
- 동시분석 그룹(5개 OR 조건, union-find) + **시험 시작일 = MAX(포장완료일)+1일** + 그룹 잠금/일부취소 보존 + 재생성 — `0013`, `concurrentGroups.ts`, `app/(menu)/schedule/groups/page.tsx`
- 향정신성(자이렌정·아디펙스정): **강지윤·김정호 배정 제외 강제 + 관리자 알림** — `assignRules.ts`, `pctAssign.ts`(applyAssignments)
- 관리자 대시보드: 전체/진행중/완료/지연/미배정/향정신성/신규품목/재배정 건수 + 시험자별 보유 DAY + 난이도 분포 — `qcDashboard.ts`, `app/(menu)/schedule/dashboard/page.tsx`
- 배정 규칙 모듈(긴급 ≤3DAY / 중금속 금요일 순환 / 난이도 penalty 비교자) 순수함수 — `assignRules.ts`

## ✅ 추가 완료 (2026-06-14, 배정 엔진·차단·그룹 자동화)
- **배정 엔진 심층 통합** — `assignRules.ts` 순수함수를 `pctAssign`/`scheduleEngine`에 통합:
  - 난이도 기반 정렬: 진행 중 HIGH 난이도 보유 수를 `difficultyPenalty`로 산출 → 엔진 `initialLoad`(초기 부하)로 주입해 차주 MEDIUM/LOW 배정에서 후순위로 밀어냄.
  - 개별 중금속 시험(개별항목+'중금속' 항목): 주차 순환(`isoWeekIndex`)으로 박성호→이영남→정예찬 강제배정(`withForcedRules`, Codex/규칙 양쪽 적용).
  - 긴급 ≤3DAY 제한: 공수(`avg_workdays`)>3 품목은 긴급 가중에서 제외(`emergencyAllowed`).
- **LOCK/IN_PROGRESS 변경 차단** — `pctIngest`: 진행중/검토중/완료/지연(및 영문 LOCKED/IN_PROGRESS/REVIEW/COMPLETED) 상태 오더는 시트 변경 자동 미반영. 변경 전/후 값을 `pct_order_edits`(field/old_value/new_value)에 기록 + 감독관 경고 알림. `IngestResult.blocked` 카운트 추가.
- **동시분석 그룹 자동 재생성** — `ingestPctSheet` 말미에서 `rebuildGroups()` 자동 호출(잠긴 그룹 보존). 적재 요약 알림에 그룹 수 포함.

## ✅ 추가 완료 (2026-08-29, 2인 배정)
품목코드 1개·제조번호 1개인 오더 하나를 담당자 **2명**이 시험항목을 나눠 수행한다. — `0037_dual_assignment.sql`
- **데이터 모델**: `pct_orders.is_dual_assignment` + `assignee_tester_id_2`, `pct_order_test_items.assignee_slot`(1=담당자1 / 2=담당자2).
  항목의 담당자를 사람(tester_id)이 아니라 **슬롯 번호**로 저장한다 — 담당자를 교체해도 항목 배분이 깨지지 않고,
  "담당자1/2가 누구인가"의 단일 기준이 오더 행 하나로 유지된다. 슬롯 기본값이 1이라 기존 오더는 백필이 필요 없다.
- **작업 구조**: `qc_jobs.order_id` 의 unique 를 `(order_id, assignee_tester_id)` 부분 유니크 인덱스로 교체.
  **담당자별 QC작업 2건**(각자 자기 QC번호로 시작·클리어·완료)이며, `startJob` 은 자기 슬롯 몫만 체크리스트로 만든다.
- **오더 상태**: `syncOrderStatusFromJobs()` 가 그 오더의 **모든 작업 중 가장 뒤처진 단계**로 오더 상태를 정한다.
  아직 시작조차 안 한 담당자(작업 행이 없음)가 남아 있으면 '진행중'을 넘어서지 못하게 묶는다 —
  그러지 않으면 담당자1이 먼저 끝낸 순간 오더가 '검토전'이 되어 담당자2가 시작 목록에서 사라진다.
  작업이 1건인 오더(1인 배정)에서는 결과가 이전과 완전히 동일하다.
- **화면**: 오더 수정 드로어의 담당자 콤보박스 옆 「2인 배정」 체크박스 → 담당자2 선택 → 「시험항목」 섹션에서 항목별 2택 배분.
  2인 배정을 켠 상태로 **저장한 뒤**에만 항목을 나눌 수 있다(서버가 dual 을 알아야 슬롯 PATCH 가 통과).
  해제하면 slot=2 항목이 전부 담당자1로 되돌아간다.
- **잠금**: 이미 작업을 시작한 담당자는 **그 슬롯만** 변경이 막힌다(오더 전체를 잠그지 않는다).
- **[원칙2] 배분은 작업 시작 전에 확정한다.** 작업이 하나라도 시작되면 ① 항목별 슬롯 이동(`setAssigneeSlot`)과
  ② 2인 배정 on/off(`STARTED_IMMUTABLE_FIELDS`)를 모두 막는다.
  `qc_job_items` 는 `startJob` 시점의 배분으로 굳는 스냅샷이고 담당자별로 시작 시점이 다르기 때문에,
  시작 후 슬롯을 옮기면 **그 항목이 아무 체크리스트에도 없이 사라지거나(누락) 양쪽에 모두 남는다(중복)**.
  이미 클리어된 항목·소요시간까지 건드려야 해서 사후 재동기화는 안전하지 않다고 판단해 잠그는 쪽을 택했다.
- **AI 자동배정은 그대로 1명만 배정한다.** 2인 전환은 관리자 수동 조작 전용 — 배정 알고리즘은 바꾸지 않았다.
  다만 **이미 만들어진 2인 배정은 부하 계산에 보이게** 했다(`pctAssign.currentWorkload`, `qcDashboard`):
  담당자2 몫이 0으로 잡히면 자동배정이 그 사람을 "가장 한가한 사람"으로 보고 신규 오더를 몰아준다.
  공수(DAY)는 두 사람이 나눠 수행하므로 절반씩 나눠 더한다.
- **담당자2도 담당자1과 동일하게 다룬다**: 재배정 이력(`reassignment_history`), 휴가 겹침 알림
  (`warnIfAssigneeOnLeave`), 작업 화면·작업자 현황·AI 챗봇 조회 범위(`assignedToTesterFilter`).
- **수동 배정 API(`assignManually`)도 2인 배정을 안다** — 담당자1 해제 금지, 담당자2와 중복 배정 금지,
  이미 시작한 담당자 교체 금지. 이 경로는 `updateOrderWithReason` 의 검증을 거치지 않으므로 별도로 막는다.
- **항목별 담당자 변경은 감사 이력에 남는다**(`pct_order_edits.field = 'testItemAssignee'`). GMP 추적 대상이다.
- **불변식**: `is_dual_assignment = false` 이면 `assignee_tester_id_2` 는 항상 null (`0038` check 제약).
  반대 방향("2인 배정이면 담당자 둘 다 not null")은 **일부러 DB 제약으로 걸지 않았다** —
  `on delete set null` 과 충돌해 시험자 하드 삭제가 실패하기 때문이다. 대신 오더 수정 검증을
  "배정을 실제로 건드리는 수정일 때만" 돌게 해서, 담당자가 삭제로 사라진 오더도 관리자가 복구할 수 있다.

## ⬜ 미구현 / 부분
- 상태값 영문 전환(현재 한글 → AUTO_ASSIGNED/MANAGER_REVIEW/CONFIRMED/LOCKED/READY/ASSIGNED/IN_PROGRESS/REVIEW/COMPLETED/DELAY/CANCEL) — 기존 데이터 마이그레이션 + 프론트 전반 수정 필요. **DB 데이터 마이그레이션(대시보드/DB 접근) 선행 필수 → 단독 세션 권장.** (차단 로직 `LOCKED_STATUSES`는 한/영 상태값 모두 미리 포함해둠)

## ⚠️ 주의
- 공수 단위: **DAY 확정(2026-08-22).** 정본은 `product_workload.avg_workdays`(DAY, 절대값).
  `products.avg_hours`(Hour)는 레거시이며 운영 DB 전 행이 null 이다. 대시보드·자동배정·월간 화면 모두 DAY 기준으로 통일했다.
  ⚠️ 단, 운영 DB `product_workload` 가 **0행**이라 실제 공수 값이 비어 있다 → 등록 필요.
- 상태 영문 전환은 광범위 영향(기존 데이터 + 프론트 전체 상태 참조) → 신중한 단독 작업 권장.
- 마이그레이션 `0012`, `0013` 미적용 시 신규 화면 동작 안 함 → `supabase db push` 필요.
- **`0037_dual_assignment.sql` · `0038_dual_assignment_invariants.sql` 은 아직 운영 DB 에 적용되지 않았다.**
  반드시 `0037` → `0038` 순서로 적용할 것. 적용 전에는 2인 배정 관련 컬럼이 없어
  오더 목록 조회부터 실패한다(`select('*')` 는 통과하지만 `is_dual_assignment` 참조 지점에서 42703).
  Supabase 대시보드 > SQL Editor 에서 직접 실행할 것(idempotent). 이 마이그레이션은 `qc_jobs` 의
  `order_id` 단일 unique 제약을 드롭하므로, **적용 전에 오더당 작업이 2건 이상인 데이터가 없는지** 확인한다.
