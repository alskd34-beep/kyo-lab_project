<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-08 | Updated: 2026-06-08 -->

# (menu) — Authenticated feature pages

## Purpose
Route group containing every authenticated screen of the QC system, wrapped in a shared dashboard shell (collapsible sidebar + global top bar + AI chatbot). The `(menu)` segment is a route group, so it is **not** part of the URL — `app/(menu)/schedule/monthly/page.tsx` serves `/schedule/monthly`. There are ~38 `page.tsx` screens grouped by domain area.

## Key Files
| File | Description |
|------|-------------|
| `layout.tsx` | Client shell: renders `Sidebar`, mobile drawer + backdrop (ESC to close), global header (avatar, bell, logout via `useAuth()`), and the `Chatbot`. All `(menu)` pages render inside it. |

## Subdirectories (feature areas)
| Directory | Purpose |
|-----------|---------|
| `home/` | Landing dashboard after login |
| `product-test/` | Product testing: `products` (품목 마스터 + 평균공수 통합), `prod-reg`, `prod-status`, `prod-std` |
| `test-mgmt/` | Test management: `test-master`, `test-items`, `test-reg`, `test-result`, `test-status`, `test-cert`, `testers` |
| `schedule/` | Scheduling: `monthly`, `weekly`, `weekly-plan`, `pct` (Monday-style boards + planners) |
| `stability/` | Stability studies: `stab-plan`, `stab-report`, `stab-status` |
| `deviation/` | Deviations: `oos` (out-of-spec), `capa`, `inv-report` (조사 보고) |
| `documents/` | Controlled docs: `doc-sop`, `doc-std`, `doc-cert`, `doc-checklist` |
| `equipment/` | Equipment: `equip-operation`, `equip-usage`, `equip-backup`, `equip-ai-maint` |
| `insights/` | Analytics: `dash`, `stats`, `ins-report` |
| `settings/` | Setup/admin: `품목 마스터`, `시험항목 마스터`, `품목별 시험항목 관리`, `users`, `roles`, `sys-settings` |

## For AI Agents

### Working In This Directory
- **Page convention**: each leaf folder holds a single `page.tsx`. New screen = new folder + `page.tsx`. Most pages start with `'use client'` (16 of 38 are explicit client components; the rest are simple/server or stubs).
- Pages fetch data client-side from `/api/*` (`fetch`, `useState`/`useEffect`/`useMemo`) and render with shadcn/ui primitives from `@frontend/components/ui` (Dialog, Button, Input, Badge, Table, Calendar, Popover, Card, Avatar).
- Icons come from `lucide-react` (e.g. `Pencil`, `Trash2`, `Plus`, `Search`).
- CRUD screens follow a common shape: list/search + a `Dialog` for create/edit + delete confirmation, all hitting one `/api/<resource>` route with GET/POST/PATCH/DELETE.
- Do **not** import `@backend/*` here — go through `/api/*`. Use `useAuth()` from `@frontend/lib/auth-context` for user/session.
- Scheduling pages use helpers in `@frontend/lib/weekly-planner.ts` and `@frontend/lib/pct-schedule-bridge.ts`, plus board components in `@frontend/components/board`.

### Testing Requirements
- `npm run dev` (port 3300), log in, navigate to the screen. `npm run typecheck` for type safety.

### Common Patterns
- Keep Korean UI labels. Reuse existing `ui/` primitives rather than adding raw HTML controls. Use `cn()` for conditional Tailwind classes.

## Dependencies

### Internal
- `@frontend/components/ui/*`, `@frontend/components/dashboard/{sidebar,chatbot}`, `@frontend/components/board/*`
- `@frontend/lib/{auth-context,utils,weekly-planner,pct-schedule-bridge}`
- `@shared/{qc,pqm}` types; `/api/*` endpoints

### External
- `lucide-react`, `radix-ui`/shadcn, `date-fns`, `react-day-picker`, `xlsx` (import/export screens)

<!-- MANUAL: -->
