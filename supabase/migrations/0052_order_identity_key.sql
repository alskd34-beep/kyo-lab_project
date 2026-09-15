-- ─────────────────────────────────────────────────────────────────────────────
-- 오더 중복 기준 변경 — (제조번호, 품목코드) → (제조번호, 품목코드, 품목명, 구분)
--
-- 배경: pct_orders 는 0010 부터 unique (batch_no, product_code) 였다. 그래서 제조팀 시트에서 들어온
--       자동 오더와 제조번호·품목코드가 같으면, 품목명이나 구분(PV1/CV …)이 달라도 수동 오더를 만들 수 없었다.
--       사용자 요청(2026-09-15): "품목코드, 제조번호, 품목명, 구분 각 정보가 하나라도 다를 경우
--       자동 오더랑 수동 오더 가능하도록".
--       규칙 전문: intent/2026-09-15-order-duplicate-key-spec.md (감독 결정 temp/decisions-t5-t7.md 「T5」)
--
-- 바뀌는 것:
--   ① uq_pct_orders_identity       — 삭제된 수동 오더를 뺀 모든 오더: (batch_no, product_code, btrim(product_name), btrim(coalesce(validation_type,'')))
--                                     네 값이 모두 같을 때만 중복. 구분 null 과 '' 는 같은 값(구분 없음).
--                                     상태 문자열 '삭제' 는 types/qc-status.ts DELETED_STATUS 와 같아야 한다.
--   ② uq_pct_orders_auto_batch_code — 자동 적재 오더(ingest_state <> 'manual')끼리는 예전처럼 (batch_no, product_code) 유일.
--                                     시트 적재(pctIngest.ts)의 갱신·삭제·복구 감지가 이 키 하나에 기대기 때문이다.
--   ③ 옛 unique (batch_no, product_code) 제약 드롭 — 이름을 하드코딩하지 않고 카탈로그에서 찾는다(0037 방식).
--
-- 기존 데이터 안전: 옛 제약이 ①·② 보다 강하다(두 컬럼이 같으면 무조건 막았다). 그러므로 적용 시점의 기존 행은
--   ① 도 ② 도 절대 위반하지 않는다 — 인덱스 생성이 기존 데이터 때문에 실패할 수 없다.
--   삭제('삭제' 상태) 행도 예전과 똑같이 키를 점유한다(적재 복구 로직이 그것을 전제로 한다).
--
-- 앱 쪽 짝(같은 배포):
--   · pctIngest.ts   — 적재의 기존 오더 매칭에서 수동 오더를 뺀다(수동 오더를 자동 오더로 덮던 기존 위험 제거).
--   · pctAssign.ts   — AI 배정 결과를 `품목코드|제조번호` 대신 오더 id 로 되붙인다(같은 키 두 오더가 섞이지 않게).
--   · pctOrders.ts   — 23505 문구를 인덱스 이름으로 구분(duplicateOrderMessage).
--   앱은 0052 없이도 동작한다(옛 제약이면 예전처럼 거절 + "0052 적용 전" 안내).
--
-- 의존: 0010_pct_workflow.sql (pct_orders), **0039_pct_order_validation_type.sql** (validation_type 컬럼)
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent — 다시 실행해도 안전)
--    `supabase db push` 금지 — 0028 헤더의 경고 참조.
--    테이블 컬럼·기존 데이터 변경 없음(인덱스 2개 추가, 제약 1개 드롭).
--    배포 순서: 앱과 무관하게 언제 적용해도 된다(앱이 먼저여도 안전). 파일 전체를 한 트랜잭션(begin … commit)으로 감쌌다.
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ⓪ 의존 확인 — 0039(validation_type) 가 없으면 ① 인덱스를 만들 수 없으니 적용 자체를 중단한다.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'pct_orders' and column_name = 'validation_type'
  ) then
    raise exception 'pct_orders.validation_type 컬럼이 없습니다. 0039_pct_order_validation_type.sql 을 먼저 적용하세요.';
  end if;
end $$;

-- ① 네 값 기준 중복 방지. 옛 제약보다 약하므로 기존 행이 위반할 수 없다.
--    **삭제된 수동 오더는 제외** — 관리자가 수동 오더를 지운 뒤 같은 네 값으로 다시 등록할 수 있어야 한다.
--    (삭제된 자동 오더는 계속 키를 차지한다 — 시트에 재등장하면 적재가 그 행을 복구하기 때문이다. ② 참고)
create unique index if not exists uq_pct_orders_identity
  on public.pct_orders (batch_no, product_code, btrim(product_name), btrim(coalesce(validation_type, '')))
  where not (ingest_state = 'manual' and status = '삭제');

-- ② 자동 적재 오더끼리는 (제조번호, 품목코드) 유일 유지 — 시트 적재 자연키.
create unique index if not exists uq_pct_orders_auto_batch_code
  on public.pct_orders (batch_no, product_code)
  where ingest_state <> 'manual';

-- ③ 옛 unique (batch_no, product_code) 제약 드롭 — 정확히 이 두 컬럼만 묶는 unique 제약을 카탈로그에서 찾는다.
--    (다시 실행하면 찾을 제약이 없어 아무것도 하지 않는다)
do $$
declare
  r record;
begin
  for r in
    select con.conname
      from pg_constraint con
      join pg_class c  on c.oid = con.conrelid
      join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and c.relname = 'pct_orders'
       and con.contype = 'u'
       and array_length(con.conkey, 1) = 2
       and (
             select array_agg(a.attname::text order by a.attname::text)
               from pg_attribute a
              where a.attrelid = con.conrelid and a.attnum = any(con.conkey)
           ) = array['batch_no', 'product_code']
  loop
    execute format('alter table public.pct_orders drop constraint %I', r.conname);
    raise notice 'pct_orders 의 (batch_no, product_code) unique 제약 % 를 드롭했습니다.', r.conname;
  end loop;
end $$;

commit;

-- PostgREST 스키마 캐시 즉시 갱신
notify pgrst, 'reload schema';
