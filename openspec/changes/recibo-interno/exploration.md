# Exploration: recibo-interno (backlog #8)

**Date**: 2026-08-31
**Change**: `recibo-interno`
**Artifact store**: hybrid — this file plus Engram topic `sdd/recibo-interno/explore`
**Phase**: explore (no code written, no source file modified)

> Persistence note: the `sdd-explore` agent has no Write/Edit tool (read-only by design), same
> constraint already hit during `punto-de-venta`'s own exploration. This file was materialized by
> the orchestrator from the agent's report, verbatim.

## Backlog description

`docs/BACKLOG.md:43` — "Recibo interno | Documento derivado on-demand de Venta+ItemVenta+Pago (sin
tabla propia); imprimible/descargable en cualquier momento; hereda el estado `anulada`; sin validez
fiscal | Depende de #7"

## Current State

Backlog #7 (`punto-de-venta`) is archived. Tables `ventas` / `items_venta` / `pagos` exist in
`apps/api/src/db/schema.ts:287-372` with everything the PRD asks a receipt to show:

- `ventas`: id, numeroCorrelativo, usuarioId (cajero), estado (`confirmada`|`anulada`, D10 — ships
  now; `anulada_por`/`anulada_en`/`motivo_anulacion` deferred to #9), total, creadoEn.
- `items_venta`: productoId, cantidad, precioUnitario, subtotal — **no product name/SKU snapshot**,
  only the FK.
- `pagos`: medio, monto, vuelto, estado (`registrado`|`revertido`).

`VentasRepo` (`apps/api/src/ventas/repository.ts`) is write-only today: `create`, `createItems`,
`createPagos`. No read method exists. `apps/api/src/routes/ventas.ts` only has `POST /api/ventas`
and `GET /api/ventas/catalogo` — **there is no `GET /api/ventas/:id` or any sales-list endpoint**.
`UsuariosRepo.findById(id)` (`apps/api/src/usuarios/repository.ts:63,195`) already returns
`UsuarioResumen` with `nombre`, so the cajero's name is one extra read away, not a schema change.
`ProductosRepo.findById` gives item name/SKU the same way — but since `items_venta` stores no name
snapshot, a receipt always shows the product's **current** `nombre`, not what it was called at sale
time.

No web route/screen anywhere lists or looks up past sales (`apps/web/src/routes/` has no
`ventas*.tsx`, only `pos.tsx`). `useConfirmarVenta`
(`apps/web/src/features/pos/useConfirmarVenta.ts:29-43`) discards the `POST /api/ventas` response
after clearing the cart — nothing about the just-confirmed sale is retained or displayed today.

Zero PDF/print dependencies exist in `apps/api/package.json` or `apps/web/package.json`; a
repo-wide grep for `pdf|print|jspdf|puppeteer|react-pdf|window.print` found nothing. This would be
the codebase's first print/export feature — same category as #7's "first ever `localStorage`
persistence."

No `tienda`/store-config entity exists anywhere in schema, PRD, or TECH-DESIGNv2. The receipt
fields the PRD actually requires (`docs/PRD.md:104-106`, `docs/TECH-DESIGNv2.md:160-161`) are:
items, importe, medio de pago, fecha, cajero, número correlativo — **store name/address is not in
that list**.

## "Anulada" state — already a settled product decision, not open

`docs/TECH-DESIGNv2.md:309` and `docs/REVISION-ADVERSARIAL.md` (S5, resolved 2026-08-13) state
verbatim: *"El recibo derivado de una venta anulada refleja el estado anulada (hereda de
Venta.estado, no requiere un campo propio), conservando la traza."* This is already binding, not a
question for the owner. `ventas.estado` already ships from #7 (D10), so recibo must read and
display it — even though #9 (anulación) hasn't been built yet, no code path should assume `estado`
is always `confirmada`.

## Affected Areas

- `apps/api/src/ventas/repository.ts` — needs a new read method (e.g. `findById` returning venta +
  items + pagos, likely joined against `productos`/`usuarios`)
- `apps/api/src/routes/ventas.ts` — needs a new `GET /api/ventas/:id`, mirroring
  `routes/productos.ts:145-163`'s detail-route shape (`roles: ['encargado','deposito']`, `idParams`)
- `apps/web/src/routes/` — needs a new route (no `ventasDetalle.tsx`/`recibo.tsx` exists), likely
  under `shellLayout` (not `encargadoLayout`) since both roles can confirm and presumably view sales
- `apps/web/src/features/pos/useConfirmarVenta.ts` — currently discards the confirm response; a
  post-confirm success/receipt affordance would need to change this

## Approaches

1. **HTML + `window.print()` (CSS `@media print`), backed by a new `GET /api/ventas/:id`** — Pros:
   zero new dependencies, matches the `GET /api/productos/:id` precedent exactly, "descargable"
   satisfied by the browser's native print-to-PDF, smallest diff. Cons: print styling has no
   precedent in this codebase. Effort: Low.
2. **Server-side PDF generation** — Pros: a real byte-stable downloadable file. Cons: first runtime
   dependency of this kind, meaningfully larger surface (rendering engine or PDF layout library,
   deploy-size/cold-start cost on Render's free tier), disproportionate to a document explicitly
   "sin validez fiscal". Effort: High.
3. **Both, staged** — print stylesheet now, PDF generation only if a real requirement for a
   byte-stable file appears later (mirrors how #7 deliberately kept `dinero.ts` small rather than
   adding a decimal library). Effort: Low now, deferred cost later.

## Recommendation

Approach 1 (HTML + `window.print()`) — same reasoning #7 used to reject a decimal library: the
heavier dependency buys generality this backlog item doesn't need.

## Risks

- No sales-history/list screen exists anywhere in the current backlog (see open question 1) —
  recibo may need to invent minimal navigation of its own, which risks scope creep into "sales
  list" territory that isn't this item's job.
- Product-name drift: a receipt always reflects the product's current name, not the name at sale
  time (no snapshot column exists).
- First print/export feature in the codebase — no established `@media print` or download
  convention to reuse.

## Open Questions (for the product owner, before proposal)

1. **How is a past sale reached "at any time" with no sales-list/history screen anywhere in the
   backlog?** #12 (Reportes) is stock/movement reporting, not an itemized sales browser. Options:
   (a) only surface "ver/imprimir recibo" right after a successful `POST /api/ventas`, with
   `/ventas/:id/recibo` existing for direct linking but no in-app browse path; (b) (a) plus a
   minimal "buscar venta por número" input; (c) defer any old-sale lookup UI entirely until a
   future item builds sales history.
2. **Does the receipt need store name/address at all?** Nothing in PRD/TECH-DESIGNv2 requires it,
   and no config entity exists to source it from. If yes: hardcoded literal for v1, or does this
   warrant its own (out-of-scope-sounding) config concept? Note: `.env*` files cannot be touched by
   the agent, so an env var would have to be a manual step, not something wired up automatically.
3. **Route/UI shape**: dedicated route (`/ventas/:id/recibo`), a modal from the POS success state,
   or both? `pos-ui` has no post-confirmation success state today (the cart just clears) — recibo
   would be the first thing to add one.
4. **Product-name drift** (see Risks): acceptable that a receipt shows the product's current name
   rather than a sale-time snapshot? Defaults to "acceptable" unless flagged otherwise.

## Ready for Proposal

Yes, once the owner answers questions 1–3 above (question 4 can default to "acceptable" unless
flagged otherwise). No architectural blocker exists — #7 already shipped every column recibo needs
to read; the gap is entirely in the read/UI layer, not the schema.

## Key Learnings

1. `docs/TECH-DESIGNv2.md:309` and `REVISION-ADVERSARIAL.md` S5 already settle that a receipt for
   an anulada venta must show that state — this was not an open question, contrary to initial
   framing.
2. `items_venta` stores no product-name snapshot, so a printed receipt always reflects the
   product's current name, not its name at time of sale.
3. Neither `apps/api` nor `apps/web` has any PDF or print dependency today, and no `window.print()`
   usage exists anywhere in the repo.
4. No sales-history or sales-list screen exists in the app or the backlog before #12, so "view a
   receipt at any time" has no discovery path beyond a direct URL unless this item builds one.
5. `GET /api/productos/:id` (`apps/api/src/routes/productos.ts:145-163`) is a direct precedent for
   the `GET /api/ventas/:id` this feature needs — same `roles: ['encargado','deposito']` shape.
