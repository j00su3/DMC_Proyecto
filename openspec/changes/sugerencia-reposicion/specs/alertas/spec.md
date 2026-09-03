# Delta for alertas

## ADDED Requirements

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

## MODIFIED Requirements

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
