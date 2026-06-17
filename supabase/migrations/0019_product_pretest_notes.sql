-- 0019_product_pretest_notes.sql
-- 품목별 시험 전 확인사항 (품목코드/품목명 기준으로 시험 전 점검/주의사항·이슈 적재)
-- 일시(날짜+시간)·작성자·특이사항·이슈발생 로트 등 부가정보 포함.
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent)

CREATE TABLE IF NOT EXISTS product_pretest_notes (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id      uuid        NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  content         text        NOT NULL,                 -- 확인사항(내용)
  occurred_at     timestamptz,                          -- 일시(날짜+시간)
  remark          text,                                 -- 특이사항
  issue_lot       text,                                 -- 이슈발생 로트(제조번호)
  created_by      uuid,                                 -- 로그인 사용자 id
  created_by_name text,                                 -- 작성자명(표시용)
  sequence_order  integer     NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()    -- 작성시각
);

-- 구버전 테이블이 이미 있으면 컬럼 보강 (idempotent)
ALTER TABLE product_pretest_notes ADD COLUMN IF NOT EXISTS occurred_at     timestamptz;
ALTER TABLE product_pretest_notes ADD COLUMN IF NOT EXISTS remark          text;
ALTER TABLE product_pretest_notes ADD COLUMN IF NOT EXISTS issue_lot       text;
ALTER TABLE product_pretest_notes ADD COLUMN IF NOT EXISTS created_by      uuid;
ALTER TABLE product_pretest_notes ADD COLUMN IF NOT EXISTS created_by_name text;

CREATE INDEX IF NOT EXISTS idx_product_pretest_notes_product ON product_pretest_notes(product_id);
