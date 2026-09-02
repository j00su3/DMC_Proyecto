# Proposal: Motor de Alertas (backlog #10)

## Intent

InvenTienda has no alert infrastructure: no `alertas` table, no automatic notification when stock
crosses a threshold, hits zero, or an `ajuste` is flagged as a discrepancy. Staff currently
discover these conditions only by manually inspecting stock lists. This change builds the alert
engine so `stock_bajo`, `quiebre`, and `discrepancia` alerts are created, de-duplicated, and
auto-resolved as a side effect of normal inventory movements, without risking the atomicity of the
movement/sale itself (C1).

## Scope

### In Scope
- `alertas` table + evaluator invoked from all four movimiento-creation call sites.
- Threshold-crossing creation of `stock_bajo`/`quiebre` (downward edge only) and their
  auto-resolution on any movement that restores stock, including `anulacion`.
- `discrepancia` creation from `Movimiento.esDiscrepancia = true` (column already exists).
- De-duplication: no new alert per producto+tipo while one is `activa` or `vista`.
- New endpoint for manual resolution of `discrepancia`, encargado-only.
- Alert list/count read endpoint for the SPA, with polling.

### Out of Scope
- `sugerencia_reposicion` (type, creation heuristic, resolution) — entirely backlog #11.
- Any change to the S7 30-day/14-day/7-day replenishment heuristic.
- Enum migration work for #11's future type — see PD-1.

## Product Decisions

**PD-1 — Scope split with backlog #11** (owner-ratified, binding): motor-alertas (#10) creates and
auto-resolves exactly three alert types: `stock_bajo`, `quiebre`, `discrepancia`.
`sugerencia_reposicion` is entirely out of scope for #10 — it belongs to backlog #11, a separate
later change that depends on #10. `Alerta.tipo` must not require future migration when #11 adds
its type, but no `sugerencia_reposicion` logic is built here.

**PD-2 — All four movimiento call sites are in scope**: `movimientos/service.ts`,
`productos/service.ts::crearProducto`, `ventas/service.ts::confirmarVenta`, and
`ventas/service.ts::anularVenta` must all invoke the alert evaluator. An engine that only fires for
the one call site with the pre-existing SEAM comment is under-scoped and would silently miss stock
initialization and sale/anulación paths. `confirmarVenta`'s per-item vs. whole-sale evaluation
granularity is an open question deferred to design (see below).

**PD-3 — Alert visibility/RBAC**: both roles (`encargado`, `deposito`) can view the alert
list/count, mirroring this project's existing convention that screens both roles can read go under
`shellLayout`. Manual resolution of `discrepancia` is encargado-only, mirroring every other
write-capable action in this project.

**PD-4 — SPA polling interval: 60 seconds**. Alerts are operationally useful within a few minutes,
not real-time; 60s balances freshness against not hammering the free-tier Render backend, which
cold-starts after ~15 minutes idle (see CLAUDE.md Deployment).

**PD-5 — Audit trail: yes**. Creating and manually resolving an alert calls `recordAudit` inside
the same `UnitOfWork`, consistent with "every write goes through UnitOfWork." This requires a new
`alertas` entry in `apps/api/src/auditoria/fields.ts` to satisfy the `AuditableEntidad` compile
gate (design/tasks own the exact field classification).

## Capabilities

### New Capabilities
- `alertas`: alert lifecycle — creation on threshold-crossing/discrepancy, de-duplication,
  auto-resolution, manual resolution, list/count read endpoint, SPA polling.

### Modified Capabilities
- None (movimientos/ventas/productos services gain an internal evaluator call, no requirement-level
  behavior change to those capabilities' existing specs).

## Approach

New `EvaluadorDeAlertas` invoked inside each movimiento-creation transaction, wrapped in a
`SAVEPOINT alertas` so any evaluator SQL error rolls back only the alert side-effect, never the
movement/sale (C1's acceptance criterion, owner-ratified). New `AlertasRepo` port+adapter
registered in `plugins/repos.ts`, mirroring existing domains.

## Open Questions Deferred to Design

1. **SAVEPOINT mechanism**: raw SQL (`tx.execute(sql`SAVEPOINT alertas`)` / `ROLLBACK TO SAVEPOINT
   alertas`) vs. Drizzle's nested `.transaction()` (auto-named, re-throws by default — opposite of
   what C1 needs). Whichever design chooses, it MUST satisfy this product-level constraint: an
   alert-evaluator SQL error never rolls back the underlying movement/sale, proven by a test that
   injects a SQL error into the evaluator and asserts the movement still commits.
2. `confirmarVenta`'s per-item vs. whole-sale SAVEPOINT+evaluation granularity.
3. Exact `AlertasRepo` port+adapter shape and its placement in `plugins/repos.ts`.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/api/src/db/schema.ts` | New | `alertas` table + enum |
| `apps/api/src/alertas/` | New | service, repository (port+adapter), evaluator |
| `apps/api/src/movimientos/service.ts` | Modified | invoke evaluator at existing SEAM |
| `apps/api/src/productos/service.ts` | Modified | invoke evaluator on stock inicial |
| `apps/api/src/ventas/service.ts` | Modified | invoke evaluator in confirmarVenta/anularVenta |
| `apps/api/src/auditoria/fields.ts` | Modified | add `alertas` FIELD_CLASSIFICATION entry |
| `apps/api/src/plugins/repos.ts` | Modified | register `AlertasRepo` |
| `apps/api/src/routes/alertas.ts` | New | list/count + manual resolve endpoints |
| `apps/web/src/features/alertas/` | New | polling hook, count badge, list screen (shellLayout) |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| SAVEPOINT semantics under Drizzle/node-postgres don't swallow SQL errors as C1 requires | Med | Design resolves mechanism explicitly; mandatory injected-error test before merge |
| Under-scoping to one movimiento call site | Low | PD-2 makes all four explicit; tasks must enumerate each |
| Migration deploy gap on Render/Neon (new table, manual migration) | Med | Document manual `pnpm db:migrate` step per CLAUDE.md Deployment |

## Rollback Plan

Feature is additive (new table, new evaluator calls behind SAVEPOINT). Revert by reverting the
migration and the four call-site diffs; no existing data model changes. If deployed and broken,
disable evaluator invocation via a no-op guard while leaving the table in place, avoiding a second
migration.

## Dependencies

- Backlog #6/#7 (movimientos, existing SEAM comment) — already merged.
- Blocks backlog #11 (`sugerencia_reposicion`), which depends on this change.

## Success Criteria

- [ ] All four movimiento call sites trigger the evaluator; verified by one test per call site.
- [ ] Injected SQL-error-in-evaluator test proves the movement/sale still commits (C1).
- [ ] `stock_bajo`/`quiebre` created only on downward-crossing edge, auto-resolved on recovery.
- [ ] `discrepancia` created from `esDiscrepancia` ajustes, resolved only by encargado.
- [ ] De-duplication holds: no duplicate alert while one is `activa`/`vista` for the same producto+tipo.
- [ ] SPA polls alert count every 60s; both roles can view, only encargado resolves discrepancia.
