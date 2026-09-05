-- ─────────────────────────────────────────────────────────────────────────────
-- 오더 밸리데이션 구분 (validation_type)
--
-- 제조팀 생산계획 시트(PCT)에 「밸리데이션구분」 열이 있다. 값은 일반 / PV1·PV2·PV3 /
-- CV / MV / CMV / MT / 반제품 / 기타 처럼 자유롭게 늘어난다 — 밸리데이션 회차(PV1→PV3)가
-- 계속 붙기 때문이다. 그래서 CHECK 로 값을 못박지 않고 text 로 둔다. 값이 하나 늘 때마다
-- 마이그레이션을 다시 돌려야 하는 쪽이 더 나쁘다.
--
-- 품목코드·품목명·제조번호와 같은 성격이다 — 제조팀 시트가 원본이고 적재가 채운다.
-- 자동 적재 오더에서는 앱이 수정을 막는다(pctOrders.AUTO_IMMUTABLE_FIELDS).
-- 수동 생성 오더는 관리자가 직접 지정할 수 있다.
--
-- null 은 "시트에 값이 없음"이다. 기본값을 '일반' 으로 채우지 않는 이유:
-- 시트가 비어 있는 것과 담당자가 '일반' 이라고 적은 것은 다른 사실이고,
-- 뒤에 붙는 통계에서 그 둘을 구분할 수 있어야 한다.
--
-- 의존: 0010_pct_workflow.sql (pct_orders)
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent)
--    `supabase db push` 금지 — 0028 헤더의 경고 참조.
-- ─────────────────────────────────────────────────────────────────────────────

alter table pct_orders
  add column if not exists validation_type text;

comment on column pct_orders.validation_type is
  '밸리데이션 구분(제조팀 시트 원본). 일반/PV1/PV2/PV3/CV/MV/CMV/MT/반제품/기타 등. null = 시트에 값 없음.';

-- 목록 화면이 구분별로 거르므로 인덱스를 둔다. null 이 대부분인 초기에는
-- 부분 인덱스가 더 작다 — 값이 있는 행만 찾으면 되기 때문이다.
create index if not exists idx_pct_orders_validation_type
  on pct_orders(validation_type) where validation_type is not null;

-- RLS: 새 테이블이 아니라 0033_enable_rls.sql 의 카탈로그 순회로 이미 커버된다.

-- PostgREST 스키마 캐시 즉시 갱신 (적용 직후 PGRST204/42703 방지)
notify pgrst, 'reload schema';
