# Design: Recibo Interno (Backlog #8)

**Change**: `recibo-interno` · **Artifact store**: hybrid (this file + Engram `sdd/recibo-interno/design`)
**Inputs**: `proposal.md` (PD-1..PD-7, binding), `exploration.md`. Written blind to `specs/`.

## Technical Approach

Read-only addition on top of #7's shipped schema. Backend follows the three-layer rule
(`routes` → `service` → `repository`) and the `GET /api/productos/:id` precedent
(`routes/productos.ts:145-163`) verbatim: `config: { roles: ['encargado','deposito'] }`,
`idParams`, `errorEnvelopeSchema` on 401/403/404. `VentasRepo` gains four narrow read methods
and no join — the cajero name and item names are composed in the service from
`UsuariosRepo.findById` / `ProductosRepo.findById`, exactly as `proposal.md`'s Approach states.

Frontend adds two routes under `shellLayout` plus one presentational `Recibo` component whose
print behaviour is pure `@media print` CSS. No new runtime dependency in either workspace.

Size confirmed against `proposal.md`'s **~800–1400 raw diff lines across 4–6 slices** — not
restated or recalculated here.

## Architecture Decisions

### D1 — Correlativo lookup is a dedicated endpoint, exact match (resolves OQ-1)

| Option | Tradeoff |
|---|---|
| `?numeroCorrelativo=N` on `GET /api/ventas` | **Rejected.** `GET /api/ventas` does not exist. Creating it invents the paginated sales-list endpoint PD-1 explicitly excludes, and the next cycle would find it and grow it. It also forces a `{data,page,pageSize,total}` envelope where "not found" is an empty array — no status, no wire code — which contradicts OQ-2's requirement for an error code. |
| Dedicated `GET /api/ventas/numero/:numeroCorrelativo` | **Chosen.** Returns the same single-resource `okRecibo` shape as `GET /api/ventas/:id`, or 404 `SALE_NOT_FOUND`. |

**Exact match only.** `numero_correlativo` is `integer` under `ventas_numero_correlativo_unique`
(`db/schema.ts:291-307`), so exact match returns 0 or 1 row *by database constraint* — which is
what makes PD-5's single generic not-found message well-defined. Prefix matching would need a
text cast + `ILIKE`, return N rows, and force the multi-result list UI PD-1 forbids.

Param schema: `z.object({ numeroCorrelativo: z.coerce.number().int().positive() })` —
`z.coerce` mirrors `pageQuerySchema` (`lib/pagination.ts:3-6`), since path params arrive as strings.

**Route-shadowing risk (must be tested, not assumed).** `routes/ventas.ts` already owns
`GET /ventas/catalogo`. Adding `GET /ventas/:id` puts a static and a parametric segment at the
same position. The design does not assert Fastify's resolution order — it *requires* a RED test
proving `GET /api/ventas/catalogo` still reaches the catalog handler after `/ventas/:id` is
registered. `/ventas/numero/:n` is three segments and cannot collide.

### D2 — `SALE_NOT_FOUND`, one code for both lookups (resolves OQ-2, wire half)

`saleNotFound()` → `SALE_NOT_FOUND`, 404, no `details`. English UPPER_SNAKE per the
two-naming-families rule; `SALE` is already this repo's English noun for `venta`
(`DUPLICATE_SALE_ITEM`, `SALE_AMOUNT_OUT_OF_RANGE`, `lib/errors.ts:265,333`). Same shape as
`productNotFound()`/`supplierNotFound()`, thrown by the **service**, never the repository
(`productos/service.ts:287-296` precedent).

**One code serves both `:id` and `:numeroCorrelativo`.** PD-5 ("no distinction between wrong
number and access denied") is then enforced at the wire, not by UI copy that happens to say the
same thing twice.

### D3 — Search lives on a dedicated landing route (resolves OQ-2, UI half)

| Option | Tradeoff |
|---|---|
| Embedded in the detail route's not-found state | **Rejected as the entry point.** Reaching `/ventas/$id/recibo` requires already holding an id. A user who has only a correlativo would have nowhere to type it. |
| Landing route `/ventas/recibo` | **Chosen.** Search box → on 200, `navigate({ to: '/ventas/$id/recibo', params, replace: true })` (`replace` so Back returns to the search, not a redirect loop). On `SALE_NOT_FOUND`, renders PD-5's generic message inline. |

The rejected option is still kept as a *recovery* affordance: the detail route's error state links
to `/ventas/recibo`. `/ventas/recibo` (2 segments) and `/ventas/$id/recibo` (3) do not collide.

### D4 — Both routes under `shellLayout` (resolves OQ-3, confirmed not assumed)

Three independent reasons, each sufficient:

1. **The client guard must mirror the server boundary, never exceed it.** PD-4 sets the server to
   `roles: ['encargado','deposito']`. An `encargadoLayout` guard would redirect a `deposito` away
   from a screen the server would serve — a client-side policy with no server counterpart, which
   is exactly the inversion `encargadoLayout.tsx:4-17`'s docblock warns against.
2. **CLAUDE.md's stated rule**: "Route guards are for encargado-only subtrees. Screens both roles
   can read go under `shellLayout`, never `encargadoLayout`."
3. **Concrete breakage, not theory.** PD-1(a) requires the POS success state to link to the
   just-confirmed receipt. `posRoute` is a `shellLayout` child (`routes/pos.tsx:21-25`) and both
   roles confirm sales. Under `encargadoLayout`, a `deposito` cashier clicking the link to *their
   own* sale would be redirected to `/` — a broken primary flow.

Both routes are registered as siblings of `posRoute` in `routes/routeTree.ts`.

### D5 — `useConfirmarVenta.ts` needs no change; the success state lifts to `pos.tsx`

`proposal.md` lists `useConfirmarVenta.ts` as needing to "stop discarding the confirm response."
Read against the code, that is not accurate: `useMutation` already exposes the response as
`mutation.data` (`useConfirmarVenta.ts:32-42`). It is `PagoPanel` that never reads it. **No hook
change is required.**

`PagoPanel` gains an `onVentaConfirmada` prop and passes a per-call `onSuccess` to
`mutation.mutate(input, { onSuccess })` — the precedent already in
`routes/productosDetalle.tsx:79-88`. `pos.tsx` holds the confirmed venta in state and renders the
success screen in place of the two-pane grid; PD-7's "Nueva venta" clears that state.

This also fixes a latent defect for free: `PagoPanel`'s local `pagos`, `montoInput` and
`precioOverrides` (`PagoPanel.tsx:78-88`) are **never reset after a successful sale** —
`useConfirmarVenta`'s `onSuccess` clears only the cart. Unmounting `PagoPanel` behind the success
screen destroys that state, so no manual reset is needed.

### D6 — Print CSS: chrome suppression at the owner, `@page` margin only (resolves OQ-4)

The real problem is not paper size. Every `shellLayout` child renders inside `AppShell`, which
contributes a sidebar and a "Cerrar sesión" button inside `<main>` (`AppShell.tsx:68-99`) — both
would print.

| Question | Decision | Rationale |
|---|---|---|
| Where does chrome suppression live? | `@media print` in `AppShell.module.css` (sidebar + logout hidden). Requires giving the logout button a class — it has none today. | The component that owns the chrome hides its own chrome. A receipt route reaching into another component's class names would invert ownership. |
| Global `body.printing` class toggled before `window.print()`? | **Rejected.** | It is mutable global style state needing `afterprint` cleanup, and it silently fails when the operator presses Ctrl+P instead of the button. A pure `@media print` rule behaves identically for both paths. |
| `@page { size: ... }`? | **Not set.** | No target paper stock is known (see PROD-A). Forcing `A4` breaks a receipt roll; forcing `80mm auto` breaks A4. The browser's print dialog already lets the operator choose, and "descargable" is satisfied by print-to-PDF at whatever they choose. |
| `@page` margin? | `@page { margin: 12mm; }` | Browser defaults differ (Chrome ~0.4in, Firefox 12.7mm). An explicit margin makes output reproducible across browsers **without** constraining paper. |
| Receipt surface | `background: #fff; color: #000` in print; hide the "Imprimir" and "Volver" controls; `break-inside: avoid` on item rows. | Ink cost and legibility. `global.css:53-62` already carries one media query, so an at-rule here is not without precedent. |

### D7 — Per-item read, not a repo join

`VentasRepo` stays join-free (matching `MovimientosRepo.listByProducto`, which returns raw rows).
The service resolves item names with a per-item `productos.findById`. This is an N+1 — accepted:
a receipt is bounded by the cart size, read-only and one-off, and **`confirmarVenta` already does
exactly this sequential per-item `findById`** inside the write transaction
(`ventas/service.ts:137-138`). Escape hatch if it ever matters: an additive
`ProductosRepo.findByIds(ids)` batch read, no port redesign.

## Data Flow

    /ventas/recibo (search)          /ventas/$id/recibo (receipt)
          │ numeroCorrelativo               │ id
          ▼                                 ▼
    GET /api/ventas/numero/:n         GET /api/ventas/:id
          └────────────┬────────────────────┘
                       ▼
              ventas/service.ts  getRecibo()
                 │        │            │
                 ▼        ▼            ▼
          VentasRepo  UsuariosRepo  ProductosRepo
          findById*   findById      findById (per item)
                       │
                       ▼  404 SALE_NOT_FOUND if no venta
                  { venta, cajero, items[], pagos[] }

    POS: PagoPanel ──mutate(onSuccess)──▶ pos.tsx state ──▶ success screen
                                                             │ "Ver recibo"  → /ventas/$id/recibo
                                                             │ "Nueva venta" → clear state (PD-7)

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/src/lib/errors.ts` | Modify | `saleNotFound()` / `SALE_NOT_FOUND` (D2) |
| `apps/api/src/ventas/repository.ts` | Modify | Port + adapter: `findById`, `findByNumeroCorrelativo`, `findItems`, `findPagos` |
| `apps/api/src/ventas/service.ts` | Modify | `getRecibo(repos, selector)` — throws `saleNotFound()`, composes cajero + item names |
| `apps/api/src/routes/ventas.ts` | Modify | `GET /ventas/:id`, `GET /ventas/numero/:numeroCorrelativo`, `okRecibo` DTO |
| `apps/api/src/app.test.ts` | Modify | The `satisfies VentasRepo` fake (`:99-103`) stops compiling until it gains the four methods |
| `apps/api/src/ventas/service.test.ts` | Modify | Same, for its own `VentasRepo` fake (`:95-127`) |
| `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts` | Regenerate | `pnpm contract`; stage before `pnpm contract:check` |
| `apps/web/src/features/recibo/queries.ts` | Create | `reciboKeys` + `queryOptions`, mirroring `features/productos/queries.ts:6-13` |
| `apps/web/src/features/recibo/useRecibo.ts` | Create | `useRecibo(id)`, `useReciboPorNumero(n)` (`enabled` on submit) |
| `apps/web/src/features/recibo/errorMessages.ts` | Create | Pure `(ApiError) => string`, switching on `code` (`features/pos/errorMessages.ts` shape) |
| `apps/web/src/features/recibo/format.ts` | Create | `formatFechaHora` — `Intl.DateTimeFormat('es', { dateStyle:'short', timeStyle:'short' })`. `usuarios/format.ts`'s `formatFecha` is date-only; a receipt needs the time |
| `apps/web/src/features/recibo/Recibo.tsx` + `.module.css` | Create | Presentational receipt + `@media print` (D6) |
| `apps/web/src/routes/recibo.tsx` | Create | `/ventas/$id/recibo` under `shellLayout` (D4) |
| `apps/web/src/routes/reciboBuscar.tsx` | Create | `/ventas/recibo` landing (D3) |
| `apps/web/src/routes/routeTree.ts` | Modify | Register both as siblings of `posRoute` |
| `apps/web/src/components/ui/AppShell.tsx` + `.module.css` | Modify | Class on the logout button + `@media print` chrome suppression (D6) |
| `apps/web/src/features/pos/PagoPanel.tsx` | Modify | `onVentaConfirmada` prop + per-call `onSuccess` (D5) |
| `apps/web/src/routes/pos.tsx` | Modify | Success-screen state, PD-7 "Nueva venta" (D5) |
| `apps/web/src/features/pos/useConfirmarVenta.ts` | **No change** | Contrary to `proposal.md`'s Affected Areas — see D5 |

## Interfaces / Contracts

```ts
// apps/api/src/ventas/repository.ts — additive, no join, mirrors MovimientosRepo's narrowness
export interface VentasRepo {
  create(input: NuevaVenta): Promise<Venta>;              // unchanged
  createItems(items: NuevoItemVenta[]): Promise<ItemVenta[]>;   // unchanged
  createPagos(pagos: NuevoPago[]): Promise<Pago[]>;             // unchanged
  findById(id: string): Promise<Venta | undefined>;
  findByNumeroCorrelativo(numero: number): Promise<Venta | undefined>;
  findItems(ventaId: string): Promise<ItemVenta[]>;
  findPagos(ventaId: string): Promise<Pago[]>;
}

// apps/api/src/routes/ventas.ts — `ventaDto` is REUSED as-is (:68-75), never duplicated.
const okRecibo = z.object({
  venta: ventaDto,                                   // numeroCorrelativo, estado (PD-6), total, creadoEn
  cajero: z.object({ id: z.string(), nombre: z.string() }),
  items: z.array(z.object({
    productoId: z.string(), nombre: z.string(), sku: z.string(),   // CURRENT name — drift accepted
    cantidad: z.number().int(), precioUnitario: z.string(), subtotal: z.string(),
  })),
  pagos: z.array(z.object({
    medio: medioSchema, monto: z.string(), vuelto: z.string(),
    estado: z.enum(['registrado', 'revertido']),
  })),
});
```

`creadoEn` is typed `z.date()` server-side but **arrives as an ISO string** over the wire —
verified and documented at `features/usuarios/format.ts:5-10`. `formatFechaHora` takes a string.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit (api) | `getRecibo` throws `saleNotFound()` for both selectors; composes cajero + per-item names; returns every `pagos` row unfiltered | Vitest + fake `VentasRepo`/`UsuariosRepo`/`ProductosRepo`, `ventas/service.test.ts` shape |
| Unit (api) | `SALE_NOT_FOUND` code/status/`details`-absence | Direct factory assertion, `lib/errors` test shape |
| Route (api) | Both routes 200/401/403/404; `roles` gate admits `deposito`; **`GET /api/ventas/catalogo` is not shadowed by `/ventas/:id`** (D1); non-uuid `:id` → `VALIDATION_ERROR`; non-integer `:numeroCorrelativo` → `VALIDATION_ERROR` | `app.inject`, asserting the browser's real header path (CLAUDE.md's logout lesson) |
| Unit (web) | `reciboErrorMessage` maps `SALE_NOT_FOUND` to PD-5's generic copy; `formatFechaHora` on a valid + invalid ISO | Pure-function tests |
| Route (web) | `/ventas/$id/recibo` renders every PD-2 field and no store name; anulada shows `estado` as plain text (PD-6); `/ventas/recibo` navigates on match and shows the generic message on 404 | RTL + `await router.load()` **before every render** (CLAUDE.md) |
| Route (web) | POS success screen appears after confirm, is not auto-dismissed, and "Nueva venta" returns a fresh empty cart *and* empty payment lines (D5's latent-defect fix) | Route-level, not hook-level — CLAUDE.md's "two defects shipped behind green hook tests" |
| Integration | Not required | No write, no transaction, no audit row. Adding one would prove nothing this layer does not. |

Strict TDD: every row above is RED first.

## Threat Matrix

`references/threat-matrix.md` rows cover shell/VCS/PR boundaries; this change has none.

| Boundary | Applicability |
|---|---|
| Documentation-like paths | **N/A** — no file classification or execution; no file is read as a manifest |
| Git repository selection | **N/A** — no `git` invocation |
| Commit state | **N/A** — no index/worktree interaction |
| Push state | **N/A** — no push |
| PR commands | **N/A** — no PR automation |

HTTP/SPA route resolution *is* an adversarial surface here, but it is not a matrix row. Its two
cases carry to `tasks.md` as RED tests regardless: the `/ventas/catalogo` shadowing test (D1) and
uuid-vs-integer param confusion between the two lookups.

## Migration / Rollout

**No migration required.** No table, column, index or enum changes — every column read already
shipped with #7. Rollback is deleting the new files and reverting the additive route/port edits;
no shipped write path is touched. Note the deploy asymmetry recorded in CLAUDE.md does not apply:
because nothing is added to the schema, there is no manual Neon migration step.

## Product Decisions Required — flagged, now RESOLVED (2026-08-31)

PD-1..PD-7 did not cover the following. Per CLAUDE.md ("if a design phase finds itself deciding
product behaviour, it must flag the conflict rather than quietly resolving it") each was flagged
with the design's provisional stance instead of being decided here. The owner has since answered
all six the same day; five are now binding as `proposal.md` PD-8..PD-12, and the sixth (PROD-F) is
deliberately deferred to backlog #9's own cycle. This table is kept as the historical record.

| # | Product decision needed | Why PD-1..PD-7 do not cover it | Design's provisional stance (NOT a decision) |
|---|---|---|---|
| **PROD-A** | **Target paper stock.** Does the shop print on a thermal receipt roll (58/80mm) or on A4/Letter? | PD-3 fixes `window.print()` + `@media print` but says nothing about paper. It determines whether `@page { size: 80mm auto }` and a narrow single-column layout are needed. | Ship paper-agnostic (margin only, no `size`, D6). A roll-specific layout would be a follow-up. → **Resolved as `proposal.md` PD-8 — A4/Letter confirmed, matches the provisional stance (no `@page size` needed).** |
| **PROD-B** | **Does arriving at `/ventas/$id/recibo` open the print dialog automatically?** | PD-3 says the route is printable; it does not say whether printing is automatic or explicit. PD-7 established a stance against unprompted screen changes, but it was scoped to the success screen's dismissal, not to printing. | Explicit "Imprimir" button, no auto-print. A cashier printing every sale may prefer the opposite. → **Resolved as `proposal.md` PD-9, matching the provisional stance.** |
| **PROD-C** | **Does the POS success screen embed the receipt, or only link to it?** | PD-1(a) says "a link/**view** to the just-confirmed receipt" — genuinely ambiguous. It also interacts with PD-7: if the screen navigates away, the "Nueva venta" button has to move to the receipt route. | Stay on `/pos`; show correlativo + total + two controls ("Ver recibo" navigates, "Nueva venta" clears). Keeps PD-7's button where the cashier already is. → **Resolved as `proposal.md` PD-10, matching the provisional stance.** |
| **PROD-D** | **Is the correlativo search reachable from the sidebar?** | `proposal.md` says "reachable from the receipt area". `AppShell.NAV_ITEMS` has no Ventas/Recibos entry, and its labels are verbatim from `docs/design.md`'s ratified Sidebar table (`AppShell.tsx:6-14`) — adding one amends a ratified document. | No new sidebar item. Linked from the POS success state and from the receipt route's error state only; otherwise direct URL. → **Resolved as `proposal.md` PD-11, matching the provisional stance.** |
| **PROD-E** | **Does the receipt show every payment medium and the `vuelto`?** | PD-2 lists "medio de pago" *singular*, but #7 ships multi-payment (one row per medio) and a `vuelto` on the cash row. A customer disputing change would have no printed proof. | List every `pagos` row (medio + monto); show `vuelto` on the cash row when non-zero. What a customer-facing document discloses is a product call. → **Resolved as `proposal.md` PD-12, matching the provisional stance.** |
| **PROD-F** | **When #9 ships, does a `revertido` payment row still print?** | PD-6 covers `Venta.estado` only; `pagos.estado` (`schema.ts:360`) is a separate axis. No `revertido` row can exist today, but the code must not assume it. | Backend returns every `pagos` row with its `estado`, unfiltered, so #9 can decide presentation with no backend change. Presentation itself is deferred to #9. → **Deliberately deferred, recorded as such in `proposal.md`** — not resolved now, not a gap. |

## Spec's flagged ambiguity — resolved by this design's D5

`sdd-spec` (blind to this file) flagged an apparent conflict between #7's PD-9 (cart clears
automatically on confirm) and this cycle's PD-7 (fresh cart only after "Nueva venta"). D5 above
resolves it as an architecture matter, not a new product decision: the cart's *data* still clears
immediately in `useConfirmarVenta`'s existing `onSuccess` (PD-9 unchanged); the success screen is a
separate view layered over `/pos` (PD-10), and PD-7's "Nueva venta" only clears the success-screen
state to reveal the (already-empty) cart underneath. No contradiction — a RECONCILE note, not a
correction, since neither side was wrong.

## Open Questions

All four of `proposal.md`'s Open Questions are resolved above: OQ-1 → D1, OQ-2 → D2 + D3,
OQ-3 → D4, OQ-4 → D6.

- [ ] **PROD-A..PROD-F above are blocking for `sdd-tasks` only where they change file shape** —
      PROD-C changes whether `Recibo.tsx` is mounted twice, and PROD-D changes whether
      `AppShell.tsx` gains a nav entry. PROD-A/B/E/F affect content and CSS, not structure.
- [ ] **Assumption to verify at apply time, not asserted here**: Fastify's static-over-parametric
      resolution keeps `GET /api/ventas/catalogo` reachable once `/ventas/:id` exists. D1 makes
      this a RED test rather than a claim.
