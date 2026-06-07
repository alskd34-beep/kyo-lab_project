<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-08 | Updated: 2026-06-08 -->

# api — Backend REST route handlers

## Purpose
Next.js App Router route handlers (`route.ts`), one folder per resource. These are **thin HTTP adapters**: parse the request, enforce auth, call a `@backend/services/*` function, and shape the JSON response. No business logic or direct DB queries live here.

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `auth/` | `login`, `logout`, `me`, `refresh`, `change-password` — JWT cookie lifecycle |
| `users/`, `users/[id]/` | User CRUD (admin) |
| `products/` | Product master CRUD + category/classification options |
| `product-test-items/`, `.../reorder/` | Per-product test items; `reorder` updates sort order |
| `test-items/` | Test item master |
| `tests/` | Test records |
| `testers/`, `tester-capabilities/` | Testers and their capability matrix |
| `batches/`, `batches/[id]/` | Test/production batches |
| `manhours/` | Man-hour (공수) tracking |
| `schedules/`, `schedules/monthly/` | Scheduling data |
| `qc-scheduler/` | QC scheduling computation |
| `dashboard/` | Aggregated dashboard/KPI data |
| `chat/`, `chat/history/` | AI chatbot — SSE streaming proxy to OpenAI; history persistence |
| `google-sheet/master/`, `.../stability/` | Google Sheet import/sync endpoints |

## For AI Agents

### Working In This Directory
- Every handler starts with `export const runtime = 'nodejs'` (services use Node crypto / service-role Supabase — not Edge-safe).
- **Standard handler shape** (see `products/route.ts` as the canonical example):
  ```ts
  export async function GET(req: NextRequest) {
    try {
      const sp = req.nextUrl.searchParams
      const rows = await listX({ ... })
      return Response.json({ rows })
    } catch (err) {
      const msg = err instanceof Error ? err.message : '서버 오류'
      return Response.json({ error: msg }, { status: 500 })
    }
  }
  ```
- **Methods → service calls**: `GET`=list/read, `POST`=create (return `{ row }, { status: 201 }`), `PATCH`=update (require `id`, else 400 `'id 필수'`), `DELETE`=delete (require `id`). Body parsed with `await req.json()`.
- **Auth**: import `requireAuth` / `requireAdmin` from `@backend/lib/guard`. Pattern:
  ```ts
  const auth = await requireAuth(req)
  if (!auth.ok) return auth.response   // 401/403 Response
  // auth.payload → { sub, username, role }
  ```
  Middleware lets API requests through (no redirect); the route guard is the real protection. `auth/*` routes are public by design.
- **Response contract**: success → `{ rows }` | `{ row }` | `{ ok: true }`; failure → `{ error: <Korean message> }` with appropriate status (400 validation, 401/403 auth, 500 server, 503 missing-env). Keep error messages in Korean.
- The chat route returns a raw `text/event-stream` (SSE) `Response`, not JSON — it pipes `sendChatMessage()`'s stream body straight through.

### Testing Requirements
- `npm run dev`; exercise endpoints from the UI or `curl` with the `kd_access` cookie. `npm run typecheck`.

### Common Patterns
- Adding an endpoint: create `api/<resource>/route.ts`, add/extend the matching `@backend/services/<resource>.ts`, reuse the try/catch + `Response.json` shape above. Dynamic routes use `[id]/route.ts`.

## Dependencies

### Internal
- `@backend/services/*` (logic), `@backend/lib/guard` (auth), `@backend/lib/auth-cookies` (cookie names/helpers).

### External
- `next/server` (`NextRequest`, `Response.json`).

<!-- MANUAL: -->
