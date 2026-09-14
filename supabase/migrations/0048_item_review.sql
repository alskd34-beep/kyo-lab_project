-- ─────────────────────────────────────────────────────────────────────────────
-- 시험항목 단위 검토 — qc_job_items.review_* + qc_job_item_review_history
--                     + derive_job_stage / recompute_job_stage / item_review_action / item_review_bulk_action
--
-- 배경: 검토가 작업 하나를 통째로 다뤘다. 시험항목을 전부 끝내야 작업이 검토전으로 넘어가고,
--       관리자는 그때부터 작업 단위 [검토 시작]·[검토 완료] 를 눌렀다. 그래서 끝난 항목의 검토가
--       마지막 항목을 기다리며 멈췄고, 어느 항목을 누가 언제 검토했는지는 남지 않았다.
--       이제 검토는 **시험항목마다** 하고, 작업 단계(진행중·검토전·검토중·승인전)는 항목 상태에서
--       서버가 도출한다. 규칙 전문: intent/2026-09-15-item-level-review-spec.md
--
-- 모델: 시험 축 status(pending/in_progress/cleared) 는 의미를 바꾸지 않는다 — 항목별 실소요 통계·
--       동시분석 절감·완료 KPI 가 'cleared' 를 "시험이 끝났다" 로 읽는다. 검토 축은 별도 컬럼
--       review_status(none/reviewing/reviewed) 로 둔다. 둘의 불변식은 CHECK 로 강제한다.
--
-- 왜 함수인가: 검토 기록이 남지 않으면 검토도 없어야 한다(GMP/ALCOA+). 항목 갱신·검토 이력·
--   작업 단계 전환·상태 이력을 앱에서 여러 번 나눠 쓰면 트랜잭션이 없어 한쪽만 남는다.
--   함수 본문 전체가 한 트랜잭션이다(0047 선례). 슬랙·앱 알림·오더 상태 동기화는 커밋 뒤 서버(TS)가 한다.
--
-- 단계 도출 규칙의 단일 기준은 derive_job_stage 다. 화면·TS 에 같은 규칙을 다시 쓰지 않는다.
--   recompute_job_stage = (현재 '승인완료'·'지연' 이면 건너뜀) + derive_job_stage + 다르면 쓰기·이력.
--   항목 이벤트(항목 완료, 검토 시작·완료·취소, 재실시, 담당자 변경(F2))에서만 부른다.
--
-- 잠금 순서(교착 방지 — 이 순서를 바꾸지 않는다): 1) qc_jobs 행  2) 그 작업의 qc_job_items 행
--   0047 cancel_job_start 와 F2 reassign_job_item 도 작업 행을 먼저 잡는다.
--
-- 상태 문자열은 이 파일 안에서만 리터럴로 쓴다.
-- ⚠️ types/qc-status.ts 와 반드시 같은 값이어야 한다. 그 파일의 값을 바꾸면 이 파일도 함께 바꾼다.
--    '진행중' IN_PROGRESS_STATUS · '검토전' REVIEW_READY_STATUS · '검토중' REVIEWING_STATUS ·
--    '승인전' APPROVAL_READY_STATUS · '승인완료' APPROVED_STATUS(CLOSED_STAGE) · '지연' DELAYED_STATUS ·
--    'pending' ITEM_PENDING · 'cleared' ITEM_CLEARED ·
--    'none' ITEM_REVIEW_NONE · 'reviewing' ITEM_REVIEW_REVIEWING · 'reviewed' ITEM_REVIEW_REVIEWED ·
--    'review_start'·'review_complete'·'review_cancel'·'reopen' ITEM_REVIEW_ACTIONS
--
-- 거절 메시지는 errcode P0001 로 던진다 — 서비스(qcJobItemReview.ts)가 메시지를 그대로 화면에 보여 준다.
--
-- 보안: 함수들은 p_user_id·p_actor 를 그대로 믿는다. 실행 권한은 service_role(서버) 에만 준다.
--       사용자 id 는 서버가 로그인 토큰에서 꺼내 넘긴다.
--
-- 의존: 0003_auth.sql (users), 0010_pct_workflow.sql (pct_orders·qc_jobs·qc_job_items),
--       0030_qc_item_elapsed_from_start.sql (elapsed_total_minutes), 0035_qc_job_status_history.sql,
--       0040_qc_job_item_start.sql (started_at)
-- ⚠️ 수동 적용 대상: Supabase 대시보드 > SQL Editor 에서 직접 실행하세요. (idempotent — 다시 실행해도 안전)
--    `supabase db push` 금지 — 0028 헤더의 경고 참조.
--    적용 전에는 항목 검토 동작이 "DB 설치(0048 마이그레이션)가 아직 적용되지 않았습니다" 로 거절되고,
--    시험자 항목 조작도 쓰기 전에 안내 메시지로 거절된다.
--    배포 순서: SQL 0048 → 0049 → 0050 적용 → 앱 배포.
--    ⚠️ 0048 은 **앱 배포 직전에** 적용하고, 앱 배포 뒤에는 **다시 실행하지 않는다.**
--       적용~배포 사이에 구 앱이 작업 단위 [검토 시작]·[검토 완료] 로 넘긴 작업을 재실행 백필이
--       "도입(0048) 이전 작업 단위 검토" 로 오기록한다. (새 앱의 [승인] 은 전 항목 검토 완료를 요구한다)
--    파일 전체를 한 트랜잭션(begin … commit)으로 감쌌다 — 중간 실패 시 "컬럼은 있고 함수는 없는" 부분 적용을 막는다.
--
-- ── 적용 전 건수 확인 (먼저 따로 실행해 백필 규모를 본다) ──────────────────────
--   -- ① 작업 상태 × 항목 시험 상태별 건수
--   select j.status as job_status, i.status as item_status, count(*)
--     from qc_job_items i join qc_jobs j on j.id = i.qc_job_id
--    group by 1, 2 order by 1, 2;
--
--   -- ② 백필 대상 항목 수 (승인전·승인완료 → reviewed, 검토중 → reviewing)
--   select case when j.status in ('승인전','승인완료') then 'reviewed' else 'reviewing' end as to_review, count(*)
--     from qc_job_items i join qc_jobs j on j.id = i.qc_job_id
--    where j.status in ('승인전','승인완료','검토중') and i.status = 'cleared'
--    group by 1;
--
--   -- ③ 승인전·승인완료·검토중 작업인데 미완료 항목이 남은 작업 수 (그 항목은 백필하지 않는다)
--   select j.status, count(distinct j.id)
--     from qc_jobs j join qc_job_items i on i.qc_job_id = j.id
--    where j.status in ('승인전','승인완료','검토중') and i.status <> 'cleared'
--    group by 1;
-- ─────────────────────────────────────────────────────────────────────────────

begin;

-- ① 검토 컬럼 ────────────────────────────────────────────────────────────────
alter table qc_job_items add column if not exists review_status          text not null default 'none';
alter table qc_job_items add column if not exists review_started_at      timestamptz;
alter table qc_job_items add column if not exists review_started_by      uuid references users(id) on delete set null;
alter table qc_job_items add column if not exists review_started_by_name text;
alter table qc_job_items add column if not exists reviewed_at            timestamptz;
alter table qc_job_items add column if not exists reviewed_by            uuid references users(id) on delete set null;
alter table qc_job_items add column if not exists reviewed_by_name       text;

comment on column qc_job_items.review_status is
  '검토 축: none(검토 없음) · reviewing(검토 중) · reviewed(검토 완료). 시험 축 status 와 직교하며, none 이 아니면 status 는 반드시 cleared. types/qc-status.ts ITEM_REVIEW_* 와 같은 값.';
comment on column qc_job_items.review_started_by_name is '검토 시작자 이름 스냅샷(users.display_name ?? username)';
comment on column qc_job_items.reviewed_by_name is '검토 완료자 이름 스냅샷(users.display_name ?? username)';


-- ② 제약 (0044/0045 패턴: drop if exists 뒤 add) ────────────────────────────────
alter table qc_job_items drop constraint if exists chk_qc_job_items_review_status;
alter table qc_job_items add constraint chk_qc_job_items_review_status
  check (review_status in ('none', 'reviewing', 'reviewed'));

-- 시험이 끝나지 않은 항목은 검토 흔적을 가질 수 없다.
alter table qc_job_items drop constraint if exists chk_qc_job_items_review_requires_cleared;
alter table qc_job_items add constraint chk_qc_job_items_review_requires_cleared
  check (review_status = 'none' or status = 'cleared');

create index if not exists idx_qc_job_items_reviewing
  on qc_job_items(qc_job_id) where review_status = 'reviewing';


-- ③ 검토 이력 테이블 ─────────────────────────────────────────────────────────
-- 컬럼 값은 재실시·검토 취소 때 비워지므로 원래 사실은 이 테이블에만 남는다.
-- 항목·작업 FK 는 on delete set null — 작업 시작 취소(0047 cascade)나 F2 의 항목 행 삭제가 일어나도
-- 이력은 지워지지 않는다. 행이 사라져도 추적되도록 order_id·qc_no·test_item_name 스냅샷을 함께 둔다.
create table if not exists qc_job_item_review_history (
  id                 uuid primary key default gen_random_uuid(),
  qc_job_item_id     uuid references qc_job_items(id) on delete set null,
  qc_job_id          uuid references qc_jobs(id) on delete set null,   -- 기록 당시 작업
  order_id           uuid not null references pct_orders(id) on delete cascade,
  qc_no              text,                                              -- 기록 당시 QC번호 스냅샷
  test_item_name     text not null,                                     -- 기록 당시 항목명 스냅샷
  action             text not null,
  from_review_status text,
  to_review_status   text,
  changed_by         uuid references users(id) on delete set null,     -- 백필은 null
  changed_by_name    text,
  reason             text,
  snapshot           jsonb,
  created_at         timestamptz not null default now()
);

alter table qc_job_item_review_history drop constraint if exists chk_qc_job_item_review_history_action;
alter table qc_job_item_review_history add constraint chk_qc_job_item_review_history_action
  check (action in ('review_start', 'review_complete', 'review_cancel', 'reopen', 'backfill'));

create index if not exists idx_qc_job_item_review_history_item
  on qc_job_item_review_history(qc_job_item_id, created_at);
create index if not exists idx_qc_job_item_review_history_job
  on qc_job_item_review_history(qc_job_id, created_at);
-- pct_orders 하드 삭제(cascade) 때 순차 스캔을 막는다
create index if not exists idx_qc_job_item_review_history_order
  on qc_job_item_review_history(order_id);

comment on table qc_job_item_review_history is
  '시험항목 검토 이력(GMP 감사) — 검토 시작·완료·취소·재실시·백필마다 1행. 재실시·취소로 비워진 원 기록은 snapshot 에 남는다.';

-- RLS (0033·0035 원칙: 기본 차단, 정책 없음 → service_role 만 통과)
alter table qc_job_item_review_history enable row level security;
alter table qc_job_item_review_history force row level security;


-- ④ 백필 (Q5 — 지어내지 않는다: 검토자·시각은 비워 두고 backfill 로 표시) ─────────
--   승인전·승인완료 작업의 cleared 항목 → reviewed / 검토중 작업의 cleared 항목 → reviewing
--   검토전·진행중·지연 → none 유지 / 미완료 항목은 CHECK 와 충돌하므로 건너뛰고 건수만 알린다.
--   재실행 안전: 항목이 none 이고 그 항목의 backfill 이력이 없으며, **그 작업에 검토 이력이 하나도 없을 때만**.
--   (도입 뒤에는 검토중 작업에 검토 대기(cleared+none) 항목이 정상적으로 있다 — 작업 단위 조건이 없으면
--    재실행이 그 항목을 검토 중으로 지어낸다.)
do $$
declare
  v_skipped int;
begin
  select count(*) into v_skipped
    from qc_job_items i join qc_jobs j on j.id = i.qc_job_id
   where j.status in ('승인전', '승인완료', '검토중')
     and i.status <> 'cleared'
     and not exists (select 1 from qc_job_item_review_history h where h.qc_job_id = j.id);
  if v_skipped > 0 then
    raise notice '[0048 백필] 승인전·승인완료·검토중 작업의 미완료 시험항목 %건은 백필하지 않았습니다(검토 없음 유지).', v_skipped;
  end if;
end
$$;

with targets as (
  select i.id              as item_id,
         i.qc_job_id       as job_id,
         j.order_id        as order_id,
         j.qc_no           as qc_no,
         i.test_item_name  as test_item_name,
         case when j.status in ('승인전', '승인완료') then 'reviewed' else 'reviewing' end as to_review
    from qc_job_items i
    join qc_jobs j on j.id = i.qc_job_id
   where j.status in ('승인전', '승인완료', '검토중')
     and i.status = 'cleared'
     and i.review_status = 'none'
     and not exists (
       select 1 from qc_job_item_review_history h
        where h.qc_job_item_id = i.id and h.action = 'backfill')
     and not exists (
       select 1 from qc_job_item_review_history h
        where h.qc_job_id = j.id)
),
logged as (
  insert into qc_job_item_review_history
    (qc_job_item_id, qc_job_id, order_id, qc_no, test_item_name, action,
     from_review_status, to_review_status, changed_by, changed_by_name, reason, snapshot)
  select t.item_id, t.job_id, t.order_id, t.qc_no, t.test_item_name, 'backfill',
         'none', t.to_review, null, null,
         case when t.to_review = 'reviewed'
              then '항목 단위 검토 도입(0048) 이전 — 작업 단위로 검토 완료됨, 검토자·시각 알 수 없음'
              else '항목 단위 검토 도입(0048) 이전 — 작업 단위 검토 중이었음, 검토자·시각 알 수 없음' end,
         null
    from targets t
  returning qc_job_item_id, to_review_status
)
update qc_job_items i
   set review_status = l.to_review_status
  from logged l
 where i.id = l.qc_job_item_id;


-- ⑤ 단계 도출 (순수 조회) ────────────────────────────────────────────────────
-- 입력: 그 작업의 항목 전부. N = 항목 수, C = cleared 수, S = reviewing+reviewed 수, V = reviewed 수.
--   N > 0 이고 V = N → '승인전'  /  S ≥ 1 → '검토중'  /  N > 0 이고 C = N → '검토전'  /  그 외 '진행중'
-- 현재 작업 상태('승인완료'·'지연')는 보지 않는다 — 그 판단은 recompute_job_stage 와 서비스(직접 변경)의 몫이다.
-- 없는 작업이면 null.
-- (STABLE 로 두지 않는다 — 호출자가 같은 트랜잭션에서 방금 쓴 항목·잠금 대기 뒤 커밋된 항목을 항상 새 스냅샷으로 읽게)
create or replace function derive_job_stage(p_job_id uuid)
returns text
language plpgsql
set search_path = public
as $$
declare
  v_n int; v_c int; v_s int; v_v int;
begin
  if not exists (select 1 from qc_jobs where id = p_job_id) then
    return null;
  end if;

  select count(*),
         count(*) filter (where status = 'cleared'),
         count(*) filter (where review_status in ('reviewing', 'reviewed')),
         count(*) filter (where review_status = 'reviewed')
    into v_n, v_c, v_s, v_v
    from qc_job_items
   where qc_job_id = p_job_id;

  if v_n > 0 and v_v = v_n then return '승인전'; end if;
  if v_s >= 1 then return '검토중'; end if;
  if v_n > 0 and v_c = v_n then return '검토전'; end if;
  return '진행중';
end;
$$;

comment on function derive_job_stage(uuid) is
  '작업 단계 도출 규칙의 단일 기준(순수 조회). 항목 상태만 보고 진행중·검토전·검토중·승인전 중 하나를 돌려준다. service_role 전용.';


-- ⑥ 단계 재도출 (호출자 트랜잭션 안에서 실행) ─────────────────────────────────
-- ① 작업 행 잠금 ② 현재 '승인완료'·'지연' 이면 그대로 ③ 항목 행 잠금 뒤 도출 ④ 다르면 쓰기 + 상태 이력(source auto)
-- pct_orders 는 쓰지 않는다 — 오더 상태는 커밋 뒤 서버의 syncOrderStatusFromJobs 가 현행 규칙으로 맞춘다.
-- 호출마다 잠금 아래에서 현재 항목을 다시 읽으므로 몇 번을 불러도 같은 값으로 수렴한다(재실행 안전).
create or replace function recompute_job_stage(p_job_id uuid, p_actor uuid, p_note text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_job   qc_jobs%rowtype;
  v_to    text;
  v_name  text;
  v_note  text;
begin
  select * into v_job from qc_jobs where id = p_job_id for update;
  if not found then
    raise exception '작업을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;

  if v_job.status in ('승인완료', '지연') then
    return jsonb_build_object(
      'jobId', v_job.id, 'orderId', v_job.order_id, 'qcNo', v_job.qc_no,
      'from', v_job.status, 'to', v_job.status, 'changed', false);
  end if;

  perform 1 from qc_job_items where qc_job_id = p_job_id for update;
  v_to := derive_job_stage(p_job_id);

  if v_to is not distinct from v_job.status then
    return jsonb_build_object(
      'jobId', v_job.id, 'orderId', v_job.order_id, 'qcNo', v_job.qc_no,
      'from', v_job.status, 'to', v_job.status, 'changed', false);
  end if;

  v_note := coalesce(nullif(btrim(p_note), ''), '시험항목 상태에 따라 서버가 자동 전환했습니다.');

  -- work_end_date 는 건드리지 않는다(승인완료 진입·이탈 때만 바뀌는 기존 규칙).
  update qc_jobs set status = v_to where id = p_job_id;

  if p_actor is not null then
    select coalesce(display_name, username) into v_name from users where id = p_actor;
  end if;

  insert into qc_job_status_history
    (qc_job_id, order_id, from_status, to_status, changed_by, changed_by_name, source, note)
  values
    (v_job.id, v_job.order_id, v_job.status, v_to, p_actor, v_name, 'auto', v_note);

  -- note 는 상태 이력에 적은 문구 그대로 — 서버가 커밋 뒤 슬랙·앱 알림에 같은 문구를 쓴다.
  return jsonb_build_object(
    'jobId', v_job.id, 'orderId', v_job.order_id, 'qcNo', v_job.qc_no,
    'from', v_job.status, 'to', v_to, 'changed', true, 'note', v_note);
end;
$$;

comment on function recompute_job_stage(uuid, uuid, text) is
  '작업 단계 재도출. 잠금: qc_jobs → qc_job_items. 승인완료·지연은 건너뛰고, derive_job_stage 결과가 다르면 qc_jobs.status 와 qc_job_status_history(source auto)를 쓴다. service_role 전용.';


-- ⑦ 항목 한 건에 검토 동작 적용 (내부용 — 호출자가 작업·항목 행을 이미 잠갔다고 가정) ──
-- 전제 검사(조건 5)·항목 갱신·검토 이력 1행을 한다. 권한·사유·작업 상태 검사와 단계 재도출은 호출자 몫이다.
-- 반환: { itemId, testItemName, action, reviewStatusBefore, reviewStatusAfter }
create or replace function apply_item_review_step(
  p_item_id uuid, p_action text, p_actor uuid, p_actor_name text, p_reason text
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_item     qc_job_items%rowtype;
  v_job      qc_jobs%rowtype;
  v_after    text;
  v_snapshot jsonb := null;
  v_now      timestamptz := now();
begin
  select * into v_item from qc_job_items where id = p_item_id;
  if not found then
    raise exception '시험항목을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;
  select * into v_job from qc_jobs where id = v_item.qc_job_id;

  if p_action = 'review_start' then
    if v_item.status is distinct from 'cleared' then
      raise exception '완료된 시험항목만 검토를 시작할 수 있습니다.' using errcode = 'P0001';
    end if;
    if v_item.review_status is distinct from 'none' then
      raise exception '이미 검토를 시작한 시험항목입니다.' using errcode = 'P0001';
    end if;
    v_after := 'reviewing';
    update qc_job_items
       set review_status = 'reviewing',
           review_started_at = v_now, review_started_by = p_actor, review_started_by_name = p_actor_name
     where id = p_item_id;

  elsif p_action = 'review_complete' then
    if v_item.review_status = 'none' then
      raise exception '검토를 시작하지 않은 시험항목입니다.' using errcode = 'P0001';
    end if;
    if v_item.review_status = 'reviewed' then
      raise exception '이미 검토를 완료한 시험항목입니다.' using errcode = 'P0001';
    end if;
    v_after := 'reviewed';
    -- review_started_* 는 유지한다.
    update qc_job_items
       set review_status = 'reviewed',
           reviewed_at = v_now, reviewed_by = p_actor, reviewed_by_name = p_actor_name
     where id = p_item_id;

  elsif p_action = 'review_cancel' then
    if v_item.review_status = 'none' then
      raise exception '검토를 시작하지 않은 시험항목입니다.' using errcode = 'P0001';
    end if;
    -- F1-2: 검토 완료 취소는 없다. 되돌리려면 재실시만.
    if v_item.review_status = 'reviewed' then
      raise exception '검토를 완료한 시험항목은 검토 취소할 수 없습니다. 재실시로 조정하세요.' using errcode = 'P0001';
    end if;
    v_after := 'none';
    v_snapshot := jsonb_build_object(
      'review_started_at',      v_item.review_started_at,
      'review_started_by',      v_item.review_started_by,
      'review_started_by_name', v_item.review_started_by_name);
    update qc_job_items
       set review_status = 'none',
           review_started_at = null, review_started_by = null, review_started_by_name = null
     where id = p_item_id;

  elsif p_action = 'reopen' then
    if v_item.status is distinct from 'cleared' then
      raise exception '완료된 시험항목만 재실시할 수 있습니다.' using errcode = 'P0001';
    end if;
    v_after := 'none';
    -- GMP: 실측 기록(시각·소요)·검토 기록을 비우기 **전에** 원본 그대로 이력에 남긴다.
    v_snapshot := jsonb_build_object(
      'status',                 v_item.status,
      'started_at',             v_item.started_at,
      'cleared_at',             v_item.cleared_at,
      'elapsed_minutes',        v_item.elapsed_minutes,
      'elapsed_total_minutes',  v_item.elapsed_total_minutes,
      'review_status',          v_item.review_status,
      'review_started_at',      v_item.review_started_at,
      'review_started_by',      v_item.review_started_by,
      'review_started_by_name', v_item.review_started_by_name,
      'reviewed_at',            v_item.reviewed_at,
      'reviewed_by',            v_item.reviewed_by,
      'reviewed_by_name',       v_item.reviewed_by_name);

  else
    raise exception '알 수 없는 검토 동작입니다.' using errcode = 'P0001';
  end if;

  -- 이력 먼저(재실시는 스냅샷이 곧 원 기록이다). 같은 트랜잭션이라 실패하면 동작도 없다.
  insert into qc_job_item_review_history
    (qc_job_item_id, qc_job_id, order_id, qc_no, test_item_name, action,
     from_review_status, to_review_status, changed_by, changed_by_name, reason, snapshot)
  values
    (v_item.id, v_item.qc_job_id, v_job.order_id, v_job.qc_no, v_item.test_item_name, p_action,
     v_item.review_status, v_after, p_actor, p_actor_name,
     case when p_action in ('review_cancel', 'reopen') then btrim(p_reason) else null end,
     v_snapshot);

  if p_action = 'reopen' then
    update qc_job_items
       set status = 'pending',
           started_at = null, cleared_at = null,
           elapsed_minutes = null, elapsed_total_minutes = null,
           review_status = 'none',
           review_started_at = null, review_started_by = null, review_started_by_name = null,
           reviewed_at = null, reviewed_by = null, reviewed_by_name = null
     where id = p_item_id;
  end if;

  return jsonb_build_object(
    'itemId',             v_item.id,
    'testItemName',       v_item.test_item_name,
    'action',             p_action,
    'reviewStatusBefore', v_item.review_status,
    'reviewStatusAfter',  v_after);
end;
$$;

comment on function apply_item_review_step(uuid, text, uuid, text, text) is
  '내부용: 잠긴 항목 1건에 검토 동작(전제 검사·갱신·검토 이력)을 적용한다. item_review_action·item_review_bulk_action 이 부른다. service_role 전용.';


-- ⑧ 항목 검토 동작 (한 트랜잭션) ─────────────────────────────────────────────
-- 판정 순서: 0 사유 → 1 동작 값 → 2 관리자 → 3 항목 존재 → (작업 잠금) 4 승인완료 아님
--            → (항목 잠금) 3' 작업 그대로 → 5 동작별 전제 → 갱신·이력 → 단계 재도출
create or replace function item_review_action(p_item_id uuid, p_user_id uuid, p_action text, p_reason text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_label     text;
  v_role      text;
  v_name      text;
  v_job_id    uuid;
  v_job       qc_jobs%rowtype;
  v_locked_job uuid;
  v_step      jsonb;
  v_stage     jsonb;
  v_note_verb text;
begin
  -- 0 사유 (검토 취소·재실시)
  if p_action in ('review_cancel', 'reopen') then
    v_label := case when p_action = 'review_cancel' then '검토 취소' else '재실시' end;
    if p_reason is null then
      raise exception '% 사유를 입력해 주세요.', v_label using errcode = 'P0001';
    end if;
    if length(btrim(p_reason)) < 2 then
      raise exception '% 사유를 2자 이상 입력해 주세요.', v_label using errcode = 'P0001';
    end if;
  end if;

  -- 1 동작 값
  if p_action is null or p_action not in ('review_start', 'review_complete', 'review_cancel', 'reopen') then
    raise exception '알 수 없는 검토 동작입니다.' using errcode = 'P0001';
  end if;

  -- 2 관리자 (라우트 requireAdmin 을 DB 에서 한 번 더)
  select role::text, coalesce(display_name, username) into v_role, v_name
    from users where id = p_user_id and is_active;
  if v_role is distinct from 'admin' then
    raise exception '관리자만 시험항목을 검토할 수 있습니다.' using errcode = 'P0001';
  end if;

  -- 3 항목 존재 (잠금 없이 작업 id 만 확보)
  select qc_job_id into v_job_id from qc_job_items where id = p_item_id;
  if not found then
    raise exception '시험항목을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;

  -- 작업 행 잠금 → 4 승인완료 아님 ('지연' 은 허용)
  select * into v_job from qc_jobs where id = v_job_id for update;
  if not found then
    raise exception '시험항목을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;
  if v_job.status = '승인완료' then
    raise exception '"승인완료" 단계의 작업은 시험항목 검토를 변경할 수 없습니다. 먼저 작업 상태를 "승인전"으로 되돌리세요.'
      using errcode = 'P0001';
  end if;

  -- 항목 행 잠금 → 3' 잠그는 사이 다른 작업으로 옮겨지지 않았는가(F2 경합)
  select qc_job_id into v_locked_job from qc_job_items where id = p_item_id for update;
  if not found then
    raise exception '시험항목을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;
  if v_locked_job is distinct from v_job_id then
    raise exception '다른 사용자가 먼저 변경했습니다. 새로고침 후 다시 시도하세요.' using errcode = 'P0001';
  end if;

  -- 5 전제 검사 + 갱신 + 검토 이력
  v_step := apply_item_review_step(p_item_id, p_action, p_user_id, v_name, p_reason);

  -- 단계 재도출 (같은 트랜잭션 — 바뀌면 상태 이력도 여기서)
  v_note_verb := case p_action
    when 'review_start'    then '검토 시작으로'
    when 'review_complete' then '검토 완료로'
    when 'review_cancel'   then '검토 취소로'
    else                        '재실시로' end;
  v_stage := recompute_job_stage(
    v_job_id, p_user_id,
    format('시험항목 "%s" %s 서버가 자동 전환했습니다.', v_step->>'testItemName', v_note_verb));

  return v_step || jsonb_build_object('jobId', v_job_id, 'stage', v_stage);
end;
$$;

comment on function item_review_action(uuid, uuid, text, text) is
  '시험항목 검토 시작·완료·취소·재실시(원자적). 잠금: qc_jobs → qc_job_items. 검사·항목 갱신·검토 이력·단계 재도출·상태 이력을 한 트랜잭션으로 처리한다. service_role 전용.';


-- ⑨ 일괄 검토 (F1-4 — 한 트랜잭션, 전부 성공 아니면 전부 실패) ─────────────────
--   review_start    : 그 작업의 cleared + none 항목 전부
--   review_complete : 그 작업의 reviewing 항목 전부
-- 기록은 항목마다 1행. 단계 재도출은 마지막에 한 번(전환 알림도 한 번).
create or replace function item_review_bulk_action(p_job_id uuid, p_user_id uuid, p_action text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_role   text;
  v_name   text;
  v_job    qc_jobs%rowtype;
  v_ids    uuid[];
  v_id     uuid;
  v_steps  jsonb := '[]'::jsonb;
  v_stage  jsonb;
  v_verb   text;
begin
  if p_action is null or p_action not in ('review_start', 'review_complete') then
    raise exception '알 수 없는 검토 동작입니다.' using errcode = 'P0001';
  end if;

  select role::text, coalesce(display_name, username) into v_role, v_name
    from users where id = p_user_id and is_active;
  if v_role is distinct from 'admin' then
    raise exception '관리자만 시험항목을 검토할 수 있습니다.' using errcode = 'P0001';
  end if;

  select * into v_job from qc_jobs where id = p_job_id for update;
  if not found then
    raise exception '작업을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;
  if v_job.status = '승인완료' then
    raise exception '"승인완료" 단계의 작업은 시험항목 검토를 변경할 수 없습니다. 먼저 작업 상태를 "승인전"으로 되돌리세요.'
      using errcode = 'P0001';
  end if;

  perform 1 from qc_job_items where qc_job_id = p_job_id for update;

  select coalesce(array_agg(id order by sequence_order, created_at), '{}'::uuid[]) into v_ids
    from qc_job_items
   where qc_job_id = p_job_id
     and case when p_action = 'review_start'
              then status = 'cleared' and review_status = 'none'
              else review_status = 'reviewing' end;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    raise exception '처리할 시험항목이 없습니다.' using errcode = 'P0001';
  end if;

  foreach v_id in array v_ids loop
    v_steps := v_steps || jsonb_build_array(apply_item_review_step(v_id, p_action, p_user_id, v_name, null));
  end loop;

  v_verb := case when p_action = 'review_start' then '검토 시작으로' else '검토 완료로' end;
  v_stage := recompute_job_stage(
    p_job_id, p_user_id,
    format('시험항목 %s개 %s 서버가 자동 전환했습니다.', array_length(v_ids, 1), v_verb));

  return jsonb_build_object(
    'jobId',  p_job_id,
    'action', p_action,
    'count',  array_length(v_ids, 1),
    'items',  v_steps,
    'stage',  v_stage);
end;
$$;

comment on function item_review_bulk_action(uuid, uuid, text) is
  '작업 1건의 완료 항목 전체 검토 시작 / 검토 중 항목 전체 검토 완료(원자적, all-or-nothing). 잠금: qc_jobs → qc_job_items. service_role 전용.';


-- ⑩ 작업 시작 취소(0047) 보강 — 검토·재실시 이력이 있는 작업은 취소하지 않는다 ─────────
-- 재실시는 항목의 시작·완료 시각·소요시간을 비운다. 그래서 전 항목을 재실시한 작업은 0047 의
-- "전 항목 실행 흔적 0" 조건을 통과해, 시험자의 [시작 취소] 로 작업 행이 지워지고 작업 상태 이력
-- (qc_job_status_history, on delete cascade)과 QC번호가 함께 사라질 수 있었다(GMP 감사 기록 소실).
-- 0047 본문·잠금 순서·권한·기존 거절 메시지는 그대로 두고, 항목 잠금 뒤 판정을 하나 더한다:
--   그 작업의 검토 이력이 1건이라도 있거나, 상태 이력에 작업 시작(from_status null) 외의 전이가 있으면 거절.
-- 판정 순서: 0 → 1a → 1b → 2 → 5 → 4 → 3 → 7(이 조건). spec: intent/2026-09-13-tester-cancel-job-start-spec.md §2
create or replace function cancel_job_start(p_job_id uuid, p_user_id uuid, p_reason text)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_job           qc_jobs%rowtype;
  v_order         pct_orders%rowtype;
  v_item_count    int;
  v_touched_count int;
  v_remaining     int;
  v_status_after  text;
begin
  -- 사유 2자 검사는 서비스가 먼저 한다. 여기서는 비어 있는 호출만 막는다.
  if p_reason is null or length(btrim(p_reason)) < 2 then
    raise exception '시작 취소 사유를 2자 이상 입력해 주세요.' using errcode = 'P0001';
  end if;

  -- ① 작업 행 잠금
  select * into v_job from qc_jobs where id = p_job_id for update;
  if not found then
    raise exception '작업을 찾을 수 없습니다.' using errcode = 'P0001';
  end if;
  if v_job.assignee_user_id is distinct from p_user_id then
    raise exception '본인 작업만 수정할 수 있습니다.' using errcode = 'P0001';
  end if;
  if v_job.status is distinct from '진행중' then
    raise exception '"%" 상태의 작업은 시작을 취소할 수 없습니다. 시작 취소는 ''진행중'' 상태이고 시험항목을 하나도 시작하지 않은 작업만 가능합니다.',
      v_job.status using errcode = 'P0001';
  end if;

  -- ② 오더 행 잠금 — LOCK(locked) 은 보지 않고 건드리지도 않는다(일정 자동변경 금지이지 실행 금지가 아니다).
  select * into v_order from pct_orders where id = v_job.order_id for update;
  if not found then
    raise exception '오더를 찾을 수 없습니다.' using errcode = 'P0001';
  end if;
  if v_order.status = '삭제' then
    raise exception '삭제된 오더의 작업은 시작을 취소할 수 없습니다. 관리자에게 문의하세요.' using errcode = 'P0001';
  end if;

  -- ③ 시험항목 행 전부 잠금 — 동시 항목 시작·완료는 여기서 대기한다.
  perform 1 from qc_job_items where qc_job_id = p_job_id for update;

  select count(*),
         count(*) filter (where status <> 'pending'
                             or started_at is not null
                             or cleared_at is not null
                             or elapsed_minutes is not null
                             or elapsed_total_minutes is not null)
    into v_item_count, v_touched_count
    from qc_job_items
   where qc_job_id = p_job_id;

  if v_item_count = 0 then
    raise exception '시험항목 체크리스트가 없는 작업은 시작을 취소할 수 없습니다. 관리자에게 확인을 요청하세요.' using errcode = 'P0001';
  end if;
  if v_touched_count > 0 then
    raise exception '이미 시작했거나 완료한 시험항목이 있어 작업 시작을 취소할 수 없습니다.' using errcode = 'P0001';
  end if;

  -- ⑦ (0048) 검토·재실시 이력 — 재실시로 흔적이 비워진 작업도 지우지 않는다.
  if exists (select 1 from qc_job_item_review_history where qc_job_id = p_job_id)
     or exists (select 1 from qc_job_status_history where qc_job_id = p_job_id and from_status is not null) then
    raise exception '검토·재실시 이력이 있는 작업은 시작을 취소할 수 없습니다. 관리자에게 문의하세요.' using errcode = 'P0001';
  end if;

  -- 감사 기록 — 사실만 적는다. 작업 시작 취소 사건은 항상 1행.
  insert into pct_order_edits (order_id, field, old_value, new_value, reason, edited_by)
  values (v_order.id, 'jobStart', 'QC ' || v_job.qc_no || ' · 진행중', '시작 취소', btrim(p_reason), p_user_id);

  -- 작업 삭제 — 시험항목·작업 상태 이력은 cascade, 알림의 related_qc_job_id 는 set null.
  delete from qc_jobs where id = p_job_id;

  -- 오더 상태 결정 (0047 과 같다 — 증명은 0047 spec §4)
  select count(*) into v_remaining from qc_jobs where order_id = v_order.id;

  v_status_after := v_order.status;
  if v_remaining = 0 and v_order.status is distinct from '대기' then
    update pct_orders set status = '대기' where id = v_order.id;
    v_status_after := '대기';

    insert into pct_order_edits (order_id, field, old_value, new_value, reason, edited_by)
    values (v_order.id, 'status', v_order.status, '대기', '작업 시작 취소 (QC ' || v_job.qc_no || ')', p_user_id);
  end if;

  return jsonb_build_object(
    'qcNo',              v_job.qc_no,
    'orderId',           v_order.id,
    'productName',       v_order.product_name,
    'batchNo',           v_order.batch_no,
    'orderStatusBefore', v_order.status,
    'orderStatusAfter',  v_status_after
  );
end;
$$;

comment on function cancel_job_start(uuid, uuid, text) is
  '작업 시작 취소(원자적). 잠금: qc_jobs → pct_orders → qc_job_items. 검사·감사(pct_order_edits)·작업 삭제·오더 상태를 한 트랜잭션으로 처리한다. 0048: 검토·재실시·단계 전이 이력이 있는 작업은 거절. service_role 전용.';


-- ⑪ 실행 권한 — 서버(service_role)에만. 사용자 id 를 믿는 함수들이다. ─────────────
revoke all on function derive_job_stage(uuid)                                from public, anon, authenticated;
revoke all on function recompute_job_stage(uuid, uuid, text)                  from public, anon, authenticated;
revoke all on function apply_item_review_step(uuid, text, uuid, text, text)   from public, anon, authenticated;
revoke all on function item_review_action(uuid, uuid, text, text)             from public, anon, authenticated;
revoke all on function item_review_bulk_action(uuid, uuid, text)              from public, anon, authenticated;
revoke all on function cancel_job_start(uuid, uuid, text)                     from public, anon, authenticated;

grant execute on function derive_job_stage(uuid)                              to service_role;
grant execute on function recompute_job_stage(uuid, uuid, text)                to service_role;
grant execute on function apply_item_review_step(uuid, text, uuid, text, text) to service_role;
grant execute on function item_review_action(uuid, uuid, text, text)           to service_role;
grant execute on function item_review_bulk_action(uuid, uuid, text)            to service_role;
grant execute on function cancel_job_start(uuid, uuid, text)                   to service_role;

commit;

notify pgrst, 'reload schema';
