# Reportes Specification

## Purpose

Read-only reporting over productos/movimientos/alertas: stock actual, bajo mínimo, movimientos
por período, discrepancias globales. Reportes owns no table and performs no writes; it exposes
four paginated views gated per role per `docs/PRD.md:62-64` and `docs/TECH-DESIGNv2.md:341-348`.

## Requirements

### Requirement: Stock Actual Report

The system MUST expose a stock actual report to both `encargado` and `deposito`, unfiltered and
identical for both, via the `{data, page, pageSize, total}` envelope.

#### Scenario: Both roles get identical results

- GIVEN productos with varying `stockActual`
- WHEN both roles request the report with the same paging
- THEN both responses contain the identical set and totals

### Requirement: Bajo Mínimo Report

The system MUST return only productos where `stockActual <= stockMinimo`, excluding null
`stockMinimo` rows, applying this predicate to BOTH the page and the count query. Both roles
receive the identical, unfiltered-by-role result.

#### Scenario: Product exactly at threshold is included

- GIVEN a producto's `stockActual` equals its non-null `stockMinimo`
- WHEN either role requests bajo mínimo
- THEN that producto is included in `data`

#### Scenario: Null stock mínimo is excluded

- GIVEN a producto has `stockMinimo = null`
- WHEN either role requests bajo mínimo
- THEN that producto is absent from `data` regardless of `stockActual`

### Requirement: Movimientos — Encargado Scope

`encargado` MUST be able to request movimientos filtered by date range, returning movimientos
from all actors within that range, paginated.

#### Scenario: Encargado sees all actors

- GIVEN movimientos recorded by more than one usuario in a date range
- WHEN `encargado` requests movimientos for that range
- THEN `data` includes movimientos from every actor in range

### Requirement: Movimientos — Deposito Row-Level Scope

A `deposito` user's movimientos report MUST be scoped to that user's own movimientos, with the
same date-range filter as encargado's. The actor MUST derive from the session; the system MUST
NOT honor any client-supplied actor identifier.

#### Scenario: Deposito sees only their own movimientos

- GIVEN deposito users A and B both have movimientos in range
- WHEN A requests the report for that range
- THEN `data` contains only A's movimientos, none from B

#### Scenario: Query parameters cannot override the scope

- GIVEN user B has movimientos in range
- WHEN A requests the report supplying B's id as an actor parameter
- THEN `data` still contains only A's movimientos

### Requirement: Discrepancias Globales Report

The system MUST expose discrepancias globales to `encargado` only; `deposito` MUST receive 403.
The report MUST read `alertas` where `tipo = 'discrepancia'`, including each row's `estado`,
`resueltaEn`, `resueltaPor`.

#### Scenario: Encargado sees resolution state

- GIVEN an alerta with `tipo = 'discrepancia'` and `estado = 'resuelta'`
- WHEN `encargado` requests discrepancias globales
- THEN that row appears with `estado`, `resueltaEn`, `resueltaPor`

#### Scenario: Deposito is denied

- GIVEN a `deposito` user is authenticated
- WHEN they request discrepancias globales
- THEN the response is 403 and no `data` is returned

### Requirement: Report Empty State

Each report MUST return `{data: [], total: 0}` — not an error envelope — when no rows match the
filter or period.

#### Scenario: Empty period is not an error

- GIVEN no movimientos exist in a date range
- WHEN a valid role requests movimientos for that range
- THEN the response is `{data: [], total: 0}` with a 2xx status

### Requirement: Pagination Correctness Under Filtering

For any filtered report (bajo mínimo; movimientos' actor scope), `total` MUST equal the count of
rows matching the predicate, not the unfiltered total, and stay consistent across pages.

#### Scenario: Bajo mínimo total matches the filtered count

- GIVEN 10 productos, only 3 satisfy `stockActual <= stockMinimo` (non-null)
- WHEN either role requests bajo mínimo
- THEN `total = 3`, and paging through all pages yields exactly those 3

## Non-Goals

- CSV/PDF export or any download capability.
- Dashboard/KPI visualization or aggregated summaries (backlog #13).
- Any change to how alertas or discrepancy movimientos are created, resolved, or classified.
- Any change to existing `ProductosRepo`/`MovimientosRepo` list methods or RBAC middleware.
