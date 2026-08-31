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
- Anulación / voiding a confirmed sale (backlog #9).
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
| Role other than `encargado`/`deposito` | 403 | `FORBIDDEN` |
| An item's `producto_id` matches no product | 404 | `PRODUCT_NOT_FOUND` (reused from #6) |
| An item's product has `activo = false` | 409 | `PRODUCT_INACTIVE` (reused from #6) |
| An item's quantity exceeds available stock | 409 | `INSUFFICIENT_STOCK`, `details.available` (reused from #6) |
| `SUM(pagos.monto) < venta.total` | — | Code not yet ratified — see Open Questions |
| A `pagos` entry omits `medio` | — | Code not yet ratified — see Open Questions |
| Two `pagos` entries share the same `medio` | — | Code not yet ratified — see Open Questions |
| A non-cash `pago` carries `vuelto > 0` | — | Rejected by DB CHECK; wire code not yet ratified |
| Server price differs from the price last acknowledged by the cashier | — | Response shape not yet ratified — see Open Questions |

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
