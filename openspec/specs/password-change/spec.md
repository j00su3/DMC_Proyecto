# password-change Specification

## Purpose

Authenticated password-change endpoint, the `debe_cambiar_password` column/migration, session revocation on change, and the server-side forced-password-change allowlist that makes the state unbypassable via direct API calls. New capability (greenfield, no prior spec).

## Requirements

### Requirement: Change Password Endpoint
`POST /api/auth/password` MUST be an authenticated route (not `config: { auth: false }`) accepting
`{ currentPassword, newPassword }`, verifying `currentPassword` against the caller's
`hash_contrasena` via the existing argon2 module, and on success updating `hash_contrasena` to the
hash of `newPassword`, setting `debe_cambiar_password` to `false`, **revoking the caller's other
sessions**, and recording an `auditoria` row for the change — all inside the same database
transaction, so that if any of those writes fails every one of them rolls back.
(Previously: the password update, the `debe_cambiar_password` flip and the session revocation were
three separate awaited calls with no transactional boundary, and none was paired with an audit
write. Session revocation is folded into the transaction here because the capability's existing
promise — that another session's cookie stops working — is not kept if that write can fail on its
own while the password change commits: the user would be told they are protected when they are not.
Reconciled with design.md's Data Flow, which rolls back `deleteOthers` too.)

#### Scenario: Successful password change
- GIVEN an authenticated user submits their correct current password and a valid new password
- WHEN `POST /api/auth/password` is called
- THEN the response is `200`, `hash_contrasena` is updated, `debe_cambiar_password` becomes `false`, and exactly one `auditoria` row is recorded for the change

#### Scenario: Wrong current password
- GIVEN an authenticated user submits an incorrect current password
- WHEN `POST /api/auth/password` is called
- THEN the response is `400 { error: { code: "INVALID_CURRENT_PASSWORD" } }`, no fields are updated, and no `auditoria` row is recorded
- AND the status MUST NOT be `401`, because the session is valid and a `401` would trip the SPA's global session-expiry recovery and discard the user's typed input (design D5)

#### Scenario: Invalid new password shape
- GIVEN a new password failing Zod validation (e.g. empty)
- WHEN `POST /api/auth/password` is called
- THEN the response is `400 { error: { code: "VALIDATION_ERROR" } }` and no `auditoria` row is recorded

#### Scenario: Audit write failure rolls back the password change
- GIVEN an authenticated user submits a correct current password and a valid new password
- WHEN the audit write for that change fails
- THEN the entire operation rolls back — `hash_contrasena` and `debe_cambiar_password` remain unchanged, the caller's other sessions are NOT revoked, and no `auditoria` row is recorded
- AND the response is `500 { error: { code: "AUDIT_WRITE_FAILED" } }`, not `200`

### Requirement: Session Revocation on Password Change
On a successful password change, the system MUST delete all of that user's sessions EXCEPT the session that performed the change.

#### Scenario: Other sessions revoked
- GIVEN a user has two active sessions: A (performing the change) and B (elsewhere)
- WHEN the password change via session A succeeds
- THEN session B's `sesiones` row is deleted and a subsequent request using B's cookie returns `401 UNAUTHORIZED`

#### Scenario: Current session survives
- GIVEN a user has one active session (A) performing the change
- WHEN the password change via session A succeeds
- THEN session A remains valid and requests using its cookie continue to succeed

### Requirement: debe_cambiar_password Column
The system MUST add a `debe_cambiar_password` boolean column to `usuarios`, defaulting to `false`, via an additive Drizzle migration.

#### Scenario: Existing users unaffected
- GIVEN a user row that existed before this migration
- WHEN the migration runs
- THEN that row's `debe_cambiar_password` is `false`

### Requirement: Server-Side Forced-Password-Change Allowlist
WHEN `request.user.debe_cambiar_password` is `true`, the `auth.ts` plugin's `preHandler` MUST refuse the route unless it opts in via the Fastify route config key `allowPasswordChangePending: true`, returning `403 { error: { code: "PASSWORD_CHANGE_REQUIRED" } }` so the SPA can route deterministically. The check MUST run BEFORE the `roles` check, so the reachable set is exactly the opted-in routes regardless of role and the returned code is deterministic. This enforcement MUST be independent of, and MUST NOT rely on, any client-side guard.

The allowlist MUST be an opt-in route config key, not a hardcoded URL list inside the plugin, so that it mirrors the existing `auth: false` / `roles` pattern and is default-deny: a route added later is blocked until it opts in. Exactly two routes opt in — `GET /api/auth/me` and `POST /api/auth/password`. `POST /api/auth/logout` and `POST /api/auth/login` need no entry because they already declare `config: { auth: false }` and therefore skip both the `onRequest` and `preHandler` hooks entirely.

#### Scenario: Forced-change user is refused an unrelated protected route
- GIVEN an authenticated request whose resolved user has `debe_cambiar_password = true`
- WHEN that request targets an authenticated route that does not declare `allowPasswordChangePending`
- THEN the response is `403 { error: { code: "PASSWORD_CHANGE_REQUIRED" } }` and the route handler does not execute

#### Scenario: Opted-in routes stay reachable during forced change
- GIVEN an authenticated request whose resolved user has `debe_cambiar_password = true`
- WHEN that request targets `GET /api/auth/me` or `POST /api/auth/password`
- THEN the request proceeds to the route handler normally, unaffected by the flag

#### Scenario: Logout stays reachable during forced change
- GIVEN a user with `debe_cambiar_password = true` holds a valid session cookie
- WHEN they call `POST /api/auth/logout`
- THEN the request succeeds and the session is destroyed, because that route declares `config: { auth: false }` and never reaches the forced-change check

#### Scenario: Forced-change refusal outranks a role mismatch
- GIVEN an authenticated user with `debe_cambiar_password = true` whose `rol` is also not in a route's `roles` allowlist
- WHEN that route is called
- THEN the response code is `PASSWORD_CHANGE_REQUIRED`, not `FORBIDDEN`, so the SPA gets one unambiguous instruction

#### Scenario: A route added later is blocked by default
- GIVEN a new authenticated route is registered without declaring `allowPasswordChangePending`
- WHEN a user with `debe_cambiar_password = true` calls it
- THEN the response is `403 { error: { code: "PASSWORD_CHANGE_REQUIRED" } }` with no change to the plugin

#### Scenario: Direct API bypass attempt is refused
- GIVEN a user with `debe_cambiar_password = true` holds a valid session cookie
- WHEN they call a non-opted-in authenticated endpoint directly (e.g. curl/devtools), bypassing the SPA
- THEN the server still returns `403 { error: { code: "PASSWORD_CHANGE_REQUIRED" } }` — the SPA guard is not the authority
