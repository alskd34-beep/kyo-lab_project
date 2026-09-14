# QC 시험 스케줄 자동배정 — 구현 현황

프로세스 정의: `.claude/commands/qc-schedule-process.md` (`/qc-schedule-process`)
현재 시스템 전체 PRD(as-built): [`docs/PRD-current-system.md`](./PRD-current-system.md)
최종 갱신: 2026-09-15

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

## ✅ 추가 완료 (2026-09-15, 진행 중 시험항목 담당자 변경 — `0050_item_reassign.sql`)
규칙 전문: `intent/2026-09-15-in-progress-item-reassign.md` · `-spec.md`
- **무엇**: 작업이 시작된 병렬 배정 오더에서 흔적 없는(시작·완료·검토 기록 0) 시험항목 하나를 **같은 오더의 다른 담당자**에게 넘긴다.
  관리자 = 오더 수정 서랍 시험항목의 [담당자 변경](LOCK 오더도 허용) / 시험자 = 할 일 낱개 진행 카드의 [넘기기](자기 항목만). 사유 선택지 필수.
- **쓰기는 DB 함수 하나**: `reassign_job_item(order, 항목명, 기대 슬롯, 받는 슬롯, user, reason)` — (A 작업 有/無) × (B 작업 有/無) 네 경우
  (행 이동 / A 행 삭제 / B 작업에 대기 항목 추가 / 배분만)·스냅샷 슬롯·`pct_order_edits(testItemAssignee, "항목: 이름(QC번호|미시작)")`·
  A·B `recompute_job_stage` 가 한 트랜잭션. 잠금 `qc_jobs → pct_orders → pct_order_assignees → pct_order_test_items → qc_job_items`. service_role 전용.
- **거절**: 진행 중·완료·검토 기록 항목, 제외 항목, 받는 작업 승인전 이후, 마지막 항목, 그 사이 담당자가 바뀐 경우(기대 슬롯), 작업 0건 오더(일괄 배분을 쓴다).
- **커밋 뒤**: 오더 상태 동기화 → 단계 전환 알림(F1) → 받는 사람 앱 알림 `시험항목 인계`. `reassignment_history` 에는 넣지 않는다.
- **항목 시작·시작 취소·완료(개별·그룹)** 는 조건부 update 로 바뀌어 0행이면 "작업 상태가 바뀌었습니다. 새로고침 후 다시 확인해 주세요." 로 실패 응답(예전엔 거짓 성공).
- **경합 대응**: 쓰기 DB 함수(0047~0050)는 교착(40P01)이면 서버가 한 번 재시도(`backend/lib/rpcRetry.ts`). 병렬 배정 `startJob` 은 체크리스트를 만든 직후
  스냅샷을 다시 읽어 누락 항목 추가·흔적 0 인 남의 항목 삭제로 맞춘다(동시 이동의 누락·중복 수렴). 동시분석 그룹 일괄 조작은 상태가 바뀐 배치만 건너뛴다.
- ⚠️ 알려진 한계: 사후 조정도 트랜잭션이 아니라, 조정 도중 또 커밋되는 이동이나 조정 전에 시작된 넘어간 항목은 수렴하지 않는다(서버 로그 경고).

## ✅ 추가 완료 (2026-09-15, 병렬 배정 — 2인 배정 대체)
한 오더를 담당자 **최대 5명**이 시험항목을 나눠 수행한다. 화면 이름 「2인 배정」 → **「병렬 배정」**. — `0049_parallel_assignment.sql`
규칙 전문: `intent/2026-09-15-parallel-assignment.md` · `-spec.md`
- **데이터 모델**: 신규 `pct_order_assignees(order_id, slot 1~5, tester_id)` — PK(order_id, slot), unique(order_id, tester_id),
  tester FK `on delete restrict`, RLS enable+force. 슬롯 1 = 대표이며 `pct_orders.assignee_tester_id` 에 **미러**(영구 유지).
  병렬 여부는 플래그 없이 **행 수 ≥ 2** 로 파생. 슬롯 번호는 빼도 당기지 않는다(구멍 허용). `pct_order_test_items.assignee_slot` 은 1~5.
  상수 `MAX_PARALLEL_ASSIGNEES = 5`(`types/assignment.ts`) ↔ SQL check 숫자 짝.
- **쓰기는 DB 함수 세 개만**: `set_order_assignees(order, [{slot,testerId}], user, reason)`(병렬 구성) ·
  `set_order_primary_assignee(order, tester|null, user, reason)`(대표만 — AI 자동배정·수동 배정·해제·시트 복구·그룹 전파·수동 오더 생성) ·
  `set_order_test_item_slot(order, 항목명, slot, user)`(작업 시작 전 항목 배분 — 담당자 삭제와 직렬화).
  슬롯·미러·구 컬럼(`is_dual_assignment`·`assignee_tester_id_2` 이중 기록)·삭제 슬롯 항목 되돌림·`pct_order_edits` 감사가 한 트랜잭션. service_role 전용.
- **작업 시작 후 구성 변경**: 추가는 허용(새 담당자는 항목 0개로 시작), 삭제는 그 담당자 작업 없음 + 활성 항목 0개일 때만,
  시작한 담당자 교체·해제 금지, 담당자 1 삭제 불가. 일괄 항목 배분 이동은 작업 1건이라도 있으면 계속 금지(진행 중 이동은 항목별 경로).
- **N명 일반화**: 할 일·작업자 현황(동료 전원 열람)·오더 상태 동기화(`countActiveBySlot` 1회)·월간 스케줄(담당자별 행, `is_parallel`/`co_assignee_ids`)·
  관리자 대시보드(보유 DAY 균등 분할)·홈 부하 카드·AI 부하/고난도 가중·챗봇/Q-Think 담당 표시·슬랙 문구·재배정 이력 라벨.
- **AI 자동배정은 병렬 배정을 만들지 않고**, 명시 `orderIds` 경로에서도 병렬 오더를 제외한다.
- **시험자 하드 삭제**: 배정된 오더가 있으면 "배정된 오더가 있어 삭제할 수 없습니다. 비활성화하세요." 로 거절.
- ⚠️ **배포 순서**: SQL 0048 → **0049** → 0050 적용 → 앱 배포 → 0049 파일 끝 「배포 직후 재동기화」 주석 블록 **즉시** 1회 실행(그 전엔 담당자 변경 금지).
  **F2(0050, 항목별 담당자 변경)와 반드시 같은 릴리스.** 0049 적용 전 점검 ③(담당자1 없는 2인 오더)은 필수.
  미적용 환경에서 담당자 구성 변경은 설치 안내로 거절되고, 새 테이블을 읽는 화면은 0049 실행 안내를 보인다.
- 구 2인 컬럼(`is_dual_assignment`·`assignee_tester_id_2`)·0037/0038 제약 드롭은 이번 릴리스에 없다(열린 질문).

## ✅ 추가 완료 (2026-08-29, 2인 배정) — ⚠️ 2026-09-15 병렬 배정(0049)으로 대체됨. 아래는 당시 기록
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

## ✅ 추가 완료 (2026-09-07, 부업무 기록 · 운영 결과 리포트)
시험자의 하루에서 **시험이 아닌 시간**을 처음으로 기록·집계한다. — `0041_side_work.sql`
- **왜**: 문서작성·교육·장비점검·시약관리·감사대응이 실제 시간을 상당히 먹는데 어디에도 남지 않아,
  월간 그리드의 빈 칸이 늘 '노는 날'로 읽혔다. "왜 이 사람에게 시험을 더 못 주는가"를 설명할 근거가 없었다.
- **기록 단위는 분(minutes)** — 시험업무 실적(`qc_job_items.elapsed_minutes`)이 이미 분이라
  같은 자로 재야 '시험 vs 부업무' 비교가 성립한다. 공수(DAY)는 계획의 단위라 섞지 않는다.
  입력은 프리셋(30분/1시간/2시간/반일/종일) 한 번으로 끝나고, 저장되는 값은 언제나 분이다.
- **데이터 모델**: `side_work_categories`(분류 마스터, 삭제 대신 `is_active=false`)
  + `side_work_logs`(1행 = 한 시험자의 하루 한 가지 일). 집계 키는 `tester_id` —
  월간 그리드 행도, 리포트의 시험업무(`qc_jobs.assignee_tester_id`)도 tester 기준이라 여기에 맞춰야 join 이 선다.
  `user_id` 는 "누가 입력했는가"(감사 추적)이지 집계 키가 아니다.
- **기록 UX**: 월간 스케줄 > 월간 그리드에서 **자기 행의 칸을 눌러** 남긴다(누른 칸이 날짜·시험자를 이미 정했으므로
  다이얼로그는 '무엇을 했는지'만 묻는다). 내 행은 「나」 배지 + 옅은 파랑으로 구분하고,
  배정이 하나도 없는 달에도 본인 행은 반드시 낸다 — 그러지 않으면 기록할 칸 자체가 없다.
  부업무 칩은 청록(teal)이라 시험 배정과 한눈에 갈린다.
- **권한**(휴가 `operator_schedule` 와 같은 모양): 시험자는 **본인 기록만** 등록·수정·삭제, 팀 기록은 읽기 전용.
  관리자는 전체. 이 값이 리포트의 분모·분자로 들어가므로 화면 숨김이 아니라 서버(`assertLogAccess`)에서 막는다.
- **운영 결과 리포트**: 시험업무 vs 부업무를 같은 기간·같은 자로 나란히 놓는다.
  기간 포함 기준은 시험업무=항목 완료 시각(KST 경계), 부업무=`work_date`, 완료 작업=승인완료+종료일.
  → 2026-09-08 「시험자 운영 분석」(`/insights/stats`)에 흡수됐다(아래 항목 참조).
- **분류 마스터 화면**: 기준 설정 > 부업무 분류(`/settings/side-work-categories`, admin).
  기록이 달린 분류는 삭제 대신 [사용 안 함] — 지우면 과거 기록을 리포트가 다시 읽을 수 없다(FK `on delete restrict`).
- 관련 파일: `backend/services/sideWork.ts`, `backend/services/operationReport.ts`, `backend/lib/testerLink.ts`,
  `app/api/side-work/**`, `app/api/insights/operation-report`, `types/side-work.ts`,
  `frontend/components/schedule/side-work-dialog.tsx`, `app/(menu)/schedule/monthly/page.tsx`.

## ✅ 추가 완료 (2026-09-08, 운영평가 + 운영 결과 리포트 통합)
두 화면을 **「시험자 운영 분석」(`/insights/stats`)** 하나로 합쳤다. 합친 이유는 셋이다.
- **질문이 두 화면에 걸쳐 있었다.** "이 사람 공수 준수율이 왜 낮지?"의 답이 "부업무를 40% 하고
  있었다"인데, 그 둘이 다른 화면이면 관리자가 숫자를 머리에 들고 화면을 오가야 했다.
  이제 통합 시험자 표 **한 행**에 준수율과 부업무 비중이 함께 있다(그래서 차트보다 위에 둔다).
- **'가동률'이 같은 이름, 다른 뜻이었다.** 운영평가 쪽은 배정 공수(계획 DAY) ÷ 근무일,
  리포트 쪽은 기록 시간(실측 분) ÷ 근무시간. 화면에서 **계획 / 실적**으로 이름을 갈라 나란히 둔다.
- **시험항목별 소요가 양쪽에 있었다.** 모집단부터 달랐다(운영평가=완료 작업에 딸린 항목,
  리포트=이 기간에 완료된 항목). 상위집합인 리포트 쪽(`byTestItem`, 건수·총소요·평균)만 남기고
  `testerEvaluation` 의 `byItem`·`totals.avgItemMinutes` 와 그 `qc_job_items` 조회를 걷어냈다.
- **구성**: KPI 6칸(시간 배분 3 + 성과 3) → 통합 시험자 표 → 탭(성과 / 시간 배분).
  표는 적응형 컬럼(논리 8칸, 최대 펼침 11칸 — `colgroup` 도 11개)이며 시험업무·부업무·가동률이
  `CellStack` 묶음이다.
- **두 집계는 따로 실패할 수 있다.** `Promise.allSettled` 로 병렬 조회하고 실패한 쪽만 안내 줄을
  띄운다 — 부업무 스키마(0041)가 없는 환경에서도 성과 지표는 읽혀야 한다.
- **기본 탭은 데이터가 있는 쪽**으로 연다. 완료 작업이 0건인 기간에 '성과'를 기본으로 열면
  표에는 실적이 가득한데 탭만 비어 화면이 고장 난 것처럼 읽힌다.
- 옛 경로 `/insights/ins-report` 는 지우지 않고 `/insights/stats` 로 리다이렉트한다(공유된 링크 보호).
  사이드바에서는 「리포트」 항목을 내리고 「운영평가」를 **「시험자 운영 분석」**으로 바꿨다.

## ⬜ 미구현 / 부분
- 상태값 영문 전환(현재 한글 → AUTO_ASSIGNED/MANAGER_REVIEW/CONFIRMED/LOCKED/READY/ASSIGNED/IN_PROGRESS/REVIEW/COMPLETED/DELAY/CANCEL) — 기존 데이터 마이그레이션 + 프론트 전반 수정 필요. **DB 데이터 마이그레이션(대시보드/DB 접근) 선행 필수 → 단독 세션 권장.** (차단 로직 `LOCKED_STATUSES`는 한/영 상태값 모두 미리 포함해둠)

## ⚠️ 주의
- **`0041_side_work.sql` 은 아직 운영 DB 에 적용되지 않았다.** Supabase 대시보드 > SQL Editor 에서 실행할 것(idempotent).
  적용 전에는 월간 스케줄이 부업무 줄만 앰버 경고로 알리고 나머지는 정상 동작하며, 운영 결과 리포트는 조회에 실패한다.
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
