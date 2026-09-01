# Proposal: Recibo Interno (Backlog #8)

## Intent

Today a cashier who confirms a sale in the POS gets nothing back — `useConfirmarVenta`
(`apps/web/src/features/pos/useConfirmarVenta.ts:29-43`) discards the `POST /api/ventas` response
after clearing the cart, and no route, screen, or endpoint anywhere lets anyone look up a past
sale. `docs/BACKLOG.md:43` requires a receipt "imprimible/descargable en cualquier momento" —
without this slice, the shop has no way to hand a customer proof of a sale or for a cashier to
recheck what was sold, and backlog #9 (anulación) and #12 (reportes) both benefit from the same
read path this item establishes first.

## Product Decisions (settled by the owner 2026-08-31, do not reopen)

| # | Decision | Reasoning |
|---|---|---|
| PD-1 | Receipt access is: (a) an immediate post-confirmation success screen in the POS (does not exist today, must be added) with a link/view to the just-confirmed receipt, plus (b) a minimal search-by-`numeroCorrelativo` lookup to revisit old receipts. No full sales-history/list screen ships in this item — that is a future backlog item. | Matches "ver en cualquier momento" without building the sales-browser that #12 (Reportes) or a future history screen would own; keeps this item's scope to exactly what the receipt needs to be reachable. |
| PD-2 | The receipt shows only: items, importe, medio de pago, fecha, cajero, número correlativo, and estado (confirmada/anulada, D10 from #7). It does **not** show store name or address. | No store/config entity exists anywhere in schema, PRD, or TECH-DESIGNv2 (see exploration.md); nothing in `docs/PRD.md:104-106` or `docs/TECH-DESIGNv2.md:160-161` requires it. Inventing a store-config concept for this alone would be scope creep with no other consumer. |
| PD-3 | Dedicated route `/ventas/:id/recibo`, printable via `window.print()` and `@media print` CSS. No modal, no server-side PDF generation. | Same reasoning #7 used to reject a decimal library (`docs/BACKLOG.md:42`, `apps/api` money handling): the receipt has no fiscal validity (`docs/BACKLOG.md:43`), so a heavier dependency (PDF rendering engine) buys generality this item doesn't need. The browser's native "print to PDF" already satisfies "descargable." |
| PD-4 | Receipt access is audit-style: any `encargado` or `deposito` can view any receipt by ID or `numeroCorrelativo`, with no per-cajero restriction. | Matches the existing `productos`/`proveedores` read-route precedent (`roles: ['encargado','deposito']`, any authorized staff reads any record). Owner confirmed 2026-08-31, resolving the proposal's own Q1. |
| PD-5 | The correlativo search shows a single generic not-found message when no venta matches — no distinction between "wrong number" and "number exists but access denied." | Moot access-distinction given PD-4's audit-style access; a generic message is sufficient. Owner confirmed 2026-08-31, resolving Q2. |
| PD-6 | An anulada receipt shows `estado: anulada` as plain text, same field treatment as PD-2's other fields — no banner, no watermark, no visual flag. | Simpler, and #9 (anulación) does not exist yet to validate a heavier treatment against. A visual flag can be added later without a proposal-level decision if it turns out to matter operationally. Owner confirmed 2026-08-31, resolving Q3. |
| PD-7 | The POS post-confirmation success screen requires an explicit action (e.g. a "nueva venta" button) to return to a fresh cart — no auto-dismiss, no timeout. | Consistent with #7's already-established rule that the cart clears only "al confirmar la venta o al vaciarlo explícitamente" (`docs/TECH-DESIGNv2.md:41-42`); an unprompted screen change would be the same category of surprise. Owner confirmed 2026-08-31, resolving Q4. |

### Second round (settled 2026-08-31, post-design — `design.md`'s "Product Decisions Required" table)

`sdd-design` correctly flagged these instead of resolving them silently, per this project's rule.
Settled here, binding like PD-1..PD-7.

| # | Decision | Reasoning |
|---|---|---|
| PD-8 | The receipt ships paper-agnostic for print: no `@page { size }` fixed, margin only. Target is A4/Letter, not a thermal roll. | Owner confirmed the shop prints on A4, not a thermal receipt roll. Matches design's own provisional stance (no `size` set), so no change to D6 is needed. |
| PD-9 | Arriving at `/ventas/:id/recibo` does **not** auto-open the print dialog. An explicit "Imprimir" button triggers `window.print()`. | Owner chose the explicit action over auto-print, consistent with this cycle's broader anti-surprise stance (PD-7). |
| PD-10 | The POS success screen does **not** embed the receipt — it shows a short summary (correlativo + total) with two controls: "Ver recibo" (navigates to `/ventas/:id/recibo`) and "Nueva venta" (clears state, PD-7). | Simpler; keeps PD-7's button where the cashier already is instead of moving it to the receipt route. Matches design's own provisional stance (D5). |
| PD-11 | No new sidebar entry for the correlativo search. It stays reachable only via the POS success screen's link and the receipt route's not-found recovery link — no direct URL memorized otherwise. | `AppShell.NAV_ITEMS`' labels are verbatim from `docs/design.md`'s ratified Sidebar table; adding an entry would amend a ratified document for a low-traffic recovery path. Matches design's own provisional stance. |
| PD-12 | The receipt lists **every** `pagos` row (medio + monto), and shows `vuelto` on the cash row when non-zero — not a single simplified total. | #7 ships multi-payment (PD-1 of that cycle) with `vuelto` living on the cash row; a customer disputing change needs printed proof of what they actually handed over and got back. PD-2's "medio de pago" singular wording described the common case, not a restriction to one row. |

Deliberately deferred, not decided now:

- **PROD-F** (design.md): whether a `revertido` `Pago` row still prints once #9 (anulación) exists.
  `pagos.estado` is returned unfiltered by this cycle's backend regardless (see design.md D2/D7's
  interface), so #9 can decide presentation later with zero backend change here. Not a gap in this
  cycle — a decision that belongs to #9's own cycle, when that write path exists to reason about.

Already settled before this cycle, not reopened here:

- **Anulada state**: a receipt for an anulada venta inherits `Venta.estado` directly — no separate
  field, no new logic (`docs/TECH-DESIGNv2.md:309`, `docs/REVISION-ADVERSARIAL.md` S5, resolved
  2026-08-13).
- **Product-name drift**: `items_venta` stores no product-name snapshot, so the receipt always shows
  the product's *current* `nombre`/precio via the FK, not what it was at sale time. Accepted, not a
  question for this cycle.

## Scope

**In scope**:
- `GET /api/ventas/:id` — venta detail with items (joined to current `productos.nombre`/`precio`),
  pagos, and cajero name (via `UsuariosRepo.findById`), mirroring the
  `GET /api/productos/:id` shape (`apps/api/src/routes/productos.ts:145-163`).
- A lookup by `numeroCorrelativo` to power the search-by-number affordance (exact route/query shape
  is a spec/design decision, see Open Questions).
- Frontend route `/ventas/:id/recibo` with `@media print` CSS.
- A POS post-confirmation success state (first of its kind — today the cart just clears) linking to
  the just-confirmed receipt.
- A minimal "buscar por número correlativo" input reachable from the receipt area.

**Out of scope**: full sales-history/list screen (future item, not #12 which is stock/movement
reporting), server-side PDF generation, any store name/address/config entity, a product-name
snapshot column on `items_venta`, anulación itself (#9 — this item only *displays* whatever
`estado` already holds).

## Capabilities

### New Capabilities
- `recibo-ui`: frontend — printable receipt route, POS post-confirm success state, correlativo
  search input.

### Modified Capabilities
- `point-of-sale` (backend, promoted from #7): adds the first read path (`VentasRepo` is currently
  write-only — `create`, `createItems`, `createPagos` only, no `findById` —
  `apps/api/src/ventas/repository.ts`) and its route. No existing write behavior changes.
- `pos-ui` (promoted from #7): `useConfirmarVenta.ts` stops discarding the confirm response; the
  POS screen gains a success state it does not have today.

## Approach

Read-only addition on top of #7's shipped schema — no migration, no new table, no transaction, no
business-rule validation. Mirrors the existing detail-route precedent
(`GET /api/productos/:id`, `roles: ['encargado','deposito']`) for `GET /api/ventas/:id`, and reuses
`UsuariosRepo.findById` / `ProductosRepo.findById` for the cajero name and item names rather than
duplicating that data. The print surface is plain HTML + CSS; `window.print()` is the only new
browser API surface, no new runtime dependency in either workspace.

## Open Questions (deferred to spec/design, not resolved here)

1. **`numeroCorrelativo` lookup shape**: a query param on `GET /api/ventas` (e.g.
   `?numeroCorrelativo=N`) vs. a dedicated endpoint. Exact-match only (numero correlativo is a
   sequential integer) or does it need partial/prefix matching — assume exact-match unless spec
   finds a reason otherwise.
2. **Where the search input lives**: a lightweight landing at a route like `/ventas/recibo` (search
   box, redirects to `/ventas/:id/recibo` on match) vs. embedding the search directly inside the
   detail route's empty/not-found state. Wire error code for "no venta with that número" (mirrors
   #7's error-factory pattern in `apps/api/src/lib/errors.ts`).
3. **Route guard placement**: `shellLayout` vs. `encargadoLayout` for `/ventas/:id/recibo` — both
   roles confirm sales in #7 (`roles: ['encargado','deposito']`), so the precedent points to
   `shellLayout`, but this is a design-time confirmation, not assumed here.
4. Exact print CSS scope (page size/margins) — no `@media print` precedent exists anywhere in the
   repo to copy from.

## Proposal question round (closed 2026-08-31)

The four proposal-shaping questions originally raised here were answered by the owner the same day
and are now recorded as PD-4..PD-7 above — not defaults ships without confirmation, but settled
decisions. This section is kept only as the historical record of what was asked and why.

1. Who can view a receipt? → PD-4 (audit-style, matches `productos`/`proveedores`).
2. Not-found behavior for the correlativo search? → PD-5 (generic message).
3. Print treatment for an anulada sale? → PD-6 (plain text, no visual flag).
4. Success-screen dismissal? → PD-7 (explicit action, no auto-dismiss).

## Affected Areas

| Area | Impact |
|---|---|
| `apps/api/src/ventas/repository.ts` | New `findById` (and/or `findByNumeroCorrelativo`) read method |
| `apps/api/src/routes/ventas.ts` | New `GET /api/ventas/:id` (+ correlativo lookup, shape TBD at spec) |
| `apps/web/src/routes/` | New route(s) — no `ventasDetalle.tsx`/`recibo.tsx` exists today |
| `apps/web/src/features/pos/useConfirmarVenta.ts` | Stops discarding the confirm response |
| `apps/web/src/routes/pos.tsx` (or equivalent POS screen) | Gains a post-confirmation success state |

## Size Estimate

**~800–1400 raw diff lines across 4–6 slices.** Recorded as a number, not a label, per this
project's own lesson from #7 ("every budget overrun in this project came from measuring only the
part being thought about").

The anchor is #6 (`movimientos-inventario`), the smallest previously-shipped multi-slice change:
~2870 raw lines across 9 slices, and it still carried an atomic conditional UPDATE, mandatory-motivo
validation, `es_discrepancia` marking, and a 3-step modal with no wireframe. Recibo is a strict
subset of even that: **no migration, no new table, no transaction, no new business-rule
validation** — it is a read (one join query, one detail route) plus presentation (one print route,
one CSS surface, one POS success state, one search input). The comparable precedent for
"backend already done, only a read/UI layer is missing" is #4.1 (proveedores maestro-detalle UI,
pure frontend fast-follow) combined with the `GET /api/productos/:id` precedent for the one new
backend endpoint this item needs.

No slice should approach this session's `review_budget_lines` ceiling; `sdd-tasks` should confirm
whether chaining is needed at all, but if it is, it will be short (4–6 slices, not #6/#7's 9–16).

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| First print/export feature in the codebase — no `@media print` convention to reuse | Medium | Resolve print CSS scope at design time (Open Question 4); keep it minimal |
| Search-by-correlativo UX could scope-creep toward a full sales-list screen | Low | PD-1 explicitly excludes a list/history screen; spec/design must not silently expand into one |
| Product-name drift surfaces confusion at print time if a product was renamed after the sale | Low | Already accepted per exploration.md; no mitigation planned this cycle |

## Rollback Plan

Additive-only: one new backend read method + route, new frontend route(s), and a POS screen
addition (post-confirm state). No existing table, migration, write endpoint, or POS confirm
behavior changes — `useConfirmarVenta`'s mutation call is unchanged, only what happens with its
response. Revert the new files/routes; no shipped write path is touched.

## Dependencies

- Backlog #7 (`punto-de-venta`), archived — `ventas`/`items_venta`/`pagos` schema, `estado`
  (D10), and `numeroCorrelativo` already exist and are read unmodified.

## Success Criteria

- [ ] Immediately after confirming a sale in the POS, the cashier sees a success state with a link/view to that sale's receipt.
- [ ] A receipt can be reached later via `/ventas/:id/recibo` and via a search by `numeroCorrelativo`.
- [ ] The receipt shows items, importe, medio de pago, fecha, cajero, número correlativo, and estado — and nothing about the store's name or address.
- [ ] A receipt for an anulada venta visibly shows `estado: anulada`, sourced from `Venta.estado`, no separate field.
- [ ] The receipt route prints cleanly via the browser's native print dialog (`window.print()` + `@media print`), with no new runtime dependency added to either workspace.
