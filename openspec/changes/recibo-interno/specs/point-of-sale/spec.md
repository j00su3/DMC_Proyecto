# Delta for point-of-sale

## ADDED Requirements

### Requirement: Sale Detail Read Path
`GET /api/ventas/:id` MUST return one venta's detail: `id`, `numeroCorrelativo`, `estado`,
`total`, `creadoEn`, its `items` (each with `productoId`, `cantidad`, `precioUnitario`,
`subtotal`, and the product's *current* name via `ProductosRepo.findById`), its `pagos`
(`medio`, `monto`, `vuelto`), and the confirming cajero's name via `UsuariosRepo.findById` —
mirroring `GET /api/productos/:id`'s detail shape. It MUST declare
`config: { roles: ['encargado', 'deposito'] }` (PD-4: audit-style, no per-cajero
restriction). A nonexistent `id` MUST return `404 SALE_NOT_FOUND`.

#### Scenario: Encargado retrieves a venta confirmed by a different cajero
- GIVEN a venta confirmed by a `deposito` user
- WHEN an `encargado` requests that venta's detail by id
- THEN the response succeeds and includes items, pagos, and the confirming cajero's name

#### Scenario: Deposito retrieves any venta by id
- GIVEN a session with `rol = deposito`
- WHEN it requests an existing venta's detail by id
- THEN the response succeeds (PD-4 audit-style access, not restricted to own sales)

#### Scenario: Nonexistent id returns a not-found error
- GIVEN no venta exists with the requested id
- WHEN the detail endpoint is requested
- THEN the response is `404 SALE_NOT_FOUND`

#### Scenario: Item name reflects the product's current name
- GIVEN a sold product was renamed after the sale
- WHEN the venta's detail is read
- THEN the item shows the product's current name, not the name at sale time (accepted drift)

### Requirement: Estado Is Returned Verbatim, No Derived Receipt State
The detail response's `estado` MUST equal `Venta.estado` exactly (`confirmada` or `anulada`)
with no separate or derived field and no server-side visual/textual embellishment — display
treatment is a client concern.

#### Scenario: Anulada venta's detail reports estado as-is
- GIVEN a venta with `estado = 'anulada'`
- WHEN its detail is read
- THEN the response's `estado` field is exactly `anulada`

#### Scenario: Confirmada venta's detail reports estado as-is
- GIVEN a venta with `estado = 'confirmada'`
- WHEN its detail is read
- THEN the response's `estado` field is exactly `confirmada`

### Requirement: Lookup By Numero Correlativo
The system MUST support locating a venta by its exact `numeroCorrelativo` (exact match only),
under the same `config: { roles: ['encargado', 'deposito'] }` audit-style access as the detail
read path. When no venta matches, the response MUST be a single generic not-found result —
`404 SALE_NOT_FOUND` — with no distinction between "no such number" and any access
consideration (PD-5). Exact route/query shape is a design decision, not specified here.

#### Scenario: Lookup by an existing correlativo succeeds regardless of confirming cajero
- GIVEN a venta confirmed by a different user than the requester
- WHEN it is looked up by its exact `numeroCorrelativo`
- THEN the lookup succeeds (PD-4 audit-style access)

#### Scenario: Lookup by a nonexistent correlativo returns the generic not-found result
- GIVEN no venta has the requested `numeroCorrelativo`
- WHEN the lookup is requested
- THEN the response is `404 SALE_NOT_FOUND` with no other distinguishing detail

### Requirement: Detail Read Path Excludes Store Configuration Data
Neither the detail response nor the correlativo lookup MUST include any store name, address,
or other store-configuration field — no such entity exists in schema (PD-2).

#### Scenario: Detail response carries no store identity fields
- GIVEN any venta's detail is read
- WHEN the response body is inspected
- THEN it contains no store name or address field
