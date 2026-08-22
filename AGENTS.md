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
Pretendard(변수 폰트) 하나로 통일한다. `app/layout.tsx`에서 `next/font/local`로 `pretendard` npm 패키지의
`PretendardVariable.woff2`를 로드해 `--font-sans`에 매핑한다(`app/globals.css`가 `font-sans`에 연결).
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
