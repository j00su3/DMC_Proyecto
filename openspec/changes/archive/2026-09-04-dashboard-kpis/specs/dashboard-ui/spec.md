# dashboard-ui Specification

## Purpose

Home/dashboard screen (backlog #13): 4 KPI cards (Quiebres, Stock bajo, Actividad reciente,
Alertas activas) reachable via the `Panel general` sidebar entry, identical for both roles.
New capability (greenfield, no prior spec). Reads only — no writes, no new alert/movement
lifecycle behavior.

## Non-Goals

- Charts/graphs or any visualization beyond counts + status indicators.
- CSV/export from this screen.
- Any change to how alertas are created, resolved, or evaluated.
- The Producto-column KPI route (`stock_actual`/`stock_minimo`-derived counts).
- A separate in-page "quick links" component distinct from the sidebar nav entry.

## Requirements

### Requirement: Dashboard Reachable By Both Roles With No Restriction
The dashboard route MUST be reachable by sessions with `rol='encargado'` or `rol='deposito'`
(a shared `shellLayout` subtree), returning identical content for both — no role-based
filtering or refusal at this screen.

#### Scenario: Deposito reaches the dashboard
- GIVEN a session with `rol='deposito'`
- WHEN the dashboard route is navigated to
- THEN the screen renders the 4 KPI cards, not a permission refusal

### Requirement: Four KPI Cards Render In Fixed Left-To-Right Order
The dashboard MUST render exactly 4 KPI cards, left-to-right: "Quiebres", "Stock bajo",
"Actividad reciente", "Alertas activas".

#### Scenario: Cards render in the specified order
- GIVEN the dashboard renders
- WHEN the 4 cards are inspected left-to-right
- THEN they read "Quiebres", "Stock bajo", "Actividad reciente", "Alertas activas" in that order

### Requirement: Quiebres And Stock-Bajo Counts Are Tipo-Specific, Not Role-Filtered
The "Quiebres" card MUST show the count of open alerts (`estado <> 'resuelta'`) with
`tipo='quiebre'` only. The "Stock bajo" card MUST show the count of open alerts with
`tipo='stock_bajo'` only. Neither count MUST include `discrepancia` or
`sugerencia_reposicion` alerts, nor be derived from Producto stock columns. Both counts MUST
be identical for `encargado` and `deposito` sessions.

#### Scenario: Quiebres counts only quiebre-tipo open alerts
- GIVEN 2 open `quiebre` alerts, 3 open `stock_bajo` alerts, and 1 open `discrepancia` alert
- WHEN the dashboard renders
- THEN the "Quiebres" card shows `2`

#### Scenario: Stock bajo counts only stock_bajo-tipo open alerts
- GIVEN the same alert mix as above
- WHEN the dashboard renders
- THEN the "Stock bajo" card shows `3`

#### Scenario: Zero open alerts of a tipo shows zero, not an error
- GIVEN no open `quiebre` alerts exist
- WHEN the dashboard renders
- THEN the "Quiebres" card shows `0`

#### Scenario: Deposito and encargado see identical counts
- GIVEN a fixed set of open alerts
- WHEN both an `encargado` and a `deposito` session load the dashboard
- THEN their "Quiebres" and "Stock bajo" counts are identical

### Requirement: Alertas Activas Counts All Open Alerts Regardless Of Tipo
The "Alertas activas" card MUST show the count of alerts where `estado <> 'resuelta'`
(`activa` and `vista` combined), across every `tipo`, matching the existing alert-count-badge
semantics.

#### Scenario: A vista alert still counts as active
- GIVEN one alert with `estado='vista'` and one with `estado='activa'`, none `resuelta`
- WHEN the dashboard renders
- THEN the "Alertas activas" card shows `2`

#### Scenario: Alertas activas spans every tipo
- GIVEN one open alert of each tipo (`quiebre`, `stock_bajo`, `discrepancia`,
  `sugerencia_reposicion`)
- WHEN the dashboard renders
- THEN the "Alertas activas" card shows `4`

#### Scenario: Zero open alerts shows zero
- GIVEN no alert rows are open
- WHEN the dashboard renders
- THEN the "Alertas activas" card shows `0`

### Requirement: Actividad Reciente Shows Exactly The 10 Most Recent Movimientos, Unfiltered
The "Actividad reciente" card MUST list the 10 most recently recorded movimientos across ALL
productos and ALL actors (not scoped to any role or usuario), ordered most-recent-first by
`fecha`. Each row MUST show: producto nombre, tipo, fecha, usuario. This list MUST be
identical for `encargado` and `deposito` sessions.

#### Scenario: More than 10 movimientos exist
- GIVEN 15 movimientos recorded across several productos and actors
- WHEN the dashboard renders
- THEN "Actividad reciente" shows exactly 10 rows, the 10 most recent by `fecha`, most-recent-first

#### Scenario: Fewer than 10 movimientos exist
- GIVEN 4 movimientos have ever been recorded
- WHEN the dashboard renders
- THEN "Actividad reciente" shows exactly those 4 rows, most-recent-first

#### Scenario: No movimientos have ever been recorded
- GIVEN zero movimientos exist in the system
- WHEN the dashboard renders
- THEN "Actividad reciente" renders an empty-state, not an error

#### Scenario: Not scoped to a single actor
- GIVEN movimientos recorded by two different usuarios, both within the most recent 10
- WHEN the dashboard renders
- THEN both usuarios' movimientos appear in the same list

#### Scenario: Each row shows the required fields
- GIVEN at least one recorded movimiento
- WHEN "Actividad reciente" renders that row
- THEN it shows the producto's nombre, the movimiento's tipo, its fecha, and its usuario

### Requirement: Panel General Nav Item Navigates To This Dashboard For Both Roles
The `Panel general` sidebar entry MUST navigate to this dashboard for both `encargado` and
`deposito` sessions, with no lock indicator on this item (unlike role-restricted items such
as Usuarios or Discrepancias for `deposito`).

#### Scenario: Panel general navigates for both roles without a lock icon
- GIVEN a session with `rol='encargado'` or `rol='deposito'`
- WHEN the "Panel general" nav item is activated
- THEN the router navigates to the dashboard route and no lock icon was shown on that item
