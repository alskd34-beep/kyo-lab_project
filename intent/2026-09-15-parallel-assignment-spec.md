# Spec: 병렬 배정(최대 5인) — 담당자 구성·배정 규칙
Author: kyo (개발) · Status: approved
관련 intent: [2026-09-15-parallel-assignment.md](./2026-09-15-parallel-assignment.md)
근거: 감독 결정 `temp/decisions-f1-f2-f3.md`(F3·공통 — **단일 기준**) · 탐색 브리프 `temp/brief-f3-parallel-assign.md`

이 문서는 병렬 배정의 **담당자 구성이 어떻게 저장되고, 언제 바꿀 수 있으며, 무엇이 기록되는가**를 못박는다.
최종 판정은 DB 함수 `set_order_assignees`(마이그레이션 0049)가 하며, 화면의 버튼 활성은 같은 규칙의 보조 판정일 뿐이다.

표기
- 무표시 = 결정 문서에 있는 규칙.
- **[브리프 준용]** = 결정 문서가 정하지 않았고, 브리프 권고가 결정과 충돌하지 않아 그대로 옮긴 세부.
- **[현행 유지]** = 지금 코드의 규칙·문구를 그대로 이어 쓰는 것.
- **확인 필요** = 결정 문서·브리프로 정할 수 없어 구현 전에 확인이 필요한 세부(§12 에 모음). 구현자는 임의로 정하지 않는다.

이 기능의 담당자 테이블은 [진행 중 시험항목 담당자 변경 spec](./2026-09-15-in-progress-item-reassign-spec.md) 의 "같은 그룹" 판정 기준이다.

---

## 1. 데이터 모델

### 1.1 신규 `pct_order_assignees`

| 컬럼 | 타입·제약 |
|---|---|
| `order_id` | `uuid not null references pct_orders(id) on delete cascade` |
| `slot` | `smallint not null` |
| `tester_id` | `uuid not null references testers(id) on delete restrict` |
| `assigned_at` | `timestamptz not null default now()` [브리프 준용] |
| `assigned_by` | `uuid references users(id) on delete set null` [브리프 준용] |

| 제약·인덱스 | 정의 |
|---|---|
| PK | `primary key (order_id, slot)` |
| `chk_pct_order_assignees_slot` | `check (slot between 1 and 5)` — 주석: `types/` 의 `MAX_PARALLEL_ASSIGNEES = 5` 와 같은 값 |
| `uq_pct_order_assignees_tester` [브리프 준용: 이름] | `unique (order_id, tester_id)` — 같은 사람 두 슬롯 금지 |
| `idx_pct_order_assignees_tester` [브리프 준용] | `(tester_id)` — "내 오더" 조회 |
| RLS | `enable` + `force`, **정책 없음**(0033·0041 원칙 — service_role 만) |
| 테이블 주석 | `오더별 담당자 슬롯(1~5). 슬롯 1=대표이며 pct_orders.assignee_tester_id 에 미러된다. 행 2개 이상=병렬 배정.` |

### 1.2 기존 테이블 변경

| 대상 | 변경 |
|---|---|
| `pct_order_test_items.assignee_slot` 제약 `chk_pct_order_test_items_slot` | `in (1, 2)` → `between 1 and 5` (`drop constraint if exists` 뒤 `add`) |
| `pct_orders.assignee_tester_id` | 구조 변경 없음. **슬롯 1 미러로 영구 유지** |
| `pct_orders.is_dual_assignment`·`assignee_tester_id_2`, 0037/0038 제약·인덱스 | 구조 변경 없음. 이번 릴리스 동안 **이중 기록**(§2.3). 드롭하지 않는다 |
| `qc_jobs` | 변경 없음(`(order_id, assignee_tester_id)` 부분 유니크가 이미 사람당 작업 1건을 보장) |

### 1.3 공유 상수

- `MAX_PARALLEL_ASSIGNEES = 5`, 슬롯 타입(1~5), 담당자 번호 라벨 함수를 `types/` 아래 공유 파일에 둔다(브리프 예: `types/assignment.ts`). 서버·화면이 같은 값을 쓴다.
- SQL 의 숫자 `5` 옆 주석에 이 상수 이름을 적는다.

---

## 2. 파생·미러 규칙

### 2.1 파생 값

| 값 | 정의 |
|---|---|
| 병렬 여부(`isParallel`) | 그 오더의 `pct_order_assignees` 행 수 **≥ 2**. 플래그 컬럼을 새로 두지 않는다 |
| 대표 담당자 | `slot = 1` 행의 `tester_id` |
| 미배정 | 행 0개(= `assignee_tester_id is null`) |
| 같은 그룹(F2) | 그 오더의 행 전체 |

### 2.2 슬롯 번호

- **구멍 허용** — 사람을 빼도 번호를 당기지 않는다. 담당자 1·3·4 처럼 보일 수 있다.
- 추가 시 **비어 있는 가장 작은 번호**(2~5)를 준다.
- 1인 배정 오더도 담당자가 있으면 슬롯 1 행 1개를 가진다.

### 2.3 미러·구 컬럼 이중 기록 (담당자 구성이 바뀌는 모든 쓰기에서 같은 트랜잭션·한 UPDATE 문)

| `pct_orders` 컬럼 | 값 |
|---|---|
| `assignee_tester_id` | 슬롯 1 의 `tester_id`, 행이 없으면 null |
| `assignee_tester_id_2` | **슬롯 2** 의 `tester_id`, 슬롯 2 행이 없으면 null |
| `is_dual_assignment` | 행 수 ≥ 2 |

- 0038 제약(`is_dual_assignment or assignee_tester_id_2 is null`) 때문에 세 컬럼을 **한 UPDATE 문**으로 쓴다.
- 한계: 슬롯 2 가 비고 3 이 차 있으면 `is_dual_assignment=true`·`assignee_tester_id_2=null` 이 된다. 롤백한 구 코드에서는 "담당자2 없는 2인 배정" 으로 보인다(DB 제약 위반은 아님). 슬롯 3~5 는 구 코드에서 보이지 않는다.
- **새 코드의 읽기는 전부 새 테이블**에서 한다. 구 두 컬럼은 쓰기만 한다.

---

## 3. 담당자 구성 변경 규칙

### 3.1 동작별 허용 조건

| 동작 | 오더에 작업 0건 | 오더에 작업 ≥ 1건 |
|---|---|---|
| 슬롯 추가(5명 이하) | 허용 | **허용** — 새 슬롯은 시험항목 0개로 시작(항목은 F2 로 넘겨받는다) |
| 슬롯 삭제(슬롯 2~5) | 허용 — 그 슬롯의 항목(제외 항목 포함)은 슬롯 1 로 되돌림 [브리프 준용] | 그 슬롯 담당자의 작업이 **없고** 그 슬롯의 활성(제외 아님) 항목이 **0개**일 때만 허용. 남은 제외 항목은 슬롯 1 로 |
| 슬롯 1(대표) 삭제 | 불가 — 교체만 | 불가 — 교체만 |
| 미시작 슬롯의 사람 교체 | 허용 [현행 유지] | 허용 [현행 유지] |
| 시작한 슬롯의 사람 교체·해제 | — | 금지 [현행 유지] |
| 병렬 해제(1명으로) | 슬롯 2~5 전부 삭제 = 위 삭제 규칙을 각각 적용 | 같음 |
| 시험항목 배분 일괄 이동(기존 슬롯 배분 API) | 허용 | **금지** — 진행 중 이동은 F2 경로로만 |
| LOCK 오더의 구성 변경 | 금지 [현행 유지] | 금지 [현행 유지] |

- "작업이 있다" = `qc_jobs` 에 `(order_id, assignee_tester_id = 그 슬롯 tester)` 행이 있음.
- 구성 변경은 오더 상태를 바꾸지 않는다. 오더 상태 상한은 "활성 항목 ≥ 1 인 미시작 담당자" 에만 걸리는데, 추가 슬롯·삭제 가능한 슬롯은 활성 항목이 0개이고, 미시작 슬롯 교체는 미시작 여부를 바꾸지 않기 때문이다(작업 0건 오더는 `대기` 그대로).

### 3.2 `set_order_assignees` 입력 해석

- `p_tester_ids[1]` = 슬롯 1(대표) [브리프 준용].
- 나머지 원소가 **어느 슬롯**에 해당하는지(기존 사람은 기존 번호 유지·새 사람은 빈 번호 중 최소 / 배열 위치 = 번호 등)는 **확인 필요**(§12-1).
  - 배열 위치 = 번호로 읽으면 구멍(§2.2)을 표현하려면 null 원소가 필요한데 결정은 null 을 금지한다.
  - "기존 사람 유지 + 새 사람은 최소 빈 번호" 로 읽으면, 슬롯 2~5 의 "사람 교체"(항목 유지)와 "삭제 후 추가"(삭제 조건 적용)를 구분할 수 없다.
  - 결정된 시그니처로 이 둘을 구분할 수 있는지, 인자에 슬롯 정보를 더해야 하는지 결정이 필요하다.

### 3.3 허용 조건과 거절 메시지(전문)

판정 순서: 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8. 함수의 거절은 `errcode P0001`, 서비스가 메시지를 그대로 보인다.

| # | 조건 | 거절 메시지(전문) |
|---|---|---|
| 0 | 사유(앞뒤 공백 제외 1자 이상) [현행 유지] | `수정 사유는 필수입니다.` |
| 1 | 배열 길이 1~5 | 0명: `담당자를 1명 이상 지정해야 합니다.` · 6명 이상: `병렬 배정은 최대 5명까지입니다.` |
| 2 | null 원소 없음 | `담당자를 선택하지 않은 자리가 있습니다.` |
| 3 | 중복 없음 | `같은 담당자를 두 번 배정할 수 없습니다.` [현행 유지] |
| 4 | 오더 존재 | `오더를 찾을 수 없습니다.` |
| 5 | LOCK 아님 | `확정(LOCK)된 오더는 담당자를 변경할 수 없습니다. 확정 해제 후 다시 시도해 주세요.` [현행 유지] |
| 6 | 새로 들어오는(기존 구성에 없던) 시험자가 존재·활성 — "배정을 실제로 건드릴 때만 검증" 원칙 [현행 유지] | 없음: `존재하지 않는 시험자입니다.` · 비활성: `비활성 시험자({이름})에게는 배정할 수 없습니다.` |
| 7 | 시작한 담당자의 교체·해제 아님 | `이미 작업을 시작한 담당자(QC {QC번호})는 변경할 수 없습니다. 작업을 먼저 정리하세요.` [현행 유지] |
| 7' | 슬롯 1 을 비우는 변경 아님 | `담당자 1(대표)은 뺄 수 없습니다. 다른 사람으로 교체만 할 수 있습니다.` |
| 8 | 작업 ≥ 1건 오더에서 삭제되는 슬롯의 활성 항목 0개 | `담당자 {번호}에게 배분된 시험항목이 {개수}개 남아 있어 뺄 수 없습니다.` |
| — | 설치(`PGRST202`/`42883`) | `병렬 배정 기능의 DB 설치(0049 마이그레이션)가 아직 적용되지 않았습니다. 관리자에게 문의하세요.` |

- 구성이 현재와 같으면 쓰기·감사 없이 `changed=false` 로 반환한다.

### 3.4 다른 쓰기 경로의 거절 메시지(문구 변경)

| 경로 | 조건 | 메시지(전문) |
|---|---|---|
| 수동 배정(`assignManually`) | 병렬 오더 담당자 해제 | `병렬 배정 오더는 담당자를 해제할 수 없습니다. 오더 수정에서 병렬 배정을 먼저 해제하세요.` |
| 수동 배정 | 이미 같은 오더 슬롯 2~5 에 있는 사람을 대표로 | `이미 이 오더의 병렬 담당자로 배정된 시험자입니다.` |
| 항목 슬롯 API(`PATCH /api/pct-orders/[id]/test-items`) | 병렬 오더 아님 | `병렬 배정 오더에서만 시험항목 담당자를 나눌 수 있습니다.` |
| 항목 슬롯 API | 그 오더에 없는 슬롯 번호 | `이 오더에 없는 담당자 번호입니다.` |
| 항목 슬롯 API | 오더에 작업 ≥ 1건 | `이미 작업이 시작된 오더는 항목별 담당자를 바꿀 수 없습니다. 담당자 배분은 작업 시작 전에 확정해야 합니다.` [현행 유지] |
| 시험자 하드 삭제(`deleteTester`) | `pct_order_assignees` FK 위반(`23503`) | `병렬 배정된 오더가 있어 삭제할 수 없습니다. 비활성화하세요.` |

- 시험자 삭제 문구는 결정 문구다. 다만 1인 배정 오더도 슬롯 1 행을 가지므로 **병렬이 아닌 오더에 배정된 시험자도** 이 문구로 거절된다. 문구 조정 여부는 **확인 필요**(§12-6).

---

## 4. 권한

| 동작 | 관리자 | 시험자(그 오더 병렬 담당자) | 시험자(그 외) |
|---|---|---|---|
| 담당자 구성 변경(오더 수정) | 허용 | 거절 | 거절 |
| 시험항목 배분(작업 시작 전) | 허용 | 거절 | 거절 |
| AI 자동배정·수동 배정 | 허용(병렬 오더 제외 규칙 §6) | 거절 | 거절 |
| 자기 슬롯 [작업 시작] | 자기 슬롯만 | 자기 슬롯만 | 거절 |
| 동료 작업 열람(`canViewJob` 등) | 허용 | **같은 오더 병렬 담당자 전원**의 작업 열람 | 거절 |
| 동료 작업 수정 | 자기 작업만 | 거절 — 열람 권한을 수정 권한으로 쓰지 않음 | 거절 |

### 4.1 함수 실행 권한 — service_role 만

| 함수 | `public`·`anon`·`authenticated` | `service_role` |
|---|---|---|
| `set_order_assignees(uuid, uuid[], uuid, text)` | revoke | grant execute |

---

## 5. 처리 순서와 경합

### 5.1 RPC 시그니처

`set_order_assignees(p_order_id uuid, p_tester_ids uuid[], p_user_id uuid, p_reason text) returns jsonb`
반환: `orderId`·`changed`(boolean)·`before`/`after`(슬롯-사람 목록)·`addedSlots`·`removedSlots`·`replacedSlots` — 커밋 뒤 재배정 이력·휴가 겹침 알림에 필요한 정보.

서비스는 **사유 검사 → rpc → 오류 번역 → (커밋 뒤) 재배정 이력·휴가 겹침 알림**만 한다. 함수가 없으면 §3.3 설치 문구로 거절하고 **비원자 폴백을 하지 않는다**.

### 5.2 함수 한 트랜잭션

| 단계 | 동작 | 실패 시 |
|---|---|---|
| ① | 조건 0·1·2·3 | 거절 |
| ② | `pct_orders` 행 `for update` → 조건 4·5 | 거절, 롤백 |
| ③ | 그 오더의 `pct_order_assignees` 행 `for update` → 변경 전 구성 확정, §3.2 해석으로 추가·삭제·교체 산출 | 거절, 롤백 |
| ④ | 조건 6·7·7'·8 (작업 존재는 `qc_jobs` 를 읽기만 — 행 잠금 없음) | 거절, 롤백 |
| ⑤ | 삭제 슬롯의 `pct_order_test_items` 행 `for update` → `assignee_slot = 1` | DB 오류, 롤백 |
| ⑥ | `pct_order_assignees` 삭제·교체·추가(`assigned_by = p_user_id`) | DB 오류, 롤백 |
| ⑦ | `pct_orders` 미러·구 컬럼 한 UPDATE(§2.3) | DB 오류, 롤백 |
| ⑧ | `pct_order_edits` 감사 insert(§7) | DB 오류, 롤백 |
| ⑨ | 반환 | — |

### 5.3 잠금 순서와 동시 요청

**잠금 순서: `pct_orders` → `pct_order_assignees` → `pct_order_test_items`.** `qc_jobs` 는 잠그지 않고 읽기만 한다.
F2 `reassign_job_item`(`qc_jobs` → `pct_orders` → `pct_order_test_items` → `qc_job_items`)·0047(`qc_jobs` → `pct_orders` → `qc_job_items`)과 `pct_orders` 이후 순서가 같아 교착 방향이 생기지 않는다.

| 경합 | 결과 |
|---|---|
| 두 관리자가 같은 오더 구성 변경 | 둘째는 ②에서 대기 후 바뀐 구성 기준으로 다시 판정 |
| 구성 변경 ↔ F2 항목 이동 | 둘 다 `pct_orders` 행을 잠가 직렬화. 이동이 먼저면 삭제 대상 슬롯에 항목이 생겨 조건 8 로 거절될 수 있음. 삭제가 먼저면 이동은 "그룹원 아님" 으로 거절 |
| 구성 변경 ↔ 삭제·교체 대상 담당자의 [작업 시작] | **알려진 한계** — 작업 시작은 오더 행을 잠그지 않는다(RPC 화는 범위 밖). ④ 검사 뒤 커밋 전에 시작이 끼면 빠진 사람의 작업이 생길 수 있다. 지금 코드에도 있는 창이다 |
| 구성 변경 ↔ 0047 시작 취소 | 0047 이 `pct_orders` 를 잠그므로 직렬화 |

### 5.4 대표 슬롯만 쓰는 다른 경로 — 미러 불일치 금지

| 경로 | 결정 | 세부 |
|---|---|---|
| AI 자동배정(`applyAssignments`) | 슬롯 1 upsert + 미러 | 병렬 오더 제외(§6) |
| 수동 배정(`assignManually`) | 슬롯 1 upsert + 미러 | 해제(0명)도 이 경로 |
| 시트 적재 복구(`pctIngest.restoreOrder`) | 담당자 비움 | 슬롯 행 전부 삭제 + 항목 슬롯 1 되돌림 + 미러·구 컬럼 null/false |
| 수동 오더 생성 | 1인으로 시작 [현행 유지] | 담당자가 있으면 슬롯 1 행 |
| 동시분석 그룹 대표 → 멤버 담당자 전파(`pctAssign.ts:145-150`) | AI 자동배정의 일부 | 병렬 멤버 오더 제외 |

- 이 경로들이 `set_order_assignees` 를 쓰는지(배열 길이 ≥1·사유 필수 조건과 맞지 않음 — 해제·복구는 0명), 별도 원자적 쓰기가 필요한지는 **확인 필요**(§12-2).
  어느 방식이든 슬롯 테이블·미러·구 컬럼이 **한 트랜잭션**에서 바뀌어야 한다.

---

## 6. 배정·부하·상태 계산의 N명 일반화

| 대상 | 규칙 |
|---|---|
| AI 자동배정 | 병렬 배정을 만들지 않는다. 슬롯 1 만 채운다. 명시 `orderIds` 경로에서도 병렬 오더(행 수 ≥ 2) 제외 |
| `currentWorkload` | 오더당 담당자 N명 각각 +1 |
| `highDifficultyPenalty` | N명 모두 셈(지금은 담당자 1만 — 함께 고침) |
| 홈 부하 카드 | N명 모두 올림(지금은 담당자 1만 — 함께 고침) |
| 챗봇·Q-Think 담당 표시 | N명 이름 모두 |
| "내 오더" 필터(`assignedToTesterFilter` 대체) | 새 테이블에서 `tester_id` 로 `order_id` 목록 조회 → `in` 필터 [브리프 준용] |
| 관리자 대시보드 보유 DAY | 담당자 수로 **균등 분할**(`days / N`). 난이도 분포는 사람마다 1건 [현행 유지] |
| 월간 스케줄 | 각 담당자 행에 **전체 기간** [현행 유지]. 슬롯별 행, `co_assignee_ids[]` |
| 오더 상태 동기화 | 지연 우선 → 가장 덜 진행된 단계 → **활성 항목이 있는 미시작 담당자가 한 명이라도 있으면 진행중 상한**. 슬롯별 활성 항목 수는 `countActiveBySlot` **한 번 조회**(반환 `Map<orderId, Map<slot, number>>`), 행 1개 오더는 즉시 false — N+1 금지 |
| 할 일·작업 현황의 내 슬롯 | 새 테이블에서 조회. "병렬이면 오더 상태와 무관하게 내 작업 없음 = 시작 대기" 규칙 그대로 |
| 작업 시작 | 내 슬롯 = 새 테이블에서 내 `tester_id` 의 `slot`. 병렬이면 그 슬롯 활성 항목만 체크리스트 [현행 유지] |
| 0047 `cancel_job_start` | SQL 수정 없음. 주석의 "2인 배정" 만 N명 표현으로 |
| 공수·평가·운영 리포트 | 작업 단위라 변경 없음 |

---

## 7. 감사 기록

| 기록 | 형식 |
|---|---|
| 담당자 구성 변경 | `pct_order_edits` 1행: `field='assignees'`, `reason` = 사용자 사유, `edited_by` = 요청자. `old_value`·`new_value` 의 **값 형식은 확인 필요**(§12-3) — 후보: 번호·이름 목록(`담당자 1 홍길동, 담당자 3 김철수`) / 브리프 초안 `slot:tester_id` 목록 |
| 삭제 슬롯 항목의 슬롯 1 되돌림 | 같은 트랜잭션에서 `pct_order_edits` 1행: `field='testItemAssignee'`, `old_value` `{N}개 항목: 담당자 {번호}`, `new_value` `담당자 1 (담당자 {번호} 해제)`, `reason` = 사용자 사유 [브리프 준용: 기존 요약 1행 형식의 일반화] |
| 작업 전 항목 배분 변경 | 기존 `logSlotEdit` 그대로, 라벨만 `담당자 {번호}` |
| 재배정 이력·휴가 겹침 알림 | 커밋 뒤 서비스에서 **바뀐 슬롯마다**(현행 2슬롯 루프의 N 일반화), `via` = `오더 수정(담당자 {번호})` [브리프 준용]. `reassignment_history` 에 슬롯 번호 컬럼 추가 여부는 intent Open questions |

- **과거 기록의 저장 키는 바꾸지 않는다**: `isDualAssignment`·`assigneeTesterId2`·`testItemAssignee`(값 `…: 담당자2`)는 그대로 두고 표시만 한다.
- 이력 표시 라벨 [브리프 준용]: `isDualAssignment` → `병렬 배정`(값 true/false → `병렬 배정`/`1인 배정`), `assigneeTesterId2` → `담당자 2`, `assignees` → `담당자 구성`.
- 대표 담당자 변경을 옛 키 `assigneeTesterId` 로도 계속 남기는지, `assignees` 한 키로만 남기는지는 **확인 필요**(§12-3).

---

## 8. 알림

- 새 알림은 없다. 기존 휴가 겹침 알림·재배정 이력은 N명으로 일반화(§7).
- 슬랙 문구 `2인 배정 — 담당자별 작업입니다` → `병렬 배정 — 담당자별 작업입니다`. 조인 대상은 새 테이블 기준 병렬 여부.

---

## 9. 화면

| 화면 | 동작 |
|---|---|
| 오더 수정 서랍 — 담당자 | 체크박스 `병렬 배정`. 켜면 `담당자 2` 행이 생기고, [담당자 추가] 로 최대 5행(5명이면 버튼 비활성). 각 행: `담당자 {번호}` 라벨 + 시험자 Select(이미 고른 사람 제외) + 삭제 버튼 |
| 같은 서랍 — 잠금 표시 | LOCK 이면 전부 비활성 [현행 유지]. 작업을 시작한 담당자 행은 Select·삭제 비활성, 안내 `작업을 시작한 담당자(QC {QC번호})는 바꿀 수 없습니다.` 슬롯 1 은 삭제 버튼 없음. 작업 ≥ 1건 오더에서 활성 항목이 남은 행은 삭제 비활성 |
| 같은 서랍 — 해제 확인창 | 작업 0건: `병렬 배정을 해제할까요? 담당자 1 외의 담당자가 빠지고, 그 담당자들의 시험항목은 담당자 1에게 돌아갑니다.` |
| 같은 서랍 — 휴가 겹침 | 담당자 행마다 판정(2벌 → 배열) |
| 시험항목 배분 섹션 | 2택 세그먼트 → **존재하는 슬롯 목록 Select**(`담당자 {번호} · {이름}`). 슬롯별 개수 배지 N개. 작업 시작 뒤 흔적 없는 항목은 F2 경로로 활성(F2 spec) |
| 오더 카드·담당자별 탭·담당자 상세 모달 | 담당자 N명 아바타·라벨, 병렬 담당 행 판정 N명, 배지 `병렬` |
| 일괄 배정·해제 | 병렬 오더 제외 [현행 유지], 안내 문구의 `2인 배정` → `병렬 배정` |
| 월간 스케줄 | 셀 라벨·통계·범례 `듀오` → `병렬` |
| 작업자 작업 현황 | `2인 배정 상대` → `병렬 배정 동료` [브리프 준용], 배지 `2인` → `병렬`, 동료 N명 |
| 할 일 | 시작 취소 문구 [현행 유지](이미 인원수 중립) |
| 이력 표시 | §7 라벨 |

- 식별자: `isDualAssignment` → `isParallel`(파생), `assigneeTesterId2`/`assigneeName2` → `assignees[]`, `dual` prop → `parallel`, `isPartner` → `isCoAssignee`, `is_duo`/`duo_partner_id` → `is_parallel`/`co_assignee_ids[]` [브리프 준용].
- `can_duo`·`requires_duo`·규칙엔진 듀오 조는 **건드리지 않는다**.
- 디자인 규칙: `rounded-md`, `bg-primary`/`blue-*`, `text-xs` 이상, 수정은 서랍/모달.

---

## 10. 배포

- 마이그레이션 **`0049_parallel_assignment.sql`**. 0045 헤더 형식, **Supabase 대시보드 > SQL Editor 수동 적용**, idempotent, `supabase db push` 금지, 끝에 `notify pgrst, 'reload schema';`.
- 파일 안 순서: ① 테이블·제약·인덱스·주석 → ② 항목 슬롯 제약 1~5 → ③ 이관(§11) → ④ RLS → ⑤ `set_order_assignees` → ⑥ 실행 권한 → ⑦ notify.
- 의존: 0010·0027·0037·0038. **0048 이 먼저 적용돼 있어야 한다**(전체 순서 고정).
- **전체 적용 순서**: SQL `0048` → `0049` → `0050` → 앱 배포 → **`0049` 의 ③ 이관 문장만 재실행**. `main` push 가 운영 배포이므로 통합 전에는 `main` 에 올리지 않는다.
- 구 컬럼 드롭 마이그레이션은 이번 릴리스에 **넣지 않고 번호도 예약하지 않는다**.
- 미적용 환경
  - 구성 변경: §3.3 설치 문구로 거절, 비원자 폴백 금지.
  - 새 테이블을 읽는 조회(오더 목록·할 일·작업 현황·월간·대시보드): `describeSchemaError(err, '병렬 배정', '0049_parallel_assignment.sql')` 로 감싸
    `병렬 배정 기능이 아직 DB에 반영되지 않았습니다. Supabase SQL Editor 에서 supabase/migrations/0049_parallel_assignment.sql 을 실행해 주세요. (원인: …)` 로 안내.

---

## 11. 이관 (0049 ③, 재실행 안전)

| 원천 | 대상 행 |
|---|---|
| `assignee_tester_id is not null` | `(order_id, 1, assignee_tester_id)` |
| `is_dual_assignment and assignee_tester_id_2 is not null and assignee_tester_id_2 is distinct from assignee_tester_id` | `(order_id, 2, assignee_tester_id_2)` |

- 모두 `on conflict do nothing`. 항목 `assignee_slot`(1/2)은 그대로 유효 — 항목 이관 없음.
- `assigned_by` null, `assigned_at` 기본값.
- 파일 머리 주석에 **점검 SELECT**(0행이어야 정상)를 둔다:
  - 미러 불일치: `assignee_tester_id` 와 슬롯 1 행의 `tester_id` 가 다른 오더.
  - 2인 불일치: `is_dual_assignment` 인데 슬롯 2 행이 없는 오더, 또는 `is_dual_assignment=false` 인데 행이 2개 이상인 오더.
- **재실행의 한계**: `on conflict do nothing` 은 **빠진 행만 넣는다**. SQL 적용~앱 배포 사이에 구 코드가 담당자를 **교체·해제**했다면 새 테이블의 기존 행이 갱신되지 않는다.
  이 차이를 재실행 문장으로 흡수할지(갱신·정리 문장 추가), 점검 SELECT 결과를 보고 수동으로 정리할지는 **확인 필요**(§12-4).

---

## 12. 확인 필요

1. `set_order_assignees(p_order_id, p_tester_ids uuid[], p_user_id, p_reason)` 의 배열 원소 → 슬롯 번호 매핑. 구멍 허용·null 금지와 "미시작 슬롯 사람 교체 허용 / 슬롯 삭제는 활성 항목 0개일 때만" 을 동시에 표현할 수 있는 해석이 결정된 시그니처만으로는 없다(§3.2).
2. 대표 슬롯만 쓰는 경로(AI 자동배정·수동 배정·해제·시트 복구·그룹 전파)의 원자적 쓰기 방식 — `set_order_assignees` 재사용(0명·사유 조건 불일치) 또는 별도 경로(§5.4).
3. `pct_order_edits` 의 `assignees` 값 형식, 대표 담당자 변경을 옛 키 `assigneeTesterId` 로도 남기는지(§7).
4. SQL 적용~앱 배포 사이 구 코드의 교체·해제를 이관 재실행이 흡수하지 못하는 문제의 처리(§11).
5. 담당자 구성과 나머지 오더 필드를 한 [저장]에서 보낼 때 부분 반영을 허용할지(intent Open questions 와 같음) — 서비스 호출 순서와 실패 시 문구가 이에 달려 있다.
6. 시험자 하드 삭제 거절 문구가 1인 배정 오더(슬롯 1 행)에도 나가는 문제 — 문구를 `배정된 오더가 있어 …` 로 넓힐지(§3.4).
7. 작업 시작 뒤 추가된 슬롯이나 미시작 슬롯에 남은 항목을 **작업이 없는 담당자끼리** 옮기는 경로 — 일괄 이동은 금지, F2 는 작업에 들어 있는 항목만 다룬다. 이 공백 때문에 활성 항목이 남은 미시작 슬롯은 삭제할 수 없다(F2 spec §12 와 같은 항목).

---

## 12.1 범위 밖

- 구 컬럼(`is_dual_assignment`·`assignee_tester_id_2`)·0037/0038 제약 드롭.
- AI 자동배정의 병렬 배정 추천.
- 조직 팀·파트 개념 도입.
- 품목 공수를 항목 비율로 나누는 규칙.
- 작업 시작(`startJob`) RPC 화.
- `can_duo`·`requires_duo`·규칙엔진 듀오 조의 이름·동작.
- 진행 중 항목 이동 자체(F2 spec 소관).

---

## 부록 A. 구현 대상 파일 목록

> 브리프 `temp/brief-f3-parallel-assign.md` 부록 A·§2 에서 옮겼다. **라인 번호는 2026-09-15 기준이며 바뀔 수 있다.**
> 결정과 달라진 곳은 괄호로 표시했다.

| 파일 | 이유 |
|---|---|
| `supabase/migrations/0049_parallel_assignment.sql` (신규) | 테이블·항목 슬롯 1~5·이관·RLS·`set_order_assignees` (브리프의 `0048_parallel_assignment.sql`·`0049_drop_dual_assignment_columns.sql` 대신 결정 번호, 드롭 파일은 만들지 않음) |
| `supabase/migrations/0047_cancel_job_start.sql` | 주석 "2인 배정" → N명 표현만(`:106-121`), 로직 불변 |
| `types/`(신규 공유 상수 파일) | `MAX_PARALLEL_ASSIGNEES=5`, 슬롯 타입 1~5, 라벨 함수 |
| `backend/lib/assigneeFilter.ts` | or 필터(`:4-13`) → "내 order_id 목록" 조회 |
| `backend/services/pctOrders.ts` | `PctOrderRow`(`:33-36`) `assignees[]`/`isParallel`, 편집 필드·잠금 필드(`:50-54,68-74,81-102`) 재정의, 라벨(`:119-120`), 목록 필터(`:156-165`), 비활성 검사(`:438`), 2인 검증(`:503-522`) → RPC, 슬롯 잠금(`:552-572`), 해제(`:590-600`), 재배정·휴가 루프(`:615-664`) N화 |
| `backend/services/pctOrderTestItems.ts` | 슬롯 타입(`:131-136,146`), `setAssigneeSlot`(`:322-354`) 존재 슬롯 검증, `slotLabel`(`:357-359`), `logSlotEdit`(`:373-388`), `resetAssigneeSlots`(`:394-413`) 부분 되돌림, `activeItemsForSlot`(`:419-426`), `countActiveBySlot`(`:438-458`) 반환형 |
| `backend/services/pctAssign.ts` | 부하(`:202-220`), 난이도 페널티(`:285-308`), 대상 필터(`:118-143`)·적용(`:311-353`) 슬롯 1 기록·병렬 제외, 그룹 전파(`:145-150`), 수동 배정(`:815-881`) 가드·문구 |
| `backend/services/qcJobs.ts` | `listWorkspace`(`:168-307`), `listWorkerOverview`(`:568-773`), `canViewJob`(`:513-540`), `startJob` 내 슬롯(`:776-803,817-838`), `hasUnstartedAssignee`(`:1109-1135`), 문구 |
| `backend/services/pctIngest.ts` | 복구(`:220-229,280-313`) 슬롯 행 삭제·미러 초기화, 재배정 이력(`:327-339`) |
| `backend/services/tests.ts` | 담당자 이름 N명(`:36-37,124-134,158-184`), 병렬 판정 |
| `backend/services/monthlySchedule.ts` | 슬롯 N행(`:138-172`), `co_assignee_ids[]`, 비병렬 합치기(`:186`) |
| `backend/services/qcDashboard.ts` | holders 를 새 테이블에서(`:103-139`) |
| `backend/services/chat.ts` | 범위 필터(`:384-394`), 담당 이름 N명(`:450-451`) |
| `backend/services/qthinkAgent.ts` | 범위 필터(`:226-227`), 담당 이름 N명(`:497-514`) |
| `backend/services/slackNotify.ts` | 조인·문구(`:34,59-73,135-139`) |
| `backend/services/aiScheduleHistory.ts` | `assignees`·옛 키 라벨(`:49,62,181,198`) |
| `backend/services/concurrentSavings.ts` | (선택) 담당 이름 N명(`:121,190`) |
| `backend/services/testers.ts` | `deleteTester`(`:222-223`) FK 위반 번역 |
| `app/api/pct-orders/route.ts` | PATCH 에 담당자 배열 수용(또는 별도 엔드포인트) |
| `app/api/pct-orders/[id]/test-items/route.ts` | 슬롯 검증(`:58-59,65-83`) 존재 슬롯·병렬 판정·문구 |
| `app/api/qc-jobs/[id]/route.ts` · `app/api/qc-jobs/overview/route.ts` | 주석·문구(`:22-26`, `:6`) |
| `app/(menu)/schedule/orders/page.tsx` | 타입(`:73-76`), 이력 라벨(`:205`), 일괄 배정(`:462-477,524,1473-1474`), 담당자별 탭(`:699-727`), 카드(`:998-1033`), 서랍(`:2043-2371`), 이력 포맷(`:2393-2399`) |
| `frontend/components/schedule/order-test-items-section.tsx` | props(`:36-37,46-72`), 세그먼트 → Select(`:267-304`), 슬롯 배지(`:159-161,174-179`), 잠금 안내(`:199-205`) |
| `frontend/components/schedule/assignee-detail-modal.tsx` | 병렬 담당 판정·배지(`:43-44,118-126,259,288,398,447-448`) |
| `app/(menu)/schedule/monthly/page.tsx` | `is_duo` → `is_parallel`, 라벨(`:56-57,120-132,377,609,869`) |
| `app/(menu)/product-test/prod-status/page.tsx` · `frontend/components/product-test/worker-stage-lane.tsx` | 상대 → 동료 N명 문구·배지(`:26,152-154,177,194-199,253-265,435-437,453-456` · `:39-40`) |
| `app/(menu)/my-tasks/page.tsx` | 시작 취소 문구 확인(`:144-149`) |
| `app/(menu)/home/page.tsx` | 부하 카드 N명(`:171-183`) |
| `intent/2026-09-13-tester-cancel-job-start-spec.md` | 권한표·증명 문구 N명(규칙 불변) |
| `docs/qc-schedule-status.md` · `docs/PRD-current-system.md` | as-built 갱신(완료 커밋에서) |
