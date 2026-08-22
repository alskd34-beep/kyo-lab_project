<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-08 | Updated: 2026-06-08 -->

# frontend — Client-side code

## Purpose
All browser/client code: React components (shadcn/ui primitives, dashboard chrome, Monday-style boards), context providers, client utilities, and scheduling logic. Imported via the `@frontend/*` alias. This layer talks to the server only through `/api/*` — it never imports `@backend/*`.

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `components/ui/` | shadcn/ui primitives: `avatar`, `badge`, `button`, `calendar`, `card`, `dialog`, `input`, `popover`, `table` |
| `components/dashboard/` | App chrome: `sidebar.tsx` (nav), `chatbot.tsx` (AI assistant, consumes `/api/chat` SSE) |
| `components/board/` | `MondayBoard.tsx`, `SheetBoardSection.tsx` — Monday-style scheduling boards |
| `components/providers/` | `theme-provider.tsx` (wraps `next-themes`) |
| `hooks/` | Custom React hooks (currently empty / reserved) |
| `lib/` | Client utilities & contexts (see table) |

## lib/ files
| File | Description |
|------|-------------|
| `auth-context.tsx` | `AuthProvider` + `useAuth()` — holds current user/session, exposes `logout`, and auto-refreshes the access token via `/api/auth/refresh` when it nears expiry. Mounted in `app/layout.tsx`. |
| `utils.ts` | `cn(...inputs)` — Tailwind class merge (`clsx` + `tailwind-merge`). Use everywhere for conditional classes. |
| `pct-schedule-bridge.ts` | Bridges PCT (product test) data into the schedule board model. |

## For AI Agents

### Working In This Directory
- Components that use state/effects/handlers must start with `'use client'`. `theme-provider` and `auth-context` are client providers established at the app root.
- **Styling**: Tailwind v4 + `class-variance-authority` for variants; always compose classes with `cn()` from `@frontend/lib/utils`. Prefer existing `ui/` primitives over hand-rolled markup; add new shadcn components into `components/ui/` (config in repo-root `components.json`).
- Auth state: read via `useAuth()`; never duplicate token logic — refresh is centralized in `auth-context.tsx`.
- Data: fetch from `/api/*`; do not import services, Supabase, or secrets here.
- Keep Korean UI text consistent with existing components. Icons via `lucide-react`.

### Testing Requirements
- `npm run dev` (port 3300) and verify in-browser; `npm run typecheck` + `npm run lint`.

### Common Patterns
- Provider stack lives in `app/layout.tsx` (`ThemeProvider` → `AuthProvider`); add new global providers there.
- Board/scheduling features combine `components/board/*` with `lib/pct-schedule-bridge.ts`. (`weekly-planner.ts` was removed on 2026-08-22 — 주간 배정은 서버의 `scheduleEngine`/`assignRules` 하나로 통합됐다.)

## Dependencies

### Internal
- `@shared/*` types; `/api/*` endpoints.

### External
- `react` 19, `radix-ui`/shadcn, `tailwindcss` v4, `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, `next-themes`, `date-fns`, `react-day-picker`.

<!-- MANUAL: -->
