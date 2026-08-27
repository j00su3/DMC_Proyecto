# Delta for password-change

## MODIFIED Requirements

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
