# Proposal: Gestión de Proveedores

## Intent

Backlog #4. There is currently no `proveedores` table and no way to register, edit, or
deactivate a supplier in the application — the entity exists only in `docs/TECH-DESIGN.md:69-71`
as a design decision, not as code. This matters now because backlog #5 (Productos) depends on
#4: products will carry a `proveedor_id` foreign key, and a product cannot be created without a
supplier to reference. Deferring #4 further blocks #5 outright.

Success for this change is a backend capability that lets `encargado` create, list, read, edit,
and logically deactivate/reactivate suppliers, that lets `deposito` read but never write them
(403 otherwise), that guarantees no two active-or-inactive suppliers can share a name (so a
future selector never shows indistinguishable rows), and that never physically deletes a
supplier row — because #5's FK depends on that row surviving.

## Divergence from the backlog letter (recorded, not re-argued)

Backlog #4's letter names both the CRUD and the master-detail UI in one line. The backlog owner
was shown that literal reading and explicitly chose to split it on 2026-08-28: this change is
**backend only** — API routes, service, repository, Drizzle schema, and migration. The
master-detail screen is a separate follow-up item, mirroring how #3 (`gestion-usuarios`, backend)
and #3.1 (`pantalla-usuarios`, UI) split before it. This is recorded here so the divergence is
traceable to an explicit decision, not an assumption made silently during planning.

## Scope

### In Scope

- New `proveedores` table (Drizzle schema + migration): `id`, `nombre`, `contacto`, `activo`,
  `creadoEn`, mirroring the shape and conventions of the existing `usuarios` table.
- A case-insensitive unique constraint on `nombre` (see Decisions below).
- `apps/api/src/proveedores/repository.ts`: a port (`ProveedoresRepo`) plus a Drizzle adapter,
  following the `usuarios/repository.ts` shape — `list` (paginated), `findById`,
  `findByIdForUpdate`, `create`, `update`, `setActivo`. No `findByIdForUpdate`-driven
  cross-row guard is needed here (see the deactivation note below), but the row lock is kept for
  the same TOCTOU-safety reason `usuarios` takes it on every write: the read-then-diff-then-write
  sequence in the service must not race a concurrent write to the same row.
- `apps/api/src/proveedores/service.ts`: business rules — `nombre` normalization before the
  uniqueness check, diff-then-audit on update, `setActivo` for deactivate/reactivate, no
  cross-row guard.
- New `apps/api/src/routes/proveedores.ts`: list, create, get, update, deactivate, reactivate.
  `GET` routes take `config: { roles: ['encargado', 'deposito'] }`; every write route (`POST`,
  `PATCH`, deactivate, reactivate) takes `config: { roles: ['encargado'] }`.
  Deactivate/reactivate follow the usuarios precedent of two explicit `POST` routes rather than a
  `PATCH` carrying `activo`, so the audit verb is decided by which URL was called.
- Every write wrapped in `app.uow.run`, paired with `recordAudit` (`crear`, `actualizar`,
  `baja_logica`, `reactivar`) in the same transaction as the row write. No schema change to
  `auditoria` is needed — `entidadAuditoria` already lists `'proveedores'` and every verb this
  change uses already exists in `accionAuditoria` (`apps/api/src/db/schema.ts:61-73`). This change
  needs no migration.

  **Corrected 2026-08-28, after `sdd-design` checked what this phase only assumed.** An earlier
  draft of this section said the change "adds a call site, nothing more". That is wrong. The
  Postgres enum does list `'proveedores'`, but the TypeScript gate is
  `AuditableEntidad = keyof typeof FIELD_CLASSIFICATION` (`apps/api/src/auditoria/service.ts:8`),
  and `apps/api/src/auditoria/fields.ts` classifies only `usuarios`. So
  `recordAudit({ entidad: 'proveedores' })` **does not compile today**, and would throw at
  `auditoria/service.ts:49` if it did. This change must add a `proveedores` entry to
  `FIELD_CLASSIFICATION` — naming its auditable fields and any denylisted ones — and extend the
  exhaustiveness test that guards that map. The code anticipated this: `fields.ts:16-18` says
  «`proveedores`/`productos` join here when #4/#5 give them a call site».

  The lesson is worth keeping: checking the enum proved the database would accept the value, not
  that the application would compile. Two different gates, and only one of them was verified.
- A new `SUPPLIER_NAME_IN_USE`-style 409 error factory in `apps/api/src/lib/errors.ts`,
  matching the shape of `emailAlreadyInUse()`, plus a `SUPPLIER_NOT_FOUND` 404 factory matching
  `userNotFound()`. Matching Zod response-schema entries per route.
- Extraction of `isUniqueViolation()` out of `apps/api/src/usuarios/repository.ts:120-132` into a
  shared location (proposed: `apps/api/src/lib/db-errors.ts`) so both `usuarios/repository.ts`
  and `proveedores/repository.ts` import the same helper instead of duplicating the depth-5
  `error.cause` walk. `usuarios/repository.ts` is updated to import it from the new location; its
  existing unique-violation tests must keep passing unchanged, since the walk's behavior does not
  change, only its location.
- `apps/api/src/plugins/repos.ts`: wire the new `proveedores` repo alongside `usuarios`.
- New `openspec/specs/supplier-management/spec.md` — its own capability, not an extension of
  `user-management`.

### Out of Scope

- **Any Proveedores screen** — list, detail, create/edit form, or the master-detail layout named
  in `docs/design.md:94`. This is the divergence recorded above; it is tracked as a future UI
  follow-up item, not part of this change.
- **Product–supplier association** (backlog #5). This change creates the `proveedores` table
  `productos.proveedor_id` will eventually reference; it does not create `productos` or the FK
  itself.
- **Structured contact fields** (phone, email, contact person as separate columns). `contacto` is
  a single free-text field per `docs/TECH-DESIGN.md:69`, decided and not reopened here.
- **List filtering or search** (e.g., `?nombre=`). The list endpoint ships pagination only,
  matching the `gestion-usuarios` precedent of shipping filters only once a real consumer exists.
  Backlog #5 has not started; guessing a filter's shape now risks shipping a parameter nobody
  ends up using. A name-search filter is the most likely fast-follow once #5 needs a supplier
  selector, but that is a decision for that later change, not this one.
- **Any change to the `auditoria` schema, `accionAuditoria`, or `entidadAuditoria` enums** — all
  already cover this change's needs.
- **A last-active-supplier guard.** See the dedicated note below — this is a deliberate absence,
  not an oversight.

## Decisions (settled by the backlog owner, 2026-08-28 — not reopened)

1. **This change is backend only.** See "Divergence from the backlog letter" above.
2. **`nombre` uniqueness is case-insensitive, normalized before comparison, never before
   storage.** The unique constraint compares a trimmed, case-folded value; the column stores
   exactly what the user typed. This is deliberate, not a shortcut: the constraint exists so that
   backlog #5's supplier selector never shows two rows a person scanning a dropdown cannot tell
   apart. "Distribuidora Norte" and "distribuidora norte" are exactly as indistinguishable in that
   dropdown as two identical strings — in this business, that is one supplier typed twice, not two
   trade names, and a case-sensitive index would let the very duplicate the constraint exists to
   prevent slip through. **"Normalized" governs the comparison only.** A supplier created as
   "Distribuidora Norte" is read back, displayed, and audited as "Distribuidora Norte" — nothing
   here lowercases the stored value. This is worth stating explicitly because "normalized" is easy
   to misread as "stored lowercased," and a later phase acting on that misreading would mangle
   every supplier's display name. Mechanically this mirrors `usuarios.email`, which normalizes
   (trim + lowercase) before both storage and comparison — `proveedores.nombre` normalizes only
   for the comparison, which is the one place this change's normalization diverges from that
   precedent, and it diverges because a display name and a login identity answer different
   questions.
3. **`contacto` is a single free-text field, optional.** Matches `docs/TECH-DESIGN.md:69`
   literally. `TECH-DESIGN.md` does not mark it required, and nothing downstream needs it to
   function — a supplier registered in a hurry with contact details filled in later is a real,
   supported workflow, not an edge case to guard against.
4. **No list filtering in v1.** See Out of Scope above.

## The deactivation policy, and why no guard mirrors it

`docs/TECH-DESIGN.md:69-71` settles the "supplier deleted while products still reference it" case
as **logical deactivation** (`activo = false`), never physical deletion, so that a product's
`proveedor_id` reference and the audit history both survive. `docs/TECH-DESIGN.md:209-214`
restates this as an explicit acceptance criterion for backlog #4.

**Read `docs/PRD.md:179` carefully before trusting it on this point**: it files "proveedor
eliminado con productos aún asociados" under *casos borde a resolver* — open edge cases — which
reads as if the question were still unresolved. It is not. `docs/TECH-DESIGN.md` is where the
actual decision lives, and this proposal follows `TECH-DESIGN.md`, not the PRD's edge-case list.
Recording this here is meant to stop a later phase from re-litigating a settled decision because
it consulted the wrong document.

**This change deliberately ships no last-active-supplier guard**, unlike `usuarios`'s
last-active-encargado guard (`apps/api/src/usuarios/service.ts` — `assertNotLastActiveEncargado`).
That guard exists because `sesiones.findValid` re-reads `usuarios` live on every request: losing
every active encargado locks every administrator out of the system with no recovery path, a
system-wide invariant. Deactivating the last active supplier breaks nothing symmetrical — no
session, no login, no administrative capability depends on any supplier being active. Products
keep their FK regardless, and the shop keeps operating. Writing this absence down explicitly is
meant to stop a later phase from inventing a guard by analogy to `usuarios` and then writing tests
that protect an invariant which does not exist here.

## Capabilities

### New Capabilities

- `supplier-management`: CRUD of `proveedores` (create/list/get/update), logical
  deactivation/reactivation, case-insensitive name uniqueness — encargado read+write, deposito
  read-only, all writes audited.

### Modified Capabilities

- None. `user-management` and `auth-sessions` are consumed (RBAC hook, `UnitOfWork`,
  `recordAudit`) but not changed.

## Approach

Mirror the three-layer split `usuarios` establishes: `routes/proveedores.ts` (Fastify + Zod,
`config: { roles: [...] }` per route, split between read and write) → `proveedores/service.ts`
(normalization, diff-then-audit) → `proveedores/repository.ts` (a port plus its Drizzle adapter).
Every write runs inside one `uow.run` call so a failed uniqueness check or a failed audit write
rolls back the whole mutation, exactly as `usuarios/service.ts` does.

The one new piece of shared infrastructure is extracting `isUniqueViolation()` from
`usuarios/repository.ts` into a shared module both repositories import. This is worth doing now
rather than duplicating the depth-5 `error.cause` walk, because `productos` (backlog #5) will
also need unique-SKU handling and will want the same helper. The extraction must not weaken
`usuarios`'s existing unique-violation coverage — its tests move with the code, unchanged in
behavior, only relocated in source.

Deactivation and reactivation reuse the `usuarios` shape of two explicit routes
(`/proveedores/:id/deactivate`, `/proveedores/:id/reactivate`) rather than a `PATCH` carrying
`activo`, so the audit verb (`baja_logica` vs. `reactivar`) is decided by which URL was called,
not inferred from a diff — same reasoning `usuarios` already applied.

## Affected Areas

| Area | Impact | Description |
|------|--------|--------------|
| `apps/api/src/db/schema.ts` | Modified | New `proveedores` table; no enum changes |
| `apps/api/src/db/migrations/` | New | Migration creating `proveedores` + its unique index |
| `apps/api/src/proveedores/repository.ts` | New | Port + Drizzle adapter, mirrors `usuarios/repository.ts` |
| `apps/api/src/proveedores/service.ts` | New | Normalization, diff-then-audit, no cross-row guard |
| `apps/api/src/routes/proveedores.ts` | New | CRUD + deactivate/reactivate, split read/write roles |
| `apps/api/src/lib/db-errors.ts` (or similar) | New | `isUniqueViolation()` extracted from `usuarios/repository.ts` |
| `apps/api/src/usuarios/repository.ts` | Modified | Imports the extracted helper instead of a local copy |
| `apps/api/src/lib/errors.ts` | Modified | `SUPPLIER_NOT_FOUND` 404, name-conflict 409 factories |
| `apps/api/src/plugins/repos.ts` | Modified | Wire the new `proveedores` repo |
| `openspec/specs/supplier-management/spec.md` | New | Spec for this capability |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Case-insensitive uniqueness collides with legitimate near-duplicate trade names | Low | Accepted tradeoff per owner decision; a genuine name collision surfaces as a 409, not silent data loss |
| Extraction of `isUniqueViolation()` regresses `usuarios`'s existing coverage | Low | Move tests with the code; no behavior change, only relocation |
| A later phase reintroduces a last-active-supplier guard by false analogy to `usuarios` | Low | Explicitly documented absence, with the reasoning, in this proposal and the eventual spec |
| A later phase reads `docs/PRD.md:179` alone and treats deletion-with-products as unresolved | Low | This proposal points to `TECH-DESIGN.md:69-71` as the authority explicitly |

## Rollback Plan

Additive only: new table, new migration, new service/route/repository files, extended error
factories. Reverting the extraction of `isUniqueViolation()` is also additive-safe — it is a pure
relocation. Revert by reverting the commit(s) and rolling back the migration; no destructive
schema change and no data to migrate.

## Dependencies

- #2.2 (audit trail schema — archived, already covers `proveedores`). No other dependency. #4
  itself is a dependency of backlog #5 (Productos).

## Success Criteria

- [ ] Encargado can create, list, get, update, deactivate, and reactivate a supplier; deposito can
      list and get but receives 403 on create/update/deactivate/reactivate.
- [ ] Two suppliers cannot share a name after case-fold + trim normalization; the conflicting
      create/update returns 409, and the stored `nombre` on the existing row keeps its original
      casing.
- [ ] Deactivating a supplier never deletes the row; it sets `activo = false` and is fully
      reversible via reactivate.
- [ ] Every create/update/deactivate/reactivate produces exactly one `auditoria` row, atomic with
      the write.
- [ ] No last-active-supplier guard exists; deactivating the only active supplier succeeds.

## Non-Goals (explicit)

- No UI of any kind — no list screen, no detail view, no master-detail layout, no forms.
- No product–supplier association or `productos.proveedor_id` FK (backlog #5).
- No structured contact columns (phone/email/person) — `contacto` stays single free-text.
- No changes to `auditoria`, `accionAuditoria`, or `entidadAuditoria`.
- No list filtering or search in v1.
- No last-active-supplier guard.

## Proposal question round (2026-08-28)

Three questions were raised during this phase and answered before a second round was needed.

1. **`nombre` uniqueness case-sensitivity** — **answered by the backlog owner directly.** This
   phase proposed case-*sensitive* uniqueness, arguing a trade name is not a login identity; that
   default was put to the owner alongside the counter-argument and **overruled**. The decision is
   case-insensitive, normalized for comparison only, never for storage. See Decision 2 for the
   full reasoning.
2. **`contacto` required or optional on create** — optional. Settled by the coordinator as a
   routine call, since `docs/TECH-DESIGN.md` does not mark it required and nothing downstream
   depends on it.
3. **List filtering in v1** — deferred. Settled by the coordinator as a routine call, matching the
   usuarios precedent; see Out of Scope.

The distinction is recorded on purpose: question 1 is a product judgement the owner made against
this phase's own recommendation, and a later reader should be able to tell that apart from the two
defaults nobody needed to be asked about.

All three are settled inputs for `sdd-spec` and `sdd-design`, not open items.
