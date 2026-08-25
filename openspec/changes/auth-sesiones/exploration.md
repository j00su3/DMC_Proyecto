# Exploration: Authentication and sessions (BACKLOG.md #2, change `auth-sesiones`)

## Current State

Foundations change (`fundaciones-monorepo`) is merged. Relevant scaffolding in `apps/api/src`:

- `app.ts` — `buildApp()` registers `@fastify/swagger`, `cookiePlugin`, `dbPlugin`, then `healthRoutes` under `/api` prefix; central `setErrorHandler`/`setNotFoundHandler` map to `toErrorEnvelope`/`notFoundEnvelope`. No auth/RBAC plugin registered yet.
- `plugins/cookie.ts` — registers `@fastify/cookie` with `parseOptions: { httpOnly: true, sameSite: 'lax' }`. No `secret` configured (unsigned) and no `secure` flag set — this change must decide cookie signing and an env-conditioned `secure: true`.
- `plugins/db.ts` — `PgDb` lazily builds a raw `pg.Pool` and exposes ONLY `checkDb(): Promise<boolean>` via `app.decorate('db', ...)`. It does NOT expose the `Pool` or a Drizzle `Db` to routes — nothing today wires `createDb(pool)` (from `db/client.ts`) onto the Fastify instance. This is a real gap: this plugin (or a sibling) must be extended to decorate a query-capable `Db` before `usuarios`/`sesiones` queries are possible, reusing the same `Pool` (not a second connection).
- `lib/env.ts` — Zod-validated env: `DATABASE_URL`, `PORT`, `NODE_ENV`. No session/cookie secret today; if cookie signing is chosen, add a new required var here (fails fast, consistent with existing pattern).
- `lib/errors.ts` — `AppError(code, message, status, details?)` + `toErrorEnvelope()` already produce the fixed `{ error: { code, message, details? } }` shape. New codes needed here: `UNAUTHORIZED` (401), a role-denied code (403), an `ACCOUNT_LOCKED`/rate-limited code. `campo_reservado_encargado` (A7, field-level) belongs to the product service in a LATER change — do not implement it here.
- `db/schema.ts` — currently `export {}` ("future changes add table definitions here"). This change is the FIRST to add real Drizzle tables (`usuarios`, `sesiones`) — the real first exercise of `migrations-infra`.
- `db/client.ts` — `createDb(pool)` wraps the same `Pool` used by `plugins/db.ts` with `drizzle(pool, { schema })`; documented to avoid a second connection path.
- `plugins/openapi.ts` — writes the OpenAPI spec to disk only, no runtime route (per `api-contract-pipeline` spec). New auth routes MUST be Zod-typed via `withTypeProvider<ZodTypeProvider>()`, following the exact `routes/health.ts` pattern (`FastifyPluginAsync`, Zod `response` schema, `AppError` for failure paths).
- `.github/workflows/ci.yml` — `ubuntu-latest` runner with a `postgres:16-alpine` service; runs lint → `contract:check` → typecheck → `pnpm db:migrate` → unit tests → integration tests on every push/PR. Any hashing library must install cleanly here without extra native-build steps.
- `apps/api/package.json` — no hashing library, no `@fastify/rate-limit`, no session-store package yet: fully greenfield for this change.

## Specs and design docs already binding this change

- `openspec/specs/api-contract-pipeline/spec.md` — fixes error envelope, pagination envelope, Zod→OpenAPI generation (no runtime spec route).
- `openspec/specs/deployment-wiring/spec.md` — "Cookie Plugin Foundation" requirement already states `@fastify/cookie` is registered with `httpOnly`+`SameSite=Lax` and explicitly "MUST NOT preclude adding auth later" — this change is that follow-up. Also fixes: no `Domain` attribute, Neon-only production DB, same-origin Vercel proxy.
- `openspec/specs/migrations-infra/spec.md` — one `DATABASE_URL` drives migrations identically against Docker Postgres and Neon; this change's migration is the first real exercise of that infra.
- **ADR-0007** (`docs/adrs/0007-sesion-cookie-rbac-propio.md`) — the authoritative decision record:
  - Own username/password auth, "strong hash (bcrypt/argon2)" — algorithm left open (compared below).
  - Session in `httpOnly` + `SameSite=Lax` cookie backed by a server-side Postgres session store. JWT-stateless was explicitly REJECTED (hard to revoke immediately); external providers (Auth0/Clerk) explicitly REJECTED (cost, pulls user management out of the system). Closed decisions — do not relitigate.
  - RBAC = endpoint-level middleware only. Row-level filtering ("own movements") is explicitly assigned to the service/query layer, NOT this middleware. Field-level `stock_minimo` permission is explicitly assigned to the PRODUCT service, is the system's "only" field-level permission — NOT part of this change.
  - Login rate-limit/lockout (~5 failed attempts → ~5 min lockout, "per user and/or IP") is in scope.
  - Bootstrap of first encargado is explicitly OUTSIDE the API (seed/script or deploy-time env var) because the user-management API itself requires being authenticated as encargado.
  - Password reset via email is explicitly OUT of v1; manual DB-hash-reset is the documented rescue path.
- `docs/TECH-DESIGNv2.md` (~L90–95, ~L219–234) — data model: `Usuario(id, nombre, email/usuario, hash_contraseña, rol[encargado|deposito], activo, creado_en)`, `Sesión(id, usuario_id, creada_en, expira_en)`. Acceptance criteria: unauthenticated → 401; deposito gets 403 on anular/devolver venta, baja producto, crear/editar proveedores, configurar umbrales, gestión usuarios/config; backend is always the enforcement point.
- `docs/REVISION-ADVERSARIAL.md` — A7 (field permission, resolved to product-service layer, not this change), row-level filtering (resolved to service/query layer, not this change), rate-limit/lockout gap (resolved: ~5 attempts → temporary lockout, per user and/or IP — this change), bootstrap gap (resolved: out-of-band — this change).
- `docs/PRD.md` (L29–68) — full two-role permission matrix the RBAC middleware ultimately encodes per-endpoint; assigning roles to every downstream endpoint happens in later feature changes, not here.

## Affected Areas

- `apps/api/src/db/schema.ts` — add `usuarios` and `sesiones` Drizzle `pgTable` definitions.
- `apps/api/src/plugins/db.ts` — extend (or add a sibling plugin) to decorate a Drizzle `Db` instance via `createDb(pool)`; currently only exposes a boolean health check.
- `apps/api/src/plugins/cookie.ts` — decide `secret`/signing and env-conditioned `secure`; must keep omitting `Domain` (ADR-0010 hard constraint).
- `apps/api/src/lib/env.ts` — likely new env var(s) for cookie/session secret, possibly lockout tuning.
- `apps/api/src/lib/errors.ts` — new stable error `code`s for 401/403/429 auth paths.
- `apps/api/src/app.ts` — register new auth plugin(s)/routes and an RBAC hook, following the existing `fp()`-plugin + `app.register` pattern.
- `apps/api/src/routes/*` (new, e.g. `routes/auth.ts`) — Zod-typed login/logout/me routes per the `routes/health.ts` pattern.
- `apps/api/package.json` — new deps: hashing library, `@fastify/rate-limit` and/or custom DB-backed lockout, possibly cookie-signing helper.
- `apps/api/drizzle.config.ts` / `apps/api/drizzle/` — first real migration.
- A new bootstrap script (e.g. `apps/api/scripts/seed-encargado.ts`) creating the first encargado outside the authenticated API.
- `.github/workflows/ci.yml` — no structural change expected, but confirm the chosen hashing lib installs cleanly on `ubuntu-latest`.
- Possibly a lightweight decision note (not necessarily a full new ADR) recording the bcrypt-vs-argon2 pick, since ADR-0007 already names both as an either/or.

## Approaches

1. **Password hashing: argon2id via the `argon2` npm package** — modern, memory-hard, OWASP's first recommendation.
   - Pros: stronger GPU/ASIC resistance than bcrypt; ships prebuilt native binaries since v0.26.0 for Ubuntu 22.04 x86-64/ARM64, Windows, macOS, so `pnpm install` should not need a compiler on the Windows dev box, Ubuntu CI, or Render's Linux build; tunable cost params.
   - Cons: still a native module — an unmatched prebuilt triggers a source compile (`node-pre-gyp`/`node-gyp`) requiring a C++ toolchain; slightly less historically ubiquitous in this stack than bcrypt.
   - Effort: Low.

2. **Password hashing: bcrypt via the `bcrypt` npm package** — mature, explicitly named first in ADR-0007's text.
   - Pros: extremely mature, wide familiarity; also ships prebuilt binaries via node-pre-gyp for common platforms.
   - Cons: not memory-hard (weaker vs GPU/ASIC brute force at equivalent cost than argon2id); OWASP lists it as the fallback, not first choice; same native-module install-risk category as argon2.
   - Effort: Low.
   - Fallback note: `bcryptjs` (pure JS, zero native dependency) eliminates cross-platform install risk entirely at the cost of hash speed (irrelevant at this project's scale) — worth keeping as the documented escape hatch if native-module friction actually appears.

3. **Session storage: DB-backed session table with an opaque session id in the cookie** — this is what ADR-0007/TECH-DESIGNv2 already decided, not an open choice: `sesiones(id, usuario_id, creada_en, expira_en)`; every request does a DB lookup to resolve the user and check expiry. JWT was explicitly rejected.
   - Pros: matches the ADR; immediate logout/role-change revocation; reuses the existing Postgres.
   - Cons: one extra DB round-trip per authenticated request (acceptable at this scale); needs an expiry story (lazy check at read time is simplest, no scheduler needed).
   - Effort: Low-Medium.

4. **Cookie signing: unsigned high-entropy opaque token vs `@fastify/cookie` signed cookie.** Since the id is DB-validated every request, an unsigned-but-sufficiently-random id (32+ bytes via `crypto.randomBytes`) is already safe against guessing; signing adds cheap tamper-evidence before the DB round-trip at the cost of one new required env var.
   - Recommend signed cookie as low-cost defense-in-depth, consistent with the codebase's existing fail-fast env validation pattern.

5. **Rate-limit/lockout: `@fastify/rate-limit` (IP-based) vs custom DB-backed per-user counter vs both.**
   - `@fastify/rate-limit` alone: easy to wire on the login route, but doesn't express "lock THIS account for ~5 minutes" and doesn't stop distributed attempts against one username from many IPs — REVISION-ADVERSARIAL explicitly says "per user and/or IP," so IP-only doesn't fully close the gap.
   - Custom counter on `usuarios` (`intentos_fallidos`, `bloqueado_hasta`): directly implements the ADR's per-user lockout semantics; survives Render cold starts (an in-memory-only rate limiter would reset every cold start, ~15 min idle → up to ~50s restart per ADR-0010).
   - **Recommended: combine both** — `@fastify/rate-limit` as cheap first-line IP/process protection, custom DB-backed counter as the correct account-lockout mechanism.
   - Effort: Medium.

6. **RBAC middleware shape: `onRequest` auth hook (resolves session → `request.user`, 401 on missing/expired) + `preHandler` role check reading a route-declared allowlist (e.g. via Fastify route `config`), 403 otherwise.**
   - Mirrors existing `cookiePlugin`/`dbPlugin` `fp()`-plugin conventions; colocates the role allowlist with each route's Zod schema, like `routes/health.ts` colocates schema and handler.
   - Needs explicit scoping so `/api/auth/login` and `/api/health` stay public while other routes default to protected — hook registration order/placement must be decided deliberately, not left implicit.
   - Must NOT absorb row-level or field-level authorization — both are explicitly assigned elsewhere per ADR-0007.
   - Effort: Medium.

## Recommendation

- **Hashing:** argon2id via `argon2` as primary recommendation (OWASP-preferred, prebuilt binaries cover Windows dev / Ubuntu CI / Render without extra toolchain work); document `bcryptjs` as the fallback if native-module friction appears in practice. Confirm explicitly with the user at proposal time since ADR-0007 leaves it open.
- **Session storage:** DB-backed session table + signed, high-entropy opaque cookie value (per ADR-0007).
- **Rate-limit/lockout:** `@fastify/rate-limit` on the login route + custom per-user DB-backed lockout counter — together satisfy "per user and/or IP."
- **RBAC:** `onRequest` auth hook (401) + route-`config`-declared role allowlist checked in a `preHandler` (403), as Fastify plugins consistent with existing conventions; endpoint-level only.
- **Precondition:** extend `plugins/db.ts` (or add a sibling plugin) to expose a query-capable Drizzle `Db` to routes/services — resolve this at design time, not mid-implementation.

## Risks

- `plugins/db.ts` exposes no query-capable DB handle today — blocks all Usuario/Sesión persistence until resolved; flag explicitly at design time.
- Native hashing modules carry residual cross-platform install risk (Windows dev / Ubuntu CI / Render Linux) even with prebuilt binaries — verify `pnpm install` actually succeeds in CI before committing.
- `plugins/cookie.ts` has no `secure`/signing config today; forgetting env-conditioned `secure: true` would ship a session cookie without `Secure` despite ADR-0010 enabling HTTPS — must be an explicit task, not an implicit default.
- Cookie must never receive a `Domain` attribute (ADR-0010 hard constraint, Vercel→Render proxy) — review every session/cookie code path against this.
- IP-only rate limiting would not satisfy REVISION-ADVERSARIAL's explicit "per user and/or IP" requirement — needs the combined mechanism.
- Bootstrap-of-first-encargado must stay genuinely outside the authenticated API surface — an implicit "first-user-if-none-exists" endpoint would reopen a security hole the ADR deliberately avoided.
- Field-level (`stock_minimo`) and row-level ("own movements") authorization must NOT be implemented inside this change's RBAC middleware — scope creep here would duplicate logic later changes are meant to own.
- Render free-tier cold starts (~50s after ~15 min idle) argue for DB-backed (not in-memory) lockout counters, since in-memory state resets on cold start.
- This is the first change to touch `db/schema.ts` and generate a real migration — any migration-tooling friction here is a shared risk for every later backlog item.

## Ready for Proposal

Yes. ADR-0007 and TECH-DESIGNv2 already fix the architecturally significant decisions. Remaining choices are narrow: hashing algorithm (argon2id vs bcrypt), rate-limit/lockout mechanism split, cookie-signing decision, and the `plugins/db.ts` extension shape. Recommend surfacing the hashing-algorithm choice and the `db` plugin extension explicitly to the user during `sdd-propose`.
