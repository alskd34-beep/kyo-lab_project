-- ─────────────────────────────────────────────────────────────────────────────
-- test_items 대분류(category) 컬럼 추가 + 기존 데이터 자동 분류
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE test_items ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT '기타';

-- 패턴 기반 일괄 분류 (우선순위: 안전성 > 성상·포장 > 기기분석 > 함량시험 > 확인시험 > 이화학 > 기타)
UPDATE test_items SET category =
  CASE
    -- 안전성 (유연물질·중금속·보존제·NMOR)
    WHEN name ILIKE '%유연%'
      OR name ILIKE '%중금속%'
      OR name ILIKE '%NMOR%'
      OR name ILIKE '%보존제%'
      OR (name ILIKE '%납%' AND name ILIKE '%비소%')
    THEN '안전성'

    -- 성상·포장
    WHEN name ILIKE '%성상%' OR name ILIKE '%포장확인%'
    THEN '성상·포장'

    -- 기기분석 (단독 기기명, 함량·확인 없는 경우)
    WHEN (
      name ~* '^(HPLC|GCMS|LCMS|GC|FT-IR|TLC|TOC)(\s|$|,)'
      OR name IN ('HPLC','GCMS','LCMS','GC','FT-IR','TLC','TOC','TOC, 전도도')
    )
    AND name NOT ILIKE '%함량%'
    AND name NOT ILIKE '%확인%'
    THEN '기기분석'

    -- 함량시험
    WHEN name ILIKE '%함량%'
    THEN '함량시험'

    -- 확인시험 (TLC 확인, LC 확인 등)
    WHEN name ILIKE '%확인%'
      OR (name ILIKE '%TLC%' AND name NOT ILIKE '%이화학%')
    THEN '확인시험'

    -- 이화학 (pH, 건조감량, 붕해, 용출, 수분 등)
    WHEN name ILIKE '%이화학%'
      OR name = 'pH'
      OR name ILIKE '%건조감량%'
      OR name ILIKE '%붕해%'
      OR name ILIKE '%용출%'
      OR name ILIKE '%수분%'
      OR name ILIKE '%비중%'
      OR name ILIKE '%흐름성%'
      OR name ILIKE '%경도%'
      OR name ILIKE '%수성엑스%'
      OR name ILIKE '%에탄올엑스%'
      OR name ILIKE '%회분%'
    THEN '이화학'

    ELSE '기타'
  END;
