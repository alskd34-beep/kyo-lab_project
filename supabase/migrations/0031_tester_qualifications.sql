-- ============================================================
-- 0031_tester_qualifications.sql
--
-- 시험자 자격 인증(Qualification List) — 기준 설정에서 관리한다.
--
-- 사내 「Qualification List」 양식을 그대로 데이터로 옮긴다.
--   카테고리(QC 완제품 고형제(정제1) …) → OJT 항목(함량/질량편차(HPLC) …) → 시험자별 자격 보유
--
-- 기존 tester_capability_matrix(역량 Y/O/N)와는 다른 개념이다.
--   - 역량: 그 기기·시험을 "할 수 있는가" (자동배정 후보 판정에 쓴다)
--   - 자격: 그 OJT 항목을 "인증받아 유효기간 안에 있는가" (GMP 자격 관리)
--   둘을 한 테이블로 합치면 유효기간이 없는 역량까지 만료 대상이 되므로 분리한다.
--
-- 만료 여부는 저장하지 않고 expires_on 과 오늘을 비교해 계산한다(types/qualification.ts).
-- 값이 바뀌지 않는데 상태만 바뀌는 컬럼을 두면 배치로 갱신해야 하고, 갱신 누락이 곧 오판이 된다.
--
-- [적용 방법] ⚠️ `supabase db push` 를 쓰지 말 것 — 0028 헤더의 경고 참조.
--   대시보드 SQL Editor 에서 이 파일만 실행한다. 전부 재실행 안전(if not exists / on conflict).
-- ============================================================

-- ─── 1) 자격 카테고리 ────────────────────────────────────────────────────────
create table if not exists qualification_categories (
  id         uuid primary key default gen_random_uuid(),
  name       text not null unique,
  sort_order int  not null default 0,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table qualification_categories is
  'Qualification List 의 그룹 머리행 (QC Sampling, QC 완제품 고형제(정제1) …)';

-- ─── 2) 자격 항목 (OJT 항목) ─────────────────────────────────────────────────
create table if not exists qualification_items (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid not null references qualification_categories(id) on delete cascade,
  name         text not null,
  -- 부여일 기준 유효기간. 만료일을 비워두고 부여하면 이 값으로 계산한다.
  valid_months int  not null default 24,
  note         text,
  sort_order   int  not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (category_id, name)
);

create index if not exists idx_qual_items_category
  on qualification_items(category_id, sort_order);

comment on column qualification_items.valid_months is
  '자격 유효기간(개월). 자격 부여 시 만료일을 비우면 부여일 + 이 개월수로 계산한다.';

-- ─── 3) 시험자별 자격 보유 ───────────────────────────────────────────────────
create table if not exists tester_qualifications (
  id                    uuid primary key default gen_random_uuid(),
  tester_id             uuid not null references testers(id) on delete cascade,
  qualification_item_id uuid not null references qualification_items(id) on delete cascade,
  -- 자격종류. 같은 OJT 항목을 시험자 자격과 검토자 자격으로 따로 가질 수 있다.
  qualification_role    text not null default '시험자',
  granted_on            date not null,
  -- 만료일. null 이면 무기한(만료 관리 대상 아님).
  expires_on            date,
  cert_type             text not null,   -- 인증구분: 최초인증 / 재인증 / 기존인증
  cert_method           text not null,   -- 인증방법: OJT / Skill 평가 점수 충족 / 기존인증
  note                  text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (tester_id, qualification_item_id, qualification_role)
);

create index if not exists idx_tester_quals_tester on tester_qualifications(tester_id);
create index if not exists idx_tester_quals_item   on tester_qualifications(qualification_item_id);
create index if not exists idx_tester_quals_expiry on tester_qualifications(expires_on);

comment on table tester_qualifications is
  '시험자가 보유한 자격 1건. 행이 없으면 미보유, expires_on 이 지났으면 만료(계산값).';

-- updated_at 트리거 — set_updated_at() 은 0010 에서 만든다.
do $$
begin
  if exists (select 1 from pg_proc where proname = 'set_updated_at') then
    if not exists (select 1 from pg_trigger where tgname = 'trg_qual_categories_updated') then
      create trigger trg_qual_categories_updated before update on qualification_categories
        for each row execute function set_updated_at();
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'trg_qual_items_updated') then
      create trigger trg_qual_items_updated before update on qualification_items
        for each row execute function set_updated_at();
    end if;
    if not exists (select 1 from pg_trigger where tgname = 'trg_tester_quals_updated') then
      create trigger trg_tester_quals_updated before update on tester_qualifications
        for each row execute function set_updated_at();
    end if;
  end if;
end $$;

-- ─── 4) 기준 데이터 — 사내 Qualification List 양식 ───────────────────────────
insert into qualification_categories (name, sort_order) values
  ('QC Sampling',                 10),
  ('QC 완제품 고형제 (정제1)',    20),
  ('QC 완제품 고형제 (정제2)',    30),
  ('QC 완제품 고형제 (정제3)',    40),
  ('QC 완제품 생약제제 (정제3)',  50),
  ('QC 완제품 액제 1',            60),
  ('QC 밸리데이션',               70)
on conflict (name) do nothing;

insert into qualification_items (category_id, name, sort_order)
select c.id, v.name, v.sort_order
  from (values
    ('QC Sampling',                'QC Sampling',            10),
    ('QC 완제품 고형제 (정제1)',   '함량/질량편차(HPLC)',    10),
    ('QC 완제품 고형제 (정제1)',   '함량/질량편차(UV)',      20),
    ('QC 완제품 고형제 (정제1)',   '붕해',                   30),
    ('QC 완제품 고형제 (정제1)',   '납/비소(ICP-MS)',        40),
    ('QC 완제품 고형제 (정제2)',   '함량/함균(HPLC)',        10),
    ('QC 완제품 고형제 (정제2)',   '용출(용출기/HPLC)',      20),
    ('QC 완제품 고형제 (정제3)',   '함량(형광분광광도계)',   10),
    ('QC 완제품 고형제 (정제3)',   '잔류용매(GC)',           20),
    ('QC 완제품 생약제제 (정제3)', '확인(LCMS)',             10),
    ('QC 완제품 생약제제 (정제3)', '확인(GCMS)',             20),
    ('QC 완제품 생약제제 (정제3)', '함량(LCMS)',             30),
    ('QC 완제품 생약제제 (정제3)', '함량(GCMS)',             40),
    ('QC 완제품 액제 1',           '확인(TLC)',              10),
    ('QC 밸리데이션',              '밸리데이션',             10)
  ) as v(category_name, name, sort_order)
  join qualification_categories c on c.name = v.category_name
on conflict (category_id, name) do nothing;

-- ─── 5) 예시 자격 — 김태훈(사번 16242) ──────────────────────────────────────
-- 사내 Qualification List 실물 1장을 그대로 넣는다. 다른 시험자는 미보유로 남겨
-- 매트릭스에서 "보유/미보유"가 바로 구분되는지 확인할 수 있게 한다.
insert into tester_qualifications
  (tester_id, qualification_item_id, qualification_role, granted_on, expires_on, cert_type, cert_method, note)
select t.id, i.id, '시험자', v.granted_on::date, v.expires_on::date, v.cert_type, v.cert_method,
       nullif(v.note, '')
  from (values
    ('QC Sampling',                'QC Sampling',           '2025-04-30', '2027-04-30', '최초인증', 'OJT',
     'RAMIN / NIR 작업을 제외한 Sampling 작업을 수행한다.'),
    ('QC 완제품 고형제 (정제1)',   '함량/질량편차(HPLC)',   '2024-10-31', '2026-10-31', '재인증',   'Skill 평가 점수 충족', ''),
    ('QC 완제품 고형제 (정제1)',   '함량/질량편차(UV)',     '2024-10-31', '2026-10-31', '재인증',   'Skill 평가 점수 충족', ''),
    ('QC 완제품 고형제 (정제1)',   '붕해',                  '2024-10-31', '2026-10-31', '재인증',   'Skill 평가 점수 충족', ''),
    ('QC 완제품 고형제 (정제1)',   '납/비소(ICP-MS)',       '2024-10-31', '2026-10-31', '재인증',   '기존인증',
     '품질관리팀 팀장 승인 하에 재인증 생략, 기존 인증(기존 경력)으로 재인증 대체'),
    ('QC 완제품 고형제 (정제2)',   '함량/함균(HPLC)',       '2024-10-31', '2026-10-31', '재인증',   'Skill 평가 점수 충족', ''),
    ('QC 완제품 고형제 (정제2)',   '용출(용출기/HPLC)',     '2024-10-31', '2026-10-31', '재인증',   'Skill 평가 점수 충족', ''),
    ('QC 완제품 고형제 (정제3)',   '함량(형광분광광도계)',  '2024-10-31', '2026-10-31', '재인증',   '기존인증',
     '품질관리팀 팀장 승인 하에 재인증 생략, 기존 인증(기존 경력)으로 재인증 대체'),
    ('QC 완제품 고형제 (정제3)',   '잔류용매(GC)',          '2024-10-31', '2026-10-31', '재인증',   'Skill 평가 점수 충족', ''),
    ('QC 완제품 생약제제 (정제3)', '확인(LCMS)',            '2024-10-31', '2026-10-31', '재인증',   'Skill 평가 점수 충족', ''),
    ('QC 완제품 생약제제 (정제3)', '확인(GCMS)',            '2024-10-31', '2026-10-31', '재인증',   'Skill 평가 점수 충족', ''),
    ('QC 완제품 생약제제 (정제3)', '함량(LCMS)',            '2024-10-31', '2026-10-31', '재인증',   'Skill 평가 점수 충족', ''),
    ('QC 완제품 생약제제 (정제3)', '함량(GCMS)',            '2024-10-31', '2026-10-31', '재인증',   'Skill 평가 점수 충족', ''),
    ('QC 완제품 액제 1',           '확인(TLC)',             '2024-10-31', '2026-10-31', '재인증',   '기존인증',
     '품질관리팀 팀장 승인 하에 재인증 생략, 기존 인증(기존 경력)으로 재인증 대체'),
    ('QC 밸리데이션',              '밸리데이션',            '2024-10-31', '2026-10-31', '기존인증', 'Skill 평가 점수 충족', '')
  ) as v(category_name, item_name, granted_on, expires_on, cert_type, cert_method, note)
  join qualification_categories c on c.name = v.category_name
  join qualification_items i on i.category_id = c.id and i.name = v.item_name
  join testers t on t.employee_no = '16242'
on conflict (tester_id, qualification_item_id, qualification_role) do nothing;
