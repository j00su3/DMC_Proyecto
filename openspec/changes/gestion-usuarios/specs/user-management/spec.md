# user-management Specification

## Purpose

Encargado-only CRUD of `usuarios`: create, list, get, update (nombre/email/rol), logical
deactivation/reactivation, and admin-initiated password reset. Backend only (Usuarios screen is
fast-follow #3.1). Consumes `auth-sessions`' RBAC hook and `record-audit-trail`'s audit contract
without modifying either; reuses `api-contract-pipeline`'s error and pagination envelopes verbatim.
New capability (greenfield, no prior spec).

Routes: `POST /api/usuarios`, `GET /api/usuarios`, `GET /api/usuarios/:id`,
`PATCH /api/usuarios/:id`, `POST /api/usuarios/:id/deactivate`,
`POST /api/usuarios/:id/reactivate`, `POST /api/usuarios/:id/password-reset`.

| Failure | Status | Code |
|---|---|---|
| No session | 401 | `UNAUTHORIZED` |
| Session `rol = deposito` | 403 | `FORBIDDEN` |
| `:id` matches no user | 404 | `USER_NOT_FOUND` |
| Email already used by another user | 409 | `EMAIL_ALREADY_IN_USE` |
| Target is the last active `encargado` | 409 | `LAST_ACTIVE_ENCARGADO` |

## Requirements

### Requirement: Role Gate on Every User-Management Route
Every route in this capability MUST declare `config: { roles: ['encargado'] }`.

#### Scenario: Unauthenticated request
- GIVEN no valid session cookie
- WHEN any user-management route is called
- THEN the response is `401 { error: { code: "UNAUTHORIZED" } }`

#### Scenario: Deposito role rejected
- GIVEN an authenticated session with `rol = deposito`
- WHEN any user-management route is called
- THEN the response is `403 { error: { code: "FORBIDDEN" } }`

### Requirement: User Creation With Temporary Password
`POST /api/usuarios` MUST accept `{ nombre, email, rol }`, generate a temporary password, hash it
with argon2id, persist only the hash, set `debe_cambiar_password = true`, and return the plaintext
temporary password in the `201` response body exactly once. The plaintext MUST NOT be persisted or
logged, and MUST NOT appear in any subsequent response (including `GET`).

#### Scenario: Successful creation
- GIVEN an encargado submits valid `nombre`, `email`, and `rol`
- WHEN `POST /api/usuarios` completes
- THEN the response is `201` with the temporary password in the body, `hash_contrasena` is an
  argon2id hash, `debe_cambiar_password = true`, and one `auditoria` row (`crear`) is recorded

#### Scenario: Password never resurfaces
- GIVEN a user was created with a temporary password
- WHEN that user is later fetched via `GET /api/usuarios/:id` or listed
- THEN no field in the response contains the plaintext or the hash

### Requirement: Email Uniqueness and Normalization
Email MUST be normalized (trimmed, lowercased) before comparison and storage on both create and
update. A create or update that collides with another user's normalized email MUST be refused
without writing.

#### Scenario: Duplicate email on create
- GIVEN an active user already owns `email`
- WHEN `POST /api/usuarios` is called with the same email in a different case/whitespace
- THEN the response is `409 { error: { code: "EMAIL_ALREADY_IN_USE" } }` and no row is created

#### Scenario: Duplicate email on update
- GIVEN two distinct users exist
- WHEN `PATCH /api/usuarios/:id` sets one user's email to the other's normalized email
- THEN the response is `409 { error: { code: "EMAIL_ALREADY_IN_USE" } }` and no field is changed

### Requirement: List Users (Paginated)
`GET /api/usuarios` MUST accept `?page&pageSize` per `lib/pagination.ts` and respond with
`{ data, page, pageSize, total }`, where each `data` item excludes `hash_contrasena`. Filtering or
search by name, email, role, or active status is out of scope for this endpoint.

#### Scenario: Default pagination
- GIVEN more than 20 users exist
- WHEN `GET /api/usuarios` is called with no query params
- THEN `data` has at most the default `pageSize` items, `page = 1`, `total` reflects the full count

#### Scenario: Explicit pagination
- GIVEN `?page=2&pageSize=5`
- WHEN the endpoint responds
- THEN `data` has at most 5 items and `page`/`pageSize` echo the request

### Requirement: Get User by Id
`GET /api/usuarios/:id` MUST return `200` with the user DTO (excluding `hash_contrasena`) or `404`.

#### Scenario: Existing user
- GIVEN `:id` matches an existing user
- WHEN `GET /api/usuarios/:id` is called
- THEN the response is `200` with the user DTO and no password/hash field

#### Scenario: Unknown id
- GIVEN `:id` matches no user
- WHEN `GET /api/usuarios/:id` is called
- THEN the response is `404 { error: { code: "USER_NOT_FOUND" } }`

### Requirement: Update User Profile and Role
`PATCH /api/usuarios/:id` MUST accept a partial `{ nombre, email, rol }` and persist only the
supplied fields. `activo` is exclusively managed by the deactivate/reactivate endpoints, not by
this route.

#### Scenario: Successful update
- GIVEN an encargado submits a valid partial update for an existing user
- WHEN `PATCH /api/usuarios/:id` completes
- THEN the response is `200` with the updated fields persisted and one `auditoria` row
  (`actualizar`) recorded

#### Scenario: Target not found
- GIVEN `:id` matches no user
- WHEN `PATCH /api/usuarios/:id` is called
- THEN the response is `404 { error: { code: "USER_NOT_FOUND" } }` and no audit row is recorded

### Requirement: Logical Deactivation
`POST /api/usuarios/:id/deactivate` MUST set `activo = false` for a target that is not the last
active `encargado`. Because `sesiones.findValid` requires `activo = true` on every lookup, no
separate session-revocation step is required: the target loses access on its very next request.

#### Scenario: Successful deactivation
- GIVEN the target is active and not the last active encargado
- WHEN `POST /api/usuarios/:id/deactivate` completes
- THEN the response is `200`, `activo = false`, one `auditoria` row (`baja_logica`) is recorded,
  and the target's next request with any existing session cookie returns `401`

### Requirement: Reactivation
`POST /api/usuarios/:id/reactivate` MUST set `activo = true` for an existing user.

#### Scenario: Successful reactivation
- GIVEN the target has `activo = false`
- WHEN `POST /api/usuarios/:id/reactivate` completes
- THEN the response is `200`, `activo = true`, one `auditoria` row (`reactivar`) is recorded, and
  the target can log in again with its existing credentials

### Requirement: Last-Active-Encargado Guard
Deactivating (`POST .../deactivate`) or demoting (`PATCH .../:id` with `rol: 'deposito'`) the last
active `encargado` MUST be refused, whether self-initiated or admin-initiated on another account.
The guard MUST be race-safe: the active-encargado count MUST NOT be able to drop to zero even under
concurrent requests, using a single atomic check-and-write statement inside the same transaction as
the row write and its audit row.

#### Scenario: Deactivating the last encargado is refused
- GIVEN exactly one active `encargado` exists
- WHEN `POST /api/usuarios/:id/deactivate` targets that user (self- or admin-initiated)
- THEN the response is `409 { error: { code: "LAST_ACTIVE_ENCARGADO" } }`, `activo` is
  unchanged, and no `auditoria` row is recorded

#### Scenario: Demoting the last encargado is refused
- GIVEN exactly one active `encargado` exists
- WHEN `PATCH /api/usuarios/:id` sets that user's `rol` to `deposito`
- THEN the response is `409 { error: { code: "LAST_ACTIVE_ENCARGADO" } }`, `rol` is
  unchanged, and no `auditoria` row is recorded

#### Scenario: Concurrent requests cannot both succeed
- GIVEN exactly two active encargados, A and B
- WHEN two concurrent requests simultaneously attempt to deactivate/demote A and B respectively
- THEN at most one request succeeds, the other is refused with `LAST_ACTIVE_ENCARGADO`, and
  the active-encargado count never reaches zero

### Requirement: Admin-Initiated Password Reset
`POST /api/usuarios/:id/password-reset` MUST reuse the temporary-password path from creation: a
new password is generated, hashed, returned exactly once, and `debe_cambiar_password` is set to
`true`. Unlike self-service `POST /api/auth/password` (which preserves the acting session), this
reset MUST delete ALL of the target's sessions immediately, because the actor is never the target
and there is no caller-owned session to preserve. This applies identically whether the target's
`rol` is `encargado` or `deposito`.

The same write MUST also clear `intentos_fallidos` and `bloqueado_hasta`. This is not a convenience:
`login` checks `bloqueado_hasta` and throws `ACCOUNT_LOCKED` **before** it verifies the password, so
a locked account cannot authenticate for the full window whatever its hash is — and being locked out
is the most likely reason the reset was requested. Without this, the encargado hands over a
credential that provably does not work. Self-service `changePassword` needs no equivalent, because
the caller had to authenticate to reach it and was therefore never locked.

The audit row for this action MUST use `accion = 'cambiar_password'`, with both snapshots carrying
the three changed non-denylisted columns (`debeCambiarPassword`, `intentosFallidos`,
`bloqueadoHasta`). An admin reset is distinguishable from a self-service change by the row itself:
it is the one where `usuario_id` (actor) differs from `entidad_id` (subject).

#### Scenario: Successful reset revokes every session
- GIVEN the target has two active sessions
- WHEN `POST /api/usuarios/:id/password-reset` completes
- THEN the response is `200` with the new temporary password, `hash_contrasena` is updated,
  `debe_cambiar_password = true`, both of the target's sessions are deleted, and one `auditoria`
  row is recorded

#### Scenario: Resetting another encargado's password is allowed
- GIVEN the target's `rol` is `encargado`
- WHEN an encargado calls `POST /api/usuarios/:id/password-reset` on that target
- THEN the reset succeeds identically to a `deposito` target

### Requirement: Audit Obligation Per Mutation
Every create, update, deactivate, reactivate, and password-reset MUST produce exactly one
`auditoria` row, written atomically with the row write per `record-audit-trail`'s transaction
contract, with `hash_contrasena` excluded from both the before and after snapshots.

#### Scenario: One audit row per mutation, hash excluded
- GIVEN any create/update/deactivate/reactivate/password-reset call succeeds
- WHEN the resulting `auditoria` row is inspected
- THEN exactly one row exists for that action and neither snapshot contains `hash_contrasena`

### Requirement: Atomic Rollback on Guard Trip or Audit Failure
If the last-encargado guard refuses a mutation, or the paired audit write fails, the target's
`usuarios` row MUST be left exactly as it was before the request — no partial field change — and
no `auditoria` row MUST exist for that attempt.

#### Scenario: Tripped guard leaves no partial write
- GIVEN the last-encargado guard refuses a deactivate or demote
- WHEN the request completes
- THEN every field of the target row is unchanged from before the request

#### Scenario: Failed audit write rolls back the mutation
- GIVEN a create/update/deactivate/reactivate/password-reset write is in progress
- WHEN the paired audit write fails
- THEN the entire transaction rolls back, the target row is unchanged, and the response is
  `500 { error: { code: "AUDIT_WRITE_FAILED" } }`

### Requirement: Locked Account Is Rescuable By Reset
An account locked by failed login attempts MUST be able to log in with the temporary password
issued by an admin reset, immediately, without waiting out the lockout window.

#### Scenario: Reset rescues a locked-out account
- GIVEN a user has been locked by 5 failed login attempts and `bloqueado_hasta` is in the future
- WHEN an encargado calls `POST /api/usuarios/:id/password-reset` on that user
- THEN the user can immediately log in with the returned temporary password, and the response is
  `200`, not `423 ACCOUNT_LOCKED`

### Requirement: No State Change Writes Nothing
A mutation whose requested end state already holds MUST write no row and record no `auditoria`
row, and MUST respond `200` with the current DTO — not `409`, not `404`. This applies uniformly to
a `PATCH` whose values equal the current row, a deactivate on an already-inactive user, and a
reactivate on an already-active user.

The reason is the trail, not the status code: `baja_logica` and `reactivar` name a *transition*, so
a row whose diff is `{activo: false} → {activo: false}` asserts a transition that never happened.
That corrupts the exact query `record-audit-trail` created these verbs for — "who deactivated this
user" would return whoever clicked the button twice.

#### Scenario: Deactivating an already-inactive user is a no-op
- GIVEN the target already has `activo = false`
- WHEN `POST /api/usuarios/:id/deactivate` is called
- THEN the response is `200` with the current DTO, the row is untouched, and NO `auditoria` row is
  recorded

#### Scenario: A PATCH with unchanged values is a no-op
- GIVEN a `PATCH` body whose every field equals the target's current value
- WHEN the request completes
- THEN the response is `200`, the row is untouched, and NO `auditoria` row is recorded

### Requirement: PATCH Rejects an `activo` Key
`PATCH /api/usuarios/:id` MUST reject a body containing `activo` at the schema layer, before any
handler runs, and MUST require at least one of `nombre`, `email`, `rol`.

Allowing `activo` through `PATCH` would let one request change `nombre` and `activo` together,
forcing either two `auditoria` rows for one transaction or a lossy choice between `actualizar` and
`baja_logica` — and the lossy choice destroys the indexed equality filter on `accion`.

#### Scenario: activo in a PATCH body is refused
- GIVEN a `PATCH /api/usuarios/:id` body containing an `activo` key
- WHEN the request is validated
- THEN it is refused with a validation error before any handler runs, and no row is written
