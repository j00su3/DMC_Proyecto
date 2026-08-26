# Proposal: Sistema de Auditoría General

## Intent

Backlog #2.2. The codebase has no record-change trail: edits to `usuarios`, `proveedores`, and
`productos` leave no trace of who changed what, and password changes are especially exposed —
`apps/api/src/auth/service.ts:106` already carries a comment marking it as the audit hook point,
because the temporary-password flow (#3) creates a window where an encargado knows an employee's
credential and a change "by the employee" is not provable. This blocks #3 and #4, both of which
list #2.2 as a hard dependency. ADR-0011 and ADR-0012 (2026-08-26) already resolved the schema and
service-boundary architecture; this proposal scopes the remaining product decisions.

## Scope

### In Scope
- New `auditoria` table (uuid pk, `entidad_id uuid` with no FK per ADR-0011) + additive migration.
- Audit service/repository recording creation, update, logical deletion, and reactivation of
  `usuarios`, `proveedores`, `productos`, plus password changes.
- Audit write executes inside the same DB transaction as the business write it records (first
  `db.transaction()` usage in this codebase — no prior precedent exists; `rg "\.transaction\("
  apps/api/src` returns nothing today).
- Wiring `changePassword` (`apps/api/src/auth/service.ts`) as the first call site.
- Sensitive-field denylist headed by `hash_contrasena` (ADR-0012 rule 4).
- Two boundary tests per ADR-0012 rule 5.

### Out of Scope
- Any read endpoint or UI for the audit trail (see Non-Goals).
- Failed login attempts and reads — not auditable actions in v1.
- Retention/purge policy — unbounded for v1.
- Wiring #3/#4 CRUD call sites themselves (those ship with #3/#4; this change only builds the
  service they will call).

**Note the consequence, because it shapes what v1 can actually be tested against:** only
`usuarios` and `sesiones` exist in `schema.ts` today. `proveedores` arrives with #4 and
`productos` with #5. So the service is built generically for all three, but in this change the
**only live call site is `changePassword`** — everything else is a contract waiting for its
consumer. The design phase must decide whether the `entidad` enum ships with all three values now
or grows later, and say why.

## Non-Goals

**No read path in v1.** Verified against `docs/PRD.md`, `docs/design.md`, and
`docs/TECH-DESIGNv2.md` (exploration phase, searched for `auditor|historial|traza|rastro`): every
PRD audit requirement is movement-scoped, and no document requests a report or UI over a
record-change trail. Building a read shape now would invent a DTO and query contract for zero
current consumers. The read shape belongs to whichever backlog item first needs it (tracked as
future work under #3).

## Capabilities

### New Capabilities
- `record-audit-trail`: `auditoria` table, repository, and service recording create/update/logical-
  delete/reactivate on `usuarios`/`proveedores`/`productos` and password changes, atomic with the
  operation it records, denylist-filtered snapshots, no quantity parameter in its signature.

### Modified Capabilities
- `password-change`: `changePassword` now writes an audit row in the same transaction as the
  password/session update.

## Approach

Follow ADR-0011 (uuid pk, no FK on `entidad_id`) and ADR-0012 (separate table, no double-write with
`movimientos`, denylist, no-quantity signature, two boundary tests, never named `historial`). Wrap
each business write plus its audit write in one `db.transaction()` call — if the audit write fails,
the business write rolls back, so the trail can never silently miss an entry.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/db/schema.ts` | New | `auditoria` table |
| `apps/api/drizzle/000X_*.sql` + `meta/` | New | Additive migration |
| `apps/api/src/auditoria/` | New | Repository + service (no quantity param) |
| `apps/api/src/plugins/repos.ts` | Modified | Extend `Repos` with `auditoria` |
| `apps/api/src/auth/service.ts` | Modified | `changePassword` writes an audit row, transactionally |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| First `db.transaction()` usage in the codebase — no precedent, untested pattern | Medium | Dedicated test asserting rollback when audit write fails |
| Denylist (ADR-0012) fails open on a future sensitive column vs. the codebase's one allowlist precedent (`toDto`) | Medium | Record the tension for design phase; not reopened here |
| #3/#4 both hard-depend on this service's signature | Medium | Design phase fixes signature/enum before #3 spec starts |

## Rollback Plan

Additive migration only (new table, no existing schema touched) — revert by dropping the table in a
follow-up migration. `changePassword` change is isolated to one function; revert via reverting the
commit, no data migration required.

## Dependencies

- None external. Depends on ADR-0011/0012 (already accepted) and backlog #2 (done).

## Success Criteria

- [ ] Creating/updating/deactivating/reactivating a `usuarios`/`proveedores`/`productos` row (once
      #3/#4 wire it) produces exactly one `auditoria` row with no `hash_contrasena` in either
      snapshot.
- [ ] Changing a password produces one `auditoria` row atomically with the password/session update.
- [ ] A simulated audit-write failure rolls back the business write (transaction test).
- [ ] Recording a `movimiento` produces zero `auditoria` rows and vice versa (ADR-0012 rule 5 test).

## Proposal question round

Product-shaping questions were already answered by the user on 2026-08-26, before this document was
drafted. Recorded as settled decisions above (write-only v1, actions list, transactional atomicity,
no retention policy). No further questions are open for this round; anything not settled here (see
exploration.md open questions on denylist granularity and creation-event field values) is explicitly
deferred to `sdd-design`.
