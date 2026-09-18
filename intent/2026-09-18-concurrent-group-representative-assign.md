# Intent: 동시분석 그룹 대표 로트 기반 담당자 배정
Author: 사용자 요청/오케스트레이션 · Status: completed

## Problem
관리자가 선택한 오더를 동시분석 그룹으로 지정해도 그룹의 대표 로트와 담당자 구성 기준이 기록되지 않아 그룹 배정 결과를 일관되게 재현하기 어렵다.

## Proposed outcome
그룹 지정 시 대표 로트를 확인할 수 있고 그룹 카드와 탭에서 대표가 표시된다. 담당자 배정은 대표 로트를 기준으로 같은 그룹에 적용되며 시작·확정 오더는 건너뛰고 결과에 사유가 표시된다.

## Affected users and systems
- 역할: 관리자(그룹 지정·담당자 배정), 시험자(배정 결과 확인)
- 화면: AI 스케줄 오더 목록·동시분석 그룹 탭·담당자 배정 모달
- 테이블: concurrent_analysis_groups, concurrent_analysis_group_items, pct_orders, pct_order_assignees, pct_order_test_items, qc_jobs, reassignment_history, notifications, operator_schedule
- 확정(LOCK)·작업 시작 상태와의 관계: LOCK 또는 이미 시험이 시작된 오더는 담당자 복제 대상에서 건너뛴다.
- 크론: instrumentation.ts PCT 적재의 자동 그룹 재생성은 대표·잠긴 수동 그룹을 보존한다. 0057 SQL을 운영 DB에 먼저 적용한 뒤 앱을 배포한다.

## Constraints
기존 권한·LOCK·시험 시작 규칙과 병렬 담당자 슬롯·시험항목 배분 규칙을 유지한다. 동시분석 그룹은 실행 단위일 뿐 판정·검토·승인을 배치 간 전파하지 않는다. 0057 미적용 DB에서는 대표 기능만 폴백한다.

## Open questions
- 시험항목 집합이 동일하면 대표의 항목별 슬롯 배분까지 복제한다.
- 시험항목 집합이 다르면 같은 담당자 슬롯 구성만 적용하고 항목 배분은 건너뛴다.
- 대표가 아닌 오더를 직접 배정하면 해당 오더만 변경하며, 대표를 통한 그룹 일괄 배정을 안내한다.
- AI 자동배정은 DB 그룹 대표만 추천·저장한 뒤 같은 담당자 구성을 그룹에 복제하며, LOCK·시작 오더는 동일하게 건너뛴다.
