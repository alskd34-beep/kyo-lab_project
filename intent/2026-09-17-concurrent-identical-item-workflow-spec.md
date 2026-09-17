# Intent: 동일 시험항목 동시분석 그룹의 워크플로우 동기화 — Spec
Author: 사용자 요청/오케스트레이션 · Status: completed

## Problem
시험항목이 완전히 같은 동시분석 그룹에서 물리적 시험 진행은 함께 기록할 수 있지만, 배치별 결과가 다를 수 있는 판정·검토·승인까지 자동 전파하면 업무 의미가 훼손된다.

## Proposed outcome
그룹 내 취소·제외되지 않은 모든 배치의 정규화된 시험항목명 집합이 동일할 때만 다음 표의 물리적 진행 전이가 짝 배치에 함께 움직인다. 판정 성격의 전이는 개별 경로에서 원본 배치만 처리한다. 관리자가 명시적 그룹 버튼을 누른 `/api/qc-jobs/group/[groupId]/review|review-bulk|approve`는 여러 배치에 한 번에 적용하는 편의 기능으로 유지한다.

| 전이 | 개별 경로 | 동일 항목 그룹 전파 | 비고 · 구현 근거 |
|---|---|---|---|
| 시험항목 시작 | 처리 | 계속 | 물리적 시험 진행 — `backend/services/qcJobs.ts:1760-1788` |
| 시험항목 완료 | 처리 | 계속 | 물리적 시험 진행 — `backend/services/qcJobs.ts:1827-1917` |
| 시험 시작 취소 | 처리 | 계속 | 물리적 시험 진행 — `backend/services/qcJobs.ts:1791-1814` |
| 적합·부적합 등 결과 판정 | 처리 | 제거 | 배치별 결과 — 결과 판정 도메인 없음 |
| 검토 시작·완료 | 처리 | 제거 | 그룹 검토 버튼은 명시적 일괄만 — `backend/services/qcJobItemReview.ts:65-93`, `frontend/components/common/job-item-review.tsx:265-322` |
| 반려·재실시·검토 취소 | 처리 | 제거 | 배치별 사유·이력 — `backend/services/qcJobItemReview.ts:65-93`, `frontend/components/common/job-item-review.tsx:292-302` |
| 승인 단계 전환·승인 | 처리 | 제거 | 그룹 승인 버튼은 명시적 일괄만 — `backend/services/qcJobs.ts:1650-1704`, `frontend/components/common/job-status-control.tsx:160-280` |
| 담당자 상태 변경 | 처리 | 제거 | 진행중/지연도 배치별 — `backend/services/qcJobs.ts:1926-1990`, `app/(menu)/my-tasks/page.tsx:625-716` |

## Affected users and systems
- 역할: 관리자 / 시험자 / 둘 다
- 화면: `/my-tasks`, 작업 상세, 작업 현황, 그룹 시작·검토·승인 컨트롤
- 테이블: `concurrent_analysis_groups`, `concurrent_analysis_group_items`, `qc_jobs`, `qc_job_items`, `qc_job_status_history`, 알림 테이블
- 확정(LOCK)·작업 시작 상태와의 관계: LOCK은 그룹 전파보다 우선하며, 승인완료·검토 흔적이 있는 항목은 기존 제한을 따른다. 그룹 해제 후 새 조작은 단일 배치 경로로만 처리한다.
- 크론: `instrumentation.ts` 영향 없음

## Constraints
동일성 판정은 `concurrentGroups.ts`의 단일 판정 함수에서 수행하고 표시·항목 경로가 이를 사용한다. 취소·제외되지 않은 오더만 비교하며 `qc_job_items`에 생성되지 않은 N/A/제외 항목은 비교 대상이 아니고, 항목 0건 그룹은 전파하지 않는다. 항목 진행 전파에는 기존 개별 경로의 시간 기록·상태 이력을 남기되 원본 배치 권한을 시스템 전파 권한으로 사용하고, 전파 호출에는 재귀 플래그를 끈다. 결과·검토·승인 이력은 각 배치에만 남긴다. DB 스키마와 권한 규칙은 변경하지 않는다.

## Open questions
- 그룹 내 작업이 아직 생성되지 않은 오더는 비교에서 제외하되, 활성 작업이 두 건 미만이면 전파하지 않는다.
- 결과 판정 도메인이 별도로 추가될 때도 자동 전파하지 않는 원칙을 유지할지 확인한다.
