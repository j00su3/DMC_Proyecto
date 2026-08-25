# Tasks: Authentication and Sessions (backlog #2)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated authored lines — P1 (data access) | ~350 (excl. `drizzle/0001_*.sql` + snapshot, generated) |
| Estimated authored lines — P2 (primitives) | ~280 |
| Estimated authored lines — P3 (enforcement) | ~180 |
| Estimated authored lines — P4 (endpoints) | ~420 (excl. `openapi.json` / `schema.d.ts` regen, generated) |
| Estimated authored lines — P5 (bootstrap + docs) | ~150 |
| **Total estimated authored** | **~1380** |
| Generated/lockfile (separate) | `pnpm-lock.yaml` diff (argon2, @fastify/rate-limit); `apps/api/drizzle/0001_*.sql` + meta snapshot (~40–80 lines, machine-generated); `apps/api/openapi.json` + `apps/web/src/api/schema.d.ts` regen (~150–250 lines, machine-generated) |
| 400-line budget risk | High — total authored is ~3.4x the 400-line budget; only P3 and P5 individually fit in one PR with slack, P1/P2/P4 are each close to or over budget on their own once test files are counted |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR2 → PR3 → PR4 → PR5 (mirrors design.md's P1–P5 rollout order; each PR depends on the prior) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — decide at apply time per `chained-pr` skill |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Data access seam: `db/pool.ts`, `schema.ts`, migration, `auth/repository.ts`, `plugins/repos.ts` (TDD + integration) | PR 1 | `pnpm --filter @inventienda/api test` then `pnpm --filter @inventienda/api test:integration` | Docker Postgres for the integration suite only; unit suite stays DB-free | revert `apps/api/src/db/**`, `apps/api/src/auth/repository.ts`, `apps/api/src/plugins/repos.ts`, `apps/api/drizzle/0001_*` |
| 2 | Auth primitives: `auth/password.ts`, `auth/session.ts`, `lib/errors.ts` factories + 429 branch, `lib/env.ts`, `plugins/cookie.ts`, CI env, pnpm build approval (TDD) | PR 2 | `pnpm --filter @inventienda/api test` | In-process, no network/DB; `argon2.test.ts` uses real argon2 (no mock) | revert `apps/api/src/auth/password.ts`, `auth/session.ts`, `lib/errors.ts`, `lib/env.ts`, `plugins/cookie.ts`; revert `.github/workflows/ci.yml` env line; revert root `package.json` `onlyBuiltDependencies` |
| 3 | RBAC enforcement: `plugins/auth.ts`, `app.ts` wiring, `routes/health.ts` opt-out (TDD) | PR 3 | `pnpm --filter @inventienda/api test` | `app.inject()` against throwaway routes registered before `ready()` | revert `apps/api/src/plugins/auth.ts`, `app.ts` auth-plugin registration, `routes/health.ts` config line |
| 4 | Auth endpoints: `auth/service.ts`, `routes/auth.ts`, rate-limit registration, regenerated contract artifacts (TDD + integration) | PR 4 | `pnpm --filter @inventienda/api test`, `pnpm contract:check`, then `pnpm --filter @inventienda/api test:integration` | Real Docker Postgres + real argon2 for the integration suite; unit suite uses stub repos | revert `apps/api/src/auth/service.ts`, `routes/auth.ts`, `app.ts` route/rate-limit registration, `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts` |
| 5 | Bootstrap + docs: `scripts/seed-encargado.ts`, ADR-0007 update, tasks/state bookkeeping | PR 5 | `pnpm --filter @inventienda/api seed:encargado` (manual dry run against local Docker Postgres) | Local Docker Postgres, human-invoked script (not automated) | revert `apps/api/scripts/seed-encargado.ts`, `apps/api/package.json` `seed:encargado` script, root passthrough, ADR-0007 update line |

## Phase 1: Data Access Seam (TDD + integration)

Maps to: *Usuario and Sesion Tables* (auth-sessions spec).

- [x] 1.1 `apps/api/src/db/pool.ts` — lazy `Pool`/`Db` singleton (D1); no test required (thin factory, exercised transitively by 1.9)
- [x] 1.2 `apps/api/src/db/schema.ts` — modify: `rolUsuario` pgEnum (D6), `usuarios` table (D3, D5), `sesiones` table (D3, D4)
- [x] 1.3 `apps/api/src/plugins/db.ts` — modify: `PgDb` consumes `getPool()`; `DbLike` contract untouched (D1)
- [x] 1.4 Run `pnpm db:generate`; commit `apps/api/drizzle/0001_*.sql` + meta snapshot (generated, exempt from TDD) — DEVIATION: journal was empty (no prior real migration committed despite the folder existing), so drizzle-kit emitted `0000_old_omega_flight.sql` instead of `0001_*`; applied cleanly against Docker Postgres via `drizzle-kit migrate`
- [x] 1.5 RED: `apps/api/src/auth/repository.test.ts` — `UsuariosRepo`/`SesionesRepo` interface shape (constructor injection, method signatures) using an in-memory fake pool; no real SQL assertions here (real SQL is integration-only)
- [x] 1.6 GREEN: `apps/api/src/auth/repository.ts` — `UsuariosRepo` (`findByEmail`, `registerFailedAttempt` atomic UPDATE, `resetAttempts`) / `SesionesRepo` (`create`, `findValid`, `delete`, `purgeExpired`) Drizzle implementations over `createDb(getPool())`
- [x] 1.7 RED: `apps/api/src/plugins/repos.test.ts` — decorates `app.repos` with injected fakes via `buildApp({ repos })`
- [x] 1.8 GREEN: `apps/api/src/plugins/repos.ts` — `fp()` plugin decorating `app.repos`
- [x] 1.9 Integration RED→GREEN: `apps/api/src/auth/repository.integration.test.ts` (real Docker Postgres, `test:integration` suite) — migration applies (tables + FK + `rol_usuario` enum), atomic lockout UPDATE transitions (increment, 5th-failure lock, elapsed-lockout reset branch), `purgeExpired` deletes only expired rows for the given user. Caught a real RED: `db.execute` raw SQL returns `bloqueado_hasta` as a string, not a `Date`, from `pg` — fixed by parsing it in `registerFailedAttempt`

## Phase 2: Auth Primitives (TDD)

Maps to: *Password Hashing*, *Session Lifecycle and Lazy Expiry*, *Cookie Plugin Foundation* (deployment-wiring spec).

- [x] 2.1 RED: `apps/api/src/auth/password.test.ts` — `hash→verify` round trip (real argon2, no mock); wrong password fails verify; stored hash is never the plaintext — covers *Password stored as argon2id hash*
- [x] 2.2 GREEN: `apps/api/src/auth/password.ts` — `hashPassword`/`verifyPassword` (argon2id, OWASP params) + exported `DUMMY_HASH` constant (D11)
- [x] 2.3 RED: `apps/api/src/auth/session.test.ts` — token length/entropy shape (`base64url(randomBytes(32))`, D4); `sessionCookieOptions()` never includes a `domain` key (ADR-0010 regression guard); `secure` flips true/false with `NODE_ENV`
- [x] 2.4 GREEN: `apps/api/src/auth/session.ts` — `SESSION_COOKIE` constant, `createToken()`, `sessionCookieOptions()` (D15, 12h `maxAge`)
- [x] 2.5 RED: extend `apps/api/src/lib/errors.test.ts` — new factories `unauthorized()`, `forbidden()`, `accountLocked()` (with `details.retryAfter`, D9), `invalidCredentials()`, `accountInactive()` map to the correct status/code envelope
- [x] 2.6 GREEN: `apps/api/src/lib/errors.ts` — add the five factories + shared `errorEnvelopeSchema`
- [x] 2.7 RED: extend `apps/api/src/lib/errors.test.ts` — a 429 thrown by `@fastify/rate-limit`'s Fastify error (`statusCode: 429`) maps to `RATE_LIMITED`, not `INTERNAL_ERROR`, in `toErrorEnvelope`
- [x] 2.8 GREEN: `apps/api/src/lib/errors.ts` — add the 429 branch to `toErrorEnvelope`
- [x] 2.9 GREEN (config, no test): `apps/api/src/lib/env.ts` — add `COOKIE_SECRET: z.string().min(32)` (fail-fast on missing/invalid, per *Missing signing secret fails fast* scenario, verified at 3.x plugin-wiring level, not here)
- [x] 2.10 GREEN (config, no test): `apps/api/src/plugins/cookie.ts` — `secret` from `buildApp({ cookieSecret })` → `process.env.COOKIE_SECRET` → dev fallback with production hard-throw (D13), explicit `path`
- [x] 2.11 GREEN (config, non-TDD): `apps/api/package.json` — add `argon2`, `@fastify/rate-limit` deps; root `package.json` `pnpm.onlyBuiltDependencies: ["argon2"]`; `.github/workflows/ci.yml` — add `COOKIE_SECRET` to job `env` block — DEVIATION: this repo already uses `pnpm-workspace.yaml`'s `allowBuilds` map (not root `package.json` `pnpm.onlyBuiltDependencies`) for native postinstall approval (e.g. `esbuild`, `@biomejs/biome`); added `argon2: true` there for consistency with the existing convention instead of introducing a second mechanism

## Phase 3: RBAC Enforcement (TDD)

Maps to: *RBAC Hook Contract*.

- [ ] 3.1 RED: `apps/api/src/plugins/auth.test.ts` — default-deny on an unconfigured route (401 `UNAUTHORIZED`); `config: { auth: false }` opt-out proceeds without a session; `config: { roles: [...] }` mismatch returns 403 `FORBIDDEN`; unmatched routes (`request.routeOptions.url === undefined`) skip auth and 404 stays 404 (D8) — covers *Unauthenticated request to a protected route*, *Wrong role on an allowlisted route*, *Public routes stay accessible*
- [ ] 3.2 GREEN: `apps/api/src/plugins/auth.ts` — `fp()` plugin: `decorateRequest('user', null)`, Fastify type augmentation, `onRequest` hook (resolves signed `sid` cookie via `repos.sesiones.findValid`), `preHandler` hook (`request.routeOptions.config.roles` check)
- [ ] 3.3 GREEN (config, no test): `apps/api/src/app.ts` — modify `BuildAppOptions { db?, repos?, cookieSecret? }`; register `repos`, `auth` plugins before routes
- [ ] 3.4 GREEN (config, no test): `apps/api/src/routes/health.ts` — add `config: { auth: false }` so `/api/health` stays public per *Public routes stay accessible* (exercised by the existing `health.test.ts`, no new test needed)

## Phase 4: Auth Endpoints (TDD + integration)

Maps to: *Login with Email and Password*, *Logout*, *Current User Endpoint*, *Account Lockout Counter*.

- [ ] 4.1 RED: `apps/api/src/auth/service.test.ts` — `login()`: success resets `intentos_fallidos` and returns `usuario` + token; wrong password increments failed-attempt counter and returns `INVALID_CREDENTIALS`; unknown email runs `argon2.verify(DUMMY_HASH, ...)` and returns `INVALID_CREDENTIALS` with the same shape (D11); inactive user returns `ACCOUNT_INACTIVE` only after password verify (D10); locked user returns `ACCOUNT_LOCKED` without evaluating the password hash; `resolveSession()`: valid session populates user, expired/absent session is treated as absent — stub `UsuariosRepo`/`SesionesRepo`, assert outcome and exact repo calls made
- [ ] 4.2 GREEN: `apps/api/src/auth/service.ts` — `login`, `logout`, `resolveSession` functions over repo interfaces (data-flow per design.md's `POST /api/auth/login` diagram, D9–D11, D14)
- [ ] 4.3 RED: `apps/api/src/routes/auth.test.ts` — `POST /api/auth/login` status codes/envelope `code`s for success/wrong-password/unknown-email/inactive/locked; `Set-Cookie` attributes (`httpOnly`, `SameSite=Lax`, signed, no `Domain`) on success; `POST /api/auth/logout` 200 with and without a valid session, cookie cleared; `GET /api/auth/me` 200 with valid session / 401 without — `buildApp({ repos: stubRepos, cookieSecret })` + `app.inject()`, login-path assertions against a committed fixture hash
- [ ] 4.4 RED: `apps/api/src/routes/auth.test.ts` (same file) — `POST /api/auth/login` rate-limited by IP returns 429 `RATE_LIMITED`, exercised against the real `@fastify/rate-limit` plugin registered with `max: 1` on the test app instance, not the error-envelope builder in isolation (per design.md Testing Strategy note)
- [ ] 4.5 GREEN: `apps/api/src/routes/auth.ts` — `POST /auth/login` (`config: { auth: false, rateLimit: { max: 10, timeWindow: '1 minute' } }`), `POST /auth/logout` (`config: { auth: false }`), `GET /auth/me` (protected by default), Zod schemas (`loginBody`, `usuarioDto`, `okUsuario`), `errorResponseBuilder` for the rate-limit plugin
- [ ] 4.6 GREEN (config, no test): `apps/api/src/app.ts` — register `@fastify/rate-limit` (`global: false`) and `authRoutes` before other routes
- [ ] 4.7 Regenerate contract (non-TDD, generated): `pnpm contract` → commit `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts`; verify `pnpm contract:check` passes
- [ ] 4.8 Integration RED→GREEN: `apps/api/src/routes/auth.integration.test.ts` (real Docker Postgres, real argon2, `buildApp()` with no stubs, `test:integration` suite) — login → `me` → logout round trip; expired session → 401 independent of row cleanup; lockout survives a rebuilt app instance (cold-start simulation, per *Lockout survives restart*)

## Phase 5: Bootstrap Script + Docs (non-TDD except password rule)

Maps to: *Bootstrap Encargado Script*.

- [ ] 5.1 RED: `apps/api/scripts/seed-encargado.test.ts` — refuses to run and exits without creating a user when an `encargado` already exists (stub repo); creates exactly one `encargado` row with a hashed password on first run; second invocation with the same input before any encargado exists does not duplicate (idempotency via `onConflictDoNothing()` on email); rejects a password passed as a CLI argument (never accepted that way, per design constraint) — covers *First run creates the encargado*, *Re-run when an encargado already exists*, *Idempotent invocation with same input*
- [ ] 5.2 GREEN: `apps/api/scripts/seed-encargado.ts` — reads `SEED_ENCARGADO_EMAIL`/`SEED_ENCARGADO_NOMBRE`/`SEED_ENCARGADO_PASSWORD` from `process.env` (`--email`/`--nombre` may override; password never via argv), Zod-validated, one transaction checking for any existing `encargado` before insert, prints email/role only
- [ ] 5.3 GREEN (config, non-TDD): `apps/api/package.json` — `seed:encargado` script (`tsx scripts/seed-encargado.ts`, `import 'dotenv/config'`); root `package.json` passthrough script
- [ ] 5.4 `docs/adrs/0007-sesion-cookie-rbac-propio.md` — dated update line recording argon2id and the session-id-as-cookie-value strategy (Spanish, project convention)
- [ ] 5.5 MANUAL (user, external/local action — not executable by the agent). Set `COOKIE_SECRET` (64 hex chars from `openssl rand -hex 32` or `crypto.randomBytes(32)`) in the local `.env`, the CI job's secret store if not already a plain env value, and the Render dashboard. Tooling never reads or writes `.env*` files; this is a manual, user-owned step per design.md's Key Config Shapes section.
- [ ] 5.6 MANUAL (user, local verification — not executable by the agent). Run `pnpm --filter @inventienda/api seed:encargado` once against local Docker Postgres with real `SEED_ENCARGADO_*` env values set, confirm exactly one `encargado` row is created, and record the result in this change's apply notes.
- [ ] 5.7 Bookkeeping: mark completed checkboxes in this file, update `openspec/changes/auth-sesiones/state.yaml` phase statuses as each PR lands, record chain strategy decision once made

## Integration Tests (real Docker Postgres, distinct `test:integration` suite)

- [ ] I.1 `apps/api/src/auth/repository.integration.test.ts` — migration applies (tables + FK + enum); atomic lockout SQL transitions (increment, 5th-failure lock, elapsed-lockout reset); `purgeExpired` scoping (task 1.9, same file — listed here for visibility)
- [ ] I.2 `apps/api/src/routes/auth.integration.test.ts` — login → me → logout round trip; expired session → 401; lockout survives a rebuilt app instance / cold-start simulation (task 4.8, same file — listed here for visibility)
- [ ] I.3 Manual verification: `pnpm db:migrate` runs cleanly against a fresh Docker Postgres container (`docker compose up -d` then `pnpm --filter @inventienda/api db:migrate`) before either integration suite is trusted in CI

## Docs / Bookkeeping (final group)

- [ ] D.1 Update `openspec/changes/auth-sesiones/tasks.md` checkboxes as work lands (this file)
- [ ] D.2 Update `openspec/changes/auth-sesiones/state.yaml` — advance `apply` phase status per PR, record chain strategy once decided
- [ ] D.3 MANUAL — document `COOKIE_SECRET` as a required env var in project README / deployment notes if such a doc exists (tooling never touches `.env*` files directly; this is a written-doc pointer only, not a value)
- [ ] D.4 Confirm `pnpm contract:check` and `pnpm -r typecheck` are green on the final PR of the chain before requesting archive
