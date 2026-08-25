# Proposal: Authentication and Sessions

## Intent

The API currently has zero authentication or authorization: every route the foundations change scaffolded (`/api/health`) is public, and `db/schema.ts` has no real tables. Backlog item #2 closes this gap so the encargado/deposito RBAC matrix from the PRD can be enforced server-side, per ADR-0007. This unblocks every later feature change (products, sales, movements) that needs `request.user` and a role check to exist first.

## Scope

### In Scope
- `usuarios` and `sesiones` Drizzle tables + first real migration.
- Login (email + password), logout, and `me` endpoints under `/api`.
- Password hashing with argon2id (`argon2` package); `bcryptjs` documented as fallback only.
- DB-backed session (opaque token in a signed, httpOnly, SameSite=Lax cookie), 12-hour expiry, lazy expiry check.
- Login lockout: 5 failed attempts → 5-minute lockout, DB-backed per-user counter (survives Render cold starts) + `@fastify/rate-limit` as IP-level first line.
- `onRequest` auth hook (401) + route-`config`-declared role allowlist checked in `preHandler` (403), endpoint-level only.
- `plugins/db.ts` extension (or sibling plugin) decorating a query-capable Drizzle `Db` via `createDb(pool)`.
- New env var(s) in `lib/env.ts` for cookie signing secret; env-conditioned `secure: true` cookie flag; no `Domain` attribute (ADR-0010).
- New `lib/errors.ts` codes for 401 (unauthorized), 403 (forbidden), and lockout.
- Bootstrap script (`apps/api/scripts/seed-encargado.ts`) creating the first encargado outside the API.

### Out of Scope
- User CRUD/management API (create/edit/deactivate users) — backlog item #3. Only the seed script creates a user in this change.
- Row-level filtering ("own movements" for deposito) — service/query layer, later change.
- Field-level `stock_minimo` permission — product service, later change.
- Password reset via email — explicitly deferred past v1 (ADR-0007); manual DB hash reset is the rescue path.
- Assigning roles to individual downstream business endpoints (products, sales, etc.) — those routes don't exist yet.

## Capabilities

### New Capabilities
- `auth-sessions`: own-auth login/logout/session lifecycle (DB-backed session, httpOnly signed cookie, argon2id hashing, lockout) and endpoint-level RBAC enforcement hook.

### Modified Capabilities
- `deployment-wiring`: the "Cookie Plugin Foundation" requirement evolves from an unsigned, secret-less cookie plugin to a signed, env-conditioned-`secure` cookie plugin actually carrying a session token.

## Approach

- **Hashing**: argon2id via `argon2` (OWASP-preferred, prebuilt binaries cover Windows dev / Ubuntu CI / Render Linux without a toolchain).
- **Session storage**: `sesiones(id, usuario_id, creada_en, expira_en)` table; opaque high-entropy token (`crypto.randomBytes`) as the cookie value, signed by `@fastify/cookie`'s `secret`; every request resolves the session via DB lookup with lazy expiry check (no scheduler).
- **Login identifier**: `usuarios.email` (unique), matching TECH-DESIGNv2's data model.
- **Lockout**: `intentos_fallidos`/`bloqueado_hasta` columns on `usuarios`, incremented on failed login, reset on success; `@fastify/rate-limit` on `/api/auth/login` as a cheap IP-level first line, independent of the per-user mechanism.
- **RBAC**: `onRequest` hook resolves session → `request.user` (401 if missing/expired/locked-out session); `preHandler` reads a route-declared role allowlist (Fastify route `config`) and returns 403 on mismatch. `/api/health` and `/api/auth/login` stay public; everything else defaults protected via explicit registration order.
- **DB plugin gap**: extend `plugins/db.ts` (or add a sibling plugin) to decorate `app.db` as the Drizzle `Db` from `createDb(pool)`, reusing the existing lazy `Pool` — resolved before route work starts, not mid-implementation.
- **Bootstrap**: `scripts/seed-encargado.ts` inserts the first encargado directly via Drizzle, run out-of-band (local/deploy-time), never exposed as an API route.

### API Surface Sketch
- `POST /api/auth/login` — body `{ email, password }` → sets session cookie, `200 { usuario: { id, nombre, email, rol } }`; `401` on bad credentials, `423`/lockout code when locked out.
- `POST /api/auth/logout` — invalidates the current session row, clears cookie, `200`.
- `GET /api/auth/me` — `200 { usuario }` if session valid, `401` otherwise.

### Data Model Sketch
- `usuarios(id, nombre, email UNIQUE, hash_contraseña, rol[encargado|deposito], activo, intentos_fallidos, bloqueado_hasta, creado_en)`
- `sesiones(id, usuario_id FK, creada_en, expira_en)`

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/db/schema.ts` | New | `usuarios`, `sesiones` Drizzle tables |
| `apps/api/src/plugins/db.ts` | Modified | decorate query-capable Drizzle `Db` |
| `apps/api/src/plugins/cookie.ts` | Modified | signing secret, env-conditioned `secure` |
| `apps/api/src/lib/env.ts` | Modified | new session/cookie secret env var |
| `apps/api/src/lib/errors.ts` | Modified | 401/403/lockout error codes |
| `apps/api/src/app.ts` | Modified | register auth plugin(s) and RBAC hook |
| `apps/api/src/routes/auth.ts` | New | login/logout/me routes |
| `apps/api/scripts/seed-encargado.ts` | New | out-of-band bootstrap |
| `apps/api/drizzle/` | New | first real migration |
| `apps/api/package.json` | Modified | `argon2`, `@fastify/rate-limit` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `argon2` native module fails to install on some CI/dev/Render combination | Low | Prebuilt binaries cover all three; `bcryptjs` documented fallback if friction appears |
| Forgetting env-conditioned `secure: true` or adding a `Domain` attribute | Med | Explicit task + review against ADR-0010 before merge |
| IP-only rate limiting alone would miss distributed per-account attacks | Low | Combined `@fastify/rate-limit` + DB-backed per-user lockout, both in scope |
| RBAC hook scope creep into row-level/field-level checks | Low | Explicitly out of scope; documented boundary from ADR-0007 |
| First migration on `migrations-infra` surfaces tooling friction | Med | Validate `pnpm db:migrate` in CI as part of this change |

## Rollback Plan

Revert the change's commits/PR; the migration is additive-only (new tables), so rolling back the migration (`drizzle-kit` down or a manual `DROP TABLE`) removes `usuarios`/`sesiones` without touching existing data, since no other schema depends on them yet. No production traffic depends on these routes today (unreleased).

## Dependencies

- `plugins/db.ts` extension must land before route/service work (both are in this change, ordered first).
- Existing `migrations-infra` and `deployment-wiring` promoted specs constrain cookie/migration behavior.

## Success Criteria

- [ ] Unauthenticated request to a protected route returns 401 with the standard error envelope.
- [ ] Deposito-role request to an encargado-only route (once role allowlists exist) returns 403.
- [ ] 5 consecutive failed logins for one user lock that account for ~5 minutes; a 6th attempt within the window is rejected without checking the password.
- [ ] Valid login sets a signed httpOnly SameSite=Lax cookie with no `Domain` attribute; session expires 12 hours after creation.
- [ ] `pnpm db:migrate` runs cleanly in CI against Docker Postgres.
- [ ] `seed-encargado.ts` creates a usable encargado account with no API endpoint required.
