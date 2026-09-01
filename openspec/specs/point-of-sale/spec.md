# point-of-sale Specification

## Purpose

Backend write path for recording a sale: `ventas`/`items_venta`/`pagos` schema,
`confirmarVenta` (sorts cart by `producto_id`, loops `aplicarDelta` + `movimientos.create`
per item inside one `uow.run`, per PD-1..PD-5), `numero_correlativo` assignment, and
`POST /api/ventas`. Reuses `aplicarDelta` (ADR-0005) and `MovimientosRepo.create()`
(`tipo: 'venta'`) unmodified — built by backlog #6 anticipating this change. New capability
(greenfield, no prior spec).

## Non-Goals

- Mobile POS (PD-4, deferred to a future backlog item).
- Receipt / print (backlog #8).
- Stock alert evaluation (backlog #10) — the transaction seam exists per item, mirroring
  `registrarMovimiento`, but this change evaluates nothing.
- Cross-sale reporting (backlog #12).
- Barcode scanning (`docs/PRD.md:141-142`).
- Fiscal, gap-free `numero_fiscal` (a separate future counter; this change's
  `numero_correlativo` MAY show gaps from rolled-back attempts, by design).

| Failure | Status | Code |
|---|---|---|
| No session | 401 | `UNAUTHORIZED` |
| Role other than `encargado`/`deposito` (confirming) or not `encargado` (anulación) | 403 | `FORBIDDEN` |
| An item's `producto_id` matches no product | 404 | `PRODUCT_NOT_FOUND` (reused from #6) |
| Venta id matches no venta (anulación) | 404 | `SALE_NOT_FOUND` |
| An item's product has `activo = false` | 409 | `PRODUCT_INACTIVE` (reused from #6) |
| An item's quantity exceeds available stock | 409 | `INSUFFICIENT_STOCK`, `details.available` (reused from #6) |
| Venta `estado` already `anulada` (anulación) | 409 | `SALE_ALREADY_VOIDED` |
| `SUM(pagos.monto) < venta.total` | — | Code not yet ratified — see Open Questions |
| A `pagos` entry omits `medio` | — | Code not yet ratified — see Open Questions |
| Two `pagos` entries share the same `medio` | — | Code not yet ratified — see Open Questions |
| A non-cash `pago` carries `vuelto > 0` | — | Rejected by DB CHECK; wire code not yet ratified |
| Server price differs from the price last acknowledged by the cashier | — | Response shape not yet ratified — see Open Questions |
| `motivoAnulacion` missing/blank (anulación) | 400 | `VALIDATION_ERROR` (reused) |

## Requirements

### Requirement: Role Gate — Confirming A Sale Is Open To Both Roles
`POST /api/ventas` MUST declare `config: { roles: ['encargado', 'deposito'] }`, mirroring #6's
entrada/salida routes and `docs/PRD.md:69-70`'s statement that depósito staff act as cashiers.

#### Scenario: Deposito confirms a valid sale
- GIVEN a session with `rol = deposito`
- WHEN a valid cart with sufficient stock and a valid payment is confirmed
- THEN the response succeeds and the sale is persisted

### Requirement: A Sale May Carry Several Payments, Validated Against The Total (PD-1)
A confirmed `venta` MAY be paired with one or more `pagos` rows (1:N). Confirmation MUST be
refused, with no row persisted, when `SUM(pagos.monto) < venta.total`. A sum strictly greater
than the total MUST be accepted (the excess becomes `vuelto` per the next requirement).

#### Scenario: Single payment covering the total succeeds
- GIVEN a cart totaling `100.00`
- WHEN confirmed with one payment of `monto = 100.00`
- THEN the sale is persisted with exactly one `pagos` row

#### Scenario: Split payment summing to the total succeeds
- GIVEN a cart totaling `100.00`
- WHEN confirmed with a cash payment of `40.00` and a card payment of `60.00`
- THEN the sale is persisted with two `pagos` rows summing to `100.00`

#### Scenario: Payments summing below the total are refused
- GIVEN a cart totaling `100.00`
- WHEN confirmed with payments summing to `80.00`
- THEN confirmation is refused before any write, and no `ventas`, `items_venta`, or `pagos`
  row is persisted

### Requirement: Vuelto Is Restricted To The Cash Payment Row (PD-2)
`vuelto` MUST be zero (or absent) on every `pagos` row except the one with `medio` = cash.
The database MUST enforce this via a CHECK constraint, structurally identical to #6's
`movimientos_merma_solo_salida`. When a confirmed sale has no cash payment, the payment sum
MUST equal `venta.total` exactly — there is no row that could carry a `vuelto`.

#### Scenario: Cash overpayment produces vuelto on the cash row only
- GIVEN a cart totaling `90.00` paid with cash `100.00`
- WHEN the sale is confirmed
- THEN the cash `pagos` row has `vuelto = 10.00` and any other row has `vuelto = 0`/absent

#### Scenario: A non-cash row with vuelto is rejected at the database
- GIVEN a `pagos` insert with `medio` other than cash and `vuelto > 0`
- WHEN the insert is attempted directly against the schema (migration/integration-level test)
- THEN the database rejects it via the CHECK constraint

#### Scenario: Card-only payment must equal the total exactly
- GIVEN a cart totaling `100.00` paid only by card
- WHEN the card payment is `110.00` (exceeding the total with no cash row to carry the excess)
- THEN confirmation is refused before any write

### Requirement: At Most One Payment Row Per Payment Medio (PD-7)
A confirmed `venta` MUST NOT contain two `pagos` rows sharing the same `medio`. If the cashier
enters the same medio more than once (e.g., two cash amounts), those amounts MUST be combined
into a single row before the sale is confirmed. The database MUST enforce uniqueness of
`(venta_id, medio)`.

#### Scenario: Two cash entries are combined into one row
- GIVEN the cashier enters cash `30.00` and then cash `20.00` for the same sale
- WHEN the sale is confirmed
- THEN exactly one cash `pagos` row exists with `monto = 50.00`

#### Scenario: A payload with two rows sharing a medio is refused
- GIVEN a confirmation payload contains two entries both with `medio: 'efectivo'`
- WHEN it is submitted
- THEN confirmation is refused before any write, and no row is persisted

### Requirement: Server-Side Price Authority At Confirmation (PD-5)
For every cart item, `confirmarVenta` MUST re-read `precio_unitario` from `productos.precio` at
confirmation time. Any price value submitted by the client MUST NEVER be trusted or persisted
as `items_venta.precio_unitario` — the persisted value MUST always be the price read from the
database during that confirmation's transaction.

#### Scenario: Persisted price is the server's current price, not the client's
- GIVEN a cart item whose client-side cached price differs from the product's current
  `productos.precio`
- WHEN the sale is confirmed successfully
- THEN the persisted `items_venta.precio_unitario` equals the server's current price at
  confirmation time, not the client-cached value

### Requirement: A Price Mismatch Blocks Silent Confirmation Until Explicitly Re-Confirmed (PD-6)
If the price read from `productos.precio` at confirmation differs from the price the cashier
last acknowledged for that item, `confirmarVenta` MUST NOT close the sale on that attempt. It
MUST surface the mismatch (including the new price) to the caller without persisting a
`ventas` row, and MUST only proceed to close the sale on an explicit subsequent confirmation
that acknowledges the new price.

#### Scenario: A stale price is not silently accepted
- GIVEN a cart item whose price changed since it was added
- WHEN the sale is confirmed without any explicit acknowledgment of the new price
- THEN no `ventas` row is persisted, and the response reports the mismatch and the new price

#### Scenario: Explicit re-confirmation proceeds at the new price
- GIVEN a prior confirmation attempt reported a price mismatch
- WHEN the cashier explicitly re-confirms, acknowledging the new price
- THEN the sale is persisted using the current server price

### Requirement: Insufficient Stock On Any Item Aborts The Whole Sale
If any cart item's quantity exceeds its product's available stock, the entire sale MUST be
refused with `409 INSUFFICIENT_STOCK` (`details.available`), and no item's stock MUST change
— including items earlier in processing order whose stock update already succeeded within the
same transaction (`docs/PRD.md:278`).

#### Scenario: A mid-cart stock shortfall rolls back the whole sale
- GIVEN a cart of three items where the second item's requested quantity exceeds its stock
- WHEN the sale is confirmed
- THEN the response is `409 INSUFFICIENT_STOCK`, no `ventas`/`items_venta`/`pagos` row exists,
  and every item's `stock_actual` is unchanged, including the first item's

### Requirement: Deterministic Item Order Prevents Concurrent-Sale Deadlocks
Within one `confirmarVenta` transaction, cart items MUST be processed in a fixed deterministic
order (ascending `producto_id`), so that two concurrent multi-item sales touching overlapping
products in different entry orders do not deadlock the database (ADR-0005, finding A3).

#### Scenario: Overlapping concurrent sales complete without a deadlock error
- GIVEN two sales confirmed concurrently that each include products A and B, added to their
  carts in opposite order
- WHEN both are confirmed at nearly the same time
- THEN both eventually complete (one may wait on the other) and neither fails with a
  transaction deadlock error

### Requirement: One Ledger Row Per Sold Item, Same Transaction As Stock And Sale Rows
Each successfully processed cart item MUST produce exactly one `movimientos` row
(`tipo = 'venta'`, `ventaId` set to the confirmed sale), written in the same transaction as
its stock decrement, mirroring `registrarMovimiento`'s existing per-item shape.

#### Scenario: A three-item sale produces three linked movements
- GIVEN a cart with three distinct products
- WHEN the sale is confirmed successfully
- THEN exactly three `movimientos` rows exist with `tipo = 'venta'` and that sale's `ventaId`

### Requirement: Sale Confirmation Is Atomic Across Venta, Items, Payments, Stock, And Ledger
A successful `confirmarVenta` MUST persist the `ventas` row, all `items_venta` rows, all
`pagos` rows, every item's stock decrement, and every item's `movimientos` row in one database
transaction. A failure at any point MUST roll back all of it — no partial sale, partial
payment set, or partial stock change MUST ever persist (ADR-0003).

#### Scenario: A failure partway through rolls back everything already written
- GIVEN a valid multi-item, multi-payment sale request
- WHEN a write for the last item fails inside the transaction
- THEN no `ventas`, `items_venta`, `pagos`, or `movimientos` row from this attempt persists,
  and every item's stock is unchanged

### Requirement: Numero Correlativo Is Assigned Only To A Successfully Confirmed Sale
Every successfully confirmed `venta` MUST receive a unique, monotonically increasing
`numero_correlativo`. A confirmation attempt that fails or rolls back MUST NOT persist a
`ventas` row; the underlying sequence value it may have consumed produces a documented gap,
not a defect (`docs/TECH-DESIGNv2.md:145-151`) — gap-free numbering is explicitly out of scope
(see Non-Goals).

#### Scenario: Consecutive successful sales get increasing numbers
- GIVEN two sales are confirmed successfully, one after the other
- WHEN their `numero_correlativo` values are compared
- THEN the second is strictly greater than the first

### Requirement: POS Catalog Reads Exclude Inactive Products And Include Zero-Stock Products (PD-8)
The read path used to populate the POS catalog MUST exclude any product with `activo = false`
entirely. It MUST include active products with `stock_actual = 0` — an inactive product is
already refused by `aplicarDelta`, so hiding it costs nothing; a zero-stock active product must
stay visible so the cashier can tell a customer it exists but is unavailable.

#### Scenario: Inactive product is absent from the catalog read
- GIVEN a product with `activo = false`
- WHEN the POS catalog is read
- THEN that product does not appear in the results

#### Scenario: Zero-stock active product is present in the catalog read
- GIVEN an active product with `stock_actual = 0`
- WHEN the POS catalog is read
- THEN that product appears in the results

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

## ADDED Requirements (Anulación de Venta — backlog #9)

### Requirement: Anulación Is Encargado-Only
The anulación endpoint MUST declare `config: { roles: ['encargado'] }` — the first
encargado-only route in `routes/ventas.ts`. A session with `rol = deposito` MUST be refused
with `403 FORBIDDEN` before any write, mirroring `docs/PRD.md:46,69-71`'s "operación
sensible" framing.

#### Scenario: Encargado anula a confirmada venta
- GIVEN a session with `rol = encargado` and an existing `confirmada` venta
- WHEN anulación is requested with a valid `motivoAnulacion`
- THEN the response succeeds and the venta transitions to `anulada`

#### Scenario: Deposito is refused
- GIVEN a session with `rol = deposito` and an existing `confirmada` venta
- WHEN anulación is requested
- THEN the response is `403 FORBIDDEN` and no field on the venta, its items, or its pagos
  changes

### Requirement: Motivo Anulación Is Mandatory (PD-1)
Anulación MUST be refused, with no write persisted, when `motivoAnulacion` is missing, empty,
or whitespace-only.

#### Scenario: Missing motivo is refused
- GIVEN an otherwise-valid anulación request from an encargado
- WHEN `motivoAnulacion` is omitted, empty, or whitespace-only
- THEN the request is refused before any write and the venta remains `confirmada`

#### Scenario: A provided motivo is persisted verbatim
- GIVEN an anulación request with `motivoAnulacion: "Cliente canceló el pedido"`
- WHEN the anulación succeeds
- THEN the venta's persisted `motivoAnulacion` reads back exactly that text

### Requirement: No Time Limit On Anulación (PD-2)
Anulación of a `confirmada` venta MUST be permitted regardless of how much time has elapsed
since confirmation. The system MUST NOT enforce any age-based window in v1.

#### Scenario: A venta confirmed long ago can still be anulada
- GIVEN a `confirmada` venta whose `creadoEn` is far in the past
- WHEN an encargado requests anulación with a valid motivo
- THEN the request succeeds, with no age check blocking it

### Requirement: Anulación Reversal Is Atomic Across Stock, Ledger, Pagos, And Venta State
A successful anulación MUST, within one database transaction: revert every item's stock by
its confirmed quantity (even when the product's current `activo = false`, per A8), create one
`movimientos` row per item (`tipo = 'anulacion'`, positive quantity), transition every `pagos`
row on the venta from `registrado` to `revertido`, and mark the venta `anulada` with
`anuladaPor` (the acting encargado's id), `anuladaEn` (timestamp), and `motivoAnulacion`. A
failure at any point MUST roll back the entire attempt — no partial stock reversal, partial
pagos revert, or partial state change MUST ever persist (mirrors `confirmarVenta`'s ADR-0003
atomicity precedent).

#### Scenario: Full atomic reversal on success
- GIVEN a `confirmada` venta with two items and one pago
- WHEN it is anulada successfully
- THEN both items' stock is restored by their sold quantity, two `anulacion` movimientos rows
  exist, the pago's `estado` is `revertido`, and the venta is `anulada` with
  `anuladaPor`/`anuladaEn`/`motivoAnulacion` all set

#### Scenario: A now-inactive product still reverses its stock
- GIVEN a `confirmada` venta containing a product that was deactivated (`activo = false`)
  after the sale
- WHEN the venta is anulada
- THEN that item's stock still reverts by its sold quantity, unblocked by `activo = false`

#### Scenario: A failure partway rolls back everything
- GIVEN a valid anulación request for a multi-item venta
- WHEN a write for the last item fails inside the transaction
- THEN no item's stock changes, no `pagos` row changes, no `anulacion` movimiento persists,
  and the venta remains `confirmada`

### Requirement: Anulación Movements Are Exempt From The Activo/Stock Guards Applied To Other Movement Types (A8)
Each `movimientos` row created by anulación MUST use `tipo = 'anulacion'` with a positive
quantity. The stock reversal it accompanies MUST NOT be blocked by a product's
`activo = false` state, unlike every other movement type's write path, which requires
`activo = true` before mutating stock (`docs/REVISION-ADVERSARIAL.md:123-140`).

#### Scenario: Anulación movement is created with the correct shape regardless of activo
- GIVEN a sold item whose product is now `activo = false`
- WHEN the venta is anulada
- THEN a `movimientos` row is created for that item with `tipo = 'anulacion'` and a positive
  `cantidad`, and the write is not refused for `activo = false`

### Requirement: Anulación On An Already-Anulada Venta Is Refused With A Conflict Error, Not A Silent No-Op Or A Duplicate Reversal
Attempting to anular a venta whose `estado` is already `anulada` MUST be refused with a `409`
conflict response, and MUST NOT persist any additional `movimientos` row, MUST NOT change any
`pagos.estado` again, and MUST NOT change `stock_actual` again. The venta's original
`anuladaPor`/`anuladaEn`/`motivoAnulacion` MUST remain exactly as set by the first anulación.

#### Scenario: A second anulación attempt is refused
- GIVEN a venta already `estado = 'anulada'`
- WHEN anulación is requested again
- THEN the response is `409` and neither stock, `pagos`, `movimientos`, nor the venta's
  original anulación fields change

#### Scenario: Concurrent anulación requests on the same venta — only one succeeds
- GIVEN a `confirmada` venta and two anulación requests submitted at nearly the same time
- WHEN both are processed
- THEN exactly one succeeds and the other is refused with the conflict response, mirroring
  `aplicarDelta`'s conditional-UPDATE race guard (ADR-0005)

### Requirement: Numero Correlativo Is Immutable Across Anulación (PD-5)
Anulación MUST NOT change, reassign, or reuse the venta's `numeroCorrelativo`.

#### Scenario: Correlativo is unchanged before and after anulación
- GIVEN a `confirmada` venta with a known `numeroCorrelativo`
- WHEN it is anulada
- THEN the anulada venta's `numeroCorrelativo` equals the value it had before anulación

### Requirement: Anulación Is Total, Not Partial (v1) — Item And Pago Selection Are Unrepresentable
The anulación request MUST NOT accept any item-level or pago-level selection; its wire shape
names only the target venta and the mandatory `motivoAnulacion`. Every item and every `pagos`
row on the venta reverses together in the same transaction — partial reversal of a subset of
items or a subset of payments is unrepresentable, not merely refused, mirroring
`inventory-movements`' "Zero-Quantity Ajuste Is Not Representable" precedent for
unrepresentable-by-design constraints.

#### Scenario: Anulación reverses every item and every pago row, none held back
- GIVEN a `confirmada` venta with three items and two `pagos` rows
- WHEN it is anulada
- THEN all three items' stock reverts, all two `pagos` rows become `revertido`, and no request
  shape exists to anular only a subset

## Open Questions (not resolved by this spec — flagged for design/orchestrator, not decided here)

1. **Wire error codes** for "payments below total", "missing `medio`", "duplicate `medio`",
   and the price-mismatch response shape are not ratified anywhere (proposal Open Q5). This
   spec states the required *behavior*; the exact `code`/response envelope is undecided.
2. **`movimientos.ventaId` FK and its `onDelete` policy** (proposal Open Q2) — no requirement
   above depends on venta deletion (out of scope, see Non-Goals), but the schema-level FK
   policy itself is undecided.
3. **Whether `Venta` needs a fourth `auditoria/fields.ts` `FIELD_CLASSIFICATION` entry**
   (proposal Open Q3) is undecided; no requirement above assumes either answer.
4. **Money arithmetic mechanism** (SQL aggregation vs. JS with a decimal library) for
   `venta.total` and `vuelto` is undecided (proposal Open Q1). This spec only requires that the
   result be exact — no floating-point precision loss — not how that is achieved.
5. **Whether `confirmarVenta` must itself reject or merge duplicate `producto_id` entries in
   the incoming item list** (defense-in-depth against a caller that bypasses PD-3's cart-merge
   behavior, e.g. a direct API call) is not addressed by any PD. PD-3 assumes the cart already
   merges duplicates before submission; this spec does not state whether the backend must also
   enforce it independently.
6. **POS catalog query shape** — reuse of `productos/repository.ts:89-115`'s
   `list(page, pageSize, q)` versus a POS-specific shape (proposal Open Q4) is undecided.

### Open Questions — Anulación requirements (backlog #9)

1. **Exact route shape** — `POST /api/ventas/:id/anular` (action-style) vs.
   `PATCH /api/ventas/:id` (resource-style) — proposal.md leaves this to `design.md`.
2. **Exact wire error code** for the "already anulada" conflict and for the missing-motivo
   refusal are not ratified anywhere; this spec states only the required status and behavior.
3. **`motivoAnulacion` length/format constraints** (e.g., a minimum-length floor mirroring
   `movimientos.motivo`'s 3-character floor in `inventory-movements`) are not settled by any PD.
4. **Whether anulación metadata (`anuladaPor`/`anuladaEn`/`motivoAnulacion`) is exposed via
   `GET /api/ventas/:id`** is not required by any success criterion in proposal.md and is left
   undecided here — the existing "Estado Is Returned Verbatim" requirement already covers
   `estado` and is unaffected either way.
