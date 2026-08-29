# supplier-management Specification

## Purpose

Encargado read+write, `deposito` read-only, CRUD of `proveedores`: create, list, get, update
(`nombre`/`contacto`), logical deactivation/reactivation, case-insensitive name uniqueness, all
writes audited. Backend only — no UI of any kind in this change. Consumes `auth-sessions`' RBAC
hook and `record-audit-trail`'s audit contract without modifying either; reuses
`api-contract-pipeline`'s error and pagination envelopes verbatim. New capability (greenfield, no
prior spec).

Routes: `POST /api/proveedores`, `GET /api/proveedores`, `GET /api/proveedores/:id`,
`PATCH /api/proveedores/:id`, `POST /api/proveedores/:id/deactivate`,
`POST /api/proveedores/:id/reactivate`.

| Failure | Status | Code |
|---|---|---|
| No session | 401 | `UNAUTHORIZED` |
| Session `rol = deposito` calls a write route | 403 | `FORBIDDEN` |
| `:id` matches no supplier | 404 | `SUPPLIER_NOT_FOUND` |
| Name already used by another supplier (case-insensitive) | 409 | `SUPPLIER_NAME_IN_USE` |
| Paired audit write fails | 500 | `AUDIT_WRITE_FAILED` |

## Requirements

### Requirement: Role Gate — Read/Write Split on Every Supplier-Management Route
`GET /api/proveedores` and `GET /api/proveedores/:id` MUST declare
`config: { roles: ['encargado', 'deposito'] }`. `POST /api/proveedores`,
`PATCH /api/proveedores/:id`, `POST /api/proveedores/:id/deactivate`, and
`POST /api/proveedores/:id/reactivate` MUST declare `config: { roles: ['encargado'] }`. This is a
real server-side authorization boundary: the RBAC hook refuses a `deposito` write before any
handler runs, regardless of what any client does or does not offer to render.

#### Scenario: Unauthenticated request
- GIVEN no valid session cookie
- WHEN any supplier-management route is called
- THEN the response is `401 { error: { code: "UNAUTHORIZED" } }`

#### Scenario: Deposito can read suppliers
- GIVEN an authenticated session with `rol = deposito`
- WHEN `GET /api/proveedores` or `GET /api/proveedores/:id` is called
- THEN the response is `200` with the supplier data

#### Scenario: Deposito write is refused
- GIVEN an authenticated session with `rol = deposito`
- WHEN `POST /api/proveedores`, `PATCH /api/proveedores/:id`,
  `POST /api/proveedores/:id/deactivate`, or `POST /api/proveedores/:id/reactivate` is called
- THEN the response is `403 { error: { code: "FORBIDDEN" } }`, no row is created or changed, and
  no `auditoria` row is recorded

### Requirement: Supplier Creation
`POST /api/proveedores` MUST accept `{ nombre, contacto? }`, persist a new row with
`activo = true`, and record exactly one `auditoria` row (`crear`) atomically with the insert.

#### Scenario: Successful creation with contacto
- GIVEN an encargado submits valid `nombre` and `contacto`
- WHEN `POST /api/proveedores` completes
- THEN the response is `201` with the created supplier DTO, `activo = true`, and one `auditoria`
  row (`crear`) is recorded

#### Scenario: contacto is optional
- GIVEN an encargado submits only `nombre`, omitting `contacto`
- WHEN `POST /api/proveedores` completes
- THEN the response is `201` and the created supplier has no `contacto` value

### Requirement: Case-Insensitive Name Uniqueness With Original-Casing Storage
`nombre` MUST be normalized (trimmed, case-folded) for comparison only, on both create and
update, checked against every existing supplier regardless of `activo`. The stored `nombre` MUST
be exactly what was submitted — normalization governs the comparison, never the stored value. A
create or update that collides with another supplier's normalized name MUST be refused without
writing.

#### Scenario: Duplicate name on create is refused
- GIVEN an existing supplier is named "Distribuidora Norte"
- WHEN `POST /api/proveedores` is called with `nombre: "distribuidora norte"` (different
  case/whitespace)
- THEN the response is `409 { error: { code: "SUPPLIER_NAME_IN_USE" } }` and no row is created

#### Scenario: Duplicate name on update is refused
- GIVEN two distinct suppliers exist
- WHEN `PATCH /api/proveedores/:id` sets one supplier's `nombre` to the other's normalized name
- THEN the response is `409 { error: { code: "SUPPLIER_NAME_IN_USE" } }` and no field is
  changed

#### Scenario: Stored casing survives exactly as submitted
- GIVEN a supplier is created with `nombre: "Distribuidora Norte"`
- WHEN that supplier is later fetched via `GET /api/proveedores/:id` or listed
- THEN `nombre` reads back as exactly "Distribuidora Norte" — never lowercased or otherwise
  altered

#### Scenario: An inactive supplier's name still blocks the duplicate
- GIVEN a supplier named "Distribuidora Norte" exists with `activo = false`
- WHEN `POST /api/proveedores` is called with `nombre: "DISTRIBUIDORA NORTE"`
- THEN the response is `409 { error: { code: "SUPPLIER_NAME_IN_USE" } }` and no row is created

### Requirement: List Suppliers (Paginated)
`GET /api/proveedores` MUST accept `?page&pageSize` per `lib/pagination.ts` and respond with
`{ data, page, pageSize, total }`. Filtering or search by name or active status is out of scope
for this endpoint.

#### Scenario: Default pagination
- GIVEN more than 20 suppliers exist
- WHEN `GET /api/proveedores` is called with no query params
- THEN `data` has at most the default `pageSize` items, `page = 1`, and `total` reflects the full
  count

#### Scenario: Explicit pagination
- GIVEN `?page=2&pageSize=5`
- WHEN the endpoint responds
- THEN `data` has at most 5 items and `page`/`pageSize` echo the request

### Requirement: Get Supplier by Id
`GET /api/proveedores/:id` MUST return `200` with the supplier DTO or `404`.

#### Scenario: Existing supplier
- GIVEN `:id` matches an existing supplier
- WHEN `GET /api/proveedores/:id` is called
- THEN the response is `200` with the supplier DTO

#### Scenario: Unknown id
- GIVEN `:id` matches no supplier
- WHEN `GET /api/proveedores/:id` is called
- THEN the response is `404 { error: { code: "SUPPLIER_NOT_FOUND" } }`

### Requirement: Update Supplier Profile
`PATCH /api/proveedores/:id` MUST accept a partial `{ nombre, contacto }`, require at least one
of the two fields, persist only the supplied fields, and reject a body containing an `activo` key
at the schema layer before any handler runs. `activo` is exclusively managed by the
deactivate/reactivate endpoints, not this route.

#### Scenario: Successful update
- GIVEN an encargado submits a valid partial update for an existing supplier
- WHEN `PATCH /api/proveedores/:id` completes
- THEN the response is `200` with the updated fields persisted and one `auditoria` row
  (`actualizar`) recorded

#### Scenario: Target not found
- GIVEN `:id` matches no supplier
- WHEN `PATCH /api/proveedores/:id` is called
- THEN the response is `404 { error: { code: "SUPPLIER_NOT_FOUND" } }` and no audit row is
  recorded

#### Scenario: activo in a PATCH body is refused
- GIVEN a `PATCH /api/proveedores/:id` body containing an `activo` key
- WHEN the request is validated
- THEN it is refused with a validation error before any handler runs, and no row is written

### Requirement: Logical Deactivation Preserves References and History
`POST /api/proveedores/:id/deactivate` MUST set `activo = false` without physically deleting the
row, so any existing or future reference to the supplier's `id` (including a
`productos.proveedor_id` foreign key) and the supplier's audit history both remain intact.

#### Scenario: Successful deactivation
- GIVEN the target supplier is active
- WHEN `POST /api/proveedores/:id/deactivate` completes
- THEN the response is `200`, `activo = false`, and one `auditoria` row (`baja_logica`) is
  recorded

#### Scenario: A deactivated supplier remains readable by id
- GIVEN a supplier has been deactivated
- WHEN `GET /api/proveedores/:id` is called with the same id
- THEN the response is `200` with `activo = false`, not `404`

### Requirement: Reactivation
`POST /api/proveedores/:id/reactivate` MUST set `activo = true` for an existing supplier.

#### Scenario: Successful reactivation
- GIVEN the target has `activo = false`
- WHEN `POST /api/proveedores/:id/reactivate` completes
- THEN the response is `200`, `activo = true`, and one `auditoria` row (`reactivar`) is recorded

### Requirement: Audit Obligation Per Mutation
Every create, update, deactivate, and reactivate MUST produce exactly one `auditoria` row,
written atomically with the row write per `record-audit-trail`'s transaction contract, with
`entidad = 'proveedores'` and the action-appropriate verb (`crear`, `actualizar`, `baja_logica`,
`reactivar`).

#### Scenario: One audit row per mutation
- GIVEN any create/update/deactivate/reactivate call succeeds
- WHEN the resulting `auditoria` row is inspected
- THEN exactly one row exists for that action, with `entidad = 'proveedores'` and the matching
  verb

### Requirement: Atomic Rollback on Audit Failure
If the paired `auditoria` write fails, the entire transaction MUST roll back: the target row MUST
be left exactly as it was before the request, and no `auditoria` row MUST exist for that attempt.

#### Scenario: Failed audit write rolls back the mutation
- GIVEN a create/update/deactivate/reactivate write is in progress
- WHEN the paired audit write fails
- THEN the entire transaction rolls back, the target row is unchanged, and the response is
  `500 { error: { code: "AUDIT_WRITE_FAILED" } }`
