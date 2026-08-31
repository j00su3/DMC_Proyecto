# Proposal: Punto de Venta (Backlog #7)

## Intent

Today there is no way to record a sale in the application — only its prerequisite (`aplicarDelta`,
the stock-write primitive) and the audit-ready `movimientos` ledger exist, built by #5/#6 with
`tipo: 'venta'` and `venta_id` already reserved and unused. Without this slice, a shop's actual
revenue-producing transaction — a cashier selling several items for one or more payments — cannot
be recorded through the system at all, and four downstream backlog items (#8 receipt, #9
anulación, #10 alerts, #12 reports) are blocked because they all depend on a `Venta` existing.

## Product Decisions (settled 2026-08-31, do not reopen)

| # | Decision | Reasoning |
|---|---|---|
| PD-1 | One `Venta` may carry several `Pago` rows (1:N at schema level). Validation becomes `SUM(pagos.monto) >= venta.total`. | Owner chose split cash+card explicitly, against a one-payment recommendation. |
| PD-2 | `vuelto` lives on the cash payment row only; a non-cash `Pago` can never carry `vuelto > 0`. Enforced by a CHECK, structurally identical to #6's `movimientos_merma_solo_salida`. With no cash payment, the sum must equal the total exactly. | Change must be traceable to which payment produced it; the application must not be trusted to remember. |
| PD-3 | The cart merges duplicate product lines (one line per product, quantity accumulates). | Removes a trap: duplicate `producto_id` lines would otherwise need pre-merging before the deterministic `producto_id`-order confirmation loop (ADR-0005). |
| PD-4 | Mobile POS is out of scope; deferred to a future backlog item. | `docs/design.md:95` marks it "pendiente de diseño" — no layout exists to build against. |
| PD-5 | `precio_unitario` is always re-read from `productos.precio` at confirmation, never trusted from the client cart; a mismatch with what the cashier saw is surfaced before the sale closes. | The cart persists in `localStorage` and can sit open a long time; server price must win. |
| PD-6 | A price mismatch requires an **explicit re-confirmation** by the cashier; the sale does not close on the notice alone. | The cashier has already said a total out loud to the customer. A notice that can be missed is not a notice — the discrepancy would otherwise surface at cash-up. |
| PD-7 | Any combination of payment media is allowed, but **at most one `Pago` row per medio** — two cash amounts are summed into one row. | Not tidiness: PD-2 puts `vuelto` on the cash row, and with two cash rows there would be no way to say which one carries it. One row per medio makes that rule unambiguous. |
| PD-8 | The POS catalog **excludes inactive products entirely**, and **shows zero-stock products without allowing them to be added**. | An inactive product is refused by `aplicarDelta` anyway, so showing it only buys a failed attempt. A zero-stock product must stay visible so the cashier can tell the customer it exists but is out, rather than searching and never finding it. |
| PD-9 | An explicit "empty cart" action is in scope. | Not a new decision — `docs/TECH-DESIGNv2.md:41-42` already states the cart clears "al confirmar la venta o al vaciarlo explícitamente", from the S9 resolution in `docs/REVISION-ADVERSARIAL.md:255-269`. Recorded here so a later phase does not re-ask it. |

### Second round (settled 2026-08-31, post-design — `design.md`'s "PRODUCT MUST DECIDE" section)

`sdd-design` correctly flagged these instead of resolving them silently, per this project's rule.
`sdd-spec` independently flagged PD-11's underlying question too. Settled here, binding like PD-1..PD-9.

| # | Decision | Reasoning |
|---|---|---|
| PD-10 | Non-cash overpayment is refused: `Σ(pagos where medio ≠ efectivo) ≤ venta.total` is enforced before the sale closes. | Cash change is legitimate because a customer hands over whatever bills they have; a card amount is typed by the cashier with full precision, so one that exceeds the total has no legitimate business explanation. Letting it through would compute `vuelto` from cash the register never received. |
| PD-11 | `confirmarVenta` refuses a request whose items contain a duplicate `producto_id` (`DUPLICATE_SALE_ITEM`); it never merges server-side. | The UI cart already merges duplicates (PD-3) before submitting. A duplicate reaching the backend means the UI was bypassed or has a bug — merging it away would hide that instead of surfacing it. Confirms `design.md`'s D13, which reached the same conclusion independently while blind to this question. |
| PD-12 | The POS catalog is ordered alphabetically by `nombre`. | `ProductosRepo.list`'s default (`creadoEn desc`) fits an admin list, not a cashier scanning a grid for one item by name. |
| PD-13 | The cart blocks adding or editing a line beyond the catalog's `stockActual` and shows a "sin stock disponible" message at that point. | Best-effort UX guard, not a second source of truth: `stockActual` is a snapshot from when the catalog loaded and can be stale. The server confirmation (`aplicarDelta`) remains the sole authority — unchanged from PD-5/PD-8. |
| PD-14 | The `localStorage` cart expires after 4 hours of inactivity (elapsed since its last write); an expired cart is discarded exactly like a corrupt one — emptied, key removed, no throw. | Overrides `design.md` D14's provisional "no expiry" stance. Prevents a cart left over from a previous shift or day from silently reappearing. |

## Scope

**In scope**: `ventas`/`items_venta`/`pagos` schema, `numero_correlativo` sequence, `confirmarVenta`
service (sorts cart by `producto_id`, loops `aplicarDelta` + `movimientos.create` per item inside
one `uow.run`, per PD-1..PD-5), `POST /api/ventas` (`roles: ['encargado','deposito']`), a
`localStorage`-backed cart (first of its kind in this codebase), and a two-pane POS screen
(catalog + fixed cart, `1.2fr | 460px` per `design.md:93`).

**Out of scope**: mobile POS (PD-4), anulación (#9), recibo/print (#8), stock alerts (#10),
reports (#12), barcode scanning (`docs/PRD.md:141-142`).

## Capabilities

### New Capabilities
- `point-of-sale`: backend — `ventas`/`items_venta`/`pagos` schema, `confirmarVenta` transaction,
  payment validation, `numero_correlativo`.
- `pos-ui`: frontend — catalog browsing, `localStorage` cart, payment step, POS route.

### Modified Capabilities
None. `inventory-movements` needs zero interface change — `MovimientosRepo.create()` already
accepts `tipo: 'venta'` and `ventaId` (built anticipating this change). `product-management` is
read-only consumed, not modified.

## Approach

Mirror `registrarMovimiento`'s per-item shape (`aplicarDelta` → classify-on-`undefined` →
`movimientos.create`), called N times in one `uow.run`, items pre-sorted by `producto_id` to avoid
deadlock 40P01 (ADR-0005). Tradeoff: the venta service re-derives that classification loop rather
than composing `registrarMovimiento` itself, because widening that function's transaction contract
was explicitly forbidden by #6 (D2) and would risk destabilizing shipped code outside this cycle.

## Open Questions (deferred to spec/design, not resolved here)

1. **Money arithmetic**: SQL aggregation (exact, no dependency) vs. JS arithmetic (needs a decimal
   library — none exists in either workspace today). Correctness fork, not a style choice.
2. **`movimientos.ventaId` FK and its `onDelete` policy.**
3. Whether `Venta` needs a fourth `auditoria/fields.ts` `FIELD_CLASSIFICATION` key.
4. POS catalog query shape — reuse `productos/repository.ts:89-115`'s `list(page, pageSize, q)` or
   a different shape.
5. Payment-validation wire error codes (missing `medio`, sum below total), mirroring #6's
   RECONCILE-1.

## Affected Areas

| Area | Impact |
|---|---|
| `apps/api/src/db/schema.ts` | New tables + sequence + FK (open Q2) |
| `apps/api/src/ventas/{repository,service}.ts` | New |
| `apps/api/src/routes/ventas.ts` | New |
| `apps/api/src/lib/errors.ts` | New payment-validation factories |
| `apps/api/src/plugins/repos.ts` | Add `ventas: VentasRepo` |
| `apps/web/src/features/pos/*`, `apps/web/src/routes/pos.tsx` | New |

## Size Estimate

**~4000–5500 raw diff lines across 12–16 chained slices.** Recorded as a number rather than a
label, because every budget overrun in this project came from measuring only the part being
thought about.

The anchor is #6 (`movimientos-inventario`), which forecast ~2870 raw lines across 9 slices and
delivered in 9. #6 is a **strict subset** of this pattern — one item per transaction rather than
N, and zero new tables. On top of that baseline #7 adds three tables, a Postgres sequence, a new
repository/service/route layer, payment validation with 1:N payments (PD-1), the project's first
`localStorage` persistence, and a two-pane screen with no wireframe.

Against this session's `review_budget_lines: 800`, no single slice should approach the ceiling;
it is the chain total that requires slicing. Expect `sdd-tasks` to report
`Chained PRs recommended: Yes` and `Decision needed before apply: Yes`.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Largest change in project history — ~4000–5500 lines / 12–16 slices, against #6's ~2870/9 | High | Chained/stacked PRs at `sdd-tasks`; see Size Estimate above |
| Deadlock mitigation silently broken by a future path that loops in click order instead of `producto_id` order | Medium | Document the invariant explicitly in design/tasks; needs a concurrency test |
| Money arithmetic done in JS with `Number()` on `NUMERIC` strings | Medium | Resolve as open Q1 at design time, before code exists |
| First-ever `localStorage` persistence: no serialization/versioning convention; a stale stored shape from an older release could crash the POS on load | Medium | Needs its own resilience design in `sdd-design` |
| No wireframe for POS internals (item rows, qty controls, payment selector) | Medium | Tokens-only invention, same situation #6's modal faced |

## Rollback Plan

Additive-only: new tables, new sequence, new routes, new frontend feature folder. No existing
route, table, or repository is modified except `repos.ts`'s wiring and `schema.ts`'s FK addition.
Revert the migration and the new files/folders; no shipped behavior changes.

## Dependencies

- Backlog #6 (`movimientos-inventario`), archived — `aplicarDelta`, `MovimientosRepo`, and the
  `venta`/`anulacion` enum values already exist and are reused unmodified.

## Success Criteria

- [ ] A cashier (encargado or deposito) can build a cart, confirm a sale with one or more payments, and stock decrements atomically per item.
- [ ] Insufficient stock on any item rolls back the whole sale; no partial stock change persists.
- [ ] `SUM(pagos.monto) >= venta.total`; `vuelto` only ever appears on a cash payment row, enforced by a database CHECK.
- [ ] `precio_unitario` is always the server's current price at confirmation, never the client's cached value.
- [ ] The cart survives reload/tab close and is not shared across devices.
