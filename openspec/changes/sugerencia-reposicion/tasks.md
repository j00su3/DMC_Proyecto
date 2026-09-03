# Tasks: Sugerencia de Reposición (backlog #11)

**Change**: `sugerencia-reposicion` · **Artifact store**: hybrid (this file + Engram
`sdd/sugerencia-reposicion/tasks`)
**Inputs**: `proposal.md` (scoping decisions ratified 2026-09-03), `design.md` (D1-D7, Evaluator
Logic, Interfaces, Testing Strategy), `specs/alertas/spec.md` (4 ADDED + 1 MODIFIED requirement, 13
scenarios).

Strict TDD: every behavior task is RED (failing test) → GREEN (implementation). Design.md fully
specifies all decisions below (D1-D7) — no open questions remain.

**Files affected** (per design.md, 4 modified, 0 new): `apps/api/src/movimientos/repository.ts`,
`apps/api/src/alertas/evaluador.ts`, `apps/api/src/alertas/repository.ts`,
`apps/api/src/alertas/service.ts`. Per D3/D7, `movimientos/service.ts`, `productos/service.ts`, and
`ventas/service.ts` need **zero production-code changes** — structural typing already routes the
full `Movimiento`/`Repos` shape into the widened interfaces; they only gain new integration test
coverage.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~380-480 (4 files, ~55 production lines total; remainder is RED tests: evaluator unit tests, `resumenRotacion` integration tests, 3 call-site integration tests, 1 route test) |
| 400-line budget risk | Medium |
| Chained PRs recommended | No |
| Suggested split | Single PR, 2 logical phases |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending (not needed at Medium risk) |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Medium

Rationale: unlike #10 (new table, new `TxControl`, 4-route surface, full frontend), #11 adds one
repo method, one evaluator branch, and two one-line compile-gate widenings — no schema, no new
call-site wiring. Two phases below are a dependency ordering (query before consumer), not a size
split; both fit in one PR under the 400-line guard with room to spare. If the actual diff runs
higher once tests are written, split at the phase boundary below rather than mid-phase.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | `resumenRotacion` (D5) on `MovimientosRepo` + its integration tests | PR 1 (or Phase 1 of single PR) | `pnpm --filter api exec vitest run src/movimientos/repository.integration.test.ts` | `pnpm test:integration` (real Postgres, Docker) — 30-day boundary, tipo filter | Revert `movimientos/repository.ts`'s new method/interface; nothing else depends on it yet |
| 2 | Evaluator branch (D1-D4, D6, D7) + compile-gate widenings + call-site integration proof | PR 2 (or Phase 2 of single PR) | `pnpm --filter api exec vitest run src/alertas/evaluador.test.ts src/alertas/service.test.ts` | `pnpm test:integration` (real Postgres) — per-call-site proof, `anularVenta` exclusion | Revert `evaluador.ts`, `alertas/repository.ts`'s type alias, `alertas/service.ts`'s tuple; Unit 1 stays valid unconsumed |

---

## Phase 1 — `MovimientosRepo.resumenRotacion` (D5)

Sequential; Phase 2's evaluator branch depends on this method existing.

- [x] 1.1 RED: `apps/api/src/movimientos/repository.integration.test.ts` — real Postgres:
  `unidadesSalida30d` sums only `venta`/`salida` `cantidad` (negated) within the last 30 days,
  excluding `entrada`/`ajuste`/`anulacion`; a movimiento at day 29 counts, one older than 30 days
  does not (boundary); `diasHistoria` is `floor((now - MIN(fecha)) / 1 day)` across ALL movimientos
  for the producto, unbounded by the 30-day window; a producto with exactly one movimiento (just
  inserted) returns `diasHistoria = 0`, never `NULL`/`NaN`.
- [x] 1.2 GREEN: `apps/api/src/movimientos/repository.ts` — add `ResumenRotacion` interface and
  `resumenRotacion(productoId): Promise<ResumenRotacion>` to `MovimientosRepo`, using the exact SQL
  in design.md D5 (conditional `SUM`/`CASE`, `COALESCE`, existing
  `movimientos_producto_id_fecha_idx` index, no new index/migration).
- [x] 1.3 **Mutation-probe** the 30-day boundary test (1.1) — flip the interval comparison
  (`>=` ↔ `>`), widen/narrow the `tipo IN (...)` list, and invert the `-cantidad` sign; confirm each
  mutant is caught before trusting the test (CLAUDE.md mutation discipline; this is one of the two
  named load-bearing tests for #11).

**Satisfies**: design.md D5. Feeds spec "Sugerencia De Reposición Evaluation Rule" (Phase 2 consumes
this data).

## Phase 2 — Evaluator branch, compile gates, wiring (D1-D4, D6, D7)

Depends on: Phase 1.

- [ ] 2.1 RED: `apps/api/src/alertas/evaluador.test.ts` — pure `evaluar()` over fake
  `EvaluadorRepos`: `diasHistoria` 6 (skip), 7 (evaluate, divisor 7), 29, 30 (divisor 30), 31
  (divisor still 30 — spec "Fewer than 7 days of history is skipped", "Partial history averages
  over available days"); `promedioDiario = 0` never suggests (spec "Zero average never suggests");
  `coberturaDias` exactly 14 does not trigger, 13.99 does (spec "Exactly 14 days does not trigger",
  "Below-threshold coverage triggers the alert"); a movimiento with `tipo === 'anulacion'` never
  calls `resumenRotacion` at all (D3, spec "anularVenta does not trigger the rule").
- [ ] 2.2 GREEN: `apps/api/src/alertas/evaluador.ts` — add `tipo: Movimiento['tipo']` to
  `EvaluadorMovimiento` (D3); widen `EvaluadorRepos.movimientos` to
  `Pick<MovimientosRepo, 'resumenRotacion'>` (D7); append the new branch per design.md's exact
  pseudocode, reading `movimiento.stockResultante` (never a fresh `producto.stockActual`, D6) as the
  `coberturaDias` numerator.
- [ ] 2.3 GREEN: `apps/api/src/alertas/repository.ts` — D1: `TipoAlertaEvaluada = TipoAlerta`
  (remove the `Exclude<...>` alias), keeping the type name.
- [ ] 2.4 RED+GREEN: `apps/api/src/alertas/service.ts` — D2: add `'sugerencia_reposicion'` to
  `TIPOS_MANUALMENTE_RESOLVIBLES`; unit test asserts `resolver()` no longer 409s for
  `sugerencia_reposicion` and still refuses `quiebre`/`stock_bajo` (spec "Manual Resolution
  Restricted To Encargado" — both new scenarios: encargado resolves, deposito refused with 403 and
  DB-state-unchanged assertion per CLAUDE.md).
- [ ] 2.5 **Mutation-probe** the `anularVenta` exclusion test (2.1's `tipo === 'anulacion'` case) —
  remove the guard, invert it, and compare against `'venta'` instead of `'anulacion'`; confirm each
  mutant is caught (this is the second named load-bearing test for #11, D3).
- [ ] 2.6 Integration (real Postgres): `apps/api/src/alertas/service.integration.test.ts` (or
  per-domain integration files) — `movimientos/service.ts::registrarMovimiento`,
  `productos/service.ts::crearProducto` (`stockInicial > 0`), and
  `ventas/service.ts::confirmarVenta` each produce exactly one open `sugerencia_reposicion` alert
  when the rule's threshold is crossed, with **zero production-code changes** to those three files
  (spec "A qualifying call site triggers evaluation"); `ventas/service.ts::anularVenta` produces
  none under the same conditions (spec "anularVenta does not trigger the rule").
- [ ] 2.7 Integration: re-evaluating an already-`activa` `sugerencia_reposicion` alert while still
  under-threshold creates no second row (spec "No duplicate open alert for the same producto" —
  existing dedup index, unchanged).
- [ ] 2.8 RED+GREEN: `apps/api/src/routes/alertas.test.ts` — `POST /api/alertas/:id/resolver`
  succeeds (200) for a `sugerencia_reposicion` alert as `encargado`, without a 409 (spec "Encargado
  resolves a sugerencia_reposicion"); `deposito` still gets 403 with the alert unchanged (spec
  "Deposito is refused (sugerencia_reposicion)").

**Satisfies**: design.md D1-D4, D6, D7. Spec requirements "Sugerencia De Reposición Evaluation Rule
(S7 Heuristic)", "Sugerencia De Reposición Evaluated Only At Specific Call Sites", "Sugerencia De
Reposición Reuses Existing De-Duplication", "Sugerencia De Reposición Carries No Suggested
Quantity" (no route/shape change — proven by 2.6/2.8 reusing the existing envelope), "Manual
Resolution Restricted To Encargado" (MODIFIED).

**Exit criteria**: `pnpm typecheck` and `pnpm -r test` green (proposal Success Criteria); `pnpm
test:integration` green against Docker Postgres.

---

## Dependency Graph

```
Phase 1 (resumenRotacion, D5)
   │
   ▼
Phase 2 (evaluator branch D1-D4/D6/D7, compile gates, call-site + route integration proof)
```

## Open Questions Carried Forward

None — proposal's two open scoping decisions (call-site set, suggested-quantity column) were
ratified by the owner 2026-09-03 and are already binding in proposal.md/design.md. No task above
reopens them.
