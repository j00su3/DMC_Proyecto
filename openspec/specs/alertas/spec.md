# alertas Specification

## Purpose

Backend alert engine: `alertas` table, `EvaluadorDeAlertas` invoked from all four
movimiento-creation call sites, threshold/discrepancy detection, de-duplication, auto/manual
resolution, and list/count + manual-resolve endpoints. New capability (greenfield).

**Capability-granularity decision**: split into `alertas` (backend, this file) and `alertas-ui`
(frontend), shipped in one change. This matches this project's consistent precedent —
`point-of-sale`+`pos-ui`, `product-management`+`productos-ui`, `inventory-movements`+
`movimientos-ui` — every prior change splits backend/frontend into separate capability files;
none bundles both into one.

## Non-Goals

- Schema change for `Movimiento.esDiscrepancia` — already exists (A9).
- SAVEPOINT mechanism and `AlertasRepo` shape — deferred to design.
- Suggested-quantity column for `sugerencia_reposicion` (backlog #11 scoping decision) — the alert
  signals a product needs attention; it carries no quantity field. Deferred to a future backlog item.
- Dedicated UI for `sugerencia_reposicion` (backlog #13) — it renders through the existing generic
  Alertas table like any other tipo.

| Failure | Status | Code |
|---|---|---|
| No session | 401 | `UNAUTHORIZED` |
| Non-encargado resolves `discrepancia` | 403 | `FORBIDDEN` |
| Alert id not found | 404 | `ALERT_NOT_FOUND` |
| Alert already `resuelta` | 409 | `ALERT_ALREADY_RESOLVED` |

## Requirements

### Requirement: Alertas Table Schema
The system MUST persist alerts with `tipo` (`stock_bajo`\|`quiebre`\|`discrepancia`), `estado`
(`activa`\|`vista`\|`resuelta`), `producto_id`, nullable `resuelta_por`, and timestamps.

#### Scenario: Alert row carries required fields
- GIVEN a `stock_bajo` alert is created
- WHEN the row is read back
- THEN it has `tipo`, `estado='activa'`, `producto_id`, `resuelta_por=null`, timestamps

### Requirement: Threshold-Crossing Creation On Downward Edge Only
Create `stock_bajo` only when `stock_previo > stock_minimo AND stock_resultante <=
stock_minimo`; create `quiebre` only on crossing to `0`. A product with `stock_minimo IS NULL`
MUST NOT ever fire `stock_bajo`.

#### Scenario: Movement crosses below minimum creates stock_bajo
- GIVEN a product with `stockMinimo=10`, `stockActual=12`
- WHEN a movement drops stock to `8`
- THEN a `stock_bajo` alert is created

#### Scenario: Null stock_minimo never fires stock_bajo
- GIVEN a product with `stockMinimo=null`
- WHEN any movement decreases its stock
- THEN no `stock_bajo` alert is created

### Requirement: De-Duplication Per Producto And Tipo
MUST NOT create a new alert for a `producto_id`+`tipo` while one exists `activa` or `vista`.
Only `resuelta` allows re-triggering.

#### Scenario: Resolved alert allows re-triggering
- GIVEN a `quiebre` alert for a product was resolved
- WHEN the product crosses to zero stock again
- THEN a new `quiebre` alert is created

#### Scenario: Repeat breach while active creates no duplicate
- GIVEN a `stock_bajo` alert is `activa` for a product
- WHEN a later movement decreases stock further
- THEN no second alert row is created

### Requirement: Auto-Resolution On Stock Recovery
MUST auto-resolve an `activa`/`vista` `stock_bajo`/`quiebre` when a later movement — including
an `anulacion` — restores stock above `stock_minimo` (or above `0`). `resuelta_por` MUST stay
null.

#### Scenario: Anulación restores stock and auto-resolves
- GIVEN a `quiebre` alert is `activa` after a sale depleted stock
- WHEN that sale is anulada, restoring stock above zero
- THEN the alert becomes `resuelta` with `resuelta_por=null`

### Requirement: Discrepancia Creation From Flagged Ajuste
Create a `discrepancia` alert when an `ajuste` movimiento has `esDiscrepancia=true`. An ajuste
without the flag MUST NOT create an alert.

#### Scenario: Flagged ajuste creates discrepancia alert
- GIVEN a user registers an `ajuste` with `esDiscrepancia=true`
- WHEN the movement commits
- THEN a `discrepancia` alert is created for that product

### Requirement: Manual Resolution Restricted To Encargado

Only `rol='encargado'` sessions MAY manually resolve a `discrepancia` or a
`sugerencia_reposicion` alert. Resolution MUST set `resuelta_por` to the resolving user's id.
(Previously: only `discrepancia` was manually resolvable.)

#### Scenario: Encargado resolves a discrepancia

- GIVEN an `activa` `discrepancia` alert
- WHEN an encargado session calls the resolve endpoint
- THEN the alert becomes `resuelta` with `resuelta_por` set to that user's id

#### Scenario: Deposito is refused (discrepancia)

- GIVEN an `activa` `discrepancia` alert
- WHEN a `deposito` session calls the resolve endpoint
- THEN the response is 403 `FORBIDDEN` and the alert stays `activa`

#### Scenario: Encargado resolves a sugerencia_reposicion

- GIVEN an `activa` `sugerencia_reposicion` alert
- WHEN an encargado session calls the resolve endpoint
- THEN the alert becomes `resuelta` with `resuelta_por` set to that user's id

#### Scenario: Deposito is refused (sugerencia_reposicion)

- GIVEN an `activa` `sugerencia_reposicion` alert
- WHEN a `deposito` session calls the resolve endpoint
- THEN the response is 403 `FORBIDDEN` and the alert stays `activa`

### Requirement: Evaluator Failure Never Rolls Back The Movement
An evaluator error (SQL or app-level) MUST NOT roll back the underlying movimiento/venta
transaction; it MUST still commit.

#### Scenario: Injected SQL error in evaluator still commits the sale
- GIVEN a sale crosses a stock threshold
- WHEN the evaluator's SQL fails during alert creation
- THEN the sale still confirms and its movimiento rows persist, with no alert row created

### Requirement: Evaluation Triggered At Every Movimiento-Creation Call Site
The evaluator MUST run for movimientos created via `movimientos/service.ts`,
`productos/service.ts::crearProducto`, `ventas/service.ts::confirmarVenta`, and
`ventas/service.ts::anularVenta`.

#### Scenario: Stock inicial on product creation can trigger an alert
- GIVEN a new product is created with `stockInicial` below its `stockMinimo`
- WHEN `crearProducto` commits
- THEN a `stock_bajo` alert is created for that product

### Requirement: Both Roles Can View Alerts
`rol='encargado'` or `rol='deposito'` sessions MAY list alerts and read the alert count.

#### Scenario: Deposito lists alerts
- GIVEN a `deposito` session
- WHEN it calls the alert list endpoint
- THEN the response returns 200 with the alert list

### Requirement: Alert Create And Resolve Are Audited
Creating an alert and manually resolving a `discrepancia` MUST call `recordAudit` inside the
same `UnitOfWork` as the triggering write.

#### Scenario: Manual resolution is audited
- GIVEN an encargado resolves a `discrepancia` alert
- WHEN the resolution commits
- THEN an audit row exists for that resolution in the same transaction

### Requirement: Sugerencia De Reposición Evaluation Rule (S7 Heuristic)

The system MUST evaluate `sugerencia_reposicion` per ADR-0008's S7 heuristic:
`promedio_diario` = (venta+salida units, last 30 days) ÷ 30; `cobertura_dias` = `stock_actual`
÷ `promedio_diario`. Create the alert only when `cobertura_dias < 14` (strict; 14 itself does
not qualify). Skip products with under 7 days of history. For 7–30 days, average over the
days available, not over a fixed 30. `promedio_diario = 0` MUST NOT trigger this alert.

#### Scenario: Below-threshold coverage triggers the alert

- GIVEN a product's `cobertura_dias` computes to 10
- WHEN the rule runs
- THEN a `sugerencia_reposicion` alert is created

#### Scenario: Exactly 14 days does not trigger

- GIVEN `cobertura_dias` computes to exactly 14
- WHEN the rule runs
- THEN no alert is created

#### Scenario: Fewer than 7 days of history is skipped

- GIVEN a product has 6 days of movimiento history and low stock
- WHEN the rule runs
- THEN no alert is created, regardless of stock level

#### Scenario: Partial history averages over available days

- GIVEN a product has exactly 10 days of history
- WHEN `promedio_diario` is computed
- THEN it divides the 10-day unit sum by 10, not by 30

#### Scenario: Zero average never suggests

- GIVEN `promedio_diario = 0` and `stock_actual = 1`
- WHEN the rule runs
- THEN no alert is created

### Requirement: Sugerencia De Reposición Evaluated Only At Specific Call Sites

The rule MUST run from `movimientos/service.ts::registrarMovimiento`,
`productos/service.ts::crearProducto` (when `stockInicial > 0`), and
`ventas/service.ts::confirmarVenta`. It MUST NOT run from `ventas/service.ts::anularVenta`,
since a reversal restores stock, not new outbound demand.

#### Scenario: A qualifying call site triggers evaluation

- GIVEN a sale via `confirmarVenta` drops a product into low coverage
- WHEN the sale commits
- THEN the rule is evaluated for that product

#### Scenario: anularVenta does not trigger the rule

- GIVEN a sale is anulada, restoring stock for a previously low-coverage product
- WHEN `anularVenta` commits
- THEN the rule is NOT evaluated for that product

### Requirement: Sugerencia De Reposición Reuses Existing De-Duplication

The existing producto+tipo open-alert dedup mechanism applies unchanged to
`sugerencia_reposicion`.

#### Scenario: No duplicate open alert for the same producto

- GIVEN a `sugerencia_reposicion` alert is `activa` for a product
- WHEN the rule re-evaluates that product while still under-threshold
- THEN no second alert row is created

### Requirement: Sugerencia De Reposición Carries No Suggested Quantity

A `sugerencia_reposicion` alert row MUST use the same shape as every other tipo (`tipo`,
`estado`, `producto_id`, `resuelta_por`, timestamps) with no quantity field. No new route is
introduced; it surfaces via the existing `GET /api/alertas` endpoints.

#### Scenario: Alert row has no quantity field

- GIVEN a `sugerencia_reposicion` alert is created
- WHEN the row is read back
- THEN it has no field beyond `tipo`, `estado`, `producto_id`, `resuelta_por`, timestamps
