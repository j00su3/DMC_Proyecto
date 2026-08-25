# Design: Authentication and Sessions (backlog #2)

## Technical Approach

Three seams, added in dependency order, each testable without Postgres:

1. **Data access seam** — pool ownership moves to `src/db/pool.ts` (lazy singleton). `plugins/db.ts` keeps its `DbLike { checkDb }` contract untouched; a sibling `plugins/repos.ts` decorates `app.repos` with `UsuariosRepo`/`SesionesRepo` built over `createDb(getPool())`. Routes never see Drizzle.
2. **Auth seam** — `plugins/auth.ts` (`fp()`) registers a default-deny `onRequest` hook that resolves the signed session cookie into `request.user`, plus a `preHandler` that checks `request.routeOptions.config.roles`. Public routes opt out with `config: { auth: false }`.
3. **Route seam** — `routes/auth.ts` exposes login/logout/me with Zod schemas following the `routes/health.ts` pattern, so the three paths land in the generated `openapi.json`.

Business rules (login, lockout, session lifecycle) live in `src/auth/service.ts` as functions over repository interfaces, so every rule is unit-testable with stubs and no HTTP or database.

## Architecture Decisions

| # | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| D1 | New `src/db/pool.ts` owns the lazy `Pool`; `PgDb` and the repos plugin both consume it | Widen `DbLike` with `getDb(): Db`; sibling plugin opening its own pool | Widening `DbLike` breaks the existing `{ checkDb: async () => true }` stubs in `health.test.ts`; a second pool violates the contract documented in `db/client.ts`. One lazy pool, zero churn on existing tests, unit suite still needs no Postgres (fundaciones D2 preserved) |
| D2 | Repositories (`app.repos`) are the injection seam, not Drizzle | Inject a `Db` and mock query builders | Mocking Drizzle chains is brittle; repo interfaces are 6 methods and make the atomic-SQL boundary explicit |
| D3 | `usuarios.id` / `sesiones.usuario_id` are `uuid` with `defaultRandom()` | `bigserial` identity | `gen_random_uuid()` is built-in on PG13+ (Docker 16 and Neon); non-enumerable ids in future URLs; no sequence coordination. Index locality is irrelevant at this scale |
| D4 | `sesiones.id` **is** the cookie value: `text` PK holding `base64url(randomBytes(32))` | uuid PK + separate `token` column; store `sha256(token)` at rest | Matches TECH-DESIGNv2's `Sesión(id, ...)` literally and mainstream server-side session stores (express-session, Rails) which persist the raw id. Cookie is signed + httpOnly + Secure, max lifetime 12 h, revocable instantly. Hashing at rest is a documented future hardening, not v1 |
| D5 | Physical column `hash_contrasena` (ASCII) for the spec's `hash_contraseña` field | Literal `hash_contraseña` | Non-ASCII identifiers must be double-quoted in every raw `psql`/migration statement and break on a Windows console code page other than UTF-8. Same logical field, ASCII spelling |
| D6 | `rol` as `pgEnum('rol_usuario', ['encargado','deposito'])` | `text` + CHECK constraint | DB-level integrity and a generated `CREATE TYPE`; the PRD fixes exactly two roles, so `ALTER TYPE ADD VALUE` friction is not a realistic cost |
| D7 | Default-deny global `onRequest` hook; `config: { auth: false }` opts a route out | Per-route `preHandler: [requireAuth]`; explicit protected list | A new route that forgets to declare anything is protected, not open. Route `config` is plain data — serializable, colocated with the Zod schema, trivially assertable in tests |
| D8 | Unmatched routes (`request.routeOptions.url === undefined`) skip auth | 401 on unknown paths | Preserves the `NOT_FOUND` envelope required by `api-contract-pipeline`; path existence is not a secret here |
| D9 | Locked account → `423 ACCOUNT_LOCKED` with `details.retryAfter` (seconds) | 429 (collides with the IP limiter), 403 (implies an authenticated principal) | Keeps "your account is locked" and "this IP is throttled" distinguishable client-side. `Retry-After` stays out of the header because `AppError` carries no headers and the envelope must not grow |
| D10 | `activo` is checked **after** a successful password verify | Check right after lookup | Checking first turns `ACCOUNT_INACTIVE` into a user-enumeration oracle. Spec scenario ("with that user's correct credentials") is satisfied either way |
| D11 | Unknown email still runs `argon2.verify` against a fixed dummy hash | Return 401 immediately | The spec demands the same timing profile as a wrong password. Cost is one hash on an already rate-limited path |
| D12 | Session TTL / lockout thresholds are code constants, not env vars | `SESSION_TTL`, `LOCKOUT_MINUTES` env knobs | ADR-0007 fixes the values; env knobs invite per-environment drift and untested combinations. Only `COOKIE_SECRET` is new env |
| D13 | Cookie secret reaches the plugin via `buildApp({ cookieSecret })` → `process.env.COOKIE_SECRET` → fixed dev fallback, with a hard throw when `NODE_ENV === 'production'` | Import `lib/env.ts` from `plugins/cookie.ts` | `lib/env.ts` requires `DATABASE_URL` at import time; importing it from a plugin would force Postgres env into the unit suite and into `openapi:generate` (which runs before typecheck in CI). Mirrors how `PgDb` reads `process.env.DATABASE_URL` directly |
| D14 | No session cleanup job; opportunistic delete of the resolved-expired row plus a bounded `delete ... where usuario_id = $1 and expira_en <= now()` on successful login | Cron/scheduler; `pg_cron` | Spec forbids a background scheduler and Render free has no scheduled jobs. Row count is bounded by active users × logins per 12 h |
| D15 | Fixed 12 h expiry from creation, no sliding renewal | Refresh `expira_en` on each request | Sliding expiry means a write on every authenticated request. Cost: a session can end mid-shift; a re-login is acceptable for a two-role shop app |

## Data Flow

```
POST /api/auth/login
  rate-limit(IP, config.rateLimit) ─429 RATE_LIMITED
        │
        ▼
  normalizeEmail → repos.usuarios.findByEmail
        │                    └─ none → argon2.verify(DUMMY_HASH) → 401 INVALID_CREDENTIALS
        ▼
  bloqueado_hasta > now? ──yes──→ 423 ACCOUNT_LOCKED { retryAfter }
        │ no
        ▼
  argon2.verify(hash, password)
        │ false → repos.usuarios.registerFailedAttempt (1 atomic UPDATE) → 401
        │ true
        ▼
  activo? ──no──→ 401 ACCOUNT_INACTIVE
        │ yes
        ▼
  resetAttempts → purgeExpired(usuarioId) → createSesion(token, now+12h)
        └─→ reply.setCookie('sid', token, sessionCookieOptions()) → 200 { usuario }

any protected request
  onRequest: config.auth === false? → skip
             unsignCookie('sid') → repos.sesiones.findValid(token, now)
               (JOIN usuarios: expira_en > now AND activo = true)
             miss → 401 UNAUTHORIZED | hit → request.user = usuario
  preHandler: config.roles && !roles.includes(user.rol) → 403 FORBIDDEN
```

`sesiones.findValid` is one round trip (join), and `activo = false` therefore revokes live sessions immediately — the property ADR-0007 chose server-side sessions for.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `apps/api/src/db/pool.ts` | Create | Lazy `Pool` + `Db` singletons; single connection path |
| `apps/api/src/db/schema.ts` | Modify | `rolUsuario` pgEnum, `usuarios`, `sesiones` tables |
| `apps/api/drizzle/0001_*.sql` + snapshot | Create | Generated by `pnpm db:generate`; committed |
| `apps/api/src/plugins/db.ts` | Modify | `PgDb` consumes `getPool()`; `DbLike` unchanged |
| `apps/api/src/plugins/repos.ts` | Create | Decorates `app.repos`, injectable via `buildApp({ repos })` |
| `apps/api/src/auth/repository.ts` | Create | `UsuariosRepo`/`SesionesRepo` interfaces + Drizzle impls (atomic lockout SQL lives here) |
| `apps/api/src/auth/password.ts` | Create | `hashPassword`/`verifyPassword` (argon2id) + `DUMMY_HASH` |
| `apps/api/src/auth/session.ts` | Create | Constants, `createToken()`, `sessionCookieOptions()`, `SESSION_COOKIE` |
| `apps/api/src/auth/service.ts` | Create | `login`, `logout`, `resolveSession` over repo interfaces |
| `apps/api/src/plugins/auth.ts` | Create | `decorateRequest('user', null)`, onRequest + preHandler hooks, Fastify type augmentation |
| `apps/api/src/routes/auth.ts` | Create | `POST /auth/login`, `POST /auth/logout`, `GET /auth/me` |
| `apps/api/src/routes/health.ts` | Modify | Add `config: { auth: false }` |
| `apps/api/src/lib/errors.ts` | Modify | `unauthorized()`, `forbidden()`, `accountLocked()`, `invalidCredentials()`, `accountInactive()` factories, shared `errorEnvelopeSchema`, 429 branch in `toErrorEnvelope` |
| `apps/api/src/lib/env.ts` | Modify | `COOKIE_SECRET: z.string().min(32)` |
| `apps/api/src/plugins/cookie.ts` | Modify | `secret`, explicit `path`, production guard |
| `apps/api/src/app.ts` | Modify | `BuildAppOptions { db?, repos?, cookieSecret? }`; register `@fastify/rate-limit` (`global: false`), `repos`, `auth`, `authRoutes` before routes |
| `apps/api/scripts/seed-encargado.ts` | Create | Out-of-band bootstrap |
| `apps/api/package.json` | Modify | `argon2`, `@fastify/rate-limit`; `seed:encargado` script |
| `package.json` (root) | Modify | `pnpm.onlyBuiltDependencies: ["argon2"]`; `seed:encargado` passthrough |
| `.github/workflows/ci.yml` | Modify | Add `COOKIE_SECRET` to the job `env` block |
| `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts` | Modify | Regenerated (`pnpm contract`); committed |
| `docs/adrs/0007-sesion-cookie-rbac-propio.md` | Modify | Dated update line recording argon2id and the session-id strategy (Spanish, project convention) |
| `apps/api/src/**/*.test.ts` (7 new) | Create | See Testing Strategy |

## API Surface

```ts
// routes/auth.ts — all three declared with .withTypeProvider<ZodTypeProvider>()
const loginBody   = z.object({ email: z.string().email(), password: z.string().min(1) });
const usuarioDto  = z.object({ id: z.uuid(), nombre: z.string(), email: z.string(),
                               rol: z.enum(['encargado','deposito']) });
const okUsuario   = z.object({ usuario: usuarioDto });

POST /api/auth/login   config: { auth: false, rateLimit: { max: 10, timeWindow: '1 minute' } }
  body loginBody → 200 okUsuario | 401 errorEnvelope | 423 errorEnvelope | 429 errorEnvelope
POST /api/auth/logout  config: { auth: false }
  → 200 z.object({ ok: z.literal(true) })
GET  /api/auth/me      (protected by default)
  → 200 okUsuario | 401 errorEnvelope
```

Error responses are declared in each route's `response` map with a shared `errorEnvelopeSchema` (`details: z.unknown().optional()`), so the generated contract documents 401/423/429 and the SPA's generated types cover them.

## Key Config Shapes

- **`usuarios`**: `id uuid pk defaultRandom`, `nombre text notNull`, `email text notNull unique`, `hash_contrasena text notNull`, `rol rol_usuario notNull`, `activo boolean notNull default true`, `intentos_fallidos integer notNull default 0`, `bloqueado_hasta timestamptz`, `creado_en timestamptz notNull defaultNow`. Emails are normalized (`trim().toLowerCase()`) on every write and lookup — plain `unique()`, no `citext`, no expression index.
- **`sesiones`**: `id text pk`, `usuario_id uuid notNull references usuarios(id) onDelete cascade`, `creada_en timestamptz notNull defaultNow`, `expira_en timestamptz notNull`, `index on usuario_id`. All timestamps are `withTimezone: true, mode: 'date'`.
- **Atomic lockout UPDATE** (in `repository.ts`, one statement, no read-modify-write):
  ```sql
  update usuarios set
    intentos_fallidos = case when bloqueado_hasta is not null and bloqueado_hasta <= now()
                             then 1 else intentos_fallidos + 1 end,
    bloqueado_hasta   = case when (case when bloqueado_hasta is not null and bloqueado_hasta <= now()
                                        then 1 else intentos_fallidos + 1 end) >= 5
                             then now() + interval '5 minutes'
                             when bloqueado_hasta <= now() then null else bloqueado_hasta end
  where id = $1 returning intentos_fallidos, bloqueado_hasta;
  ```
  The elapsed-lockout branch prevents a stale counter of 5 from re-locking on the first attempt after the window.
- **`sessionCookieOptions()`** → `{ path: '/', httpOnly: true, sameSite: 'lax', signed: true, secure: process.env.NODE_ENV === 'production', maxAge: 43200 }`. **No `domain` key is ever produced** (ADR-0010); attributes are set at the `reply.setCookie` call site rather than relying on `parseOptions`. `clearCookie` reuses the same object.
- **argon2id params**: `{ type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1 }` (OWASP baseline). `argon2.verify` reads params from the encoded hash, so tests can use committed fixture hashes independently of current defaults.
- **Env**: `COOKIE_SECRET: z.string().min(32)` added to `lib/env.ts`. Manual, user-owned step (tooling never touches env files): set it locally, in the CI job env, and in the Render dashboard — 64 hex chars from `openssl rand -hex 32` or `crypto.randomBytes(32)`.
- **pnpm**: root `"pnpm": { "onlyBuiltDependencies": ["argon2"] }` so pnpm 10+/11 does not block argon2's `node-gyp-build` install script under `--frozen-lockfile` in CI and on Render. `bcryptjs` remains the documented drop-in fallback (swap only `auth/password.ts`) if native install friction appears.
- **Seed script**: `pnpm --filter @inventienda/api seed:encargado` → `tsx scripts/seed-encargado.ts`, `import 'dotenv/config'` at the top (same pattern as `drizzle.config.ts`). Reads `SEED_ENCARGADO_EMAIL`, `SEED_ENCARGADO_NOMBRE`, `SEED_ENCARGADO_PASSWORD` from `process.env`; `--email`/`--nombre` may override, but **the password is never accepted as a CLI argument** (it would land in shell history and `ps` output). Zod-validated (email format, password ≥ 12 chars). One transaction: if any `rol = 'encargado'` row exists, log and `exit(0)` without writing; otherwise insert with `onConflictDoNothing()` on email. Prints email and role only, never the password. Same script for Docker and Neon — whichever `DATABASE_URL` the shell carries, run from the developer machine per ADR-0010.

## Testing Strategy (Strict TDD)

| Layer | What to test | Approach |
|---|---|---|
| Unit — `auth/service.test.ts` | login success / wrong password / unknown email / inactive / locked; expired and absent session resolution; counter reset on success | Stub `UsuariosRepo`/`SesionesRepo`; assert both the outcome and the repo calls made |
| Unit — `auth/session.test.ts` | token length/entropy shape; cookie options never contain `domain`; `secure` flips with `NODE_ENV` | Pure function assertions (this is the ADR-0010 regression guard) |
| Unit — `auth/password.test.ts` | hash→verify round trip; wrong password fails; hash is never the plaintext | **Real argon2**, no mocking — a mock would hide native-module load failures |
| Unit — `routes/auth.test.ts` | status codes, envelope `code`s, `Set-Cookie` attributes, `me` 200/401 | `buildApp({ repos: stubRepos, cookieSecret })` + `app.inject()`; login-path tests verify against a committed fixture hash |
| Unit — `plugins/auth.test.ts` | default-deny, `auth: false` opt-out, `roles` 403, 404 stays 404 | Register throwaway routes on the instance returned by `buildApp` before `ready()`; global hooks already apply |
| Unit — `lib/errors.test.ts` | new factories; 429 rate-limit error maps to `RATE_LIMITED`, not `INTERNAL_ERROR` | Extend the existing pure-function suite |
| Integration — `auth/repository.integration.test.ts` | migration applied (tables + FK + enum), atomic lockout SQL transitions, expired-session purge | Real Docker Postgres; `truncate sesiones, usuarios` in `beforeEach` |
| Integration — `routes/auth.integration.test.ts` | login → `me` → logout round trip; expired session → 401; lockout survives a rebuilt app instance (cold-start simulation) | Real repos, real argon2, `buildApp()` with no stubs |
| Contract | The three auth paths appear in `openapi.json` and `schema.d.ts` | `pnpm contract:check` in CI |

`@fastify/rate-limit` throws a Fastify error carrying `statusCode: 429`, which today's `toErrorEnvelope` would flatten to a 500 `INTERNAL_ERROR`. Both an `errorResponseBuilder` returning the envelope **and** a 429 branch in `toErrorEnvelope` are required, and the RED test for the 429 path must exercise the real plugin (with `max: 1`), not the builder in isolation.

## Threat Matrix

N/A — no agent routing, shell command construction, subprocess spawning, VCS/PR automation, executable-file classification, or process-integration boundary is introduced. `seed-encargado.ts` is a human-invoked product script, not automated agent behavior; its credential-handling rule (password via env only, never argv) is captured as a design constraint above and carries its own test.

## Migration / Rollout

Additive-only first real migration (`CREATE TYPE rol_usuario`, `usuarios`, `sesiones`); nothing depends on these tables yet, so rollback is a revert plus `DROP TABLE sesiones, usuarios; DROP TYPE rol_usuario`. Implementation order (the tasks phase slices PRs from this):

1. **P1 — data access**: `db/pool.ts`, `schema.ts`, migration, `repository.ts`, `plugins/repos.ts` + repository integration tests.
2. **P2 — primitives**: `auth/password.ts`, `auth/session.ts`, `lib/errors.ts` factories + 429 branch, `lib/env.ts`, `plugins/cookie.ts`, CI env, pnpm build approval.
3. **P3 — enforcement**: `plugins/auth.ts`, `app.ts` wiring, `routes/health.ts` opt-out.
4. **P4 — endpoints**: `routes/auth.ts`, rate-limit registration, regenerated contract artifacts, auth integration tests.
5. **P5 — bootstrap and docs**: `seed-encargado.ts`, ADR-0007 update line.

P1–P3 are independently mergeable and each stays well inside the 400-line review budget; P4 carries the generated contract diff.

## Open Questions

- [ ] Nothing closes the shared `Pool` today (current behavior, unchanged by D1). Adding an `onClose` hook would break a shared singleton across `buildApp` calls in one test file; deferred as a follow-up, not silently introduced here.
- [ ] Exact versions of `argon2` and `@fastify/rate-limit` must be resolved at install time against Fastify 5 and Node 22 — pin explicitly, do not assume.
