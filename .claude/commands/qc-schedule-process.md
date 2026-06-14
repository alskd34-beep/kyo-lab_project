# QC 시험 스케줄 자동배정 — 프로세스 정의

제조팀 생산계획(구글시트) → QC 시험 스케줄 자동생성 → AI 배정 추천 → 관리자 확정·LOCK 전체 프로세스의 단일 기준 문서.
**원본**: `QC 시험 스케줄 자동배정 시스템 요구사항 정의서.pdf` (2026-06-14 확정)
**구현 현황**: 이 문서의 "구현 현황" 표 + `docs/qc-schedule-status.md` 참고.

---

## 운영 원칙 (불변)

1. **AI는 추천, 관리자가 확정** — 흐름: `AI 자동배정 → 관리자 검토 → 관리자 확정 → LOCK`. AI는 최종 결정권 없음.
2. **시험 시작 후 일정 변경 금지** — `IN_PROGRESS`/`COMPLETED` 상태는 생산계획 변경돼도 재계산·재배정 금지, **알림만**.
3. **LOCK 상태 존중** — `LOCKED`는 자동 재배정/일정변경 금지. 생산계획 변경 시 알림만, 관리자가 판단.
4. **공수는 DAY 단위** — 품목마스터 공수가 절대값. 동시분석/LOT 수량 무관 (베니톨정 3DAY는 LOT 1개든 30개든 3DAY).

---

## 업무 흐름

```
제조팀 Google Sheet → 데이터 수집 → 신규/수정/삭제 감지 → 품목마스터 확인
→ 시험 스케줄 생성 → 동시분석 그룹 생성 → 품목 규칙 적용 → 공수 계산
→ AI 자동 배정 → 관리자 검토 → 확정 → LOCK → 시험 진행 → 상태 관리 → 대시보드
```

---

## 상태 정의

`AUTO_ASSIGNED → MANAGER_REVIEW → CONFIRMED → LOCKED → READY → ASSIGNED → IN_PROGRESS → REVIEW → COMPLETED` (+ `DELAY`, `CANCEL`)

생산계획 변경 처리:
- `AUTO_ASSIGNED` / `MANAGER_REVIEW` / `CONFIRMED` → **재계산 가능**
- `IN_PROGRESS` / `LOCKED` → **재계산 금지, 알림만**

---

## 핵심 규칙

### 동시분석 그룹 (OR 조건 중 하나라도 충족 시 동일 그룹)
1. 품목코드 동일 AND 완료요청일 동일
2. 품목명 동일
3. 품목코드 다름 + 품목명 동일
4. 품목코드 동일 + 품목명 다름
5. 품목명 포함 관계 (베니톨정 / 베니톨에스정 / 베니톨플러스정 → 동일 그룹)

- **그룹 잠금**: `GROUP_LOCK = TRUE` (관리자만)
- **일부 취소**: 기존 그룹 유지, 재생성 금지, 관리자 알림
- **시험 시작일 = MAX(포장완료일) + 1일**

### 휴가 (`operator_schedule`)
컬럼: `id, user_id, start_date, end_date, type(ANNUAL|HALF_DAY|BUSINESS_TRIP), manager_checked, memo, created_at`
→ **휴가 기간 중인 시험자는 AI 자동배정 대상 제외.** 화면: 스케줄 > 휴가 캘린더.

### 장비 예약 (`equipment_reservation`)
컬럼: `id, equipment_id, user_id, start_date, end_date, status(RESERVED|WAITING|CANCELLED|COMPLETED), wait_order`
- 선착순. 이미 예약 존재 시 예약 불가 → 대기 등록 + 대기 알림.
- `WAITING` 24시간 초과 시 자동 취소.

### 난이도 기반 배정 (`products.difficulty` = HIGH|MEDIUM|LOW)
- 최근 2주 기준 HIGH 난이도 업무 많은 시험자 → 차주 MEDIUM/LOW 우선 배정.

### 긴급 업무 (`EMERGENCY_ASSIGN`)
- 공수 **≤ 3DAY** 품목만 허용 (베니톨 3DAY ⭕ / 광동마음정액 14DAY ❌).

### 품목별 특수 규칙
- **향정신성** (자이렌정·아디펙스정): 모든 시험자 배정 가능, 단 **강지윤·김정호 제외**, 배정 시 관리자 알림 필수.
- **개별 중금속**: 매주 금요일 강제 배정, 박성호→이영남→정예찬 순환, 공수 1DAY 고정.

---

## 권한

- **관리자**: 공수 수정, 배정 수정, LOCK 설정/해제, 그룹 잠금/해제, 재배정 이력 조회.
- **담당자**: 휴가 등록, 장비 예약, 시험 수행, 시험 결과 입력. (공수/배정/LOCK/그룹잠금 변경 불가)

## 필수 부가 요건
- 모든 변경 이력 저장, 모든 알림 저장, 생산계획 변경 시 `before_value`/`after_value` 저장.
- **재배정 이력** (`reassignment_history`: group_id, before_user, after_user, reason, changed_by, changed_at) — 관리자만 조회. 분석용(누가/왜/어느 품목에서 많이 변경되는가).

## 관리자 대시보드
전체/진행중/완료/지연/미배정 건수, 향정신성 현황, 신규 품목 현황, 재배정 현황, 시험자별 보유 DAY, 시험자별 난이도 분포.

---

## 구현 현황 (2026-06-14 기준)

| 영역 | 상태 |
|------|------|
| 구글시트 적재(크론)/diff/품목동기화 | ✅ 완료 (`pctIngest.ts`) |
| AI 자동배정(역량·부하분산) | ✅ 완료 (`pctAssign.ts`, `scheduleEngine.ts`) |
| 감독관 배정/수정 화면 · 담당자 실행 화면 | ✅ 완료 |
| QC번호 채번 · 알림(DB+벨) · 수정사유 이력 | ✅ 완료 |
| `products.difficulty` 컬럼 | ✅ 존재 (`0004`) |
| 휴가 관리(`operator_schedule`) + AI 휴가제외 | 🚧 진행 (`0012`) |
| 장비 예약(`equipment_reservation`) | ⬜ 미구현 (테이블만) |
| 재배정 이력(`reassignment_history`) | ⬜ 미구현 (테이블만) |
| 동시분석 그룹 + 시험시작일 계산 | ⬜ 미구현 |
| 상태값 영문 전환(AUTO_ASSIGNED 등) | ⬜ 미구현 (현재 한글) |
| 난이도/긴급/향정신성/중금속 특수 규칙 | ⬜ 미구현 |
| 관리자 대시보드(보유 DAY/난이도 분포 등) | ⬜ 미구현 |

> 새 기능 착수 전 이 표와 `docs/qc-schedule-status.md`를 먼저 확인할 것.
