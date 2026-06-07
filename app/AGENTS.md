<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-08 | Updated: 2026-06-08 -->

# app — Next.js App Router

## Purpose
The Next.js App Router root. Holds the global layout/providers, the authenticated page tree (route group `(menu)`), the standalone `/login` page, and all backend HTTP route handlers under `api/`.

## Key Files
| File | Description |
|------|-------------|
| `layout.tsx` | Root layout (server). Sets `<html>`, fonts (Geist), metadata (Korean title), wraps app in `ThemeProvider` + `AuthProvider`. |
| `globals.css` | Tailwind v4 global styles / theme tokens. |
| `page.tsx` | Root page (protected by middleware — root `/` requires auth). |

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `(menu)/` | Route group: all authenticated feature pages behind the sidebar+topbar shell (see `(menu)/AGENTS.md`) |
| `api/` | Backend REST route handlers, one folder per resource (see `api/AGENTS.md`) |
| `login/` | Public login page (excluded from auth by `middleware.ts`) |

## For AI Agents

### Working In This Directory
- `app/layout.tsx` is a **server component**; the provider stack (`ThemeProvider` → `AuthProvider`) is established here. Don't add `'use client'` to it.
- The route group `(menu)` does not appear in the URL — it only groups pages that share the dashboard chrome (`(menu)/layout.tsx`).
- Adding a new feature screen → create `app/(menu)/<area>/<feature>/page.tsx`. Adding a new backend endpoint → create `app/api/<resource>/route.ts`. These are different layers; see the respective child AGENTS.md.

### Testing Requirements
- `npm run typecheck` + `npm run dev` (port 3300). Log in via `/login` to reach `(menu)` pages.

### Common Patterns
- Page components are client components (`'use client'`) that fetch from `/api/*`.
- Route handlers set `export const runtime = 'nodejs'` and delegate to `@backend/services/*`.

## Dependencies

### Internal
- `@frontend/*` — providers, components, contexts used by layout & pages.
- `@backend/*` — services/guards used by `api/` handlers.
- `@shared/*` — shared types.

### External
- `next` (App Router), `react` 19.

<!-- MANUAL: -->
