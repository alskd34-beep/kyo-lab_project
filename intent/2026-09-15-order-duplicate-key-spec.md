# Spec: 오더 중복 기준 (0052)
연결 intent: `intent/2026-09-15-order-duplicate-key.md` · 감독 결정: `temp/decisions-t5-t7.md` 「T5」

## 1. 제약 설계
| 이름 | 대상 | 키 | 목적 |
|---|---|---|---|
| `uq_pct_orders_identity` | 삭제된 **수동** 오더를 뺀 모든 오더(`where not (ingest_state='manual' and status='삭제')`) | `batch_no, product_code, btrim(product_name), btrim(coalesce(validation_type,''))` | 네 값이 모두 같을 때만 중복. 지운 수동 오더와 같은 값으로 다시 등록 가능(수동 오더 삭제 intent) |
| `uq_pct_orders_auto_batch_code` | `ingest_state <> 'manual'` | `batch_no, product_code` | 시트 적재 자연키 유지 |
| (드롭) 0010 `unique (batch_no, product_code)` | — | — | 카탈로그에서 두 컬럼만 묶는 unique 제약을 찾아 드롭 |

- 구분 null 과 '' 는 같은 값. 품목명·구분은 앞뒤 공백을 무시한다(서비스·적재도 trim 해서 저장).
- 소프트 삭제된 **자동** 오더는 두 인덱스에 남는다 — 적재 복구(`restoreOrder`)가 삭제 행을 키로 찾아 되살리는 전제를 유지.
  삭제된 **수동** 오더는 ① 에서 빠진다 — 복구 경로가 없으므로 키를 계속 점유할 이유가 없다.
- 부분 인덱스 조건은 앱 쿼리가 아니라 제약에만 쓰이므로(`ON CONFLICT` 사용처 없음) 조건 불일치로 인한 오동작이 없다.
- 수동 오더가 자동 오더로 바뀌는 경로는 없다(적재가 수동 오더를 매칭하지 않으므로 `ingest_state='manual'` 은 유지된다). 따라서 ② 인덱스의 대상 집합이 바뀌며 충돌할 일도 없다.

## 2. 기존 데이터 안전 근거
적용 시점의 모든 행은 옛 제약 `unique(batch_no, product_code)` 를 만족한다. 두 행의 (batch_no, product_code) 가 다르면
① 의 네 값도, ② 의 두 값도 다르다. 그러므로 두 인덱스 생성은 기존 데이터 때문에 실패할 수 없다. 파일 전체가 한 트랜잭션이라
어느 단계든 실패하면 옛 제약이 그대로 남는다. `if not exists` + 카탈로그 드롭이라 다시 실행해도 안전하다.

## 3. 동작 규칙
| 경로 | 0052 적용 후 | 0052 적용 전(앱만 배포) |
|---|---|---|
| 수동 오더 등록 | 네 값 모두 같으면 23505 → "품목코드·제조번호·품목명·구분이 모두 같은 오더가 이미 있습니다…" | 옛 제약 → 기존 문구 + "0052 적용 전에는…" 안내 |
| 수동 오더 수정(식별 칸·구분·품목명) | 같은 규칙 | 같은 안내 |
| 시트 적재 매칭 | 수동 오더 제외. 자동 오더끼리 기존 판정 | 같음 |
| 시트 신규 행 insert | 자동 오더 중복은 기존처럼 매칭돼 insert 안 함. 수동 오더와 네 값 모두 같으면 실패로 기록(사유 포함) | 수동 오더와 두 값만 같아도 실패로 기록 — **예전에는 그 수동 오더를 덮어썼다** |
| N/A 대체값 재생성 | 23505 이면 대체값 재생성(기존) | 같음 |

문구는 PostgREST 오류 메시지의 인덱스 이름으로 가른다(`pctOrders.duplicateOrderMessage`).

## 4. (품목코드, 제조번호) 로 오더를 식별하던 곳 — 전수와 조치
| 위치 | 용도 | 조치 |
|---|---|---|
| `backend/services/pctAssign.ts` `orderKey` | 사유·대표 매칭 | **오더 id** 로 변경 |
| `pctAssign.ts` `testerByKey`·`reasonByKey`(규칙엔진 결과) | 배정 결과 되붙이기 | 엔진 행에 `orderId` 를 실어 보내고 결과의 `orderId` 로 키(`engineResultKey`) |
| `pctAssign.ts` `psychoByKey`·향정 재계산 `reasonByKey` | 같음 | 같음 |
| `pctAssign.ts` pick 의 `${product_code}|${batch_no}` | 같음 | `orderKey(o)` |
| `pctAssign.ts` `collectHalfDayNotices` `repByKey` | 반차 알림을 대표 오더에 매칭 | 대표 id ↔ 알림 `orderId` |
| `backend/services/scheduleEngine.ts` | 엔진 입력·결과 타입 | `EnginePctRow.orderId?`, 결과(`EngineAssignment`·`EngineUnassigned`·`EngineHalfDayNotice`)에 `orderId?` 전달. 다른 호출부 없음(`generatePctSchedule` 호출은 pctAssign 두 곳뿐) |
| `pctAssign.ts` Codex 경로 `byOrder` | LLM 결과 | 이미 `orderId` 키 — 변경 없음 |
| `backend/services/pctIngest.ts` `keyOf` 맵(`existingByKey`·`deletedByKey`) | 적재 매칭 | 수동 오더 제외. 자동 오더끼리는 ② 로 유일하므로 맵 키 충돌 없음 |
| `pctIngest.ts` `pct_ingest_log.order_key`, `pctOrders.listIngestLog` split | 적재 이력 표시 | 자동 오더 전용이라 변경 없음 |
| `backend/services/concurrentGroups.ts` 규칙 1·4(품목코드 동일) | 자동 묶기 | 변경 없음 — 같은 품목코드·제조번호 두 오더(예: 같은 배치의 일반·PV1 시험)는 한 그룹이 된다. 같은 배치를 함께 시험하는 것이 자연스러워 허용(intent Open question). 그룹 멤버십은 `order_id` unique 라 섞이지 않음 |
| `app/(menu)/schedule/orders/page.tsx` 카드 | 표시 | 같은 키 오더가 둘 이상이면 구분 배지를 늘 표시(`구분 없음` 포함) |
| 프런트 React key·검색 | 표시 | 오더 카드 key 는 `r.id`. 품목코드 단위 key(휴가 제안·품목군)는 품목 레벨이라 무관 |
| `backend/services/pctOrders.ts` 23505 처리(등록·수정) | 문구 | `duplicateOrderMessage` |

## 6. 개정 — 자동 적재 오더도 네 값 기준 (2026-09-15, `0053`)
운영 시트에 같은 제조번호·품목코드인데 구분만 다른 행이 실제로 있었다(10024 광동원탕 26017 PV3 ↔ 26017 일반, 26018 PV2 ↔ 26018 일반).
§1 의 "자동 오더끼리 (제조번호, 품목코드) 유일" 은 이 두 행을 한 오더로 보고 적재마다 구분을 번갈아 덮어써, 두 번째 오더를 만들 수 없었다.
사용자 확인("자동으로 적재를 누르면 반영이 안된다")에 따라 개정한다.

| 항목 | 개정 후 |
|---|---|
| DB | `0053` 이 `uq_pct_orders_auto_batch_code` 드롭. 중복 방지는 `uq_pct_orders_identity` 하나(0052 의존 확인 후 드롭) |
| 적재 키 | `제조번호|품목코드|trim(품목명)|trim(구분)` — 0039 미적용 DB 면 구분 제외 |
| 품목명·구분이 시트에서 바뀐 행 | **보조 매칭**: 같은 제조번호·품목코드 묶음에서 ① 네 값이 시트 어디에도 없는 기존(삭제 아님) 자동 오더가 정확히 1건 ② 정확히 맞는 오더가 없는 시트 행도 1건일 때만 "변경"으로 잇는다(LOCK·작업 진행이면 기존대로 차단). 모호하면 새 오더 + 옛 오더는 삭제 감지 규칙대로 |
| 시트에 네 값이 모두 같은 행이 두 번 | 두 번째 행은 실패로 기록하고 건너뜀 |
| 복구 | 삭제된 자동 오더는 네 값 키로만 복구(보조 매칭 없음) |
| 0053 적용 전 앱만 배포 | 같은 제조번호·품목코드 두 번째 행 insert 가 옛 인덱스에 걸려 실패로 기록 + "0053 적용" 안내 |

기존 운영 데이터 영향: 위 두 쌍은 지금까지 한 오더가 구분을 번갈아 가졌다. 개정 후 첫 적재에서 그 오더는 **현재 DB 구분과 같은 시트 행**에 그대로 남고, 나머지 행이 새 오더로 생긴다. 기존 오더에 배정·작업이 있었다면 그것이 어느 구분의 시험이었는지 관리자가 확인해야 한다.

## 5. 배포
SQL 0052 와 앱은 순서 무관(권장: SQL 먼저). 앱만 먼저 가면 수동 오더 중복 거절이 옛 기준으로 남고 안내 문구가 붙는다.
