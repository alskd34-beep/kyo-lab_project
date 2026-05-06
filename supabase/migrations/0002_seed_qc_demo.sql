-- ─────────────────────────────────────────────────────────────────────────────
-- 데모 시드 데이터 (현재 페이지에 하드코딩된 8건과 동일)
-- ─────────────────────────────────────────────────────────────────────────────

insert into contractors (name) values ('광동제약(주)')
  on conflict (name) do nothing;

insert into managers (name, initial, avatar_color) values
  ('김수현', '김', 'bg-blue-500'),
  ('박지민', '박', 'bg-violet-500'),
  ('이서연', '이', 'bg-emerald-500'),
  ('최준호', '최', 'bg-amber-500'),
  ('정다은', '정', 'bg-rose-500')
on conflict do nothing;

with c as (select id from contractors where name = '광동제약(주)' limit 1)
insert into tests (test_no, category, type, product, items, contractor_id, manager_id, receive_date, due_date, status, is_deviation)
select v.test_no, v.category, v.type, v.product, v.items, c.id,
       (select id from managers where initial = v.mi limit 1),
       v.receive_date, v.due_date, v.status::qc_status, v.is_deviation
from c, (values
  ('QC-2024-0312','완제품','이화학시험','경옥고 프리미엄','pH, 점도, 비중','김','2024-03-01'::date,'2024-03-15'::date,'completed', false),
  ('QC-2024-0318','원료','미생물시험','비타500 원액','총균수, 대장균','박','2024-03-05','2024-03-20','reviewing', false),
  ('QC-2024-0325','완제품','안정성시험','홍삼농축액 에브리타임','함량, 순도','이','2024-03-08','2024-04-08','inprogress', false),
  ('QC-2024-0331','완제품','이화학시험','옥수수수염차 500ml','pH, 탁도, 당도','최','2024-03-10','2024-03-25','pending', false),
  ('QC-2024-0337','원료','중금속시험','경옥고 원료 배합','Pb, Cd, As, Hg','김','2024-03-12','2024-03-26','completed', false),
  ('QC-2024-0342','완제품','미생물시험','비타500W 제로','총균수, 효모','박','2024-03-14','2024-03-28','fail', true),
  ('QC-2024-0349','원료','이화학시험','홍삼정 에브리타임 2X','진세노사이드 함량','정','2024-03-15','2024-03-29','inprogress', false),
  ('QC-2024-0356','완제품','관능시험','헛개수 플러스','색상, 향, 맛, 이물','이','2024-03-18','2024-04-01','reviewing', false)
) as v(test_no, category, type, product, items, mi, receive_date, due_date, status, is_deviation)
on conflict (test_no) do nothing;
