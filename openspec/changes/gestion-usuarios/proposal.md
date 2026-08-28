# Proposal: Gestion de Usuarios

## Intent

Backlog #3. Today only the bootstrap encargado exists (`seed-encargado.ts`); there is no in-app
way to onboard a second employee, change anyone's role, or deactivate an account. `UsuariosRepo`
(`apps/api/src/auth/repository.ts`) has only auth-support methods (`findByEmail`,
`registerFailedAttempt`, `resetAttempts`, `updatePassword`) — no create/list/update/deactivate.
Backlog #2.1 (app shell) and #2.2 (audit trail) both shipped specifically to unblock this item:
#2.1 gives the frontend a router and forms to build a screen against later; #2.2 gives every
mutation here a non-repudiation trail, which matters because the temporary-password flow means an
encargado briefly knows an employee's credential. Two structural risks make this change more than
routine CRUD: `sesiones.findValid` re-reads `usuarios` live on every request, so a bad
deactivate/demote of the last encargado locks out all admin access with no password-reset path to
recover it (ADR-0007 defers email reset out of v1); and `debe_cambiar_password` must be
server-enforced, not just a UI nicety, since #2.1 already proved a router guard alone is bypassable
with a stolen cookie.

## Scope

### In Scope
- `UsuariosRepo` (or a new `usuarios/repository.ts`): `create`, `list` (paginated), `findById`,
  `update` (nombre/email/rol/activo), and an atomic `countActiveEncargados`-style guard query.
- `usuarios/service.ts`: business rules — temp-password generation + hash on create,
  `debe_cambiar_password = true`, last-active-encargado guard (blocks self- and admin-initiated
  deactivate/demote of the last active encargado), email uniqueness, admin-initiated password
  reset reusing the same temp-password path as create.
- New `routes/usuarios.ts`: list, create, get, update, deactivate, reactivate, password-reset —
  all `config: { roles: ['encargado'] }`.
- Every write wrapped in `app.uow.run`, paired with `recordAudit` (`crear`, `actualizar`,
  `baja_logica`, `reactivar`) in the same transaction as the guard check and the row write.
- New `errors.ts` factories: resource-scoped 404, email-conflict, last-encargado-guard — plus
  matching Zod response-schema entries per route.
- Own `openspec/specs/user-management/spec.md`; does not extend `auth-sessions` scope.

### Out of Scope
- Any Usuarios screen (list/detail/create/edit UI). Tracked as fast-follow #3.1. Rationale: the
  literal backlog wording is backend CRUD; there is still no approved wireframe (`Wireframes.dc.html`
  referenced by `docs/design.md` is absent from the repo, unlike every other screen built so far);
  and combining API + UI in one PR risks the 400-line review budget on a change that already touches
  a security-sensitive guard. #2.1 already proved the split (shell first, screen later) works.
- Email-based password recovery — tracked as backlog #3.5 (see decisions below).
- Any change to `FIELD_CLASSIFICATION.usuarios` (already complete) or to the audit service
  signature (already fixed by #2.2).

## Decisions (settled by the user, 2026-08-27 — not reopened)

1. **Last-encargado guard, IN SCOPE.** Refuse to deactivate or demote the last active encargado,
   race-safe (atomic-statement precedent from the lockout UPDATE), inside the same transaction as
   the write and its audit row.
2. **System-generated temporary password, IN SCOPE.** On create, the API generates the password,
   returns it exactly once in the creation response, sets `debe_cambiar_password = true`, and
   never persists or logs the plaintext (argon2id hash only). Admin-initiated reset of an existing
   user reuses this path — the only in-app rescue for a locked-out non-encargado account.
3. **Email-based recovery, OUT OF SCOPE — new backlog #3.5.** Blocked by DNS, not effort: no domain
   exists that can carry SPF/DKIM (Firebase Hosting's `*.web.app` DNS belongs to Google), so no
   email could reach an employee. Adopting Firebase Authentication was rejected — it would replace
   the cookie+`sesiones` model ADR-0007 fixes and orphan `auditoria.usuario_id`'s FK.

## Capabilities

### New Capabilities
- `user-management`: CRUD of `usuarios` (create/list/get/update), role assignment, logical
  deactivation/reactivation, temporary-password issuance and admin-initiated reset, last-active-
  encargado protection — all encargado-only, all audited.

### Modified Capabilities
- None. `auth-sessions` (login, session resolution, RBAC hook) is consumed, not changed.

## Approach

Mirror the three-seam split from `auth-sesiones` (repository / service / route) and the
transactional pattern `changePassword` establishes: argon2 hashing happens outside `uow.run`;
the guard check, the row write, and `recordAudit` happen inside one `uow.run` call so a blocked
guard or a failed audit write rolls back the whole mutation. The last-encargado guard reuses the
single-atomic-UPDATE shape from `registerFailedAttempt` to avoid a TOCTOU window between counting
active encargados and committing the demote/deactivate.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/auth/repository.ts` | Modified | Extend `UsuariosRepo`: create/list/findById/update/guard query |
| `apps/api/src/usuarios/service.ts` | New | Business rules: temp password, last-encargado guard, uniqueness |
| `apps/api/src/routes/usuarios.ts` | New | CRUD + password-reset endpoints, `roles: ['encargado']` |
| `apps/api/src/lib/errors.ts` | Modified | 404 (resource), 409 (email conflict), 409/422 (last-encargado guard) |
| `apps/api/src/plugins/repos.ts` | Modified | Wire extended `usuarios` repo |
| `openspec/specs/user-management/spec.md` | New | Delta/full spec for this capability |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Last-encargado guard has a TOCTOU gap if not atomic+transactional | Low | Single-statement guard pattern + same `uow.run` as write/audit; dedicated race test |
| Temp password leaks via logs/response caching | Low | Never persisted in plaintext, returned once, response schema excludes it from any GET |
| Splitting UI to a fast-follow leaves #3 unreachable in a browser | Medium | Explicit #3.1 tracked immediately; API fully testable via integration tests meanwhile |
| New error codes under-documented in OpenAPI if Zod schemas lag the factories | Low | Add response-schema entries in the same commit as each new factory |

## Rollback Plan

Additive only: new service/route files, extended repo methods, new error factories. No destructive
schema change (guard query reads existing columns). Revert by reverting the commit(s); no data
migration required.

## Dependencies

- #2, #2.1, #2.2 (all archived/done). No external dependency.

## Success Criteria

- [ ] Encargado can create, list, get, update, deactivate, and reactivate a user; `deposito` gets
      403 on every one of these routes.
- [ ] User creation returns a temporary password exactly once; the hash only is persisted; login
      with it requires an immediate password change (`debe_cambiar_password`).
- [ ] Deactivating or demoting the last active encargado is refused (409/422), verified under a
      concurrent-request race test.
- [ ] Every create/update/deactivate/reactivate produces exactly one `auditoria` row, atomic with
      the write, with `hash_contrasena` excluded from both snapshots.

## Proposal question round (answered by the user, 2026-08-27)

All four questions raised by the proposal phase were confirmed at their stated defaults. They are
settled inputs for `sdd-spec` and `sdd-design`, not open items.

1. **Admin-initiated password reset revokes ALL of that user's sessions immediately.** The user is
   logged out everywhere and must sign in with the temporary password. Note the deliberate
   asymmetry with self-service `changePassword`, which revokes every *other* session and keeps the
   caller's own: there the actor owns the session being preserved, whereas an admin reset has no
   caller-owned session on the target to preserve. If the reset was triggered by a suspected
   compromise, leaving sessions alive would leave the attacker in.
2. **The flow works for BOTH roles** — an encargado may create and reset another encargado. The PRD
   does not restrict user management by the target's role, and restricting it would defeat the
   documented mitigation for the one remaining lockout gap (keep a second encargado account, so the
   two can rescue each other). There is no email recovery to fall back on.
3. **List endpoint ships pagination only in v1** — `?page&pageSize` reusing `lib/pagination.ts`
   verbatim. Filter/search by name, email, role, or active status is a cheap fast-follow once a
   real screen consumes the endpoint; adding contract surface and tests now, inside a change that
   already carries a security-sensitive guard, buys nothing at this headcount.
4. **UI deferral CONFIRMED.** The Usuarios screen is fast-follow #3.1; this change is backend-only.

## Naming correction (orchestrator, 2026-08-27)

The proposal as first drafted mixed `users/service.ts` with `routes/usuarios.ts`. Existing domain
directories are `apps/api/src/auth/` and `apps/api/src/auditoria/` — the directory takes the name of
the table it owns. This change therefore uses **`apps/api/src/usuarios/`**, not `users/`. Corrected
above before spec and design consume it.
