# auth-sessions Specification

## Purpose

Own-auth login/logout/session lifecycle (email + password, DB-backed session behind a signed httpOnly cookie, argon2id hashing, per-account lockout) and endpoint-level RBAC enforcement, per ADR-0007. Establishes `request.user` and role checks that all later feature changes depend on.

## Requirements

### Requirement: Usuario and Sesion Tables
The system MUST persist `usuarios` (`id`, `nombre`, `email` UNIQUE, `hash_contraseña`, `rol` in `encargado|deposito`, `activo`, `intentos_fallidos`, `bloqueado_hasta`, `creado_en`) and `sesiones` (`id`, `usuario_id` FK, `creada_en`, `expira_en`) as Drizzle tables, applied via the first real migration under `migrations-infra`.

#### Scenario: Migration applies cleanly
- GIVEN an empty schema (current `db/schema.ts` state)
- WHEN the migration runs via `pnpm db:migrate` against Docker Postgres or Neon
- THEN `usuarios` and `sesiones` exist with the documented columns and the FK constraint

### Requirement: Login with Email and Password
`POST /api/auth/login` MUST accept `{ email, password }`, validate against `usuarios`, and on success set a session cookie and return `200 { usuario: { id, nombre, email, rol } }` with no password/hash field.

#### Scenario: Successful login
- GIVEN an active, non-locked user with a known email and correct password
- WHEN `POST /api/auth/login` is called with matching credentials
- THEN the response is `200` with the `usuario` object, a session cookie is set, and `intentos_fallidos` resets to 0

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

### Requirement: Logout
`POST /api/auth/logout` MUST invalidate the current session's DB row and clear the session cookie, returning `200` regardless of prior session validity.

#### Scenario: Logout with valid session
- GIVEN a valid, non-expired session cookie
- WHEN `POST /api/auth/logout` is called
- THEN the response is `200`, the matching `sesiones` row is deleted or marked invalid, and the cookie is cleared

#### Scenario: Logout with no session
- GIVEN no session cookie or an already-invalid one
- WHEN `POST /api/auth/logout` is called
- THEN the response is `200` and no error is raised

### Requirement: Current User Endpoint
`GET /api/auth/me` MUST return `200 { usuario }` when the request carries a valid, unexpired session, and `401` otherwise.

#### Scenario: Valid session
- GIVEN a valid, unexpired session cookie
- WHEN `GET /api/auth/me` is called
- THEN the response is `200` with the current `usuario` object (no password/hash field)

#### Scenario: No or expired session
- GIVEN a missing, invalid, or expired session cookie
- WHEN `GET /api/auth/me` is called
- THEN the response is `401 { error: { code: "UNAUTHORIZED" } }`

### Requirement: Session Lifecycle and Lazy Expiry
Sessions MUST expire 12 hours after creation. Expiry MUST be checked lazily on each request that resolves a session (no background scheduler); an expired session MUST be treated as absent.

#### Scenario: Session valid within window
- GIVEN a session created less than 12 hours ago
- WHEN an authenticated request resolves that session
- THEN the request proceeds with `request.user` populated

#### Scenario: Session expired
- GIVEN a session whose `expira_en` has passed
- WHEN an authenticated request resolves that session
- THEN the request is treated as unauthenticated (401), independent of whether the row is later cleaned up

### Requirement: Account Lockout Counter
On each failed login, the system MUST increment `usuarios.intentos_fallidos` for the matched user; on the 5th consecutive failure it MUST set `bloqueado_hasta` to 5 minutes in the future. A successful login MUST reset `intentos_fallidos` to 0 and clear `bloqueado_hasta`. This state MUST be DB-backed so it survives process restarts (Render cold starts).

#### Scenario: Fifth failure locks the account
- GIVEN a user with `intentos_fallidos = 4`
- WHEN one more login attempt fails
- THEN `intentos_fallidos` becomes 5 and `bloqueado_hasta` is set to approximately now + 5 minutes

#### Scenario: Lockout survives restart
- GIVEN a user is currently locked (`bloqueado_hasta` in the future)
- WHEN the API process restarts and the same user attempts to log in before `bloqueado_hasta` elapses
- THEN the login still returns `423 ACCOUNT_LOCKED`

#### Scenario: Successful login resets counter
- GIVEN a user with `intentos_fallidos = 3` and no active lockout
- WHEN that user logs in successfully
- THEN `intentos_fallidos` resets to 0

### Requirement: RBAC Hook Contract
An `onRequest` hook MUST resolve the session cookie to `request.user`, returning `401 { error: { code: "UNAUTHORIZED" } }` when the session is missing, invalid, or expired. A `preHandler` MUST check `request.user.rol` against a route-declared role allowlist (Fastify route `config`), returning `403 { error: { code: "FORBIDDEN" } }` on mismatch. `/api/health` and `/api/auth/login` MUST remain publicly accessible without a session. This hook MUST NOT perform row-level or field-level authorization.

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

### Requirement: Bootstrap Encargado Script
`apps/api/scripts/seed-encargado.ts` MUST create exactly one `encargado` user from credentials supplied via environment variables or CLI arguments (not hardcoded), MUST be idempotent (safe to re-run with no duplicate side effects), and MUST refuse to run if any `encargado` user already exists.

#### Scenario: First run creates the encargado
- GIVEN no user with `rol = encargado` exists
- WHEN the script runs with valid credentials supplied
- THEN exactly one `usuarios` row is created with `rol = encargado` and a hashed password

#### Scenario: Re-run when an encargado already exists
- GIVEN a user with `rol = encargado` already exists
- WHEN the script is run again
- THEN it exits without creating a user and reports that an encargado already exists

#### Scenario: Idempotent invocation with same input
- GIVEN the script has already succeeded once for a given target email
- WHEN it is invoked again with the same input before any other encargado exists
- THEN it does not create a duplicate user for that email

### Requirement: Password Hashing
Passwords MUST be hashed with argon2id before storage; the system MUST NOT log or persist a plaintext password at any point, including in error details or application logs.

#### Scenario: Password stored as argon2id hash
- GIVEN a new user is created via the bootstrap script
- WHEN the `usuarios` row is inspected
- THEN `hash_contraseña` is an argon2id hash, never the plaintext password

#### Scenario: Plaintext never logged
- GIVEN a login attempt (successful or failed)
- WHEN application logs for that request are inspected
- THEN no plaintext password appears in any log line or error payload
