# product-management Specification

## Purpose

Backend CRUD for `productos` plus the stock ledger (`movimientos`) invariant from ADR-0003:
every stock change writes `stock_actual` and a `movimientos` row in the same transaction,
never one without the other. `deposito` reads and may create/update products except the
`stock_minimo` field (A7, field-level RBAC); `encargado` does everything, including
deactivate/reactivate. The only movement write path in this change is the create-time
initial-stock `ajuste`; entrada/salida/venta/anulacion and the movement-registration UI are
backlog #6, out of scope here. New capability (greenfield, no prior spec).

Routes: `POST /api/productos`, `GET /api/productos`, `GET /api/productos/:id`,
`PATCH /api/productos/:id`, `POST /api/productos/:id/deactivate`,
`POST /api/productos/:id/reactivate`.

| Failure | Status | Code |
|---|---|---|
| No session | 401 | `UNAUTHORIZED` |
| `deposito` calls deactivate/reactivate | 403 | `FORBIDDEN` |
| Payload from a `deposito` session sets `stock_minimo` | 403 | `FIELD_RESERVED_FOR_ENCARGADO` |
| `:id` matches no product | 404 | `PRODUCT_NOT_FOUND` |
| `sku` already used | 409 | `SKU_ALREADY_IN_USE` |
| Create/update selects an inactive `proveedor_id` | 409 | `SUPPLIER_INACTIVE` |
| Paired audit write fails | 500 | `AUDIT_WRITE_FAILED` |

## Requirements

### Requirement: Role Gate — Read Open To Both Roles, Deactivate/Reactivate Encargado-Only
`GET /api/productos`, `GET /api/productos/:id`, `POST /api/productos`, and
`PATCH /api/productos/:id` MUST declare `config: { roles: ['encargado', 'deposito'] }`.
`POST /api/productos/:id/deactivate` and `POST /api/productos/:id/reactivate` MUST declare
`config: { roles: ['encargado'] }`.

#### Scenario: Deposito reads and creates
- GIVEN a session with `rol = deposito`
- WHEN `GET /api/productos`, `GET /api/productos/:id`, or `POST /api/productos` (without
  `stock_minimo`) is called
- THEN the response is `200`/`201` as applicable

#### Scenario: Deposito cannot deactivate or reactivate
- GIVEN a session with `rol = deposito`
- WHEN `POST /api/productos/:id/deactivate` or `POST /api/productos/:id/reactivate` is called
- THEN the response is `403 { error: { code: "FORBIDDEN" } }` and `activo` is unchanged

### Requirement: Field-Level Permission — `stock_minimo` Reserved To Encargado
On `POST /api/productos` and `PATCH /api/productos/:id`, if the acting session has
`rol = deposito` and the payload includes a `stock_minimo` key (any value, including `null`),
the service MUST refuse with `403 FIELD_RESERVED_FOR_ENCARGADO` before any write. The same
payload without that key MUST succeed. This code deviates by design from
`docs/TECH-DESIGNv2.md:235`'s ratified `campo_reservado_encargado`; the owner-approved reason
(English UPPER_SNAKE, `LAST_ACTIVE_ENCARGADO` precedent) is recorded in the proposal (D2).

#### Scenario: Deposito payload with stock_minimo is refused
- GIVEN a `deposito` session
- WHEN `POST /api/productos` or `PATCH /api/productos/:id` is called with `stock_minimo` present
- THEN the response is `403 { error: { code: "FIELD_RESERVED_FOR_ENCARGADO" } }` and no row is
  written

#### Scenario: Same payload without the field succeeds
- GIVEN a `deposito` session
- WHEN the identical payload is sent without a `stock_minimo` key
- THEN the request succeeds normally

#### Scenario: Encargado sets stock_minimo freely
- GIVEN an `encargado` session
- WHEN `POST /api/productos` or `PATCH /api/productos/:id` includes `stock_minimo`
- THEN the request succeeds and the value is persisted

### Requirement: Product Creation Writes `stock_actual` And Its Initial Movement In One Transaction
`POST /api/productos` MUST insert the product row, and — only when the submitted initial
stock is greater than 0 — a `movimientos` row (`tipo = 'ajuste'`, fixed `motivo` "stock inicial
(alta de producto)", `es_discrepancia = false`) in the same database transaction (ADR-0003).
`stock_actual` MUST NEVER change without a paired `movimientos` row, and neither write MUST
persist if the other fails.

#### Scenario: Initial stock greater than zero creates the product and the ledger entry together
- GIVEN a create payload with initial stock `50`
- WHEN `POST /api/productos` completes
- THEN the response is `201`, the product has `stock_actual = 50`, and exactly one
  `movimientos` row exists for it with `tipo = 'ajuste'`, that fixed `motivo`, and
  `es_discrepancia = false`

#### Scenario: Initial stock of zero creates no movement
- GIVEN a create payload with initial stock `0` (or omitted)
- WHEN `POST /api/productos` completes
- THEN the response is `201`, `stock_actual = 0`, and no `movimientos` row exists for the
  product

#### Scenario: A failure writing the ledger rolls back the product insert
- GIVEN a create payload with initial stock `> 0`
- WHEN the `movimientos` insert fails inside the same transaction
- THEN the entire transaction rolls back, no `productos` row exists, and no `movimientos` row
  exists

### Requirement: Stock Correction After Creation Requires A Movement, Not This Endpoint
The `PATCH /api/productos/:id` Zod input schema MUST NOT include `stock_actual` in its shape.
A payload containing that key MUST be refused as a validation error before any handler runs.
Any post-creation stock correction is out of scope for this change (backlog #6).

#### Scenario: A payload with stock_actual is refused
- GIVEN a `PATCH /api/productos/:id` body containing a `stock_actual` key
- WHEN the request is validated
- THEN it is refused with a validation error before any handler runs, and no row is written

### Requirement: Unique SKU
`sku` MUST be enforced unique at the database via a unique index. A create or update that
collides with an existing `sku` MUST be refused via `isUniqueViolation`'s mapping of the
driver's `23505`, without a prior existence check.

#### Scenario: Duplicate SKU on create is refused
- GIVEN an existing product has `sku = "ABC-100"`
- WHEN `POST /api/productos` is called with `sku: "ABC-100"`
- THEN the response is `409 { error: { code: "SKU_ALREADY_IN_USE" } }` and no row is created

#### Scenario: Duplicate SKU on update is refused
- GIVEN two distinct products exist
- WHEN `PATCH /api/productos/:id` sets one product's `sku` to the other's `sku`
- THEN the response is `409 { error: { code: "SKU_ALREADY_IN_USE" } }` and no field is changed

### Requirement: Movimientos CHECK Constraints Enforce Sign/Type And Discrepancy Coherence
The `movimientos` table MUST enforce two CHECK constraints at the schema level: sign coherent
with `tipo` (`entrada` > 0, `salida`/`venta` < 0, `anulacion` > 0, `ajuste` unconstrained), and
`es_discrepancia = true` permitted only when `tipo = 'ajuste'`. This change writes only
`ajuste` rows (the create-time initial stock, always `es_discrepancia = false`); the other
`tipo` values and any user-set `es_discrepancia = true` are not reachable through any endpoint
in this change and are exercised end-to-end when backlog #6 ships entrada/salida/ajuste
write paths.

#### Scenario: A direct insert violating the discrepancy constraint is rejected
- GIVEN a `movimientos` insert with `tipo = 'entrada'` and `es_discrepancia = true`
- WHEN the insert is attempted against the schema (migration/integration-level test)
- THEN the database rejects it via the CHECK constraint

### Requirement: Logical Deactivation And Reactivation Are Encargado-Only; History Stays Readable
`POST /api/productos/:id/deactivate` MUST set `activo = false` without deleting the row, and
`POST /api/productos/:id/reactivate` MUST set `activo = true`; both are encargado-only (see
Role Gate). A deactivated product MUST remain readable by id. Enforcing "an inactive product
rejects new movements" end to end requires a movement-writing endpoint, which ships in
backlog #6, not this change; that guarantee is a data-model invariant here, not yet
HTTP-testable.

#### Scenario: Successful deactivation
- GIVEN the target product is active
- WHEN `POST /api/productos/:id/deactivate` completes
- THEN the response is `200`, `activo = false`, and one audit row is recorded

#### Scenario: A deactivated product remains readable by id
- GIVEN a product has been deactivated
- WHEN `GET /api/productos/:id` is called
- THEN the response is `200` with `activo = false`, not `404`

#### Scenario: Successful reactivation
- GIVEN the target has `activo = false`
- WHEN `POST /api/productos/:id/reactivate` completes
- THEN the response is `200`, `activo = true`, and one audit row is recorded

### Requirement: `stock_minimo` Is Optional And Never Blocks Creation
`stock_minimo` MUST be nullable. A create or update omitting it MUST succeed and persist
`null`. No alert evaluation exists in this change (backlog #10), so a null threshold produces
no server-side side effect.

#### Scenario: Create without stock_minimo succeeds
- GIVEN a create payload omits `stock_minimo`
- WHEN `POST /api/productos` completes
- THEN the response is `201` and the product has `stock_minimo = null`

### Requirement: Category Is Free Text And Nullable
`categoria` MUST accept any string or `null`/omitted, with no enum or fixed-list validation.

#### Scenario: Arbitrary category text is stored as submitted
- GIVEN a create or update payload sets `categoria: "Bebidas"`
- WHEN the request completes
- THEN `categoria` reads back as exactly `"Bebidas"`

### Requirement: List Products Supports Pagination And Search By Name Or SKU
`GET /api/productos` MUST accept `?page&pageSize` per `lib/pagination.ts`, responding with
`{ data, page, pageSize, total }`, and MUST accept an optional `?q` parameter that
case-insensitively matches either `nombre` or `sku`, composing with pagination.

#### Scenario: Default pagination
- GIVEN more than 20 products exist
- WHEN `GET /api/productos` is called with no query params
- THEN `data` has at most the default `pageSize` items and `total` reflects the full count

#### Scenario: Search matches name or SKU case-insensitively
- GIVEN a product named "Detergente Azul" with `sku = "DET-01"`
- WHEN `GET /api/productos?q=azul` or `GET /api/productos?q=det-01` is called
- THEN that product is included in `data`

### Requirement: New Products May Not Reference An Inactive Supplier; Existing References Survive Later Deactivation
`POST /api/productos` and `PATCH /api/productos/:id` MUST refuse to set `proveedor_id` to a
supplier whose `activo = false`. A product already referencing a supplier that is later
deactivated MUST keep that reference; its read and update operations MUST continue to work
unchanged.

#### Scenario: Create against an inactive supplier is refused
- GIVEN a supplier exists with `activo = false`
- WHEN `POST /api/productos` is called with that supplier's id as `proveedor_id`
- THEN the response is `409 { error: { code: "SUPPLIER_INACTIVE" } }` and no product is created

#### Scenario: A product survives its supplier's later deactivation
- GIVEN a product was created while its supplier was active
- WHEN that supplier is later deactivated via `POST /api/proveedores/:id/deactivate`
- THEN `GET /api/productos/:id` still returns `200` with the same `proveedor_id`, and
  `PATCH /api/productos/:id` on an unrelated field (e.g. `precio`) still returns `200`

### Requirement: Audit Trail Recorded For Every Mutation, Atomic With The Write
Every create, update, deactivate, and reactivate MUST record exactly one `auditoria` row
(`entidad = 'productos'`, action-appropriate verb) atomically with the row write, per
`record-audit-trail`'s transaction contract. If the audit write fails, the entire transaction
MUST roll back.

#### Scenario: One audit row per mutation
- GIVEN any create/update/deactivate/reactivate call succeeds
- WHEN the resulting `auditoria` row is inspected
- THEN exactly one row exists with `entidad = 'productos'` and the matching verb

#### Scenario: Failed audit write rolls back the mutation
- GIVEN a create/update/deactivate/reactivate write is in progress
- WHEN the paired audit write fails
- THEN the transaction rolls back, the target row is unchanged, and the response is
  `500 { error: { code: "AUDIT_WRITE_FAILED" } }`
