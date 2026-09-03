# Proposal: Sugerencia de reposición (backlog #11)

## Intent

#10 (motor de alertas) shipped `stock_bajo`, `quiebre`, and `discrepancia`, and deliberately left
`sugerencia_reposicion` unimplemented — its archive report names #11 as the direct successor. Without
this rule, the `encargado` has no proactive signal that a product with real sales velocity is about
to run out; they only find out via `stock_bajo`/`quiebre` after the threshold is already crossed, or
by noticing it manually. #11 closes that gap with the S7 heuristic already ratified in ADR-0008:
suggest reposición when a product's 30-day sales-velocity-implied coverage drops below 14 days.

## Scope

### In Scope
- New evaluator rule producing `sugerencia_reposicion` alerts, using the exact S7 definition:
  `promedio_diario` = (venta+salida units, last 30 days) ÷ 30; `cobertura_dias` = stock_actual ÷
  promedio_diario; suggest when `cobertura_dias < 14`; skip products with <7 days of history;
  average over available days for 7–30 days of history; never suggest when `promedio_diario = 0`.
- Widen the two `TipoAlertaEvaluada` compile gates so this tipo can be created and manually
  resolved: `apps/api/src/alertas/repository.ts` (`AlertasRepo.create()` typing) and
  `apps/api/src/alertas/service.ts` (`TIPOS_MANUALMENTE_RESOLVIBLES`).
- New aggregate method on `MovimientosRepo` (or equivalent evaluator-owned port): sum of
  `venta`+`salida` units over the last 30 days, plus first-movimiento date, per producto.
- Wiring the new rule into `registrarSiCorresponde()`, reusing #10's SAVEPOINT-wrapped,
  synchronous, in-transaction trigger mechanism — this is inherited from ADR-0008, not a fresh
  decision (see "Trigger mechanism" below).
- Resolution stays manual-only (encargado), consistent with A10 and the other alert types.

### Out of Scope
- **Suggested-quantity column/migration.** S7's ratified definition is a coverage-day threshold,
  not a quantity; no schema currently has a slot for it, and adding one is a Neon migration that
  must be run manually before deploy per `CLAUDE.md`. Deferred to a future backlog item unless the
  owner says otherwise below.
- **Dedicated UI for this alert type.** #10 already ships a generic Alertas table that will render
  `sugerencia_reposicion` rows like any other tipo. Alert-type-specific UI polish is backlog #13,
  still pending.
- Any change to `stock_bajo`, `quiebre`, or `discrepancia` behavior.

## Capabilities

### New Capabilities
- None (no new top-level capability folder; this extends the existing `alertas` capability from
  #10 with one more evaluated tipo).

### Modified Capabilities
- `alertas`: adds the `sugerencia_reposicion` evaluation rule, widens the manually-resolvable and
  creatable tipo sets, and adds a movimientos aggregate read inside the alert-evaluation
  transaction.

## Approach

Reuse #10's infrastructure end to end: same `EvaluadorDeAlertas` rule-registration shape, same
`AlertasRepo` create/dedup/audit path, same SAVEPOINT isolation around `registrarSiCorresponde()`.
The only new pieces are (1) the S7 rule itself, (2) a movimientos aggregate query it depends on,
and (3) widening the two compile-time gates that currently exclude this tipo by design (`D5` in
#10). No new table, no new transaction mechanism, no new scheduler.

### Trigger mechanism (inherited, not open)
ADR-0008 already fixed this as synchronous, in-transaction, evaluated on every relevant
movimiento, explicitly trading a per-movimiento historical query for reusing the existing
SAVEPOINT error-isolation path (`TECH-DESIGNv2.md:181-183` names this query as the reason the
SAVEPOINT covers "error en la consulta del promedio de 30 días"). Compute-on-read and a scheduled
job were both considered in exploration and rejected — compute-on-read breaks the pre-materialized
`AlertasRepo.list()`/`countAbiertas()` contract, and no scheduler infra exists anywhere in this
project (free-tier Render has none).

## Affected Areas

| Area | Impact | Description |
|------|--------|--------------|
| `apps/api/src/alertas/repository.ts` | Modified | Widen `TipoAlertaEvaluada` to include `sugerencia_reposicion` |
| `apps/api/src/alertas/service.ts` | Modified | Add `sugerencia_reposicion` to `TIPOS_MANUALMENTE_RESOLVIBLES`; wire rule into `registrarSiCorresponde()` call sites |
| `apps/api/src/alertas/evaluador.ts` | Modified | New rule reading the 30-day movimientos aggregate via a new `EvaluadorRepos` dependency |
| `apps/api/src/movimientos/repository.ts` | Modified | New aggregate method: 30-day venta+salida sum and first-movimiento date, per producto |
| `apps/api/src/movimientos/service.ts`, `apps/api/src/productos/service.ts` (`crearProducto`), `apps/api/src/ventas/service.ts` (`confirmarVenta`) | Modified | Call sites where the rule gets evaluated — see open question on `anularVenta` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `TIPOS_MANUALMENTE_RESOLVIBLES` gate compiles fine unfixed but silently 409s a real alert at runtime | Medium | Track as an explicit task alongside the repository-layer gate, not assumed to be "the same fix" |
| First alert rule reading a table other than its triggering row inside the transaction — untested at scale for index usage | Low | Add a dedicated acceptance criterion for the 30-day aggregate query using existing date index, not just "shouldn't matter at this scale" |
| Wiring into the wrong subset of call sites over- or under-triggers evaluation | Medium | Owner ratifies call-site scope explicitly (see open questions) before design/tasks |

## Rollback Plan

Revert the widened `TipoAlertaEvaluada`/`TIPOS_MANUALMENTE_RESOLVIBLES` gates, remove the new rule
registration and its call-site wiring, and drop the new movimientos aggregate method. No schema or
migration changes are introduced, so rollback is a pure code revert with no data cleanup — any
already-created `sugerencia_reposicion` alert rows remain valid rows of an existing enum value and
can be left in place or deleted at the owner's discretion.

## Dependencies

- #10 (motor de alertas) — satisfied, archived 2026-09-02, live on `main`.

## Success Criteria

- [ ] A product with <14 days of implied coverage (per the S7 formula) triggers exactly one open
      `sugerencia_reposicion` alert per dedup window, through the agreed call sites.
- [ ] Products with <7 days of history, or `promedio_diario = 0`, never trigger this alert.
- [ ] `resolver()` succeeds for a `sugerencia_reposicion` alert (manual-only, encargado) without a
      409.
- [ ] `pnpm typecheck` and `pnpm -r test` pass with the widened gates in place.

## Scoping decisions (ratified by the owner, 2026-09-03)

1. **Which movimiento tipos re-trigger evaluation of this rule:** confirmed as proposed — wire into
   `movimientos/service.ts` (entrada/salida/ajuste), `productos/service.ts::crearProducto`, and
   `ventas/service.ts::confirmarVenta`. **`ventas/service.ts::anularVenta` is excluded**, because
   reversing a sale restores stock and does not represent new outbound demand.
2. **Suggested-quantity column: confirmed out of scope for #11**, deferred to a future backlog
   item. #11 only produces the alert (product needs attention); the encargado decides how much and
   when to order by reading the product's existing stock, same as today. No new schema/migration.
