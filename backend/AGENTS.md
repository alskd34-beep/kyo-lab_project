<!-- Parent: ../AGENTS.md -->
<!-- Generated: 2026-06-08 | Updated: 2026-06-08 -->

# backend — Server-only logic

## Purpose
Server-side business logic and infrastructure. Split into `lib/` (auth, Supabase client, route guards) and `services/` (one module per domain resource, owning all DB access). Imported only by `app/api/**/route.ts` (and `scripts/`) via the `@backend/*` alias. **Never import from a client component** — it holds secrets and the service-role path.

## Subdirectories
| Directory | Purpose |
|-----------|---------|
| `lib/` | Cross-cutting helpers: JWT auth, password hashing, Supabase client, cookie helpers, route guards |
| `services/` | Domain logic + Supabase queries; maps DB `snake_case` rows ⇄ app `camelCase` |

## lib/ files
| File | Description |
|------|-------------|
| `auth.ts` | JWT (jose, HS256) sign/verify for **access (15min)** & **refresh (7d)** tokens; bcrypt `hashPassword`/`verifyPassword`; `hashRefreshToken` (sha256) + `generateJti` for DB-stored refresh tokens. Secrets from `JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`. Exports `AccessPayload { sub, username, role }`, `UserRole`. |
| `auth-cookies.ts` | Cookie names (`ACCESS_COOKIE` = `kd_access`, etc.) and set/clear helpers. |
| `guard.ts` | `requireAuth(req)` → `{ ok, payload }` or `{ ok:false, response }` (401); `requireAdmin(req)` adds role check (403). Used at the top of protected route handlers. |
| `supabase.ts` | Creates the Supabase client from `NEXT_PUBLIC_SUPABASE_URL` + anon key. A service-role (RLS-bypass) client is scaffolded but commented out. Exports `supabase`. |

## services/ files
| File | Resource |
|------|----------|
| `products.ts` | Products + categories + classifications (`listProducts`, `createProduct`, `updateProduct`, `deleteProduct`, `listProductCategories`, `listProductClassifications`) |
| `productTestItems.ts` | Per-product test items incl. reordering |
| `testItems.ts` | Test item master |
| `tests.ts` | Test records |
| `testers.ts` | Testers & capabilities |
| `batches.ts` | Batches |
| `manhours.ts` | Man-hours (공수) |
| `users.ts` | User accounts (uses `auth.ts` for hashing) |
| `chat.ts` | Chatbot — OpenAI Chat Completions (`gpt-4o-mini`); builds DB context, returns an SSE stream converted to a Dify-compatible format |
| `chatHistory.ts` | Persist/retrieve chat conversations by `conversationId` |

## For AI Agents

### Working In This Directory
- **Service pattern**: a service module imports `supabase` from `@backend/lib/supabase`, exports a typed `XRow` interface, and uses a `mapRow(r)` helper to convert `snake_case` Supabase rows to `camelCase` domain objects (see `products.ts`). Functions are plain async exports (`listX`, `createX`, `updateX`, `deleteX`) returning typed rows/objects, not `Response`s. HTTP concerns stay in the route handler.
- Throw `Error` with a Korean message on failure; the route handler catches and serializes it.
- Reuse shared types from `@shared/*` (`types/qc.ts`, `types/pqm.ts`) where a shape is shared with the frontend; service-internal row types live next to the service.
- **chat.ts**: reads `OPENAI_API_KEY`, POSTs to `https://api.openai.com/v1/chat/completions` with `model: 'gpt-4o-mini'`, streams the response, and converts OpenAI JSON deltas → Dify-style SSE. Missing env → service responds 503. The `@anthropic-ai/sdk` package in `package.json` is legacy and not used here.
- Auth/secrets: only `auth.ts` and `supabase.ts` should read JWT/Supabase env vars. Don't duplicate secret reads in services.

### Testing Requirements
- `npm run typecheck`. Exercise via the corresponding `/api/*` route in `npm run dev`. `scripts/` (e.g. `seed_pqm.ts`, `migrate.ts`) can be run with the project's TS runner for DB setup.

### Common Patterns
- New resource: add `services/<name>.ts` (row type + `mapRow` + CRUD fns), then a thin `app/api/<name>/route.ts` calling it.

## Dependencies

### Internal
- `@shared/*` types. `services/*` depend on `lib/supabase`; `users.ts` depends on `lib/auth`.

### External
- `@supabase/supabase-js`, `jose`, `bcryptjs`, Node `crypto`, OpenAI HTTP API (chat).

<!-- MANUAL: -->
