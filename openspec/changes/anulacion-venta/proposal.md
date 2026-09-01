# Proposal: Anulación de Venta (Backlog #9)

## Intent

Today a confirmed sale in InvenTienda cannot be undone through the system. `ventaEstado`
(`confirmada`/`anulada`) and the `movimientos` schema's `anulacion` type/CHECK were already built
during #7 anticipating this item (`apps/api/src/db/schema.ts:261, 153-159, 230-238`), but nothing
transitions a `Venta` out of `confirmada`, no route exists, and `Pago.estado` never moves out of
`registrado`. Without this slice, a mistaken or disputed sale (wrong item, wrong quantity, customer
return) permanently locks in its stock decrement and payment record — the encargado has no
corrective action other than manually adjusting stock outside the audit trail the rest of the
system relies on. `docs/PRD.md:46, 69-71` and `docs/TECH-DESIGNv2.md:297-312` both already treat
this as a sensitive, encargado-only operation because it touches stock, cash, and receipts at once.

## Product Decisions (settled by the owner 2026-08-31, do not reopen)

| # | Decision | Reasoning |
|---|---|---|
| PD-1 | `motivo_anulacion` is **mandatory** — the anulación route refuses a request without it. | Consistent with the PRD's framing of anulación as an "operación sensible": a sale cannot be voided without leaving a real, traceable reason. An optional field would allow anulaciones with no accountability trail, which is exactly what the sensitive-operation framing is meant to prevent. |
| PD-2 | **No time limit** on anulación after confirmation in v1 — an encargado can anular a sale of any age. | `docs/TECH-DESIGNv2.md:297-312`'s acceptance criteria name no temporal window. Inventing one now would be a new, unrequested business rule, not an implementation of something already specified. If operationally needed later, it is a follow-up backlog item with its own product decision. |
| PD-3 | Backend **and** UI ship in the same #9 cycle — not a backend-only slice with a UI fast-follow. | Without a UI entry point, encargados have no way to trigger anulación at all; deferring the UI would ship a feature nobody can use and force an artificial #9.1 cycle just to expose it. Unlike #3/#3.1 (where a UI fast-follow was acceptable), this backlog line names no separate follow-up. |
| PD-4 | `Recibo.tsx` is **not modified** for this cycle — the existing venta-level "Estado: anulada" text is sufficient; no per-`Pago` `revertido` marker is added to the printed receipt. | v1 anulación is total-only (`docs/TECH-DESIGNv2.md:297-312`): every `Pago` on the venta reverts at once, so the venta's own `estado` already communicates everything relevant. A per-row marker would only add information if a partial anulación existed, which it does not in v1. This resolves PROD-F, which `recibo-interno`'s design.md explicitly deferred to this cycle. |
| PD-5 | `numero_correlativo` stays **fixed** on an anulada venta — it is never reassigned, reused, or changed by anulación. | It is the stable audit identifier for the sale, established at confirmation time (#7). The existing correlativo design already documents gaps as expected and traceable rather than something to be closed by renumbering; anulación must not retroactively rewrite the sequence's meaning. Documented explicitly here (a minor technical decision) rather than left implicit, per this project's convention of writing every settled decision down as a PD. |

## Scope

**In scope**:
- Migration adding `anulada_por` (FK `usuarios`, `ON DELETE RESTRICT`, nullable), `anulada_en`, and
  `motivo_anulacion` to `ventas`, plus a CHECK tying their presence to `estado = 'anulada'` (mirrors
  the existing `pagos_vuelto_solo_efectivo`/`auditoria_datos_previos_solo_en_crear` idiom).
- A new `ProductosRepo` method mirroring `aplicarDelta` but exempt from the `activo = true` guard
  (A8 — reversal of a past operation is not a new business movement), used only for anulación.
- A new `VentasRepo` conditional-UPDATE method transitioning `confirmada -> anulada` (same
  double-write/race guard idiom as `aplicarDelta`'s negative-stock guard) plus a bulk `pagos`
  revert (`registrado -> revertido`).
- `ventas/service.ts`'s `anularVenta`, one `uow.run` mirroring `confirmarVenta`'s structure:
  reverse every item's stock via the new A8-exempt method, create one `movimientos` row per item
  with `tipo: 'anulacion'`, revert every `pagos` row, and mark the venta anulada with
  usuario/fecha/motivo — all-or-nothing.
- A new encargado-only route in `routes/ventas.ts` (`config: { roles: ['encargado'] }` — the first
  encargado-only route in this file). Exact route shape (action-style `POST .../anular` vs.
  resource-style `PATCH`) is left to `design.md`.
- A new "already anulada" conflict error code in `apps/api/src/lib/errors.ts`.
- A UI entry point for triggering anulación (per PD-3), reachable from an existing screen (likely
  the receipt/venta detail view or the POS) — exact placement is a design-time decision, not
  resolved here. This does **not** include a movements-history screen (see Scope boundary below).

**Out of scope**:
- Any stock-movement history screen. The sidebar's "Movimientos" entry (`AppShell.tsx:15-22`) is a
  pre-existing destination-less placeholder — same pattern as "Panel general"/"Punto de venta" —
  and is not wired to anything by this cycle. #9 ships only the anulación *action*, not a history
  browser.
- Partial anulación — v1 is total-only, per `docs/TECH-DESIGNv2.md:297-312`; every item and every
  `Pago` on the venta reverts together.
- Any time-limit enforcement on when a sale can be anulada (PD-2).
- Any change to `Recibo.tsx` or `recibo-ui`'s per-payment rendering (PD-4).
- Any cierre-de-caja / cash-register table — "revierte caja" remains purely conceptual, meaning
  `pagos.estado` only, as already settled in exploration.

## Capabilities

### Modified Capabilities
- `point-of-sale` (backend): adds the anulación write path — schema columns, the A8-exempt stock
  reversal, the `confirmada -> anulada` transition, the bulk `pagos` revert, the service method, and
  the new route. No existing `confirmarVenta`/read behavior changes.
- `pos-ui` and/or `recibo-ui` (frontend): adds the anulación UI entry point. Which capability owns
  it depends on where design places the action (POS screen vs. receipt/venta-detail screen) — not
  resolved here.

### New Capabilities
None expected — this extends the write side of `point-of-sale` and adds a UI affordance to an
existing frontend capability rather than introducing a new domain concept.

## Approach

Approach 1 from `exploration.md`: a dedicated, narrow `ProductosRepo` method for the A8-exempt
stock reversal, plus a conditional-UPDATE `VentasRepo` transition, both inside one `uow.run` —
mirroring `confirmarVenta`'s structure and this codebase's "narrow port, one seam per concern"
convention exactly. Rejected alternatives: parameterizing `aplicarDelta` with an
`opts.ignorarActivo` flag (contradicts the project's anti-backdoor convention — makes the exact
invariant A8 protects silently bypassable by any future caller), and splitting the transaction into
two non-atomic writes (violates CLAUDE.md's "every write goes through UnitOfWork" and
`confirmarVenta`'s own all-or-nothing precedent).

## Affected Areas

| Area | Impact |
|---|---|
| `apps/api/src/db/schema.ts` | New columns + CHECK on `ventas`; migration |
| `apps/api/src/productos/repository.ts` | New A8-exempt stock-reversal method |
| `apps/api/src/ventas/repository.ts` | New `confirmada -> anulada` conditional-UPDATE + bulk pagos-revert method |
| `apps/api/src/ventas/service.ts` | New `anularVenta` |
| `apps/api/src/routes/ventas.ts` | New encargado-only route (shape deferred to design) |
| `apps/api/src/lib/errors.ts` | New "already anulada" conflict error code |
| `apps/web/src/features/pos/` and/or `apps/web/src/features/recibo/` | New anulación UI entry point (exact location deferred to design) |
| `apps/web/src/features/recibo/Recibo.tsx` | Unchanged — PD-4 |

## Size Estimate

**~1500–2500 raw diff lines across 4–6 slices.** Recorded as a number, not a label, per this
project's own lesson from #7 ("every budget overrun in this project came from measuring only the
part being thought about").

Smaller than #8 (`recibo-interno`, ~800–1400 lines): #8 was read-only with zero schema/transaction
work. #9 adds a migration, a new CHECK, a new A8-exempt repository method, a new atomic
multi-step transaction (mirroring `confirmarVenta`'s per-item loop), a new RBAC-gated route, and a
UI entry point — but it builds no new screen, no new table, and reuses `MovimientosRepo.create`
and the RBAC pattern unmodified. Meaningfully smaller than #7 (`punto-de-venta`, ~4000–5500 lines,
12–16 slices): #7 introduced three new tables, a sequence, and a two-pane screen with no
wireframe; #9 introduces zero new tables and a single small UI affordance on an existing screen.

No slice should approach this session's `review_budget_lines` ceiling; `sdd-tasks` should confirm
whether chaining is needed, but if so it will be short.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Neon migration must be applied manually before the route works in production (same pattern as #6/#7) | Medium | Document as a manual deployment step, same as prior cycles |
| Double-anulación / concurrent-anulación race on the same venta | Medium | Conditional-UPDATE guard on `estado = 'confirmada'`, same proven idiom as `aplicarDelta`'s negative-stock guard |
| A8-exempt reversal path accidentally reused by a future unrelated caller, silently bypassing `activo = true` | Low | Dedicated, narrowly-named method (Approach 1) rather than a flag on `aplicarDelta` |
| UI entry-point placement (POS vs. receipt/venta-detail) chosen at design time could conflict with an unstated product expectation | Low | `design.md` must flag this explicitly rather than resolve it silently, per this project's spec/design rule |

## Rollback Plan

Additive-only: new columns + CHECK on `ventas` (migration), one new repository method per domain,
one new service method, one new route, one new error code, and one new UI entry point. No existing
`confirmarVenta` write path, table, or route is modified. Revert the migration and the new
files/methods; no shipped write behavior changes.

## Dependencies

- Backlog #7 (`punto-de-venta`), archived — `ventas`/`items_venta`/`pagos` schema, `ventaEstado`,
  `pagoEstado`, and the RBAC pattern already exist and are extended, not modified.
- Backlog #6 (`movimientos-inventario`), archived — `movimientoTipo = 'anulacion'` and its CHECK
  (`movimientos_signo_tipo`) already exist, built anticipating this cycle; zero schema change needed
  there.
- Backlog #8 (`recibo-interno`), archived — the receipt already renders `venta.estado` and returns
  every `pagos` row unfiltered; PD-4 relies on this being already true.

## Success Criteria

- [ ] An encargado can anular a `confirmada` venta, providing a mandatory `motivo_anulacion`; a `deposito` user is refused with a 403.
- [ ] Anulación is atomic: every item's stock reverts (even for a now-`activo = false` product, per A8), every `pagos` row moves to `revertido`, and the venta is marked `anulada` with usuario/fecha/motivo — or none of it happens.
- [ ] A `movimientos` row with `tipo: 'anulacion'` is created per item, positive quantity, exempt from the `activo = true`/stock guards that apply to other movement types.
- [ ] Attempting to anular an already-`anulada` venta is refused with a clear conflict error, not a silent no-op or a duplicate reversal.
- [ ] `numero_correlativo` on the anulada venta is unchanged from before anulación.
- [ ] The receipt for an anulada venta continues to show `estado: anulada` with no other visual change (PD-4); `Recibo.tsx` is untouched.
- [ ] An encargado can trigger anulación from the UI without needing direct API access; no anulación UI is reachable by a `deposito` user.
