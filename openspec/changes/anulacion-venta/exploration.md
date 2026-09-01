# Exploration: anulacion-venta (backlog #9)

**Date**: 2026-08-31
**Change**: `anulacion-venta`
**Artifact store**: hybrid — this file plus Engram topic `sdd/anulacion-venta/explore`
**Phase**: explore (no code written, no source file modified)

> Persistence note: the `sdd-explore` agent has no Write/Edit tool (read-only by design). This
> file was materialized by the orchestrator from the agent's report, verbatim.

## Backlog description

`docs/BACKLOG.md:44` — "Anulación de venta | Solo encargado; movimientos tipo `anulacion`
(positivos, exentos de `activo = true` — A8); `Pago.estado → revertido` (revierte caja); marca de
anulada con usuario/fecha/motivo; solo anulación total en v1 | Depende de #7"

## Current State

- `apps/api/src/db/schema.ts:261` — `ventaEstado` enum (`confirmada`/`anulada`) exists since #7
  (D10). `ventas` has NO `anulada_por`/`anulada_en`/`motivo_anulacion` columns yet — the schema
  comment at `schema.ts:297` says verbatim: "deferred to backlog #9; only the state column ships
  now."
- `apps/api/src/db/schema.ts:153-159, 230-238` — `movimientoTipo` enum already has `'anulacion'`,
  and the `movimientos_signo_tipo` CHECK already enforces `anulacion > 0`. Zero schema changes
  needed here — built during #7 specifically to unblock #9.
- `apps/api/src/db/schema.ts:263, 348-372` — `pagoEstado` enum (`registrado`/`revertido`) exists
  since #7. Nothing transitions it today.
- `apps/api/src/ventas/repository.ts` — `VentasRepo` only has `create`, `createItems`,
  `createPagos`, `findById`, `findByNumeroCorrelativo`, `findItems`, `findPagos`. No update/anular
  method exists.
- `apps/api/src/ventas/service.ts` — `confirmarVenta` always creates `estado: 'confirmada'`;
  `getRecibo` is read-only. No anulación logic exists.
- `apps/api/src/productos/repository.ts:229-242` — `aplicarDelta(id, delta)` is the **only** seam
  that mutates `stock_actual`, and its conditional UPDATE unconditionally requires `activo = true`.
  This is the real A8 blocker: reused as-is, it would no-op on a since-deactivated product and
  reject the whole anulación. A8's exemption lives at the schema level (CHECK) but not yet in code.
- `docs/REVISION-ADVERSARIAL.md:123-140` — A8 in full: reversal movements are exempt from
  `activo=true` (and `stock >= :n`, moot since positive) "because the reversal of a past operation
  is not a new business movement." Resolved 2026-08-13.
- `apps/api/src/plugins/auth.ts` + 4 other route files — `config: { roles: [...] }` default-deny
  RBAC pattern is well precedented. `routes/ventas.ts` currently has every route open to
  `['encargado','deposito']` — anulación is the first encargado-only route in this file.
- `docs/PRD.md:46, 69-71` — settled: anular/devolver is encargado-only ("operación sensible: afecta
  stock, caja y comprobantes").
- `docs/TECH-DESIGNv2.md:297-312` — full "Anulación / devolución de venta" acceptance criteria
  already settled: encargado-only, `anulacion` movements, venta marked `anulada` with
  usuario/fecha/motivo, A8 exemption, `Pago.estado -> revertido` (there is no caja/cierre-de-caja
  table anywhere — "revierte caja" is purely conceptual, meaning `pagos.estado`), recibo inherits
  estado, v1 total-only anulación.
- `openspec/changes/archive/2026-08-31-recibo-interno/design.md:238-252` — PROD-F explicitly
  deferred to #9. Backend already returns every `pagos` row unfiltered, so #9 needs no backend
  change for the receipt to reflect `revertido`.
- `apps/web/src/features/recibo/Recibo.tsx` — renders `venta.estado` as plain text (no visual
  flag), but **never renders `pago.estado` at all** — a `revertido` payment row today renders
  identically to a `registrado` one. The venta-level "Estado: anulada" text is the only visible
  signal. Worth flagging explicitly rather than assuming this is sufficient.
- `apps/api/src/movimientos/repository.ts:34-41` — `MovimientosRepo.create` already accepts
  `tipo`/`ventaId`; no repository change needed, only new call sites with `tipo: 'anulacion'`.
- `apps/api/src/lib/errors.ts` — has `saleNotFound` (404) but no "already anulada" conflict code.

## Sidebar "Movimientos" entry — status check (orchestrator note, from a live conversation turn)

`apps/web/src/components/ui/AppShell.tsx:15-22`'s `NAV_ITEMS` already reserves a "Movimientos"
label (matches the product's intended sidebar mockup), but it has no `to:` — same
destination-less-placeholder pattern as "Panel general" and "Punto de venta" (the latter despite
`/pos` existing — the nav was simply never wired to it). `shellLayout.tsx` mounts `AppShell` once
around `<Outlet/>`; `encargadoLayout` nests under it rather than rendering its own shell, so this
exact sidebar renders identically on every screen for both roles. No route or screen for
"movimientos" (a stock-movement history) exists anywhere in `apps/web` today — confirmed by a
direct search, zero files. This is directly relevant to Open Question 3 below.

## Affected Areas

- `apps/api/src/db/schema.ts` — add `anuladaPor` (FK usuarios, restrict, nullable), `anuladaEn`,
  `motivoAnulacion` to `ventas`, likely with a CHECK tying them to `estado='anulada'` (mirrors
  `pagos_vuelto_solo_efectivo`/`auditoria_datos_previos_solo_en_crear`). New migration.
- `apps/api/src/ventas/repository.ts` — new conditional-UPDATE method for `confirmada -> anulada`
  (same double-anulación/race guard idiom as `aplicarDelta`'s negative-stock guard) + a bulk
  pagos-revert method.
- `apps/api/src/productos/repository.ts` — new method mirroring `aplicarDelta` but exempt from
  `activo = true` (A8).
- `apps/api/src/ventas/service.ts` — new `anularVenta`, mirroring `confirmarVenta`'s one-`uow.run`
  structure.
- `apps/api/src/routes/ventas.ts` — new encargado-only route.
- `apps/api/src/lib/errors.ts` — new state-conflict error code.
- `apps/web/src/features/recibo/Recibo.tsx` — likely no change; needs explicit owner sign-off
  (Open Question 6).

## Approaches

1. **Dedicated narrow repo method for the A8-exempt stock reversal + conditional-UPDATE `VentasRepo`
   transition, one `uow.run`** — mirrors `confirmarVenta` and the codebase's "narrow port, one seam
   per concern" convention exactly.
   - Pros: matches every existing precedent (ADR-0005 conditional-UPDATE idiom, narrow-port idiom,
     CLAUDE.md's "every write goes through UnitOfWork"); keeps `aplicarDelta`'s `activo=true`
     invariant intact for every other caller; double-anulación race closed the same proven way as
     negative-stock races.
   - Cons: one more method on `ProductosRepo`'s surface.
   - Effort: Medium.
2. **Parameterize `aplicarDelta` with an `opts.ignorarActivo` flag instead of a new method.**
   - Pros: no new method name.
   - Cons: directly contradicts this codebase's own anti-backdoor convention; makes the exact
     invariant A8 protects silently bypassable from any future caller.
   - Effort: Low, higher long-term risk.
3. **Two separate transactions instead of one atomic UoW.** Rejected — violates CLAUDE.md's "every
   write goes through UnitOfWork" and `confirmarVenta`'s own all-or-nothing precedent. Listed only
   to rule out.

## Recommendation

Approach 1 — same reasoning #7/#8 used every time a shortcut would have bypassed an existing
invariant instead of extending it narrowly.

## Risks

- Neon migration must be applied manually before trusting the route in production (same pattern as
  #6/#7's manual-migration precedent).
- Whether a `revertido` pago needs any visible marker on the printed recibo is a live product
  question, not a closed one, despite PROD-F saying "no backend change."
- No UI entry point for anulación exists anywhere in `apps/web` today, and the backlog line (unlike
  #8's) names no UI route — whether #9 ships UI or is backend-only (fast-follow pattern, like
  #3/#3.1) is unresolved. The sidebar "Movimientos" placeholder is a separate, still-unbuilt screen
  (stock-movement history) — not the same thing as an anulación action UI, and not this cycle's job
  unless the owner decides otherwise.

## Open Questions (for the product owner, before proposal)

1. Is `motivo_anulacion` mandatory or optional?
2. Is there a time limit on anulación after confirmation, or unlimited in v1?
3. Does #9 ship a UI, or is it backend-only this cycle (fast-follow later, like #3/#3.1)?
4. Does `numero_correlativo` stay fixed on an anulada venta?
5. Route shape: `POST /api/ventas/:id/anular` (action-style) vs `PATCH /api/ventas/:id`
   (resource-style, matching other domains)?
6. Does a `revertido` pago need a visible marker on the printed recibo, or does the existing
   venta-level "Estado: anulada" plain text suffice?

## Ready for Proposal

Yes — data model, RBAC pattern, A8 exemption rule, and full acceptance criteria are already
settled in TECH-DESIGNv2.md/PRD.md/REVISION-ADVERSARIAL.md. The six open questions above are
narrow product-decision gaps (PD-style), not architectural unknowns.

## Key Learnings

1. `aplicarDelta` (productos/repository.ts:229) unconditionally requires `activo = true`, so A8's
   exemption is unbuilt in code, not just schema — real work for #9.
2. The `movimientos` table and CHECKs are already 100% ready for `tipo = 'anulacion'` since #7 —
   zero schema changes needed there.
3. `Recibo.tsx` never renders `pago.estado` at all, so PROD-F's "no backend change needed" claim
   holds for the backend but leaves an open frontend product question.
4. `ventas.anulada_por`/`anulada_en`/`motivo_anulacion` were explicitly deferred to backlog #9 in a
   schema.ts comment written during #7.
5. No route in `routes/ventas.ts` is encargado-only today; #9 is the first, but the RBAC pattern is
   well precedented in four other route files.
6. The sidebar's "Movimientos" nav entry is a pre-existing destination-less placeholder (same
   pattern as "Panel general"/"Punto de venta"), not evidence that a movements screen is scoped
   into this cycle.
