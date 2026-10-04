# encargado-rescue Specification

## Purpose

Operator-run recovery of the `encargado` account whose password is lost, for the case where no
in-app route exists because user management requires an authenticated encargado. Closes drift
finding D-02 and delivers the manual procedure promised by ADR-0007. The procedure is a script run
by someone holding write access to the database (`pnpm --filter @inventienda/api rescatar:encargado`,
flags `--email <correo>` and `--confirmar`); it is not an HTTP route and has no UI. New capability
(greenfield, no prior spec). Refusals and notices are operator-facing console messages in Spanish,
not wire codes; no new error code or HTTP status is introduced.

## Requirements

### Requirement: Rescue Command Inputs
The script MUST take the target account from `--email <correo>` and the write authorization from
`--confirmar`. The email MUST be normalized exactly as login normalizes it (trimmed, lowercased)
before lookup. The script MUST refuse, writing nothing, when `--email` is absent or empty, when
`DATABASE_URL` is not set, or when it receives any argument it does not define. The script MUST NOT
accept a password from any CLI argument or from any environment variable.

#### Scenario: Email is matched after normalization
- GIVEN an active encargado stored with email `ana@tienda.com`
- WHEN the script runs with `--email "  Ana@Tienda.COM "` and `--confirmar`
- THEN that encargado is the one rescued

#### Scenario: Missing email is refused
- GIVEN `DATABASE_URL` is set
- WHEN the script runs without `--email`
- THEN it exits non-zero with a Spanish message naming the missing flag, and no `usuarios`, `sesiones` or `auditoria` row changes

#### Scenario: Missing DATABASE_URL is refused
- GIVEN `DATABASE_URL` is not set
- WHEN the script runs with `--email` and `--confirmar`
- THEN it exits non-zero with a Spanish message saying the database is not configured, and no connection is attempted

#### Scenario: A password flag is rejected
- GIVEN an active encargado exists
- WHEN the script runs with `--email <that email> --confirmar --password Secreto123`
- THEN it exits non-zero as an unknown argument, the encargado's `hash_contrasena` is unchanged, and `Secreto123` appears nowhere in the output

#### Scenario: A password in the environment is ignored
- GIVEN an environment variable carrying a candidate password (for example `RESCUE_PASSWORD=Secreto123`)
- WHEN a successful rescue runs
- THEN the displayed temporary password is the generated one, the candidate value is neither displayed nor usable to log in, and the stored hash does not verify against it

### Requirement: Successful Rescue of an Active Encargado
When `--confirmar` is given and the normalized email matches a `usuarios` row with `rol = 'encargado'`
and `activo = true`, the system MUST in one transaction: replace the account's password with a newly
generated temporary password stored only as an argon2id hash; set `debe_cambiar_password = true`;
set `intentos_fallidos = 0` and `bloqueado_hasta = NULL`; delete every `sesiones` row of that user;
and record exactly one `auditoria` row. The temporary password MUST come from the same generator
the in-app reset and user creation use.

#### Scenario: Rescue replaces the credential and forces a change
- GIVEN an active encargado with a known old password and `debe_cambiar_password = false`
- WHEN the rescue completes
- THEN the stored hash verifies against the displayed temporary password and not against the old one, and `debe_cambiar_password = true`

#### Scenario: The rescued encargado can log in at once
- GIVEN an active encargado locked by five failed logins (`bloqueado_hasta` in the future)
- WHEN the rescue completes and `POST /api/auth/login` is called with the displayed temporary password
- THEN the response is `200` with `debe_cambiar_password = true`, not `423 ACCOUNT_LOCKED`

#### Scenario: Lockout state is cleared
- GIVEN an active encargado with `intentos_fallidos = 5` and `bloqueado_hasta` set
- WHEN the rescue completes
- THEN `intentos_fallidos = 0` and `bloqueado_hasta` is `NULL`

#### Scenario: Every session is removed
- GIVEN the encargado has two `sesiones` rows and another user has one
- WHEN the rescue completes
- THEN the encargado has zero `sesiones` rows, the other user's session is untouched, and a request with either removed cookie returns `401 UNAUTHORIZED`

#### Scenario: Rescue of an already-flagged account still rotates the password
- GIVEN an active encargado with `debe_cambiar_password = true` and no lockout
- WHEN the rescue completes
- THEN the hash is replaced by one verifying the newly displayed password and one `auditoria` row is recorded

### Requirement: Atomic Rescue With Its Audit Row
The credential change, flag, lockout reset, session removal and `auditoria` row MUST be committed or
rolled back together. If any of them fails, the temporary password MUST NOT be displayed and the
script MUST exit non-zero.

#### Scenario: Audit failure rolls the whole rescue back
- GIVEN an active, locked encargado with one session, and the audit write is made to fail
- WHEN the script runs with `--confirmar`
- THEN `hash_contrasena`, `debe_cambiar_password`, `intentos_fallidos`, `bloqueado_hasta` and the session row are exactly as before, no `auditoria` row exists, no temporary password is printed, and the exit status is non-zero

#### Scenario: Successful pair commits together
- GIVEN the rescue and its audit write both succeed
- WHEN the transaction commits
- THEN the password change and exactly one `auditoria` row are visible to subsequent reads

### Requirement: Rescue Audit Row and Origin Marker
The `auditoria` row MUST have `entidad = 'usuarios'`, `accion = 'cambiar_password'`, `entidad_id`
equal to the rescued user's id, and `usuario_id` (actor) equal to the same id, because a script has
no authenticated actor and the column is mandatory. `datos_posteriores` MUST carry the key
`origen` with the value `'rescate'`, alongside the same changed columns an in-app reset records
(`debeCambiarPassword`, `intentosFallidos`, `bloqueadoHasta`). `datos_previos` MUST NOT carry
`origen`. Neither snapshot may contain `hash_contrasena` or the plaintext password. A row produced
by `POST /api/usuarios/:id/password-reset` or `POST /api/auth/password` MUST carry no `origen` key
in either snapshot.

#### Scenario: Rescue row identifies itself
- GIVEN a rescue of encargado E succeeds
- WHEN the resulting `auditoria` row is read from the database
- THEN `entidad = 'usuarios'`, `accion = 'cambiar_password'`, `entidad_id = E.id`, `usuario_id = E.id`, and `datos_posteriores.origen = 'rescate'`

#### Scenario: Rescue snapshots carry no secrets
- GIVEN a rescue of encargado E succeeds
- WHEN both snapshots of its `auditoria` row are inspected
- THEN neither contains `hash_contrasena`, a hash value, or the temporary password, and `datos_previos` has no `origen` key

#### Scenario: In-app admin reset carries no marker
- GIVEN an encargado resets a deposito user's password through `POST /api/usuarios/:id/password-reset`
- WHEN the resulting `auditoria` row is inspected
- THEN neither snapshot has an `origen` key and its `usuario_id` differs from its `entidad_id`

#### Scenario: Self-service change carries no marker
- GIVEN an authenticated user changes their own password through `POST /api/auth/password`
- WHEN the resulting `auditoria` row is inspected
- THEN neither snapshot has an `origen` key

#### Scenario: Marker is readable through the audit endpoint
- GIVEN a rescue row exists
- WHEN an encargado calls `GET /api/auditoria` filtered by that `entidadId`
- THEN the returned row's `datosPosteriores.origen` is `'rescate'`, unmodified

### Requirement: Refusals Write Nothing
The script MUST refuse, with or without `--confirmar`, when the normalized email matches no user,
when the matched user's `rol` is not `encargado`, and when the matched encargado has
`activo = false`. Each refusal MUST exit non-zero with a Spanish message that states its specific
reason, distinct from the other two. A refusal MUST NOT write to `usuarios`, `sesiones` or
`auditoria`, MUST NOT reactivate any account, and MUST NOT print a password.

#### Scenario: Unknown email
- GIVEN no user has the submitted email
- WHEN the script runs with `--confirmar`
- THEN it exits non-zero with a message saying no user was found, and row counts and contents of `usuarios`, `sesiones` and `auditoria` are identical before and after

#### Scenario: Non-encargado is refused
- GIVEN an active `deposito` user with a known password, one session, and `intentos_fallidos = 3`
- WHEN the script runs with that user's email and `--confirmar`
- THEN it exits non-zero with a message saying the account is not an encargado, and that user's `hash_contrasena`, `debe_cambiar_password`, `intentos_fallidos`, session row and the `auditoria` table are unchanged

#### Scenario: Inactive encargado is refused and not reactivated
- GIVEN an encargado with `activo = false`
- WHEN the script runs with that email and `--confirmar`
- THEN it exits non-zero with a message saying the account is inactive and that the script does not reactivate it, `activo` stays `false`, and no `usuarios`, `sesiones` or `auditoria` row changes

#### Scenario: Stored mixed-case email is not found
- GIVEN an encargado whose stored `email` is `Admin@Tienda.com`
- WHEN the script runs with `--email Admin@Tienda.com --confirmar`
- THEN the lookup uses `admin@tienda.com`, the script exits non-zero with the no-user-found message, and no `usuarios`, `sesiones` or `auditoria` row changes

#### Scenario: Refusal messages are distinct
- GIVEN the unknown-email, non-encargado and inactive cases
- WHEN each is run
- THEN the three console messages differ from one another

### Requirement: Confirmation Guard and Target Database Disclosure
Without `--confirmar`, the script MUST write nothing. It MUST print the host of the database named
by `DATABASE_URL` and the account it would rescue (name and email), state that no change was made
and that `--confirmar` is required, and exit zero: a preview is a successful outcome, not a refusal. It MUST NOT print the username, password or
any other credential part of `DATABASE_URL`, nor any password hash, in this or any other mode.
With `--confirmar` it MUST print the same host line before writing.

#### Scenario: No confirmation, nothing written
- GIVEN an active encargado and a `DATABASE_URL` of `postgres://rescue_op:s3cret@db.example.net/inventienda`
- WHEN the script runs with `--email <that email>` and no `--confirmar`
- THEN the output contains `db.example.net` and the encargado's name and email, the exit status is zero, and `usuarios`, `sesiones` and `auditoria` are unchanged

#### Scenario: Credentials are never printed
- GIVEN the same `DATABASE_URL`
- WHEN the script runs in any mode (no flag, `--confirmar`, or refused)
- THEN neither `rescue_op` nor `s3cret` appears in the output

#### Scenario: Confirmed run discloses the host first
- GIVEN an active encargado
- WHEN the script runs with `--confirmar`
- THEN the host line is printed before the temporary password

#### Scenario: Refusal precedes the preview
- GIVEN the matched user is inactive
- WHEN the script runs without `--confirmar`
- THEN the output is the inactive-account refusal, not a "would rescue" preview

### Requirement: Other Active Encargado Notice
When at least one active encargado other than the target exists, the script MUST still perform the
rescue (given `--confirmar`) and MUST state in its output, in the preview and in the confirmed run,
that resetting the password from within the app is the normal route. When no other active encargado
exists, the notice MUST NOT appear. Inactive encargados do not count.

#### Scenario: Rescue proceeds alongside another active encargado
- GIVEN encargados A and B are both active
- WHEN the script runs for A with `--confirmar`
- THEN A is rescued, B's row and sessions are untouched, and the output states that the in-app reset is the normal route

#### Scenario: Preview carries the notice
- GIVEN encargados A and B are both active
- WHEN the script runs for A without `--confirmar`
- THEN the output includes the same notice and nothing is written

#### Scenario: Sole active encargado gets no notice
- GIVEN encargado A is active and the only other encargado is inactive
- WHEN the script runs for A with `--confirmar`
- THEN A is rescued and the output contains no in-app-route notice

### Requirement: Temporary Password Handling
On a committed rescue the script MUST display the plaintext temporary password to the operator
exactly once, in a single write to standard output. The plaintext MUST NOT be written to the
application logger, to any file, to `auditoria`, or to the database, and MUST NOT appear in any
error message. The script MUST NOT display it on refusal, on a missing `--confirmar`, or on
rollback.

#### Scenario: Password appears exactly once
- GIVEN a successful rescue
- WHEN the full captured output of the process (standard output and standard error) is searched for the temporary password
- THEN exactly one occurrence is found

#### Scenario: Password is not persisted
- GIVEN a successful rescue
- WHEN `usuarios`, `sesiones` and `auditoria` are searched for the temporary password in any column
- THEN it is found nowhere; only its argon2id hash exists, in `hash_contrasena`

#### Scenario: Two rescues produce different passwords
- GIVEN the same encargado is rescued twice
- WHEN both displayed passwords are compared
- THEN they differ and only the second verifies against the stored hash

### Requirement: Runs Without COOKIE_SECRET
The rescue MUST complete successfully, including its audit row, when `COOKIE_SECRET` is not set in
the process environment. It MUST also complete when `COOKIE_SECRET` is set. Making this possible
MUST NOT weaken pseudonymization of audit snapshots that contain a pseudonymized field (see
`record-audit-trail`).

#### Scenario: Rescue with the secret unset
- GIVEN `COOKIE_SECRET` is absent from the environment and an active encargado exists
- WHEN the script runs with `--confirmar`
- THEN the rescue succeeds, the audit row exists with `origen = 'rescate'`, and the exit status is zero

#### Scenario: Rescue with the secret set
- GIVEN `COOKIE_SECRET` is set
- WHEN the script runs with `--confirmar` for an active encargado
- THEN the rescue succeeds and the audit row is identical in shape to the unset case

### Requirement: Operator Runbook
A Spanish runbook MUST exist in `docs/DEPLOY-PLAN.md`. It MUST state that the operator is the only
gate of this procedure and that the operator MUST confirm the requester's identity out of band
before running it. It MUST give the exact command, name the `--email` and `--confirmar` flags and
the preview-then-confirm sequence, and state that a write-capable `DATABASE_URL` is required (the CI
Neon URL is read-only). It MUST state that the temporary password is shown once and that the user
must change it at first login. It MUST say what the operator does when the script refuses because the
account is inactive (the script does not reactivate it). It MUST also say that an account whose
stored email contains uppercase letters is reported as not found, because the lookup uses the same
normalized email as login, and that such an account could never log in; repairing it is outside
this procedure.

#### Scenario: Runbook states the sole-gate rule
- GIVEN `docs/DEPLOY-PLAN.md`
- WHEN the rescue section is read
- THEN it says the operator is the only gate and that the requester's identity must be confirmed out of band before running the script

#### Scenario: Runbook is operable end to end
- GIVEN the rescue section
- WHEN it is read for the command, flags, required database access, one-time password and forced change
- THEN each of those five items is present

#### Scenario: Runbook covers the mixed-case stored email
- GIVEN the rescue section
- WHEN it is read for the refusal outcomes
- THEN it states that an account stored with uppercase letters in its email is reported as not found and is not repaired by this procedure

#### Scenario: Runbook covers the inactive-account case
- GIVEN the rescue section
- WHEN it is read for the refusal outcomes
- THEN it states that an inactive account is refused and not reactivated, and gives the operator's next step

### Requirement: Drift and Cross-Reference Records
The change MUST update the project documents that track this finding. `docs/DRIFT.md` D-02 MUST be
marked closed and point to the runbook. `docs/SECURITY.md` recommendation 4 MUST reference the
procedure. ADR-0007 MUST gain a short addendum naming the procedure. `docs/DRIFT.md` MUST gain two
new items: ADR-0007 says a correct password grants access while locked whereas the code returns
`423 ACCOUNT_LOCKED`; and `seed-encargado.ts` inserts the email unnormalized. The stale
cross-references MUST be corrected: `docs/SECURITY.md` cites the ADR-0007 section that promises the
procedure (lines 61-63), and `docs/DRIFT.md` cites the matching `docs/SECURITY.md` location (line
207).

#### Scenario: D-02 is closed
- GIVEN `docs/DRIFT.md`
- WHEN finding D-02 is read
- THEN its status is closed and it references the runbook

#### Scenario: New drift items are recorded
- GIVEN `docs/DRIFT.md`
- WHEN its items are listed
- THEN one describes the locked-account/correct-password mismatch between ADR-0007 and `auth/service.ts`, and one describes the unnormalized email in `seed-encargado.ts`

#### Scenario: Stale citations resolve
- GIVEN the corrected `docs/SECURITY.md` and `docs/DRIFT.md`
- WHEN each cited line range is opened
- THEN it lands on the text it claims to cite
