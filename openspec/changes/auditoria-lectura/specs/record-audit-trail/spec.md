# Delta for record-audit-trail

## RENAMED Requirements

### Requirement: Write-Only Scope (No Read Path) → Audit Trail Read Access

(Reason: closes drift finding D-01 — `auditoria` was write-only by omission, not by design intent;
ADR-0012's own denylist rationale already assumes an encargado can read this table.)
(Migration: None — no other spec references the old requirement name.)

## MODIFIED Requirements

### Requirement: Write-Only Scope (No Read Path)

The system MUST expose exactly one endpoint, `GET /api/auditoria`, gated `roles: ['encargado']`,
returning audit rows in the standard `{ data, page, pageSize, total }` pagination envelope.
`deposito` MUST receive 403 with no `data`.
(Previously: MUST NOT expose any endpoint, route, or UI to read the `auditoria` trail in v1. This
requirement reverses that prohibition to close drift finding D-01.)

#### Scenario: Encargado retrieves paginated audit rows

- GIVEN `auditoria` rows exist
- WHEN `encargado` calls `GET /api/auditoria`
- THEN the response is 200 with `{ data, page, pageSize, total }`, `data` containing the matching rows

#### Scenario: Deposito is denied

- GIVEN a `deposito` user is authenticated
- WHEN they call `GET /api/auditoria`
- THEN the response is 403 and no `data` is returned

## ADDED Requirements

### Requirement: Composable Audit Filters

The system MUST support filtering audit rows by `usuarioId` and by `entidad`+`entidadId` in the
same request; when both are supplied, the query MUST AND them, not treat them as mutually
exclusive.

#### Scenario: Both filters supplied compose

- GIVEN one row matches only `usuarioId = U`, one matches only `entidad`+`entidadId = E`, and one matches both
- WHEN `encargado` requests with both `usuarioId = U` and `entidad`+`entidadId = E`
- THEN only the row matching both filters is returned

### Requirement: Row Enrichment With Human-Readable Labels

Each returned row MUST include, alongside the raw `usuarioId` and `entidadId`, a resolved
human-readable label for each. `usuarioId` resolves via `usuarios.nombre`. `entidadId` resolves
from whichever table `entidad` names: `usuarios.nombre`, `proveedores.nombre`, or `productos.nombre`
respectively. For `entidad = 'alertas'`, which has no single label column of its own, the label
MUST resolve via that alerta's `productoId` joined to `productos.nombre`. Enrichment is additive:
raw ids MUST remain present in the response alongside their labels, never replaced by them.

#### Scenario: Usuario actor enriched with name

- GIVEN an audit row recorded by usuario U with `nombre = "Ana"`
- WHEN the row is returned
- THEN it includes `usuarioId = U.id` and a resolved label `"Ana"`

#### Scenario: Entidad=alertas enriched via its linked producto

- GIVEN an audit row with `entidad = 'alertas'`, `entidadId = A.id`, and alerta A has `productoId = P.id` where `productos.nombre = "Harina"`
- WHEN the row is returned
- THEN its entidad label is `"Harina"`, resolved through the alerta's linked producto, not a column on `alertas` itself

#### Scenario: Referenced row no longer exists

- GIVEN an audit row's `entidadId` no longer matches any row in its `entidad` table
- WHEN the row is returned
- THEN `entidadId` is still present and its resolved label is `null`, with no error raised

### Requirement: Batched Enrichment Lookup

Enrichment MUST resolve in a bounded number of queries per page: at most one lookup query per
distinct table represented among that page's `usuarioId` and `entidad` values, never one lookup
query per row.

#### Scenario: A mixed page resolves without a per-row query

- GIVEN a single page of audit rows spanning `entidad = 'proveedores'`, `entidad = 'productos'`, and `entidad = 'alertas'` values
- WHEN the page is enriched
- THEN the number of enrichment lookup queries issued stays flat as page size grows, bounded by the distinct tables represented on that page, not by row count

### Requirement: Read Response Projects Stored Snapshot As-Is

The read path MUST NOT apply any new filtering to `datos_previos`/`datos_posteriores`; it projects
them exactly as already stored, since `FIELD_CLASSIFICATION` denylisting already happened at write
time and stays unchanged.

#### Scenario: Snapshot fields pass through unfiltered

- GIVEN an audit row was written with `FIELD_CLASSIFICATION` already applied at write time
- WHEN the row is read back via `GET /api/auditoria`
- THEN `datos_previos`/`datos_posteriores` are returned exactly as stored, with no additional field removed
