# Proposal: Pseudonymize `usuarios.nombre` in audit snapshots

## Intent

Close drift finding D-22 (`docs/DRIFT.md`, Advertencia). The PRD decision (`docs/PRD.md:202-209`)
says the audit trail "no conserva datos personales", but `FIELD_CLASSIFICATION.usuarios` pseudonymizes
only `email` (`apps/api/src/auditoria/fields.ts:47`). Every user creation or rename writes the
person's name in plaintext into a permanent trail. The code is brought in line with the promise.

## Ratified Decisions (owner, 2026-10-04 — final)

1. Pseudonymize `usuarios.nombre` in `datos_previos` / `datos_posteriores`.
2. Rows already written keep the plaintext name; the docs say so. No rewrite of the trail.
3. `nombre` gets its own HMAC domain tag. The email tag (`audit-email-pseudonym:`,
   `apps/api/src/auditoria/service.ts:54`) is unchanged, so existing email pseudonyms stay stable.
4. Edit `docs/PRD.md:202-209` (owner-approved) to say email and name; add a Status line to SEC-012
   in `docs/SECURITY.md`.
5. `proveedores.contacto` is out of scope; recorded as a new finding in `docs/DRIFT.md`.

Proposed defaults (owner may still change): D-21 (secret rotation changes pseudonyms) is not fixed
but its entry now says it also covers `nombre`; the OpenAPI contract does not change; the operator
rescue keeps running without `COOKIE_SECRET` (its snapshots carry no `nombre`).

## Scope

### In Scope
- Add `nombre` to `pseudonymizedFields` for `usuarios`; per-field domain tag in `pseudonymizeWith`.
- Update the three tests that assume plaintext/email-only; add unit tests (both snapshots
  pseudonymized, key required) and an integration test (no stored snapshot contains the name after a
  real create and rename).
- Docs: PRD, SECURITY SEC-012 Status, DRIFT (D-22 resolved, D-21 widened, new `contacto` finding),
  stale "email" code comments, BACKLOG item 2.5 wording.

### Out of Scope
- Rewriting or purging existing audit rows.
- `proveedores.contacto` and any other entity's fields.
- Fixing D-21 (key separation or rotation strategy).
- Any audit-read screen, API shape change, or new env variable.

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `record-audit-trail`: requirement "Pseudonym Key Required Only When a Pseudonymized Field Is
  Present" (`openspec/specs/record-audit-trail/spec.md:191-212`) is worded for `email` only; the
  pseudonymized-field set and per-field domain separation change.

## Approach

Make the HMAC domain tag a function of the field (email keeps its current literal, `nombre` gets a
new one) and list `nombre` in the `usuarios` classification. Key access stays lazy, so writes that
carry no string under a listed field (deactivate, reactivate, password changes, rescue) still need no
key. Wire codes and contract are untouched; if any new code is needed, settle it at spec time.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/auditoria/fields.ts`, `service.ts` | Modified | field list, per-field tag |
| `fields.test.ts`, `service.test.ts`, `routes/usuarios.integration.test.ts` | Modified | stale expectations |
| `openspec/specs/record-audit-trail/spec.md` | Modified (delta) | email-only wording |
| `docs/PRD.md`, `SECURITY.md`, `DRIFT.md`, `BACKLOG.md` | Modified | see In Scope |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| A name-only `PATCH` now needs `COOKIE_SECRET` (before: only create/email change) | Low | Production validates the secret at startup; unit test pins it |
| Low-entropy names are dictionary-testable by anyone holding the key | Med | Same trust boundary as email; documented in SEC-012 Status |
| Rename history shows as changed but is not readable as old to new | Med | Accepted product tradeoff; document it |
| Pre-change rows keep plaintext names | Certain | Ratified; stated in PRD and SEC-012 |
| Rotating `COOKIE_SECRET` changes `nombre` pseudonyms too | Low | D-21 entry updated |

## Rollback Plan

Revert the code and doc commits. Pseudonymized rows written meanwhile stay as they are; the trail is
append-only, so no data migration is needed either way.

## Dependencies

None.

## Success Criteria

- [ ] After a real create and rename, no stored snapshot contains the name in plaintext.
- [ ] Email pseudonyms computed before and after this change are identical.
- [ ] A rename still writes a visible diff; a no-op rename writes nothing.
- [ ] Rescue integration test passes without `COOKIE_SECRET`.
- [ ] `pnpm contract:check` reports no drift; docs updated as listed.

## Note for spec and design

Spec and design run in parallel and cannot see each other. Design must not decide product
behaviour; any conflict with the ratified decisions above is flagged, not resolved.
