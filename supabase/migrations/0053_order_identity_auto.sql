-- ─────────────────────────────────────────────────────────────────────────────
-- 자동 적재 오더도 네 값(제조번호·품목코드·품목명·구분) 기준으로 — uq_pct_orders_auto_batch_code 제거
--
-- 배경: 0052 는 수동 오더에만 네 값 기준을 열고, 자동 적재 오더끼리는 (제조번호, 품목코드) 유일을 남겼다.
--       그런데 제조팀 시트에는 같은 제조번호·품목코드인데 구분만 다른 행이 실제로 있다
--       (2026-09-15 운영 시트: 10024 광동원탕 26017 PV3 ↔ 26017 일반, 26018 PV2 ↔ 26018 일반).
--       그 경우 적재가 두 행을 한 오더로 보고 회차마다 구분을 번갈아 덮어썼고, 두 번째 오더는 만들 수 없었다.
--       사용자 확인: "자동으로 적재를 누르면 반영이 안된다" → 자동 오더도 네 값 기준으로 한다.
--       규칙 전문: intent/2026-09-15-order-duplicate-key-spec.md §6
--
-- 바뀌는 것: ② uq_pct_orders_auto_batch_code 드롭. 중복 방지는 0052 의 ① uq_pct_orders_identity 하나가 맡는다
--           (삭제된 수동 오더를 뺀 모든 오더, 네 값 기준).
-- 앱 짝: pctIngest.ts 적재 키를 네 값으로(품목명·구분만 바뀐 행은 같은 제조번호·품목코드의 1:1 보조 매칭으로 "변경" 처리).
--        앱이 먼저 배포되면 두 번째 행 insert 가 ② 에 걸려 적재 실패로 기록되고 "0053 적용" 안내가 붙는다(데이터 손상 없음).
--
-- 기존 데이터 안전: 인덱스를 지우기만 한다 — 실패할 조건이 없다.
-- 의존: 0052_order_identity_key.sql (uq_pct_orders_identity 가 있어야 중복 방지가 남는다 — 없으면 적용 중단)
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent — 다시 실행해도 안전)
--    `supabase db push` 금지 — 0028 헤더의 경고 참조. 파일 전체를 한 트랜잭션(begin … commit)으로 감쌌다.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ⓪ 의존 확인 — 네 값 인덱스 없이 ② 만 지우면 자동 오더 중복을 막을 장치가 사라진다
do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public' and tablename = 'pct_orders' and indexname = 'uq_pct_orders_identity'
  ) then
    raise exception 'uq_pct_orders_identity 인덱스가 없습니다. 0052_order_identity_key.sql 을 먼저 적용하세요.';
  end if;
end $$;

drop index if exists public.uq_pct_orders_auto_batch_code;

commit;

-- PostgREST 스키마 캐시 즉시 갱신
notify pgrst, 'reload schema';
