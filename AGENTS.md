<!-- Generated: 2026-06-08 | Updated: 2026-06-08 -->

# kd_project — 광동제약 QC 시험 관리 시스템

## Purpose
A Next.js 16 (App Router) web application for **Kwangdong Pharmaceutical's Quality Control (QC) testing management** — a pharma LIMS/QMS covering product test management, scheduling, stability studies, deviations (OOS/CAPA), equipment, documents (SOP/STD), and analytics. UI text and domain terms are in Korean. Data lives in Supabase (Postgres); auth is custom JWT (jose + bcrypt) with httpOnly cookies; an AI chatbot streams answers (provider depends on role — see AI providers below).

## Key Files
| File | Description |
|------|-------------|
| `package.json` | Deps & scripts. Dev server runs on **port 3300** (`next dev --turbopack`). |
| `tsconfig.json` | TS config + path aliases (see below). `strict: true`. |
| `middleware.ts` | Edge middleware: verifies `kd_access` JWT cookie, redirects unauthenticated **page** requests to `/login`. API routes pass through to their own `requireAuth` guard. |
| `next.config.mjs` | Next.js config. |
| `eslint.config.mjs` / `.prettierrc` | Lint & format (prettier + tailwind plugin). |
| `components.json` | shadcn/ui config. |
| `.env.local` | Secrets: Supabase URL/keys, `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `OPENAI_API_KEY`. Not committed. |
| `middleware.ts` | Route protection (see above). |

## Path Aliases (tsconfig)
| Alias | Resolves to |
|-------|-------------|
| `@/*` | `./*` (repo root) |
| `@frontend/*` | `./frontend/*` |
| `@backend/*` | `./backend/*` |
| `@shared/*` | `./types/*` |

Always use these aliases in imports; do not write deep relative paths.

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `app/` | Next.js App Router — pages + API route handlers (see `app/AGENTS.md`) |
| `backend/` | Server-only logic: services (DB access) + lib (auth, supabase, guards) (see `backend/AGENTS.md`) |
| `frontend/` | Client-side: React components, hooks, contexts, utils (see `frontend/AGENTS.md`) |
| `types/` | Shared TS types across front/back: `qc.ts`, `pqm.ts` (imported via `@shared/*`) |
| `supabase/` | SQL migrations (`migrations/00xx_*.sql`) — schema + seed data |
| `scripts/` | One-off Node/TS scripts: `migrate.ts`, `seed_pqm.ts`, `bulk_add_jeonhangmok.ts` |
| `public/` | Static assets |
| `temp/` | Temporary & garbage files (screenshots, debug logs, dumps — git ignored) |

## Architecture (request flow)
```
Browser (frontend/ client components)
   │  fetch('/api/...')
   ▼
app/api/**/route.ts   ← thin HTTP handlers, requireAuth guard
   │  call service
   ▼
backend/services/*.ts ← business logic + Supabase queries, maps snake_case rows → camelCase
   │
   ▼
Supabase (Postgres)   ← schema in supabase/migrations
```

## For AI Agents

### Working In This Directory
- **3-layer separation is the core convention**: pages/components (frontend) → API route handlers (`app/api`) → services (`backend/services`). Route handlers stay thin and delegate all logic to a service.
- **임시/가비지 파일 관리**: 스크린샷, 디버그 로그, 테스트 결과물 등 임시 파일은 절대 루트나 소스 디렉토리에 생성하지 말고 반드시 `temp/` (`temp/screenshots/`, `temp/logs/` 등) 아래에 생성한다.
- Korean is the product language. Keep comments, UI strings, and error messages in Korean to match surrounding code. Code identifiers stay in English.
- DB columns are `snake_case`; the app/domain layer is `camelCase`. Services own the mapping (`mapRow` pattern).
- Never import `@backend/*` (services, supabase, secrets) into a client component — it leaks server secrets. Backend code is server-only (`runtime = 'nodejs'`).

### Testing Requirements
- No automated test suite is present. Verify changes with:
  - `npm run typecheck` (tsc --noEmit) — must pass.
  - `npm run lint` (eslint).
  - `npm run build` for production-affecting changes.
  - Manual run: `npm run dev` → http://localhost:3300.

### Common Patterns
- API responses: success returns `Response.json({ rows | row | ok })`; errors return `Response.json({ error: msg }, { status })` with Korean messages. See `app/api/AGENTS.md`.
- Auth: short-lived `kd_access` (15min) + `refresh` (7d) JWT cookies; client auto-refreshes via `/api/auth/refresh` (logic in `frontend/lib/auth-context.tsx`).

## Dependencies

### External (key)
- `next` 16 / `react` 19 — framework (App Router, Turbopack dev).
- `@supabase/supabase-js` — Postgres data layer.
- `jose` (JWT) + `bcryptjs` — custom auth.
- `tailwindcss` v4 + `radix-ui` + shadcn/ui — styling/components; `clsx` + `tailwind-merge` via `cn()`.
- `lucide-react` — icons; `date-fns`, `react-day-picker` — dates; `xlsx` — spreadsheet import/export.
### AI providers (verified 2026-08-22)
Four different providers are in use. Keep this table accurate — it was wrong before (it claimed OpenAI `gpt-4o-mini`, which **nothing** calls).

| Path | Provider | Entry point | Env |
|------|----------|-------------|-----|
| Chatbot — tester role | **MISO app** | `backend/lib/misoClient.ts` | `MISO_API_URL`, `MISO_API_KEY` |
| Chatbot — admin, dev | **Codex CLI** (subprocess) | `backend/lib/codexCli.ts` | `CODEX_EXEC_CMD`, `CODEX_ASSISTANT_MODEL` |
| Chatbot — admin, prod | **Letsur** | `backend/lib/letsurClient.ts` | `LETSUR_BASE_URL`, `LETSUR_API_KEY`, `LETSUR_MODEL` |
| AI order assignment (opt-in) | **Codex CLI** → rule engine fallback | `backend/services/pctAssign.ts` | `ENABLE_CODEX_ASSIGN=1` |

- `@anthropic-ai/sdk` is a leftover dependency — **nothing imports it** since the Anthropic weekly-schedule path was removed (2026-08-22). OpenAI is not a dependency of any code path either.
- Admin chatbot provider is chosen by `CHAT_ADMIN_USE_CLI` (defaults to CLI outside production).
- ⚠️ `LETSUR_*` / `MISO_*` keys are absent from `.env.local`; those two chat paths cannot work until they are set.
- **CLI-first during development, API-based for production — this is deliberate.** The Codex CLI paths reuse a logged-in subscription session instead of burning API credits, and each has a switch (`CHAT_ADMIN_USE_CLI`, `ENABLE_CODEX_ASSIGN`) that flips to the API/rule-engine path. Constraints to resolve before production: `spawn('sh', …)` does not run on Windows servers, and CLI calls leave no audit trail. See `docs/system-audit-2026-08-22.md` item 7.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->

## 착수 전 의도 문서 (intent.md) — AI-Native SDLC
코드를 쓰기 전에 **무엇을 왜 만드는지** `intent/YYYY-MM-DD-슬러그.md` 로 먼저 남긴다.
- **작성**: 직접 쓰지 않고 `/intent <하고 싶은 일>` 로 인터뷰를 받는다(`.claude/commands/intent.md`).
- **전체 가이드**: `docs/ai-native-sdlc.md` · **템플릿**: `intent/TEMPLATE.md`
- **섹션 5개만**: `Problem` · `Proposed outcome` · `Affected users and systems` · `Constraints` · `Open questions`.
  머리에 `Author` / `Status`. `Open questions` 가 비어 있으면 잘못 쓰인 것이다.
- **"어떻게"는 쓰지 않는다** — 기술 선택·구현 방법·파일명·함수명은 플랜 모드의 몫이다.
  구현 방법을 미리 못 박으면 코드베이스를 읽은 뒤에야 보이는 더 나은 방법이 막힌다.
- **`Affected users and systems` 필수 항목**(이 프로젝트 특성): 역할(관리자/시험자/둘 다) ·
  건드리는 Supabase 테이블 · 확정(LOCK)·작업 시작 상태와의 관계 · 크론(`instrumentation.ts`) 영향 여부.
- **Status**: `draft` → `approved` → `completed` (폐기는 `abandoned`, **삭제 금지**).
  `approved` 시점에 intent 를 먼저 커밋하고, `completed` 는 **코드와 같은 커밋**에서 바꾼다(문서가 낡지 않게).
- **단계는 3개로 줄여 쓴다**(1인 개발): intent 필수 → `spec.md` 생략 → `plan.md` 는 플랜 모드 승인으로 대체.
  단, **마이그레이션 동반 · 권한/인증 규칙 · 확정(LOCK)·상태 전이 규칙**을 건드리면 `intent/<이름>-spec.md` 를 같이 둔다.
- **intent 없이 바로 한다**: 오타·문구·색 수정, 동작 규칙이 안 바뀌는 버그 수정, 겉보기 동작 그대로인 리팩터링.
- **intent 가 반드시 필요하다**: 새 화면·새 메뉴, 새 테이블·마이그레이션, 권한 규칙 변경,
  상태 전이·확정 규칙 변경, 외부 연동 추가(슬랙·구글시트·AI 공급자), 크론·자동 실행 추가.
- **중복 금지**: intent 는 "앞으로 만들 변경 하나", `docs/PRD-current-system.md` 는 "이미 만들어진 시스템 전체"다.
  intent 에 시스템 전체 설명을 늘려 쓰지 말고, 완료 후 전체 설명이 달라졌으면 PRD 를 갱신한다.

## UX Preferences
- 별도 요청이 없으면 데이터 수정 작업은 인라인 편집보다 모달/Dialog를 기본 UX로 사용한다.

## 브랜드 메인 컬러
파랑(blue) 하나로 통일한다. `app/globals.css`의 `--primary`/`--ring`/`--sidebar-primary`/
`--sidebar-accent`/`--secondary`가 전부 이 색(`oklch(.. .. 262.88)`, Tailwind `blue-600` 기준)이다.
- 버튼·아이콘 칩·포커스 링·선택된 탭/메뉴·"활성" 상태 등 브랜드·인터랙션 강조색이 필요하면
  가능한 한 시맨틱 클래스(`bg-primary`, `text-primary`, `ring-ring`, `<Button>` 기본 variant)를 쓴다.
  직접 Tailwind 색을 써야 하면 반드시 `blue-*`를 쓴다 — `indigo-*`/`violet-*`/`purple-*`/`sky-*` 등
  다른 파랑·보라 계열을 브랜드 강조색으로 새로 쓰지 않는다.
- 예외(색상 자체가 의미이므로 바꾸지 않는다): 검토중/진행중/완료/지연처럼 여러 색이 순환하는
  상태·카테고리 팔레트(`frontend/components/ui/tag.tsx`의 `indigo`="공지" 포함), 성공 토스트(초록), 요일 색(토·일).
- 상세 패턴·예시는 `.claude/commands/design-standard.md` 참조.

## 타이포그래피
Pretendard(변수 폰트) 하나로 통일한다. 폰트 파일은 **저장소에 직접 둔다** —
`frontend/assets/fonts/PretendardVariable.woff2`를 `app/layout.tsx`의 `next/font/local`이 읽어
`--font-sans`에 매핑한다(npm 패키지·외부 CDN 의존 없음, `fallback` 목록까지 `--font-sans` 안에 포함).
- 기본 폰트 연결은 `app/globals.css`의 `@theme inline`이 담당한다. `--default-font-family`/`--default-mono-font-family`를
  각각 `--font-sans`/`--font-mono`에 물려서 Tailwind preflight의 `html`·`input`·`code`까지 전부 따라오게 해 뒀다.
- 폰트 종류·크기의 단일 기준은 **`app/styles/typography.scss`** 다. 루트 크기(`$font-size-root`, 현재 18px)와
  최소 크기(`$font-size-min`, 13.5px = `text-xs`)를 여기서 선언하고 `--font-size-*` CSS 변수로 노출한다. 크기를 바꿀 일이
  있으면 이 파일만 고친다(`app/globals.css`는 색·라운드 등 나머지 토큰 담당).
- **`text-xs`보다 작은 폰트를 쓰지 않는다.** 루트 18px 기준 `text-xs`(0.75rem)가 곧 13.5px이며 이게 최소값이다.
  scss 안에서는 `font-size()`(최소 크기 보장) · `rem()`(px → rem 환산) 함수를 쓴다.
- Tailwind `text-*` 스케일은 `app/globals.css`의 `@theme`에 rem으로 명시돼 있다(px 환산값 주석 포함).
  커스텀 `text-*` 유틸리티는 만들지 않는다 — tailwind-merge가 색상 클래스로 오인해 `cn()`에서 지워 버린다.
- 폰트 크기는 `text-[15px]` 같은 고정 px 대신 Tailwind 클래스나 rem 임의값(`text-[0.9rem]`)을 쓴다.
  고정 px는 루트 크기를 바꿔도 안 따라와서 자기만 작아진다.
- `text-xs`는 line-height 1.333을 함께 건다. 기존 상속(1.5)을 유지해야 하는 자리에는 `leading-normal`을 같이 붙인다.
- 새 폰트를 추가로 import하지 않는다. 고정폭이 필요하면 기존 `--font-mono`(Geist Mono)를 쓴다.
- 참고: [bizday UI Guideline](http://localhost:3000/bizday-ui-guideline)도 Pretendard를 사용해 톤을 맞췄다.

## 모서리 둥글기 (border-radius)
`rounded-md` 하나로 고정한다. `rounded-sm`/`lg`/`xl`/`2xl`/`3xl`/`4xl`를 새로 쓰지 않는다.
- **예외**: 아바타, 상태 점(dot), 원형 아이콘 버튼, 알림 카운트 뱃지처럼 **원형이 기능상 꼭 필요한 곳**만 `rounded-full`을 쓴다.
- 진행률 바(progress bar)·칩/배지·카드·다이얼로그·시트 등 그 외 모든 곳은 `rounded-md`.
- `Button`(`frontend/components/ui/button.tsx`)은 이미 `--radius-md` 토큰 기반이라 손댈 필요 없다.
- `Calendar`(`frontend/components/ui/calendar.tsx`)의 날짜 셀은 `--cell-radius: var(--radius-md)`로 이미 이 기준과 일치— 직접 만드는 달력 UI(예: 휴가 캘린더의 '오늘' 표시)도 원형이 아니라 이 기준(`rounded-md`)을 따른다.

## QC 시험 스케줄 자동배정 (PCT 워크플로우)
제조팀 구글시트(PCT) 생산계획을 적재해 QC 시험 스케줄을 자동 생성하고, AI가 시험자 배정을 추천하면 관리자가 확정·LOCK 하는 워크플로우.
- **프로세스 정의 단일 기준**: `.claude/commands/qc-schedule-process.md` (슬래시 커맨드 `/qc-schedule-process`).
- **구현 현황 추적**: `docs/qc-schedule-status.md`.
- 핵심 원칙: ① AI는 추천·관리자가 확정 ② 시험 시작(IN_PROGRESS)/완료 후 일정 변경 금지 ③ LOCK 상태 존중 ④ 공수는 DAY 단위(품목마스터가 절대값).
- 주요 테이블: `pct_orders`, `pct_ingest_log`, `pct_order_edits`, `qc_jobs`, `qc_job_items`, `notifications`, `app_settings`, `operator_schedule`(휴가), `equipment_reservation`(장비예약), `reassignment_history`(재배정이력).
- 적재 크론은 `instrumentation.ts`(9시/14시 Asia/Seoul), 수동 트리거 `POST /api/cron/ingest-pct`(admin).
