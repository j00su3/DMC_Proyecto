# inventory-movements Specification

## Purpose

Backend write path for registering stock movements (`entrada`, `salida`, `ajuste`) and the
read path for a product's own movement history. Builds on backlog #5's schema and the
`aplicarDelta` conditional-UPDATE primitive (ADR-0003, ADR-0005). Every movement writes
`stock_actual` and its own `movimientos` row atomically, and IS its own audit trail
(ADR-0012 rule 2) — it never produces a separate `auditoria` row. New capability
(greenfield, no prior spec).

## Non-Goals

- `venta` and `anulacion` write paths (backlog #7, #9).
- Automatic alert evaluation (backlog #10) — this change only leaves a transaction seam
  (SAVEPOINT point) for the future evaluator; it evaluates nothing.
- Cross-product / global movement listing and reporting (backlog #12).
- Any change to the `auditoria` system, its schema, or its field classification.

| Failure | Status | Code |
|---|---|---|
| No session | 401 | `UNAUTHORIZED` |
| `deposito` registers `ajuste` | 403 | `FORBIDDEN` |
| `motivo` missing/blank on `ajuste` or a merma `salida` | 400 | `MOVEMENT_REASON_REQUIRED` |
| `cantidad = 0` on `ajuste` | 400 | `VALIDATION_ERROR` |
| Target product id matches no product | 404 | `PRODUCT_NOT_FOUND` |
| Target product `activo = false` | 409 | `PRODUCT_INACTIVE` |
| `salida`/merma would drive stock below zero | 409 | `INSUFFICIENT_STOCK` (`details.available`) |

## Requirements

### Requirement: Role Gate — Entrada/Salida Open To Both Roles, Ajuste Encargado-Only
Registering `entrada` or `salida` (including a merma salida) MUST be permitted for sessions
with `rol = encargado` or `rol = deposito`. Registering `ajuste` MUST be refused for
`rol = deposito` with `403 FORBIDDEN`, before any write. (PD-1)

> **Corrected 2026-08-30 (was `ADJUSTMENT_RESERVED_FOR_ENCARGADO`).** This spec was written in
> parallel with the design and named a code the system does not emit. D5 puts the ajuste
> restriction in `config.roles`, so the refusal comes from the shared `preHandler` in
> `apps/api/src/plugins/auth.ts:92-95`, which throws a plain `forbidden()` with no per-route
> override — the same mechanism, and the same code, that already refuses `deposito` on
> `POST /api/productos/:id/deactivate`.
>
> Emitting the specific code would require either an in-service role branch or a per-route error
> override: both are exactly the anti-pattern D5's route-config approach was chosen to avoid, and
> either one would move PD-1's server-side boundary out of route configuration, where a test can
> prove it, into handler code, where it has to be re-proved per route. The generic code is the
> honest description of the mechanism, and it is consistent with every other role refusal in the
> application.

#### Scenario: Deposito registers entrada and salida
- GIVEN a session with `rol = deposito`
- WHEN a movement of `tipo = entrada` or `tipo = salida` is registered for an active product
- THEN the response succeeds and the movement is persisted

#### Scenario: Deposito is refused for ajuste
- GIVEN a session with `rol = deposito`
- WHEN a movement of `tipo = ajuste` is submitted
- THEN the response is `403 { error: { code: "FORBIDDEN" } }`, and `stock_actual` and the
  movement count for that product are both unchanged

#### Scenario: Encargado registers ajuste
- GIVEN a session with `rol = encargado`
- WHEN a non-zero-quantity `ajuste` is submitted with a valid `motivo`
- THEN the response succeeds and the movement is persisted

### Requirement: Motivo Mandatory Only On Ajuste And Merma Salidas
`motivo` MUST be required for `tipo = ajuste` and for any `salida` submitted with the merma
indicator set. `motivo` MUST be optional for `entrada` and for an ordinary (non-merma)
`salida`. (PD-2)

When required, `motivo` MUST be at least **3 characters after trimming**, and at most 500.
(Orchestrator resolution of RECONCILE-2, 2026-08-30. PD-3 chose "free text *with a minimum
length*", so a bare non-empty rule under-implements it. `sdd-design` proposed 5, which would
reject `"robo"` — four characters, and one of the most ordinary merma reasons a shop will
ever type. A floor that refuses a legitimate reason is worse than one that admits a lazy
one. 3 still rejects `""`, `"x"`, `"ok"` and whitespace. The 500 ceiling comes from
`sdd-design`: `motivo` is unbounded `text` and reaches both a column and a table cell.)

#### Scenario: Ajuste without motivo is refused
- GIVEN an otherwise-valid `ajuste` payload
- WHEN `motivo` is omitted, empty, whitespace-only, or shorter than 3 characters after
  trimming
- THEN the response is `400 { error: { code: "MOVEMENT_REASON_REQUIRED" } }` and no movement
  is persisted

#### Scenario: Merma salida without motivo is refused
- GIVEN a `salida` payload with the merma indicator `true`
- WHEN `motivo` is omitted, empty, whitespace-only, or shorter than 3 characters after
  trimming
- THEN the response is `400 { error: { code: "MOVEMENT_REASON_REQUIRED" } }` and no movement
  is persisted

#### Scenario: A short but legitimate reason is accepted
- GIVEN a `salida` payload with the merma indicator `true`
- WHEN `motivo` is `"robo"`
- THEN the response succeeds and the movement is persisted with `motivo = "robo"`

#### Scenario: Ordinary salida needs no motivo
- GIVEN a `salida` payload with the merma indicator `false` or absent
- WHEN `motivo` is omitted
- THEN the response succeeds and the movement is persisted with `motivo = null`

### Requirement: Motivo Is Free Text With No Closed Reason List
When `motivo` is required (see above), any text meeting the length bounds MUST be accepted
verbatim — the system MUST NOT validate it against a fixed list of reasons. (PD-3)

#### Scenario: Arbitrary reason text is accepted and stored verbatim
- GIVEN an `ajuste` payload with `motivo: "Conteo físico mensual"`
- WHEN the movement is registered
- THEN the response succeeds and the persisted `motivo` reads back exactly
  `"Conteo físico mensual"`

### Requirement: Zero-Quantity Ajuste Is Not Representable
An `ajuste` request with `cantidad = 0` MUST be refused with a validation error before any
write is attempted. As a backstop, the database schema MUST also reject any `ajuste` row
with `cantidad = 0` via a CHECK constraint. (PD-4)

#### Scenario: Zero quantity is unrepresentable on the wire
- GIVEN an `ajuste` payload with `cantidad: 0`
- WHEN the movement is submitted
- THEN the response is `400 { error: { code: "VALIDATION_ERROR" } }` and no row is written

> **Corrected 2026-08-30 (was `ADJUSTMENT_QUANTITY_ZERO`).** D7 makes `cantidad` a positive
> magnitude (`z.number().int().min(1)`), with the sign derived in the service. Zero therefore
> fails schema validation before any handler code runs, so no code path is left that could emit
> a named domain code — and adding one would mean loosening the wire shape to admit the value
> first, purely so the application could reject it a layer later.
>
> PD-4 is satisfied either way, and more strongly than the original wording described: zero is
> not merely refused, it is **unrepresentable**. Three independent layers now hold the line — the
> form refuses it before submit, the wire schema cannot express it, and the
> `movimientos_ajuste_cantidad_no_cero` CHECK backstops a direct insert.

#### Scenario: A direct zero-quantity ajuste insert is rejected by the database
- GIVEN a `movimientos` insert with `tipo = 'ajuste'` and `cantidad = 0`
- WHEN the insert is attempted directly against the schema (migration/integration-level test)
- THEN the database rejects it via the CHECK constraint

### Requirement: Merma Salida Is Persisted Distinctly From An Ordinary Salida
A `salida` submitted with the merma indicator (`esMerma: true`) MUST persist
`tipo = 'salida'` plus a persisted merma indicator, distinguishable from an ordinary salida
in the movement's own row and in history reads. The merma indicator MUST be settable only
when `tipo = 'salida'`; the database MUST enforce this via a CHECK constraint, mirroring the
existing `es_discrepancia`-on-`ajuste`-only constraint. No `merma` value MUST be added to the
movement `tipo` enum. (PD-5)

#### Scenario: Merma salida is persisted with the indicator set
- GIVEN a `salida` payload with `esMerma: true` and a valid `motivo`
- WHEN the movement is registered
- THEN the response succeeds and the persisted row has `tipo = 'salida'` with the merma
  indicator `true`

#### Scenario: A direct insert with the merma indicator on a non-salida tipo is rejected
- GIVEN a `movimientos` insert with `tipo = 'entrada'` (or `ajuste`) and the merma indicator
  `true`
- WHEN the insert is attempted directly against the schema
- THEN the database rejects it via the CHECK constraint

### Requirement: A Movement Against An Inactive Product Is Refused, Distinguishably From Insufficient Stock
Any `entrada`, `salida`, or `ajuste` targeting a product with `activo = false` MUST be
refused with `409 PRODUCT_INACTIVE`, distinct from the insufficient-stock refusal, and
`stock_actual` MUST remain unchanged.

#### Scenario: Movement against an inactive product is refused
- GIVEN a product with `activo = false`
- WHEN any movement type is submitted against it by an authorized role
- THEN the response is `409 { error: { code: "PRODUCT_INACTIVE" } }`, distinct from
  `INSUFFICIENT_STOCK`, and `stock_actual` is unchanged

### Requirement: A Salida That Would Drive Stock Below Zero Is Refused, Naming The Available Quantity
A `salida` (ordinary or merma) whose quantity exceeds the product's current `stock_actual`
MUST be refused with `409 INSUFFICIENT_STOCK`, and the response `details` MUST include the
quantity actually available (ADR-0005's "hay N"), read within the same transaction. This
refusal MUST be shown identically to `encargado` and `deposito` sessions. `stock_actual`
MUST remain unchanged.

#### Scenario: Salida exceeding stock is refused for either role
- GIVEN a product with `stock_actual = 5`
- WHEN a `salida` of quantity `8` is submitted by an `encargado` or a `deposito` session
- THEN the response is `409 { error: { code: "INSUFFICIENT_STOCK", details: { available: 5 } } }`
  and `stock_actual` remains `5`

> Naming note: the `details` payload key is ENGLISH (`available`), not Spanish. The error
> envelope belongs to the English family, and the only existing `details` key in the
> codebase — `retryAfter` on `ACCOUNT_LOCKED` (`apps/api/src/lib/errors.ts:85-89`) — is
> English camelCase. This matters because `AppError.details` is typed `z.unknown()`
> (`errors.ts:7`), so the shape never reaches `openapi.json` and `pnpm contract:check`
> cannot catch a drift here. The convention is the only guard.

### Requirement: Stock And Ledger Write Atomicity
`stock_actual` MUST NEVER change without a paired `movimientos` row written in the same
database transaction, and neither write MUST persist if the other fails (ADR-0003). The
`stockResultante` recorded on the movement MUST be exactly the value returned by the atomic
stock update — it MUST NEVER be independently recomputed.

#### Scenario: Successful movement updates stock and ledger together
- GIVEN an active product with `stock_actual = 10`
- WHEN a valid `entrada` of quantity `5` is registered
- THEN the response succeeds, `stock_actual = 15`, and the persisted movement's
  `stockResultante = 15`

#### Scenario: A failure writing the movement rolls back the stock change
- GIVEN a valid movement request
- WHEN the `movimientos` insert fails inside the transaction
- THEN the entire transaction rolls back and `stock_actual` is unchanged

### Requirement: No Audit Row Is Ever Written For A Movement
Registering `entrada`, `salida`, or `ajuste` MUST NOT produce any `auditoria` row. The
movement's own row (`usuarioId`, `fecha`, `motivo`, `stockResultante`) IS its complete audit
trail (ADR-0012 rule 2).

#### Scenario: A successful movement produces no auditoria row
- GIVEN any valid `entrada`, `salida`, or `ajuste` request
- WHEN the movement completes successfully
- THEN no row is added to `auditoria` for it, and the `auditoria` row count is unchanged
  before and after

### Requirement: Movement History Is Readable Per Product, Paginated, By Both Roles
Reading a product's own movement history MUST be permitted for `rol = encargado` and
`rol = deposito`, returning `{ data, page, pageSize, total }` per the project's pagination
convention, ordered most-recent-first, and MUST include `tipo`, `cantidad`,
`stockResultante`, `motivo`, the merma indicator, `fecha`, and `usuarioId` per row. Listing
across products is out of scope (see Non-Goals).

#### Scenario: Either role reads a product's history
- GIVEN a product with 3 recorded movements
- WHEN its history is requested by an `encargado` or `deposito` session
- THEN the response is `200` with `data` containing 3 items, `total = 3`, most recent first

#### Scenario: History reflects a merma salida distinctly
- GIVEN a product with one ordinary salida and one merma salida
- WHEN its history is read
- THEN both rows show `tipo = 'salida'`, and only the merma row's merma indicator is `true`
