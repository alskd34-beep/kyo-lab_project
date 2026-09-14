# Spec: 시험항목 단위 검토 — 작업 단계 도출 규칙
Author: kyo (개발) · Status: completed
관련 intent: [2026-09-15-item-level-review.md](./2026-09-15-item-level-review.md)
근거: 감독 결정 `temp/decisions-f1-f2-f3.md`(F1·공통 — **단일 기준**) · 탐색 브리프 `temp/brief-f1-review.md`

이 문서는 항목 검토가 **언제 허용되고, 작업 단계가 어떻게 정해지며, 무엇이 기록되는가**를 못박는다.
최종 판정은 DB 함수(마이그레이션 0048)가 하며, 화면의 버튼 노출은 같은 규칙의 보조 판정일 뿐이다.

표기
- 무표시 = 결정 문서에 있는 규칙.
- **[브리프 준용]** = 결정 문서가 정하지 않았고, 브리프 권고가 결정과 충돌하지 않아 그대로 옮긴 세부.
- **[결정 F1-n]** = 감독 보강 결정(`temp/decisions-f1-f2-f3.md` 「보강 결정」)으로 확정된 세부. 옛 「확인 필요」 7건은 전부 이것으로 바뀌었다(§12).
- **[구현 반영]** = 구현(2026-09-15) 중 spec 초안과 달라진 점. 이유를 함께 적었다.

이 기능의 단계 재도출 함수 `recompute_job_stage` 는 [진행 중 시험항목 담당자 변경 spec](./2026-09-15-in-progress-item-reassign-spec.md) 의 항목 이동이 그대로 호출한다.

---

## 1. 데이터 모델

### 1.1 `qc_job_items` 추가 컬럼

| 컬럼 | 타입·제약 | 의미 |
|---|---|---|
| `review_status` | `text not null default 'none'` | 검토 축. `none`(검토 없음) · `reviewing`(검토 중) · `reviewed`(검토 완료) |
| `review_started_at` | `timestamptz` null | 검토 시작 시각 [브리프 준용] |
| `review_started_by` | `uuid references users(id) on delete set null` | 검토 시작자 [브리프 준용] |
| `review_started_by_name` | `text` | 검토 시작자 이름 스냅샷(`display_name ?? username`) [브리프 준용] |
| `reviewed_at` | `timestamptz` null | 검토 완료 시각 [브리프 준용] |
| `reviewed_by` | `uuid references users(id) on delete set null` | 검토 완료자 [브리프 준용] |
| `reviewed_by_name` | `text` | 검토 완료자 이름 스냅샷 [브리프 준용] |

- 시험 축 `status`(`pending`·`in_progress`·`cleared`)는 **그대로** 둔다. 값·의미를 바꾸지 않는다.
- 제약(0044/0045 패턴: `drop constraint if exists` 뒤 `add`)

| 제약 이름 [브리프 준용] | 식 |
|---|---|
| `chk_qc_job_items_review_status` | `review_status in ('none','reviewing','reviewed')` |
| `chk_qc_job_items_review_requires_cleared` | `review_status = 'none' or status = 'cleared'` |

- 인덱스: 필수 없음. `(qc_job_id) where review_status = 'reviewing'` 부분 인덱스는 선택 [브리프 준용].

### 1.2 신규 `qc_job_item_review_history`

| 컬럼 | 타입·제약 |
|---|---|
| `id` | `uuid primary key default gen_random_uuid()` |
| `qc_job_item_id` | `uuid references qc_job_items(id) on delete set null` (nullable) **[결정 F1-1]** |
| `qc_job_id` | `uuid references qc_jobs(id) on delete set null` (nullable) — 기록 당시 작업(항목이 다른 작업으로 옮겨져도 당시 값 유지) **[결정 F1-1]** |
| `order_id` | `uuid not null references pct_orders(id) on delete cascade` **[결정 F1-1]** |
| `qc_no` | `text` — 기록 당시 QC번호 스냅샷 **[결정 F1-1]** |
| `test_item_name` | `text not null` — 기록 당시 항목명 스냅샷 **[결정 F1-1]** |
| `action` | `text not null` check `action in ('review_start','review_complete','review_cancel','reopen','backfill')` |
| `from_review_status` | `text` |
| `to_review_status` | `text` |
| `changed_by` | `uuid references users(id) on delete set null` (백필은 null) |
| `changed_by_name` | `text` 스냅샷 |
| `reason` | `text` (검토 취소·재실시는 필수, 백필은 고정 문구 §10) |
| `snapshot` | `jsonb` (§6.1) |
| `created_at` | `timestamptz not null default now()` |

- 인덱스 [브리프 준용]: `(qc_job_item_id, created_at)`, `(qc_job_id, created_at)`.
- RLS: `enable row level security` + `force row level security`, **정책 없음**(0033·0035·0041 원칙 — service_role 만 접근).
- action CHECK 는 재실행 안전하게 이름 있는 제약 `chk_qc_job_item_review_history_action`(drop if exists 뒤 add)으로 둔다 **[구현 반영]**.
- 작업 시작 취소(0047)나 F2 의 항목 행 삭제로 항목·작업 행이 사라져도 이력은 남는다(FK set null + 스냅샷 컬럼).

### 1.3 상태 문자열 짝

SQL 안의 `'none'`·`'reviewing'`·`'reviewed'`·`'pending'`·`'cleared'`·`'진행중'`·`'지연'`·`'검토전'`·`'검토중'`·`'승인전'`·`'승인완료'` 는 리터럴로 쓰고,
함수 주석에 `types/qc-status.ts` 의 상수 이름과 짝을 적는다. TS 는 상수를 import 한다. 새 검토 상태 상수·라벨도 `types/qc-status.ts` 에 둔다.

---

## 2. 작업 단계 도출 규칙

### 2.1 규칙 (단일 기준 = DB 함수 `derive_job_stage`, 쓰기는 `recompute_job_stage`)

입력: 그 작업의 `qc_job_items` 전부. N = 항목 수, C = `status='cleared'` 수, S = `review_status in ('reviewing','reviewed')` 수, V = `review_status='reviewed'` 수.

| 우선순위 | 조건 | 결과 |
|---|---|---|
| 0 | 현재 `qc_jobs.status` 가 `승인완료` 또는 `지연` | **도출하지 않는다**(값 유지) |
| 1 | N > 0 이고 V = N | `승인전` |
| 2 | S ≥ 1 | `검토중` |
| 3 | N > 0 이고 C = N (이때 S = 0) | `검토전` |
| 4 | 그 외 | `진행중` |

- 도출값이 현재값과 **다를 때만** 쓴다. 같은 트랜잭션에서 `qc_job_status_history` 1행(source `auto`)을 넣는다(§6.2).
- 뒤로 가는 전이(승인전→검토중, 검토중→진행중, 검토전→진행중 등)도 이 규칙으로 일어난다. 이력 note 에 원인 항목을 남긴다.
- `work_end_date` 는 건드리지 않는다(승인완료 진입·이탈 때만 바뀌는 기존 규칙 유지).
- **화면·TS 에 같은 도출 규칙을 다시 구현하지 않는다.** 화면은 `qc_jobs.status` 를 그대로 보여 준다.
- 기존 TS `autoAdvanceToReview` 는 없애고 이 함수 호출로 대체한다.
- 규칙 1~4 는 순수 조회 함수 `derive_job_stage(p_job_id) returns text` 한 곳에만 있다 **[결정 F1-7]**. `recompute_job_stage` 는
  우선순위 0(승인완료·지연 건너뜀) + `derive_job_stage` + 다르면 쓰기·이력이다. 관리자 직접 변경·지연 해제도 같은 `derive_job_stage` 를 부른다.

### 2.2 도출을 실행하는 시점 — 항목 이벤트에서만

| 이벤트 | 호출 위치 | note(§6.2) 의 동작 이름 |
|---|---|---|
| 시험자 항목 완료(개별·동시분석 그룹) | 항목 완료 서비스가 항목 갱신 뒤 rpc 호출 | `완료` |
| 검토 시작·완료·취소, 재실시 | `item_review_action` 함수 안(같은 트랜잭션) | `검토 시작`·`검토 완료`·`검토 취소`·`재실시` |
| 진행 중 항목 담당자 변경(F2) | `reassign_job_item` 함수 안, 보내는 쪽·받는 쪽 작업 각각 | `담당자 변경` |

- 항목 시작·시작 취소는 C·S·V 를 바꾸지 않으므로 호출하지 않는다.
- 크론·조회 시점에는 도출하지 않는다(옛 데이터를 조회만으로 옮기지 않는다).
- 항목 완료 경로는 항목 갱신과 도출이 **한 트랜잭션이 아니다** **[결정 F1-5]**. 항목 완료는 기존 TS 경로를 유지하고 커밋 뒤
  `recompute_job_stage` RPC 를 부른다. 함수가 호출마다 잠금 아래에서 현재 항목을 다시 읽어 수렴하므로(재실행 안전) 묶지 않는다.
  도출 호출이 실패하면 항목은 완료로 남고(서버 로그), 단계는 다음 항목 이벤트 때 맞춰진다.

### 2.3 오더 상태 — 현행 규칙 유지

- 오더 상태는 도출 함수가 쓰지 않는다. **커밋 뒤, 단계가 바뀐 경우** 기존 `syncOrderStatusFromJobs(orderId)` 를 호출한다.
  규칙: 작업 중 `지연` 이 있으면 `지연` → 아니면 가장 덜 진행된 작업 단계 → 활성 항목이 있는 미시작 담당자가 있으면 `진행중` 상한.
- 오더 수준 "하나라도 검토중이면 검토중" 은 **적용하지 않는다**(intent Open questions).

### 2.4 경계 사례 판정표

| # | 상황 | 판정 |
|---|---|---|
| a | 일부 진행 중 + 일부 완료 + 검토 없음 | `진행중`. 완료 항목에 [검토 시작] 이 보인다 |
| b | 일부 진행 중 + 한 항목 검토 중 | `검토중`. 시험자는 나머지 항목을 계속 시작·완료한다. 남은 항목이 끝나도 `검토중` 유지 |
| c | 전 항목 검토 완료 | `승인전`(자동). [승인] 은 관리자 수동 |
| d | 검토 완료 항목을 재실시 | 항목 `pending`·검토 `none`. 다른 항목에 검토 흔적이 있으면 `검토중`, 없으면 `진행중`(승인전이었다면 뒤로 감) |
| e | 전 항목 완료, 검토 미시작 | `검토전` |
| f | 전 항목 완료 전에 검토가 먼저 시작됨 | `진행중 → 검토중`, 검토전을 거치지 않음 |
| g | `지연` 작업에서 항목 검토 시작·완료 | 항목 검토는 허용, 작업은 `지연` 유지 |
| h | `승인완료` 작업의 항목 검토·재실시 | 거절(§3.2). 먼저 관리자 직접 변경으로 `승인전` 으로 내린 뒤 조정 |
| i | 병렬 배정 — A 작업 검토중, B 작업 진행중 | 작업은 각각 도출. 오더는 `진행중`(가장 덜 진행된 단계) |
| j | 항목 0건 작업 | 규칙 4 → `진행중`. 작업 시작이 0건 생성을 막고 F2 가 마지막 항목 이동을 막으므로 정상 경로로는 생기지 않음 |
| k | 백필 뒤 `승인전` 작업에 미완료 항목이 남은 불일치 데이터 | 그 항목은 백필하지 않음(§10). 다음 항목 이벤트에서 `검토중` 으로 도출될 수 있음 |
| l | 관리자 직접 변경으로 `지연` → 도출 단계(예: `진행중`)로 풀었는데 항목 상태로는 `검토중` 이어야 함 | **[결정 F1-3]** 요청값 대신 도출 단계(`검토중`)로 복귀. 상태 이력 note 에 `(항목 상태에 따라 '검토중' 로 복귀)` |
| m | 시험자가 `지연 → 진행중` 으로 되돌렸는데 항목 상태로는 `검토중`·`승인전` 이어야 함 | **[결정 F1-3]** l 과 같음. note `담당자 상태 변경 — 항목 상태에 따라 '{단계}' 로 복귀` |

---

## 3. 항목 검토 동작과 허용 조건

### 3.1 동작

| 동작(`p_action`) | 전제(항목) | 결과(항목) | 사유 |
|---|---|---|---|
| `review_start` 검토 시작 | `status='cleared'` AND `review_status='none'` | `reviewing`, `review_started_at/by/by_name` 채움 | 불필요 |
| `review_complete` 검토 완료 | `review_status='reviewing'` | `reviewed`, `reviewed_at/by/by_name` 채움(`review_started_*` 유지) | 불필요 |
| `review_cancel` 검토 취소 | `review_status='reviewing'` 만. "검토 완료 취소" 는 **없다** — `reviewed` 는 재실시로만 되돌린다 **[결정 F1-2]** | `none`, `review_started_*` 비움(이력에 남음) | **필수** |
| `reopen` 재실시 | `status='cleared'`(검토 상태 무관) | `status='pending'`, `started_at`·`cleared_at`·`elapsed_minutes`·`elapsed_total_minutes`·검토 컬럼 전부 비움, `review_status='none'` | **필수** |

- 공통 전제(작업): `qc_jobs.status ≠ '승인완료'`. `지연` 은 허용.
- 사유: 문자열, 앞뒤 공백 제외 **2자 이상**(같은 급의 정정인 관리자 직접 변경과 같은 기준) [브리프 준용].

### 3.2 허용 조건과 거절 메시지(전문)

판정 순서: 0 → 1 → 2 → 3 → 3' → 4 → 5. 앞에서 거절되면 뒤는 보지 않는다. 함수의 거절은 `errcode P0001` 이고 서비스가 메시지를 그대로 보인다.

| # | 조건 | 거절 메시지(전문) |
|---|---|---|
| 0 | 사유(취소·재실시) | 없음/문자열 아님: `검토 취소 사유를 입력해 주세요.` · `재실시 사유를 입력해 주세요.` / 2자 미만: `검토 취소 사유를 2자 이상 입력해 주세요.` · `재실시 사유를 2자 이상 입력해 주세요.` |
| 1 | 동작 값 | `알 수 없는 검토 동작입니다.` |
| 2 | 요청자 = 관리자(라우트 `requireAdmin`, 함수도 `users.role='admin'` AND `is_active` 재확인 [리뷰 경미 5]) | `관리자만 시험항목을 검토할 수 있습니다.` |
| 3 | 항목 존재 | `시험항목을 찾을 수 없습니다.` |
| 3' | 잠근 뒤 항목의 작업이 잠금 전과 같음(F2 이동 경합) | `다른 사용자가 먼저 변경했습니다. 새로고침 후 다시 시도하세요.` |
| 4 | 작업 ≠ 승인완료 | `"승인완료" 단계의 작업은 시험항목 검토를 변경할 수 없습니다. 먼저 작업 상태를 "승인전"으로 되돌리세요.` |
| 5a | `review_start`: 완료 항목 | `완료된 시험항목만 검토를 시작할 수 있습니다.` |
| 5b | `review_start`: 검토 없음 | `이미 검토를 시작한 시험항목입니다.` |
| 5c | `review_complete`·`review_cancel`: `none` | `검토를 시작하지 않은 시험항목입니다.` |
| 5d | `review_complete`: 이미 `reviewed` | `이미 검토를 완료한 시험항목입니다.` |
| 5e | `review_cancel`: `reviewed` **[결정 F1-2]** | `검토를 완료한 시험항목은 검토 취소할 수 없습니다. 재실시로 조정하세요.` |
| 5f | `reopen`: 완료 항목 | `완료된 시험항목만 재실시할 수 있습니다.` |
| — | 설치(`PGRST202`/`42883`, 그리고 `42703`/`42P01`/`PGRST204`/`PGRST205` **[구현 반영]**) | `시험항목 검토 기능의 DB 설치(0048 마이그레이션)가 아직 적용되지 않았습니다. 관리자에게 문의하세요.` |
| — | 라우트의 작업 id 와 항목의 작업이 다름(서비스 사전 검사) **[구현 반영]** | `시험항목을 찾을 수 없습니다.` |

### 3.3 일괄 편의 버튼(관리자 패널)

| 버튼 | 대상 | 기록 |
|---|---|---|
| `완료 항목 전체 검토 시작` | 그 작업의 `cleared` + `none` 항목 전부 | 항목마다 검토 이력 1행 |
| `검토 중 항목 전체 검토 완료` | 그 작업의 `reviewing` 항목 전부 | 항목마다 검토 이력 1행 |

- **[결정 F1-4]** RPC 한 번 = 한 트랜잭션, **전부 성공 아니면 전부 실패**. 대상이 0건이면 `처리할 시험항목이 없습니다.`
  함수: `item_review_bulk_action(p_job_id uuid, p_user_id uuid, p_action text) returns jsonb` **[구현 반영: 이름·인자]**.
  판정 순서: 동작 값(`review_start`·`review_complete` 외 `알 수 없는 검토 동작입니다.`) → 관리자 → 작업 잠금·존재(`작업을 찾을 수 없습니다.`) → 승인완료 거절(§3.2-4 문구) → 항목 전부 잠금 → 대상 0건 거절 → 항목마다 갱신·이력 → 단계 재도출 1회.
- 단계 전환 알림은 일괄 전체에서 **실제 전환된 결과**만 보낸다(항목 수만큼 보내지 않는다).

### 3.4 작업 단위 동작의 변경

| 기존 동작 | 변경 | 거절 메시지(전문) |
|---|---|---|
| 관리자 단계 넘기기(`advanceJobStage`) | `승인전 → 승인완료` **만** 허용. 검토전·검토중에서 넘기기 제거. 0048 적용 환경이면 **전 항목 `reviewed`**(= `derive_job_stage` 가 `승인전`)일 때만 **[리뷰 M2]** | `승인은 "승인전" 단계의 작업에서만 할 수 있습니다. 검토는 시험항목별로 진행합니다.` · `모든 시험항목의 검토가 끝나야 승인할 수 있습니다.` |
| 관리자 직접 변경(`setJobStatusByAdmin`) | ① `승인완료` 로는 `승인전` 에서만, `승인완료` 에서는 `승인전` 으로만 **[결정 F1-6]** ② 출발이 `지연` 이면 요청값 대신 `derive_job_stage` 값으로 복귀 **[결정 F1-3]** ③ 그 밖에 목표가 도출 단계(`진행중`·`검토전`·`검토중`·`승인전`)면 **목표 = `derive_job_stage`** 일 때만 **[결정 F1-7]** ④ 도출 단계 → `지연` 은 자유. 쓰기는 `.eq('status', 현재값)` 조건부 update | ① `승인완료는 승인전 단계에서만 변경할 수 있습니다.` ③ `항목 상태와 맞지 않습니다 — 항목 재실시/검토 취소로 조정하세요.` · 조건부 update 0행: `작업 상태가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.` |
| 담당자 상태 변경(`changeJobStatus`) | 출발·목표 집합 = `TESTER_STATUS_CHANGE_STATUSES = {진행중, 지연}`(넓히지 않음). `지연` 해제는 도출 단계로 복귀 **[결정 F1-3]** | 기존 문구 유지 · 조건부 update 0행: `작업 상태가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.` **[구현 반영]** |
| 시험자 항목 시작·취소·완료, 동시분석 그룹 조작 | 작업 상태 집합 = `ITEM_EDITABLE_JOB_STATUSES = {진행중, 지연, 검토전, 검토중}`. 검토 흔적 있는 항목은 거절 | 작업 단계: 기존 `"{상태}" 단계의 작업은 시험항목을 변경할 수 없습니다.` 유지 · 검토 흔적: `검토가 시작된 시험항목은 변경할 수 없습니다.` |
| 시험자 수행일자 수정(`updateJobDates`) | 허용 작업 상태 = `{진행중, 지연, 검토전, 검토중}`(승인전부터 잠금) | 기존 `"{상태}" 단계의 작업은 수행일자를 변경할 수 없습니다.` 유지 |

- `SELF_EDITABLE_JOB_STATUSES` 는 위 두 상수로 **분리**한다. 한 상수를 넓혀 쓰면 시험자가 `검토중→진행중` 으로 되돌릴 수 있게 된다.
- 관리자 직접 변경으로 `승인전` 이 아닌 단계에서 곧바로 `승인완료` 로 바꾸는 것은 거절한다 **[결정 F1-6]**.
  `승인전 → 승인완료` 직접 변경도 [승인] 과 같이 0048 적용 환경이면 전 항목 검토 완료가 필요하다 **[리뷰 M2]**.
- 지연 해제·관리자 직접 변경의 조건부 update 가 성공하고 결과가 도출 단계(진행중·검토전·검토중·승인전)면, 커밋 뒤
  `recompute_job_stage` 를 한 번 더 불러 잠금 아래에서 수렴시킨다 **[리뷰 M3]**. 결과 단계가 요청과 다르면 응답의 `to`·`message`
  (`요청한 "{요청}" 대신 시험항목 상태에 따라 "{실제}" 단계가 되었습니다.`)로 알린다. 복귀 note 는 도출값이 요청값과 다를 때만 붙인다.
- 직접 변경의 일치 판정은 순수 조회 함수 `derive_job_stage` 로 받아 오고, 판정~쓰기 사이 경합은 조건부 update 로 막는다.
  관리자 전용 경로라 트랜잭션화하지 않는다 **[결정 F1-7]**.

---

## 4. 권한

| 동작 | 관리자 | 시험자(작업 담당자) | 시험자(병렬 동료·타인) |
|---|---|---|---|
| 항목 검토 시작·완료·취소 | 허용 | 거절 | 거절 |
| 재실시 | 허용(사유) | 거절 | 거절 |
| 일괄 검토 버튼 | 허용 | 거절 | 거절 |
| 승인(승인전→승인완료) | 허용 | 거절 | 거절 |
| 작업 상태 직접 변경 | 허용(§3.4 일치 조건) | 거절 | 거절 |
| 항목 시험 조작 | 자기 작업만, 시험자와 같은 규칙 | 자기 작업, `ITEM_EDITABLE_JOB_STATUSES` | 거절 |
| 항목 검토 상태 열람 | 허용 | 허용(읽기 전용) | 기존 작업 열람 규칙(`canViewJob`)을 따름 |

- **수행자 본인 검토 금지는 v1 에서 강제하지 않는다.** 검토자 id·이름은 반드시 기록한다.
- 권한 주체는 로그인 토큰의 사용자 id 다. 서버가 토큰에서 꺼내 `p_user_id`·`p_actor` 로 넘긴다.

### 4.1 함수 실행 권한 — service_role 만

| 함수 | `public`·`anon`·`authenticated` | `service_role` |
|---|---|---|
| `derive_job_stage(uuid)` **[결정 F1-7]** | revoke | grant execute |
| `recompute_job_stage(uuid, uuid, text)` | revoke | grant execute |
| `apply_item_review_step(uuid, text, uuid, text, text)` (내부용) **[구현 반영]** | revoke | grant execute |
| `item_review_action(uuid, uuid, text, text)` | revoke | grant execute |
| `item_review_bulk_action(uuid, uuid, text)` **[결정 F1-4]** | revoke | grant execute |
| `cancel_job_start(uuid, uuid, text)` (0047 재정의, 조건 7 추가) **[리뷰 B1]** | revoke(재적용) | grant execute(재적용) |

- `apply_item_review_step` 은 단건·일괄 함수가 같은 조건 5 검사·항목 갱신·검토 이력을 쓰도록 뽑은 내부 함수다(규칙 두 벌 금지).
  호출자가 작업·항목 행을 이미 잠갔다고 가정한다. 서버 코드는 직접 부르지 않는다.

---

## 5. 처리 순서와 경합

### 5.1 RPC 시그니처

| 함수 | 시그니처 | 반환(jsonb) |
|---|---|---|
| 단계 도출(순수 조회) **[결정 F1-7]** | `derive_job_stage(p_job_id uuid) returns text` | 도출 단계. 없는 작업이면 null |
| 단계 재도출 | `recompute_job_stage(p_job_id uuid, p_actor uuid, p_note text) returns jsonb` | `jobId`·`orderId`·`qcNo`·`from`·`to`·`changed`(boolean) + 바뀐 경우 `note`(상태 이력에 적은 문구 — 서비스가 슬랙·앱 알림에 그대로 쓴다 **[구현 반영]**) |
| 항목 검토 동작 [브리프 준용: 이름·인자] | `item_review_action(p_item_id uuid, p_user_id uuid, p_action text, p_reason text) returns jsonb` | `itemId`·`testItemName`·`action`·`reviewStatusBefore`·`reviewStatusAfter`·`jobId`·`stage`(재도출 반환값) |
| 일괄 검토 **[결정 F1-4]** | `item_review_bulk_action(p_job_id uuid, p_user_id uuid, p_action text) returns jsonb` | `jobId`·`action`·`count`·`items[]`(항목별 위 5필드)·`stage` |

HTTP 라우트 **[구현 반영]**
| 라우트 | 권한 | 서비스 |
|---|---|---|
| `POST /api/qc-jobs/[id]/items/[itemId]/review` `{ action, reason? }` | `requireAdmin` | `reviewJobItem`(`backend/services/qcJobItemReview.ts`) |
| `POST /api/qc-jobs/[id]/review-bulk` `{ action }` | `requireAdmin` | `bulkReviewJobItems` |

- 서비스는 **사유 검사 → rpc → 오류 번역 → (커밋 뒤) 오더 동기화·슬랙·앱 알림**만 한다.
  함수가 없으면(`PGRST202`/`42883`) §3.2 설치 문구로 거절하고 **여러 호출로 나눈 비원자 폴백을 하지 않는다**.

### 5.2 `item_review_action` — 함수 한 트랜잭션

| 단계 | 동작 | 실패 시 |
|---|---|---|
| ① | 사유·동작 값·관리자 확인(조건 0·1·2) | 거절, 롤백 |
| ② | 항목을 잠금 없이 읽어 `qc_job_id` 확보(없으면 조건 3) | 거절 |
| ③ | 작업 행 잠금 `qc_jobs … for update` → 조건 4 | 거절, 롤백 |
| ④ | 항목 행 잠금 `qc_job_items … for update` → `qc_job_id` 가 ②와 같은지(조건 3') → 조건 5 | 거절, 롤백 |
| ⑤ | 항목 갱신(§3.1) | DB 오류, 롤백 |
| ⑥ | 검토 이력 1행 insert(§6.1) | DB 오류, 롤백 |
| ⑦ | `recompute_job_stage(작업, p_user_id, note)` — 단계가 바뀌면 상태 이력도 이 안에서 insert | DB 오류, 롤백 |
| ⑧ | 결과 반환 | — |
| (커밋 뒤) | `stage.changed` 이면 `syncOrderStatusFromJobs` → 슬랙 → 앱 알림(§7) | 검토는 유지. 알림 실패는 서버 로그 |

### 5.3 `recompute_job_stage` — 호출자 트랜잭션 안에서 실행

| 단계 | 동작 |
|---|---|
| ① | 작업 행 `for update`(호출자가 이미 잠갔으면 같은 트랜잭션이라 그대로 통과). 없으면 `작업을 찾을 수 없습니다.` |
| ② | 현재 상태가 `승인완료`·`지연` 이면 `changed=false` 로 반환 |
| ③ | 그 작업의 항목 행 전부 `for update` → N·C·S·V 계산 → §2.1 도출 |
| ④ | 다르면 `qc_jobs.status` 갱신 + `qc_job_status_history` insert(source `auto`) |
| ⑤ | 반환 |

- `pct_orders` 는 이 함수가 쓰지 않는다(§2.3).

### 5.4 잠금 순서와 동시 요청

**잠금 순서: `qc_jobs` → `qc_job_items`**(0047 과 같은 방향). F2 의 `reassign_job_item` 은 `qc_jobs`(id 오름차순) → `pct_orders` → `pct_order_test_items` → `qc_job_items` 로, 작업을 먼저 잡는 방향이 같다.

| 경합 | 결과 |
|---|---|
| 같은 항목에 두 관리자가 [검토 시작] | 둘째는 ③에서 대기 후 조건 5b 로 거절. 이력 중복 없음 |
| 시험자 항목 완료 ↔ 관리자가 다른 항목 검토 시작 | 항목 완료 update 는 단일 문장이라 바로 커밋된다. 재도출은 두 쪽 모두 작업 잠금 아래에서 최신 항목을 읽으므로 나중에 끝난 쪽이 최종 단계를 맞춘다 |
| 검토 동작 ↔ 작업 시작 취소(0047) | 둘 다 작업 행을 먼저 잠근다 → 직렬화. 검토는 `cleared` 가 전제라 시작 취소 조건(전 항목 흔적 0)과 동시에 성립하지 않는다 |
| 재실시 뒤 작업 시작 취소 **[리뷰 B1]** | 재실시가 흔적을 비워 0047 조건 3을 통과하므로, 0048 이 `cancel_job_start` 를 재정의해 항목 잠금 뒤 조건 7을 더한다: 그 작업의 검토 이력이 1건이라도 있거나 상태 이력에 작업 시작 외 전이가 있으면 `검토·재실시 이력이 있는 작업은 시작을 취소할 수 없습니다. 관리자에게 문의하세요.` 판정 순서 0 → 1a → 1b → 2 → 5 → 4 → 3 → 7 (0047 spec §2) |
| 검토 동작 ↔ F2 항목 이동 | 작업 행 잠금으로 직렬화. 이동이 먼저 커밋되면 조건 3' 로 거절 |
| 재실시 ↔ 시험자가 같은 항목을 시작 | 재실시 커밋 전에는 항목이 `cleared` 라 시험자 시작이 거절됨. 커밋 뒤에는 정상 시작 |

---

## 6. 감사 기록

### 6.1 `qc_job_item_review_history` — 항목 동작마다 1행

| 동작 | `action` | from → to | `reason` | `snapshot` |
|---|---|---|---|---|
| 검토 시작 | `review_start` | `none` → `reviewing` | null | null |
| 검토 완료 | `review_complete` | `reviewing` → `reviewed` | null | null |
| 검토 취소 | `review_cancel` | `reviewing` → `none` | 사용자 사유 | 취소 직전 `review_started_at/by/by_name` |
| 재실시 | `reopen` | (직전 값) → `none` | 사용자 사유 | 직전 `status`·`started_at`·`cleared_at`·`elapsed_minutes`·`elapsed_total_minutes`·`review_status`·`review_started_at/by/by_name`·`reviewed_at/by/by_name` |
| 백필 | `backfill` | `none` → `reviewing`/`reviewed` | §10 고정 문구 | null |

- `changed_by` = 요청 관리자, `changed_by_name` = `users.display_name ?? username` 스냅샷. `qc_job_id`·`order_id` = 기록 당시 값.
- 항목 갱신과 같은 트랜잭션이다. 기록이 실패하면 동작도 없다.

### 6.2 `qc_job_status_history` — 단계가 실제로 바뀐 경우만

| 컬럼 | 값 |
|---|---|
| `from_status`·`to_status` | 도출 전·후 |
| `changed_by`·`changed_by_name` | 계기가 된 사용자(`p_actor`)와 이름 스냅샷 |
| `source` | `auto` |
| `note` | `시험항목 "{항목명}" {동작}(으)로 서버가 자동 전환했습니다.` — 동작 = §2.2 표의 이름 [브리프 준용: 예문 형식]. 일괄 버튼은 `시험항목 {n}개 {동작}(으)로 서버가 자동 전환했습니다.` 조사는 받침에 맞춰 고정 문구로 쓴다: `검토 시작으로`·`검토 완료로`·`검토 취소로`·`재실시로`·`완료로` **[구현 반영]**. note 가 비면 `시험항목 상태에 따라 서버가 자동 전환했습니다.` |

- 도출 경로의 상태 이력은 트랜잭션 안에서 쓴다(기존 TS best effort 기록 함수를 이 경로에서 쓰지 않는다).

---

## 7. 알림

| 조건 | 슬랙 | 앱 알림 |
|---|---|---|
| 항목 검토 시작·완료·취소·재실시(단계 불변) | 보내지 않음 | 보내지 않음 |
| 도출로 작업 단계가 바뀜(아래 `검토전` 제외) | 기존 `notifyStageChangeToSlack`(source `auto`, note 포함), fire-and-forget | 1건: type `status_changed`, severity 앞으로 가는 전이 `info` / 뒤로 가는 전이 `warning`, title `작업 단계 자동 변경`, body `QC {QC번호} 작업이 "{from}" → "{to}" 단계로 자동 변경되었습니다. ({note})` |
| 도출 결과가 `검토전` | 위와 같음 | 기존 문구 유지: title `검토 대기`, body `모든 시험항목이 완료되어 작업 상태가 "검토전" 으로 자동 변경되었습니다.` |
| 관리자 [승인]·직접 변경 | 기존 그대로 | 기존 그대로 |
| 시험자 항목 완료(`item_cleared`) | 기존 그대로 | 기존 그대로 |

- 알림은 커밋 뒤 TS 에서 보낸다. 실패해도 검토·단계는 되돌리지 않는다.
- `작업 단계 자동 변경` 문구와 severity 구분은 결정·브리프에 문구가 없어 기존 알림 톤으로 새로 정했다.

---

## 8. 화면

| 화면 | 동작 |
|---|---|
| 관리자 작업 패널(`/product-test/prod-status` 오른쪽 패널) · `/test-mgmt/test-status` 상세 서랍의 항목 행 | 검토 배지: `cleared`+`none` = `검토 대기` [브리프 준용] · `reviewing` = `검토 중` · `reviewed` = `검토 완료`. `pending`·`in_progress` 는 기존 시험 배지만. 검토자 이름·시각 표시 |
| 같은 항목 행의 액션(관리자) | [검토 시작](cleared+none) · [검토 완료](reviewing) · [검토 취소](reviewing, 사유 모달) · [재실시](cleared, 사유 모달). 작업이 `승인완료` 면 전부 숨김 |
| 패널 상단(관리자) | `완료 항목 전체 검토 시작`·`검토 중 항목 전체 검토 완료`(각각 대상 1건 이상일 때). "검토 대기 N건" 요약 |
| 상태 컨트롤 | 작업 단위 [검토 시작]·[검토 완료] 제거. `승인전` 에서만 [승인]. 안내문 교체: `시험항목 검토를 시작하면 작업이 검토중으로, 모든 시험항목 검토가 끝나면 승인전으로 서버가 자동 전환합니다.` [직접 변경] 거절 시 서버 메시지 표시 |
| 단계 막대 | 도출된 `qc_jobs.status` 를 그대로 표시(기존 `JobStageTrack` 이 이미 서버 값을 그리므로 변경 없음) |
| 공통 부품 **[구현 반영]** | `frontend/components/common/job-item-review.tsx`(`ItemReviewBadge`·`ItemReviewActions`·`BulkReviewBar`)를 두 관리자 화면이 함께 쓴다. 검토 배지 옆에 검토자·시각(백필 항목은 `검토자 기록 없음(도입 전)`) |
| 0048 미적용 안내 **[구현 반영]** | 작업 상세·할 일 응답의 `reviewSetupError` 가 있으면 화면 위에 안내 문구를 띄운다(§9) |
| 진행 항목 강조·현재 항목 계산 | `진행중·지연` 에서만 하던 것을 `ITEM_EDITABLE_JOB_STATUSES` 로 |
| 시험자 `/my-tasks` | 자기 항목 행에 검토 배지(읽기 전용). 항목 버튼은 작업이 `승인전`·`승인완료` 이거나 항목에 검토 흔적이 있으면 숨김. 동시분석 그룹 카드 묶기 기준을 `ITEM_EDITABLE_JOB_STATUSES` 로. 항목 완료 뒤 안내 flash 는 응답의 전환 결과로 |
| 재실시 모달 | 사유 입력(2자 이상일 때 확인 버튼 활성). 본문: `이 시험항목의 시작·완료 시각, 소요시간, 검토 기록이 비워지고 대기로 돌아갑니다. 원래 기록은 이력에 남습니다.` |
| 검토 완료 확인 모달 **[리뷰 M1]** | 단건 [검토 완료]·일괄 [검토 중 항목 전체 검토 완료] 모두 확인 모달. 본문: `검토 완료는 되돌릴 수 없습니다. 바꾸려면 재실시해야 하며, 재실시는 시험 기록을 초기화합니다.` + 대상 항목 수·이름 목록 |
| 0048 미적용 **[리뷰 경미 8]** | `reviewSetupError` 가 있으면 항목 검토 액션·일괄 버튼을 숨긴다 |
| 검토 취소 모달 | 사유 입력(2자 이상일 때 확인 버튼 활성). 본문: `이 시험항목의 검토 시작 기록이 비워지고 검토 대기로 돌아갑니다. 원래 기록은 이력에 남습니다.` |

- 디자인 규칙: `rounded-md`, `bg-primary`/`blue-*`, `text-xs` 이상, 수정은 모달.
- 항목 완료 API 응답의 `statusChangedTo` 는 "도출로 바뀐 단계(바뀐 경우)" 를 뜻하도록 계약·주석을 갱신한다. `allCleared` 는 유지.
- KPI(시험현황·대시보드)는 작업 단계 값을 그대로 쓴다 — 분류 규칙을 추가하지 않는다.

---

## 9. 배포

- 마이그레이션 **`0048_item_review.sql`**. 0045 헤더 형식, **Supabase 대시보드 > SQL Editor 수동 적용**, idempotent, `supabase db push` 금지, 끝에 `notify pgrst, 'reload schema';`.
  본문은 `begin; … commit;` 한 트랜잭션이다(부분 적용 방지) **[리뷰 경미 13]**.
- ⚠️ **0048 은 앱 배포 직전에 적용하고, 배포 후에는 다시 실행하지 않는다** **[리뷰 M2]**. 적용~배포 사이에 구 앱이 작업 단위
  [검토 시작]·[검토 완료] 로 넘긴 작업을, 재실행 백필이 "도입(0048) 이전 작업 단위 검토" 로 오기록하기 때문이다.
  그런 작업은 새 앱에서 [승인] 이 전 항목 검토 완료를 요구하므로 검토 기록 없이 승인되지는 않는다.
- 파일 안 순서: ① 컬럼 → ② 제약 → ③ 이력 테이블·인덱스·RLS → ④ 백필(§10) → ⑤ `recompute_job_stage` → ⑥ `item_review_action` → ⑦ 실행 권한 → ⑧ notify.
- **전체 적용 순서**: SQL `0048`(이 기능) → `0049`(병렬 배정) → `0050`(항목 담당자 변경) → 앱 배포 → `0049` 이관 문장 재실행.
  `main` push 가 곧 운영 배포이므로 세 기능 통합이 끝나기 전에는 `main` 에 올리지 않는다.
- 미적용 환경
  - 검토 동작: §3.2 설치 문구로 거절, 비원자 폴백 금지.
  - 새 컬럼·테이블을 읽는 조회(작업 상세·할 일): 기존 `describeSchemaError(err, '시험항목 검토', '0048_item_review.sql')` 로 만든
    `시험항목 검토 기능이 아직 DB에 반영되지 않았습니다. Supabase SQL Editor 에서 supabase/migrations/0048_item_review.sql 을 실행해 주세요. (원인: …)` 를
    응답의 `reviewSetupError` 로 싣고, 항목은 검토 컬럼 없이 다시 읽어 `reviewStatus='none'` 으로 내려준다 — 조회 전체가 죽지 않게 **[구현 반영]**.
    (예전 코드는 항목 조회 오류를 버려 목록이 안내 없이 비었다.) 작업 현황 집계(`listWorkerOverview`)는 검토 컬럼을 읽지 않아 영향이 없다.
  - 시험자 항목 조작은 조작 전에 항목 검토 상태를 읽으므로, 미적용이면 **쓰기 전에** 위 안내로 거절된다.

---

## 10. 백필 (0048 안, 재실행 안전)

| 작업 상태(적용 시점) | `cleared` 항목 | 미완료 항목 |
|---|---|---|
| `승인전`·`승인완료` | `reviewed`, 검토자·시각 **null** | `none` 유지 + 건수 `raise notice` [브리프 준용] |
| `검토중` | `reviewing`, 검토자·시각 **null** | `none` 유지 + 건수 `raise notice` [브리프 준용] |
| `검토전`·`진행중`·`지연` | `none` | `none` |

- 대상 조건: `review_status = 'none'` AND 그 항목의 `action='backfill'` 이력이 없음 AND **그 작업에 검토 이력이 한 건도 없음** → 두 번 실행해도 한 번만 반영.
  작업 단위 조건은 **[구현 반영]**: 도입 뒤에는 `검토중` 작업에 검토 대기(cleared+none) 항목이 정상적으로 있으므로, 이 조건이 없으면
  배포 뒤 재실행이 그 항목을 검토 중으로 지어낸다.
- 백필한 항목마다 이력 1행: `action='backfill'`, `changed_by` null, `reason` =
  - reviewed: `항목 단위 검토 도입(0048) 이전 — 작업 단위로 검토 완료됨, 검토자·시각 알 수 없음`
  - reviewing: `항목 단위 검토 도입(0048) 이전 — 작업 단위 검토 중이었음, 검토자·시각 알 수 없음`
- 백필은 `qc_jobs.status` 를 바꾸지 않고, 상태 이력·알림을 만들지 않는다.
- 파일 머리 주석에 **적용 전 건수 확인 SELECT** 를 둔다: 작업 상태 × 항목 `status` 별 건수, `승인전·승인완료·검토중` 작업 중 미완료 항목이 있는 작업 수.

---

## 11. 범위 밖

- 오더 상태를 항목 합집합으로 도출하는 규칙(오더 수준 "하나라도 검토중이면 검토중").
- 수행자 본인 검토 금지 가드.
- 항목 검토별 슬랙·앱 알림.
- 시도 차수(attempt) 행, 일탈(OOS/CAPA) 연동.
- `지연` 을 단계 컬럼에서 분리하는 일.
- 항목 시작·완료 API 를 RPC 로 옮기는 일.
- 검토 전용 역할 신설(역할은 admin·tester 둘 그대로).
- 전 항목 검토 완료 시 승인까지 자동 처리.

---

## 12. 결정 (옛 「확인 필요」 → 감독 보강 결정 F1-1~F1-7)

`temp/decisions-f1-f2-f3.md` 「보강 결정」이 이 절의 단일 기준이다. 본문 해당 자리에 **[결정 F1-n]** 으로 반영했다.

| # | 옛 질문 | 결정 |
|---|---|---|
| F1-1 | 검토 이력의 삭제 시 동작(작업 시작 취소·F2 항목 행 삭제 때 재실시 스냅샷이 사라지는가) | `qc_job_item_id`·`qc_job_id` 는 **`on delete set null`**(nullable). `order_id`(not null, FK pct_orders cascade)·`test_item_name`·`qc_no` 스냅샷 컬럼을 둔다. 작업 시작 취소·F2 행 삭제가 일어나도 이력은 남는다(§1.2). |
| F1-2 | `reviewed` 를 되돌리는 "검토 완료 취소" 허용 여부 | **없다.** `review_cancel` 은 `reviewing → none` 만. 검토 완료를 되돌리려면 **재실시**만 쓴다(§3.1, §3.2-5e). |
| F1-3 | 지연 해제 때 항목 상태와 단계가 어긋나는 경우 | 작업이 `지연` 에서 벗어날 때(관리자 직접 변경·시험자 상태 변경 모두) 서버는 **요청값 대신 도출 단계로 되돌리고** 이력 note 에 "항목 상태에 따라 '{단계}' 로 복귀" 를 남긴다(§2.4-l·m, §3.4). |
| F1-4 | 일괄 검토의 트랜잭션 단위·일부 실패 문구 | **RPC 한 번 = 한 트랜잭션, 전부 성공 아니면 전부 실패.** 대상 0건이면 `처리할 시험항목이 없습니다.`(§3.3) |
| F1-5 | 시험자 항목 완료와 단계 재도출을 한 트랜잭션으로 묶을지 | 묶지 않는다. 항목 완료는 기존 TS 경로를 유지하고 커밋 뒤 `recompute_job_stage` RPC 를 호출한다. 함수가 호출마다 잠금 아래에서 현재 항목을 다시 읽어 수렴한다(§2.2). |
| F1-6 | `승인전` 이 아닌 단계에서 곧바로 `승인완료` 로 직접 변경 | `승인완료` 로의 직접 변경은 **`승인전` 에서만**. 되돌림은 `승인완료 → 승인전` 만(사유 필수). 그 외는 `승인완료는 승인전 단계에서만 변경할 수 있습니다.` 로 거절(§3.4). |
| F1-7 | 직접 변경 일치 판정을 DB 규칙 하나로 하는 방법·경합 | 순수 조회 SQL 함수 `derive_job_stage(p_job_id)` 로 도출값을 받아 요청값과 비교한 뒤 `.eq('status', 현재값)` 조건부 update. 0행이면 `작업 상태가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.` 트랜잭션화하지 않는다(§3.4, §5.1). |

### 12.1 구현 중 spec 과 달라진 점 (2026-09-15)

| 무엇 | 달라진 점 | 이유 |
|---|---|---|
| 조건 5 검사·항목 갱신·이력 | 내부 함수 `apply_item_review_step` 으로 뽑아 단건·일괄이 함께 쓴다 | 두 함수에 같은 전제 검사·스냅샷 규칙을 두 벌 쓰지 않기 위해 |
| `recompute_job_stage` 반환 | 바뀐 경우 `note` 를 함께 돌려준다 | 커밋 뒤 슬랙·앱 알림 문구를 상태 이력 문구와 똑같이 쓰려고(조사 처리 규칙을 TS 에 다시 쓰지 않음) |
| 백필 재실행 조건 | "그 작업에 검토 이력이 없을 때만" 을 더했다 | 배포 뒤 재실행이 정상적인 검토 대기 항목을 검토 중으로 지어내지 않게(§10) |
| 설치 오류 코드 | `PGRST202`/`42883` 외에 `42703`/`42P01`/`PGRST204`/`PGRST205` 도 설치 안내로 번역 | 함수는 있어도 컬럼·테이블이 없는 부분 적용, 조회 경로의 컬럼 없음 오류도 같은 원인이라서 |
| 미적용 조회 | 조회 오류로 던지지 않고 검토 컬럼 없이 다시 읽어 `reviewSetupError` 로 안내 | 결정 공통 "조회 전체가 죽지 않게". 쓰기(검토 동작·시험자 항목 조작)는 여전히 거절한다 |
| 라우트 | `review-history` 조회 라우트는 만들지 않았다. 일괄은 `POST /api/qc-jobs/[id]/review-bulk` | 이번 화면이 이력 목록을 보여 주지 않는다. 필요해지면 `qc_job_item_review_history` 조회를 추가한다 |
| 담당자·관리자 상태 변경 0행 문구 | `다른 사용자가 먼저 상태를 변경했습니다…` → `작업 상태가 바뀌었습니다. 새로고침 후 다시 확인해 주세요.` | F1-7 결정 문구로 통일 |
| 단계 도출 TS 헬퍼 | `qcJobs.ts` 에 `recomputeJobStage`·`deriveJobStage`·`notifyStageRecomputed` 를 두었다(부록 A 의 신규 서비스는 검토 동작 전용) | `syncOrderStatusFromJobs` 와 같은 파일이어야 순환 import 없이 커밋 뒤 오더 동기화를 부를 수 있다 |
| `listWorkerOverview` 검토 집계·`worker-stage-lane` 막대 | 바꾸지 않았다(주석만 정정) | 화면 미표시 필드이고 이번 범위의 필수 화면이 아니다 |

---

## 부록 A. 구현 대상 파일 목록

> 브리프 `temp/brief-f1-review.md` §4.7 에서 옮겼다. **라인 번호는 2026-09-15 `main`(15c574b) 작업 트리 기준이며 바뀔 수 있다.**
> 결정과 달라진 곳은 괄호로 표시했다.

| 파일 | 이유 |
|---|---|
| `supabase/migrations/0048_item_review.sql` (신규) | 검토 컬럼·CHECK·이력 테이블·백필·`recompute_job_stage`·`item_review_action` (브리프 파일명 `0048_qc_job_item_review.sql` 대신 결정 파일명) |
| `types/qc-status.ts` | 흐름 주석(`:8`), 항목 검토 상수·라벨, `STAGE_ACTION_LABEL`(`:86-92`, 검토전·검토중 = null), `SELF_EDITABLE_JOB_STATUSES`(`:115-117`) → `ITEM_EDITABLE_JOB_STATUSES`/`TESTER_STATUS_CHANGE_STATUSES` 분리 (브리프의 TS 도출 함수 `deriveJobStage` 는 만들지 않는다 — 규칙 두 벌 금지) |
| `backend/services/qcJobs.ts` | `autoAdvanceToReview`(`:1148-1193`) → rpc 호출, `loadItemForEdit`(`:1278-1293`)·`myJobsInGroup`(`:1578-1581`)·`updateJobDates`(`:1038`)·`changeJobStatus`(`:1412,1424`) 상수 교체, `advanceJobStage`(`:1204-1271`) 승인만, `setJobStatusByAdmin`(`:1470-1525`) 일치 검사, `getJobDetail`(`:476-478`) 가드 완화 + 검토 필드, `listWorkerOverview`(`:693-694`) 검토 집계, `GroupItemResult.advanced`(`:1556-1563`) 의미 |
| `backend/services/qcJobItemReview.ts` (신규) | 항목 검토 rpc 호출·오류 번역·커밋 뒤 오더 동기화·슬랙·알림·이력 조회 |
| `backend/services/qcJobStatusHistory.ts` | 주석 오기(0032→0035, `:70`) 정정, note 규칙 |
| `app/api/qc-jobs/[id]/items/[itemId]/review/route.ts` (신규) | `POST {action, reason?}`, `requireAdmin`, thin |
| `app/api/qc-jobs/[id]/items/[itemId]/review-history/route.ts` (신규, 또는 상세 응답에 포함) | 항목 검토 이력 조회 |
| `app/api/qc-jobs/[id]/items/route.ts` | 응답 `statusChangedTo` 의미·주석(`:6,10,39`) |
| `app/api/qc-jobs/[id]/stage/route.ts` | 승인만 남은 전이(`:1-7,17`) |
| `app/api/qc-jobs/group/[groupId]/items/route.ts` | `advanced` 계약 주석 |
| `frontend/components/product-test/job-detail-modal.tsx` | 항목 행 검토 배지·액션(`:288-342`), 요약, 낡은 주석(`:13-14`)·문구(`:246-261`) |
| `frontend/components/common/job-status-control.tsx` | 검토 버튼 제거(`:114-123,148-167`), 안내문(`:126-127`), 직접 변경 오류 표시(`:169-203`) |
| `frontend/components/common/job-stage-track.tsx` | 도출 단계 표시(`:19-46`, 선택) |
| `frontend/components/product-test/worker-stage-lane.tsx` | 카드 항목 검토 집계(`:58-63,294-306`) |
| `frontend/components/test-mgmt/test-detail-drawer.tsx` | `testing` 가드(`:117,240`), 검토 배지, 상태 컨트롤 사용처(`:193-195`) |
| `app/(menu)/my-tasks/page.tsx` | 그룹 묶기(`:594-610`)·버튼 노출(`:1055,1250`)·flash 문구(`:533-535,561`)·검토 배지·주석(`:83-86,1152-1154`)·일괄 선택 적용(`:627-636,886-900`) 서버 거절 확인 |
| `backend/services/tests.ts`(`:44-54`) · `backend/services/qcDashboard.ts`(`:110`) | KPI 는 단계 값 그대로(결정 Q6) — 동작 변경 없음, 주석만 확인 |
| `backend/services/slackNotify.ts` | 도출 전이 note 표시(`:84-86`) |
| `backend/services/chat.ts` | 항목 컨텍스트 검토 라벨(`:446-454`, 선택) |
| `types/qc.ts` | StatusKey 문서 주석(`:11-15`) |
| `docs/PRD-current-system.md`·`docs/WORKFLOW-current-system.md`·`.claude/commands/qc-schedule-process.md` | as-built 갱신(완료 커밋에서) |

영향 없음으로 확인해 수정하지 않는 파일(브리프 §2.4): `testItemStats.ts`, `concurrentSavings.ts`, `operationReport.ts`, `testerEvaluation.ts`, `pctAssign.ts`(F1 기준), `monthlySchedule.ts`, `pctIngest.ts`, `home/page.tsx`, `instrumentation.ts`, `0047_cancel_job_start.sql`.
