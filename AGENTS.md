<!-- Generated: 2026-06-08 | Updated: 2026-06-08 -->

# kd_project — 광동제약 QC 시험 관리 시스템

## Purpose
A Next.js 16 (App Router) web application for **Kwangdong Pharmaceutical's Quality Control (QC) testing management** — a pharma LIMS/QMS covering product test management, scheduling, stability studies, deviations (OOS/CAPA), equipment, documents (SOP/STD), and analytics. UI text and domain terms are in Korean. Data lives in Supabase (Postgres); auth is custom JWT (jose + bcrypt) with httpOnly cookies; an AI chatbot streams answers via OpenAI `gpt-4o-mini`.

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
- OpenAI HTTP API (`gpt-4o-mini`) for the chatbot. **Note:** `@anthropic-ai/sdk` is listed in deps but is legacy/unused — the chat service was migrated to OpenAI.

<!-- MANUAL: Any manually added notes below this line are preserved on regeneration -->
