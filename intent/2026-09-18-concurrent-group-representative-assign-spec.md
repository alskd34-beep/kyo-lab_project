# Intent: 동시분석 그룹 대표 로트 담당자 복제 — Spec
Author: 사용자 요청/오케스트레이션 · Status: completed

## Problem
동시분석 그룹의 대표 로트에 담당자 구성을 저장해도 같은 실행 단위의 다른 오더가 자동으로 따라가지 않아, 그룹이 서로 다른 담당자에게 배정될 수 있다.

## Proposed outcome
대표 로트의 단건·병렬 담당자 구성과 시험항목별 슬롯 배분을 동일 그룹의 미시작·미확정 오더에 복제한다. 항목 집합이 다르면 담당자 슬롯만 적용하고 항목 배분은 건너뛰며, 결과에 적용 건수와 오더별 건너뜀 사유를 안내한다.

## Affected users and systems
- 역할: 관리자(배정·확정·LOCK), 시험자(배정 결과 확인), AI 자동배정(추천 실행)
- 테이블: concurrent_analysis_groups, concurrent_analysis_group_items, pct_orders, pct_order_assignees, pct_order_test_items, qc_jobs, reassignment_history, pct_order_edits, notifications, operator_schedule
- 확정(LOCK)·작업 시작 상태와의 관계: LOCK 오더 또는 qc_jobs가 이미 생성된 오더는 복제하지 않고 사유를 남긴다. 대표가 아닌 오더의 직접 배정은 그 오더만 변경한다.
- 크론(instrumentation.ts): PCT 적재 및 자동 그룹 재생성은 배정 복제 규칙을 별도로 실행하지 않으며 대표·잠긴 수동 그룹 보존 규칙을 따른다. 0057 SQL을 운영 DB에 먼저 적용한 뒤 앱을 배포한다.

## Constraints
기존 권한, 0049 담당자 슬롯 RPC, 0054 담당자·시험항목 번들 RPC, 휴가 알림과 감사 이력을 유지한다. 대표와 대상의 활성 시험항목명 집합이 같을 때 대표의 전체 항목별 슬롯 배분을 복제하고, 다르면 슬롯만 복제한다. 동시분석은 진행을 함께 하는 실행 단위일 뿐 배치별 판정·검토·승인을 전파하지 않는다. AI 자동배정은 DB 그룹 대표를 배정 기준으로 사용하며 병렬 담당자 구성 자체를 새로 만들지는 않는다.

## Open questions
- 그룹 구성원이 추가되거나 대표가 변경될 때 기존 담당자 구성을 재동기화할지는 별도 운영 결정으로 남긴다.
