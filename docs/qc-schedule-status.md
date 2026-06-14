# QC 시험 스케줄 자동배정 — 구현 현황

프로세스 정의: `.claude/commands/qc-schedule-process.md` (`/qc-schedule-process`)
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

## ⬜ 미구현 / 부분
- 상태값 영문 전환(현재 한글 → AUTO_ASSIGNED/MANAGER_REVIEW/CONFIRMED/LOCKED/READY/ASSIGNED/IN_PROGRESS/REVIEW/COMPLETED/DELAY/CANCEL) — 기존 데이터 마이그레이션 + 프론트 전반 수정 필요. **DB 데이터 마이그레이션(대시보드/DB 접근) 선행 필수 → 단독 세션 권장.** (차단 로직 `LOCKED_STATUSES`는 한/영 상태값 모두 미리 포함해둠)

## ⚠️ 주의
- 공수 단위: 요구사항은 DAY, 현재 `products.avg_hours`는 Hour 단위 → DAY 전환 결정 필요(대시보드는 8h=1d 근사 환산).
- 상태 영문 전환은 광범위 영향(기존 데이터 + 프론트 전체 상태 참조) → 신중한 단독 작업 권장.
- 마이그레이션 `0012`, `0013` 미적용 시 신규 화면 동작 안 함 → `supabase db push` 필요.
