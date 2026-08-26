# Delta Spec: auth-sessions

## MODIFIED Requirements

### Requirement: Usuario and Sesion Tables
The system MUST persist `usuarios` (`id`, `nombre`, `email` UNIQUE, `hash_contrasena`, `rol` in `encargado|deposito`, `activo`, `intentos_fallidos`, `bloqueado_hasta`, `creado_en`, `debe_cambiar_password` boolean default `false`) and `sesiones` (`id`, `usuario_id` FK, `creada_en`, `expira_en`) as Drizzle tables, applied via Drizzle migrations.
(Previously: `usuarios` had no `debe_cambiar_password` column, and this requirement's prose named the hash column `hash_contraseña`; the shipped column is the ASCII `hash_contrasena` — see `apps/api/src/db/schema.ts:22` and `apps/api/drizzle/0000_old_omega_flight.sql:13`.)

#### Scenario: Migration applies cleanly
- GIVEN an empty schema (current `db/schema.ts` state)
- WHEN the migration runs via `pnpm db:migrate` against Docker Postgres or Neon
- THEN `usuarios` and `sesiones` exist with the documented columns and the FK constraint

#### Scenario: New column defaults to false for existing rows
- GIVEN the additive migration adding `debe_cambiar_password` runs against a table with existing rows
- WHEN the migration completes
- THEN every existing row's `debe_cambiar_password` is `false`

### Requirement: Login with Email and Password
`POST /api/auth/login` MUST accept `{ email, password }`, validate against `usuarios`, and on success set a session cookie and return `200 { usuario: { id, nombre, email, rol, debe_cambiar_password } }` with no password/hash field.
(Previously: the `usuario` DTO did not include `debe_cambiar_password`.)

#### Scenario: Successful login
- GIVEN an active, non-locked user with a known email and correct password
- WHEN `POST /api/auth/login` is called with matching credentials
- THEN the response is `200` with the `usuario` object including `debe_cambiar_password`, a session cookie is set, and `intentos_fallidos` resets to 0

#### Scenario: Wrong password
- GIVEN an active user with a known email
- WHEN `POST /api/auth/login` is called with an incorrect password
- THEN the response is `401 { error: { code: "INVALID_CREDENTIALS" } }`, no cookie is set, and `intentos_fallidos` increments by 1

#### Scenario: Unknown email
- GIVEN no user exists for the submitted email
- WHEN `POST /api/auth/login` is called
- THEN the response is `401 { error: { code: "INVALID_CREDENTIALS" } }` with the same shape/timing profile as a wrong-password response (no user enumeration)

#### Scenario: Inactive user
- GIVEN a user with `activo = false`
- WHEN `POST /api/auth/login` is called with that user's correct credentials
- THEN the response is `401 { error: { code: "ACCOUNT_INACTIVE" } }` and no cookie is set

#### Scenario: Locked account
- GIVEN a user whose `bloqueado_hasta` is in the future
- WHEN `POST /api/auth/login` is called with that user's correct password
- THEN the response is `423 { error: { code: "ACCOUNT_LOCKED", details: { retryAfter } } }` without evaluating the password hash

#### Scenario: Rate-limited by IP
- GIVEN `@fastify/rate-limit` on `/api/auth/login` has exceeded its configured window for the caller's IP
- WHEN a further `POST /api/auth/login` request is made from that IP
- THEN the response is `429 { error: { code: "RATE_LIMITED" } }`

### Requirement: Current User Endpoint
`GET /api/auth/me` MUST return `200 { usuario }` — including `debe_cambiar_password` — when the request carries a valid, unexpired session, and `401` otherwise.
(Previously: the `usuario` object did not include `debe_cambiar_password`.)

#### Scenario: Valid session
- GIVEN a valid, unexpired session cookie
- WHEN `GET /api/auth/me` is called
- THEN the response is `200` with the current `usuario` object, including `debe_cambiar_password` (no password/hash field)

#### Scenario: No or expired session
- GIVEN a missing, invalid, or expired session cookie
- WHEN `GET /api/auth/me` is called
- THEN the response is `401 { error: { code: "UNAUTHORIZED" } }`

### Requirement: RBAC Hook Contract
An `onRequest` hook MUST resolve the session cookie to `request.user` (via `SesionesRepo.findValid`, which JOINs `usuarios` and requires `activo = true`, so `debe_cambiar_password` is available on the same lookup with no extra query), returning `401 { error: { code: "UNAUTHORIZED" } }` when the session is missing, invalid, or expired. A `preHandler` MUST first check `request.user.debe_cambiar_password` and, when it is true, refuse the route unless it declares the config key `allowPasswordChangePending: true`, returning `403 { error: { code: "PASSWORD_CHANGE_REQUIRED" } }`; it MUST then check `request.user.rol` against a route-declared role allowlist (Fastify route `config`), returning `403 { error: { code: "FORBIDDEN" } }` on mismatch. The forced-change check running first is required so the reachable set is exactly the opted-in routes regardless of role, and so a flagged user with a role mismatch receives one unambiguous code. `/api/health` and `/api/auth/login` MUST remain publicly accessible without a session. This hook MUST NOT perform row-level or field-level authorization.
(Previously: the hook only checked the role allowlist; it had no forced-password-change check.)

#### Scenario: Unauthenticated request to a protected route
- GIVEN no session cookie
- WHEN a request hits a route other than `/api/health` or `/api/auth/login`
- THEN the response is `401 { error: { code: "UNAUTHORIZED" } }`

#### Scenario: Wrong role on an allowlisted route
- GIVEN an authenticated session with `rol = deposito` and a route whose `config` allowlist is `[encargado]`
- WHEN that route is called
- THEN the response is `403 { error: { code: "FORBIDDEN" } }`

#### Scenario: Public routes stay accessible
- GIVEN no session cookie
- WHEN `GET /api/health` or `POST /api/auth/login` is called
- THEN the request proceeds without a 401

#### Scenario: Forced-password-change flag blocks a route that did not opt in
- GIVEN an authenticated session with `debe_cambiar_password = true`
- WHEN a route that does not declare `allowPasswordChangePending` is called
- THEN the response is `403 { error: { code: "PASSWORD_CHANGE_REQUIRED" } }`

#### Scenario: Forced-password-change flag does not block opted-in routes
- GIVEN an authenticated session with `debe_cambiar_password = true`
- WHEN `GET /api/auth/me` or `POST /api/auth/password` is called
- THEN the request proceeds past the `preHandler` normally

#### Scenario: Forced-change check precedes the role check
- GIVEN an authenticated session with `debe_cambiar_password = true` and a role outside a route's `roles` allowlist
- WHEN that route is called
- THEN the response code is `PASSWORD_CHANGE_REQUIRED`, not `FORBIDDEN`
