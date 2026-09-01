# Delta for point-of-sale

Adds the anulación write path to the existing `point-of-sale` capability. No existing
`confirmarVenta` behavior, route, or read path changes — every requirement below is ADDED, not
MODIFIED. `motivoAnulacion`/`anuladaPor`/`anuladaEn` per PD-1/PD-5 of proposal.md.

| New failure | Status | Code |
|---|---|---|
| No session | 401 | `UNAUTHORIZED` (reused) |
| Role other than `encargado` | 403 | `FORBIDDEN` (reused) |
| `motivoAnulacion` missing/blank | 400 | Not yet ratified — see Open Questions |
| Venta id matches no venta | 404 | `SALE_NOT_FOUND` (reused) |
| Venta `estado` already `anulada` | 409 | Not yet ratified — see Open Questions |

## ADDED Requirements

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
