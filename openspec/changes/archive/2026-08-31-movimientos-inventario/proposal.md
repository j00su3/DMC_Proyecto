# Proposal: Movimientos de Inventario (Backlog #6)

## Intent

Registering a stock movement (entrada/salida/ajuste) has no service, route, or UI today —
only the underlying data model and the atomic `aplicarDelta` primitive exist (built in #5).
Without this slice, stock changes cannot be recorded through the application at all. This
change adds the write path (with its own RBAC and validation rules) and the read path
(movement history per product) that #12's reports will later depend on.

## Product Decisions (settled 2026-08-30, do not reopen)

| # | Decision | Reasoning |
|---|---|---|
| PD-1 | `ajuste` is `encargado`-only. `deposito`/`encargado` both do `entrada`/`salida`. | The person moving goods must not also be able to adjust the count — that removes the control an `ajuste` exists to provide. |
| PD-2 | `motivo` mandatory only on `ajuste` and merma salidas, not ordinary salidas. | Matches `docs/TECH-DESIGNv2.md:126` verbatim; an ordinary salida needs no explanation. |
| PD-3 | `motivo` is free text, min-length only — no closed reason list. | Accepted trade-off: backlog #12 cannot group discrepancies by cause. Inherited knowingly. |
| PD-4 | Zero-quantity `ajuste` is not representable; a matching count produces no row. | Resolves the `cantidad <> 0` question #5 punted here. Requires a CHECK constraint + migration. |
| PD-5 | A merma salida is **persisted** as such, via an `es_merma` column — not an ephemeral request-only flag. | PD-3 already costs #12 the ability to group discrepancies by cause. An ephemeral flag would additionally cost #12 the ability to *identify* a merma at all, leaving free text as the only trace. The column is nearly free: it rides the migration PD-4 already requires. |

## PD-5 in detail (resolves the former open assumption)

PD-2 + PD-3 created a circularity: `merma` is a motivo, not a `tipo`, so the system cannot
require the motivo without first knowing the salida is a merma.

Settled resolution, confirmed by the owner on 2026-08-30:

- The modal's four operator-facing choices (Entrada / Salida / **Salida por merma** / Ajuste)
  map to only three wire `tipo` values. "Salida por merma" sends `tipo: 'salida'` plus an
  explicit merma flag.
- That flag is **persisted** as a new `es_merma` boolean column on `movimientos`, guarded by
  a CHECK that permits `true` only when `tipo = 'salida'` — deliberately mirroring the
  existing `movimientos_discrepancia_solo_ajuste` constraint, which permits
  `es_discrepancia = true` only on `ajuste`.
- The service uses the flag both to decide whether `motivo` is required (PD-2) and to write
  the column.
- **No `merma` value is added to the `movimientoTipo` pgEnum** — that was already considered
  and rejected in #5 (`archive/2026-08-30-productos-ledger-base/design.md:168`, "Merma is a
  reason, not a `tipo`").
- The exact wire field name is a `sdd-spec` decision; the column name and its CHECK are a
  `sdd-design` decision.

## Scope

**In scope**: `movimientos` service + routes (`entrada`, `salida`, `ajuste`, paginated
history), RBAC per PD-1, motivo validation per PD-2/PD-3, zero-quantity CHECK per PD-4,
disambiguating `aplicarDelta`'s `undefined` (inactive vs. insufficient stock, "hay N"
message), the #10 SAVEPOINT seam, the 3-step movement modal and its trigger.

**Out of scope**: `venta`/`anulacion` (#7, #9), the alert evaluator itself (#10, only its
seam), reports (#12), any audit-system change.

## Capabilities

### New Capabilities
- `inventory-movements`: backend service/routes for entrada, salida, ajuste and history.
- `movimientos-ui`: the 3-step movement-registration modal and its trigger.

### Modified Capabilities
None — `product-management` already scoped entrada/salida/ajuste/UI out explicitly
(`openspec/specs/product-management/spec.md:9-11`).

## Approach

Mirror `crearProducto`'s transaction shape exactly: RBAC/shape guards before `uow.run`, one
`uow.run`, `aplicarDelta` → `stockResultante` taken verbatim, `movimientos.create` inside
the same transaction, **no `recordAudit`** (ADR-0012 rule 2 — the movement row is its own
audit trail), and a clean point after the insert for #10's future `SAVEPOINT alertas`.
Domain errors (motivo missing, insufficient stock, inactive product) are thrown before
`create`, never derived from a caught CHECK violation.

## Affected Areas

| Area | Impact |
|---|---|
| `apps/api/src/movimientos/service.ts` | New |
| `apps/api/src/movimientos/repository.ts` | Extended (history method) |
| `apps/api/src/routes/movimientos.ts` | New |
| `apps/api/src/lib/errors.ts` | New factories |
| `apps/api/drizzle/` | One new migration: the zero-quantity CHECK (PD-4) and the `es_merma` column with its salida-only CHECK (PD-5) |
| `apps/web/src/features/movimientos/` | New |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Exceeds 800-line budget (est. 1000-1500) | High | Slice backend/frontend PRs; confirmed at `sdd-tasks` review guard |
| #12 loses cause-grouping (PD-3) | Certain, accepted | Documented here for #12 to inherit. PD-5 preserves the ability to identify and total mermas, which is the part that would otherwise have compounded. |
| `aplicarDelta` undefined-cause ambiguity | Medium | High-level approach only; mechanism deferred to `sdd-design` |

## Rollback Plan

Revert the migration (drop the CHECK constraint) and the new files; no existing route or
table is modified, so rollback is additive-only and low-risk.

## Dependencies

- Backlog #5 (`productos-ledger-base`), archived — schema and `aplicarDelta` complete.

## Success Criteria

- [ ] `encargado` and `deposito` can register entrada/salida; only `encargado` can register `ajuste`.
- [ ] Zero-quantity `ajuste` is rejected at the database level, and the form refuses it before it is sent.
- [ ] A merma salida persists `es_merma = true`; the database refuses `es_merma = true` on any other `tipo`.
- [ ] The insufficient-stock error names the available quantity ("hay N") and is shown to both roles.
- [ ] No `recordAudit` call exists for movements.
- [ ] A movement history endpoint returns paginated results per product.
