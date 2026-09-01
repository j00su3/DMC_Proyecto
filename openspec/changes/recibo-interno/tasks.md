# Tasks: Recibo Interno (Backlog #8)

**Change**: `recibo-interno` · **Artifact store**: hybrid (this file + Engram `sdd/recibo-interno/tasks`)
**Inputs**: `proposal.md` (PD-1..PD-12, binding), `design.md` (D1..D7, File Changes table),
`specs/point-of-sale/spec.md`, `specs/pos-ui/spec.md`, `specs/recibo-ui/spec.md`.

Strict TDD: every test row is written RED first, per `design.md`'s Testing Strategy. Every task
below cites the spec requirement(s) it satisfies.

## Reconciliation Notes

Two items flagged as potential spec/design conflict points were checked against the actual repo
state while writing this checklist; neither required a new decision.

- **RECONCILE-CHECK-1 (`SALE_NOT_FOUND`)**: `design.md` D2 and `specs/point-of-sale/spec.md`
  ("Sale Detail Read Path", "Lookup By Numero Correlativo") both independently land on
  `404 SALE_NOT_FOUND`, with no `details`, thrown by the service layer. Verified against
  `apps/api/src/lib/errors.ts` (current file, `productNotFound()` at line 189, `SALE_AMOUNT_OUT_OF_RANGE`
  at line 333) — no existing `SALE_NOT_FOUND` or colliding code exists today. **No conflict, no
  action needed beyond Task 1.1 below.**
- **RECONCILE-CHECK-2 (cart-clear timing)**: `specs/pos-ui/spec.md`'s Open Question 1 flagged that
  PD-9 (cart clears automatically on confirm) and this cycle's PD-7 (fresh cart only after "Nueva
  venta") read as ambiguous in isolation. `design.md` D5 already resolves this as an architecture
  matter — the cart's *data* clears immediately (PD-9 unchanged, `useConfirmarVenta`'s existing
  `onSuccess`), the success screen is a separate view layered on top (PD-10), and "Nueva venta"
  only clears the success-screen state. Verified against `apps/web/src/routes/pos.tsx` and
  `apps/web/src/features/pos/PagoPanel.tsx` (current files) — `useConfirmarVenta` already exposes
  `mutation.data`, confirming D5's premise that no hook change is needed. **Already resolved in
  both artifacts; no new RECONCILE entry required, carried forward into Task 5.1/5.2 as-is.**

No other spec/design discrepancy was found. `design.md`'s File Changes table and code-shape
assumptions (route registration in `routes/ventas.ts`, `app.repos`/`app.uow` usage, `idParams`
being locally defined per route file, the `productos.ts:145-163` detail-route shape) were checked
against the current source and match exactly.

## Route-Shadowing Risk — explicit test required

`design.md` D1 is explicit that Fastify's static-vs-parametric resolution order for
`GET /ventas/catalogo` vs. the new `GET /ventas/:id` **must be tested, not assumed**. Task 1.4
below is the RED test that proves it; no task may claim this behavior from documentation alone.

---

## Phase 1 — Backend read path (`point-of-sale`, spec: `specs/point-of-sale/spec.md`)

Sequential internally (each task's code depends on the previous one compiling). No frontend task
may start until this phase is green, since `pnpm contract` regenerates the types the frontend
consumes.

### Task 1.1 — `SALE_NOT_FOUND` error factory
- **File**: `apps/api/src/lib/errors.ts`
- **Satisfies**: point-of-sale spec, "Sale Detail Read Path" (404 clause) and "Lookup By Numero
  Correlativo" (404 clause).
- Add `saleNotFound()` → `AppError('SALE_NOT_FOUND', ..., 404)`, no `details` (D2). Mirrors
  `productNotFound()` (errors.ts:189) shape exactly.
- RED test first: direct factory assertion on code/status/`details`-absence, in the `lib/errors`
  test file's existing shape.

### Task 1.2 — `VentasRepo` read methods (port + Drizzle adapter)
- **File**: `apps/api/src/ventas/repository.ts`
- **Satisfies**: point-of-sale spec, "Sale Detail Read Path" (data shape).
- Depends on: 1.1 (not code-dependent, but same PR-slice).
- Add to the `VentasRepo` interface: `findById(id): Promise<Venta | undefined>`,
  `findByNumeroCorrelativo(numero): Promise<Venta | undefined>`, `findItems(ventaId): Promise<ItemVenta[]>`,
  `findPagos(ventaId): Promise<Pago[]>`. Implement on `DrizzleVentasRepo`, join-free (D7) — no repo
  join, per-item name resolution happens in the service (Task 1.3).
- **This breaks compilation of two existing test fakes** — fix both in this same task, not later:
  - `apps/api/src/app.test.ts:99-103` (`satisfies VentasRepo` fake) — add the four methods.
  - `apps/api/src/ventas/service.test.ts:95-127` (its own `VentasRepo` fake) — same.
- No new RED test of its own (a repo method with no business rule); covered by Task 1.3's service
  tests via the fake.

### Task 1.3 — `getRecibo` service function
- **File**: `apps/api/src/ventas/service.ts`
- **Satisfies**: point-of-sale spec, "Sale Detail Read Path", "Estado Is Returned Verbatim, No
  Derived Receipt State", "Lookup By Numero Correlativo", "Detail Read Path Excludes Store
  Configuration Data" (by construction — the composed shape never includes store fields).
- Depends on: 1.1, 1.2.
- `getRecibo(repos, selector: {id: string} | {numeroCorrelativo: number})`:
  - Resolves the venta via `findById` or `findByNumeroCorrelativo`; throws `saleNotFound()` (D2,
    thrown by the service, never the repository — mirrors `productos/service.ts:287-296`) if
    `undefined` for either selector (PD-5: identical error for both).
  - Composes cajero name via `UsuariosRepo.findById` (D7), item names via a per-item
    `ProductosRepo.findById` call (D7, matches the existing N+1 pattern already in
    `confirmarVenta`, `service.ts:137-138`).
  - Returns `estado` verbatim from `Venta.estado`, no derived field (D2/spec "Estado Is Returned
    Verbatim").
  - Returns every `pagos` row unfiltered, including `estado` (PROD-F, deferred to #9 — do not
    filter `revertido` rows here).
- RED tests first, `ventas/service.test.ts` shape (per `design.md` Testing Strategy):
  - throws `saleNotFound()` for both selectors when no match
  - composes cajero + per-item current names correctly
  - returns every `pagos` row unfiltered (including a `revertido` row, to prove no filtering exists
    even though none can occur yet)
  - `estado` passes through verbatim for both `confirmada` and `anulada`

### Task 1.4 — Routes: `GET /ventas/:id`, `GET /ventas/numero/:numeroCorrelativo`, route-shadowing RED test
- **File**: `apps/api/src/routes/ventas.ts`
- **Satisfies**: point-of-sale spec, "Sale Detail Read Path", "Lookup By Numero Correlativo",
  "Detail Read Path Excludes Store Configuration Data".
- Depends on: 1.3.
- Local `idParams = z.object({ id: z.string().uuid() })` (per-file precedent, not shared — matches
  `productos.ts:50`, `movimientos.ts:22`, `usuarios.ts:49`, `proveedores.ts:35`).
- `okRecibo` DTO reusing `ventaDto` as-is (D-Interfaces): `{ venta, cajero: {id, nombre}, items[],
  pagos[] }`.
- `GET /ventas/:id` — `config: { roles: ['encargado', 'deposito'] }` (PD-4), `params: idParams`,
  `response: { 200: okRecibo, 401/403/404: errorEnvelopeSchema }`.
- `GET /ventas/numero/:numeroCorrelativo` — same role gate, `params: z.object({ numeroCorrelativo:
  z.coerce.number().int().positive() })` (D1), same response shape.
- **RED test, explicit and non-negotiable (D1's flagged risk)**: `GET /api/ventas/catalogo` is
  registered and still reaches the catalog handler *after* `GET /ventas/:id` is registered in the
  same plugin — assert this with `app.inject` before writing the new routes, watch it fail for the
  wrong reason if written after, then confirm it passes for the right reason once both routes
  coexist. This is the task that resolves `design.md`'s "Assumption to verify at apply time, not
  asserted here" open item.
- Additional RED tests (route layer, `app.inject`, per Testing Strategy):
  - both routes 200 for `encargado` and `deposito` (PD-4 audit-style, not own-sale-only)
  - both routes 401 unauthenticated, 403 for no session/wrong setup if applicable
  - both routes 404 `SALE_NOT_FOUND` for a nonexistent id / numeroCorrelativo
  - non-uuid `:id` → `VALIDATION_ERROR`
  - non-integer `:numeroCorrelativo` → `VALIDATION_ERROR`
  - response body contains no store name/address field (spec: "Detail Read Path Excludes Store
    Configuration Data")

### Task 1.5 — Contract regeneration
- **Files**: `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts`
- Depends on: 1.4 green.
- Run `pnpm contract`, stage the regenerated files, run `pnpm contract:check` before trusting
  green (CLAUDE.md: uncommitted regenerated files read as drift).
- No test of its own — gate, not a behavior.

**Phase 1 exit criteria**: `pnpm -r test` and `pnpm typecheck` green for `apps/api`; `pnpm
contract:check` green; both test fakes compile; the route-shadowing RED test passes for the
right reason.

---

## Phase 2 — Frontend recibo data layer (`recibo-ui`, spec: `specs/recibo-ui/spec.md`)

Depends on: Phase 1 (needs `schema.d.ts` types for `okRecibo`/`SALE_NOT_FOUND`).
Internally sequential (queries → hook → error messages/format are small and independent of each
other but all live in the same new `features/recibo/` directory — one slice).

### Task 2.1 — Query keys + query options [x]
- **File**: `apps/web/src/features/recibo/queries.ts` (new)
- **Satisfies**: recibo-ui spec, "Printable Receipt Route" and "Correlativo Search" (data layer
  underpinning both).
- Mirrors `features/productos/queries.ts:6-13`'s key-factory shape: `reciboKeys.detail(id)`,
  `reciboKeys.byNumero(numero)`. `queryOptions` for `GET /ventas/:id` and
  `GET /ventas/numero/:numeroCorrelativo`.
- No RED test of its own (pure config); exercised through Task 2.2's hook tests.

### Task 2.2 — `useRecibo` / `useReciboPorNumero` hooks [x]
- **File**: `apps/web/src/features/recibo/useRecibo.ts` (new)
- Depends on: 2.1.
- `useRecibo(id)` — always enabled. `useReciboPorNumero(numero)` — `enabled` gated on submit (not
  on every keystroke), per D3's search-on-submit flow.
- RED tests: hook returns data on success, surfaces `SALE_NOT_FOUND` as an `ApiError` on 404
  (pure hook-level test; route-level coverage happens in Phase 3/4 per CLAUDE.md's "route-level,
  not just hook-level" rule).

### Task 2.3 — Error message mapping [x]
- **File**: `apps/web/src/features/recibo/errorMessages.ts` (new)
- **Satisfies**: recibo-ui spec, "Correlativo Search" (PD-5 generic message) and "Printable
  Receipt Route" (not-found scenario).
- Pure `(ApiError) => string`, same shape as `features/pos/errorMessages.ts`. `SALE_NOT_FOUND` →
  PD-5's single generic message, identical string for both the detail route's not-found state and
  the search's not-found state (spec requires no distinguishing detail between them).
- RED test: `reciboErrorMessage` maps `SALE_NOT_FOUND` to the generic copy; unknown codes fall
  back to a generic default (existing pattern).

### Task 2.4 — Date/time formatter [x]
- **File**: `apps/web/src/features/recibo/format.ts` (new)
- **Satisfies**: recibo-ui spec, "Printable Receipt Route" (fecha field).
- `formatFechaHora` — `Intl.DateTimeFormat('es', { dateStyle: 'short', timeStyle: 'short' })`.
  `creadoEn` arrives as an ISO string over the wire (verified precedent:
  `features/usuarios/format.ts:5-10`) even though it is `z.date()` server-side.
- RED test: valid ISO string formats correctly; an invalid/malformed string does not throw (degrade
  gracefully, matching `usuarios/format.ts`'s existing `formatFecha` behavior).

**Phase 2 exit criteria**: `pnpm -r test` and `pnpm typecheck` green for `apps/web`; no route
changes yet. **DONE** (`feat/recibo-pr2-datos`, commit `f2b94dc`, not pushed — see
`sdd/recibo-interno/apply-progress` in Engram). `pnpm --filter web test` (384/384),
`pnpm typecheck`, `pnpm lint` all green.

---

## Phase 3 — Receipt route + print surface (`recibo-ui`)

Depends on: Phase 2. This is the anchor route Phase 4 and Phase 5 both link to — it must land
before either.

### Task 3.1 — `Recibo` presentational component + print CSS [x]
- **File**: `apps/web/src/features/recibo/Recibo.tsx` + `Recibo.module.css` (new)
- **Satisfies**: recibo-ui spec, "Printable Receipt Route" (field list), "Estado Shown As Plain
  Text, No Visual Flag" (PD-6), "Receipt Omits Store Identity" (PD-2), and the "Correlativo Search"
  requirement's PD-12 payment-row list (every `pagos` row + `vuelto` on the cash row when nonzero).
- Renders exactly: items, importe, medio de pago (every `pagos` row, PD-12), fecha (via
  `formatFechaHora`), cajero, número correlativo, and estado as plain text (PD-6, no banner/
  watermark). No store name/address anywhere in the markup (PD-2).
- `@media print` CSS per D6: `@page { margin: 12mm; }`, no `size` set (PD-8, A4/Letter paper-
  agnostic); hide "Imprimir"/"Volver" controls when printing; `break-inside: avoid` on item rows;
  `background: #fff; color: #000` in print.
- "Imprimir" button calls `window.print()` directly — no auto-print on mount (PD-9).
- RED tests (unit/component level, extended at route level in 3.2):
  - renders every PD-2 field, no store name/address element present
  - `anulada` estado renders as plain text, no distinct visual treatment (component-level portion
    of the route-level assertion in 3.2)
  - every `pagos` row renders (multi-payment case); `vuelto` shows only on the cash row when
    nonzero

### Task 3.2 — `/ventas/$id/recibo` route + registration [x]
- **File**: `apps/web/src/routes/recibo.tsx` (new), `apps/web/src/routes/routeTree.ts` (modify)
- Depends on: 3.1, Task 2.2.
- **Satisfies**: recibo-ui spec, "Printable Receipt Route" (route reachability, role gate,
  not-found), "Receipt Access Is Audit-Style, Not Per-Cajero" (PD-4).
- Registers under `shellLayout` as a sibling of `posRoute` (D4 — both roles read, never
  `encargadoLayout`; three independent reasons in D4 all apply here).
- Wires `useRecibo(id)` to `Recibo.tsx`; on `SALE_NOT_FOUND`, renders the generic not-found message
  (Task 2.3) with a recovery link to `/ventas/recibo` (D3's "recovery affordance", built in Phase
  4 — link may 404 internally until Phase 4 lands if these ship as separate PRs; do not gate this
  task on Phase 4).
- RED tests, route level (`await router.load()` before every render, per CLAUDE.md):
  - valid id renders every PD-2 field
  - nonexistent id shows the generic not-found message
  - "Imprimir" button triggers `window.print()` (mock/spy on `window.print`)
  - `deposito` session can view a receipt confirmed by an `encargado` (PD-4, "Receipt Access Is
    Audit-Style")
  - route is reachable under `shellLayout`, not redirected by an `encargado`-only guard

### Task 3.3 — `AppShell` print chrome suppression [x]
- **File**: `apps/web/src/components/ui/AppShell.tsx` + `AppShell.module.css` (modify)
- Depends on: none structurally, but only meaningful once 3.2 exists to print from — same slice.
- **Satisfies**: recibo-ui spec, "Printable Receipt Route" (clean print output — not a separate
  spec requirement, but D6's stated mechanism for satisfying it without sidebar/logout bleeding
  into the printed page).
- Add a class to the "Cerrar sesión" button (`AppShell.tsx:96-98`, currently classless).
  `@media print` in `AppShell.module.css` hides the sidebar (`.sidebar`) and the logout button.
- RED test: rendering `AppShell` and asserting (via a print-media-query simulation or a
  print-class snapshot) that the sidebar and logout button are print-hidden while `<main>`'s
  content is not.

**Phase 3 exit criteria**: `/ventas/$id/recibo` is reachable, renders per spec, and prints without
chrome. `pnpm -r test`, `pnpm typecheck`, `pnpm lint` green. **DONE**
(`feat/recibo-pr3-ruta`, not pushed — see `sdd/recibo-interno/apply-progress` in Engram).
`pnpm --filter web test` (399/399), `pnpm typecheck`, `pnpm lint` all green.

---

## Phase 4 — Correlativo search route (`recibo-ui`)

Depends on: Phase 3 (navigates to `/ventas/$id/recibo` on match). Independent of Phase 5 — may run
in parallel with it once Phase 3 is merged.

### Task 4.1 — `/ventas/recibo` landing route + registration [x]
- **File**: `apps/web/src/routes/reciboBuscar.tsx` (new), `apps/web/src/routes/routeTree.ts`
  (modify)
- **Satisfies**: recibo-ui spec, "Correlativo Search" (all scenarios).
- Registers under `shellLayout` as a sibling of `posRoute` (D4, same reasoning as 3.2).
- Search box → on `200`, `navigate({ to: '/ventas/$id/recibo', params, replace: true })` (D3 —
  `replace` so Back returns to the search, not a redirect loop). On `SALE_NOT_FOUND`, renders the
  generic not-found message (Task 2.3) inline, no navigation.
- No sidebar entry (PD-11) — reachable only via the POS success state (Phase 5) and the receipt
  route's not-found recovery link (Task 3.2). No list/browse control anywhere on this route (PD-1
  scope boundary, spec's explicit "No sales-list affordance" scenario).
- RED tests, route level:
  - existing `numeroCorrelativo` navigates to that venta's receipt
  - nonexistent `numeroCorrelativo` shows the generic not-found message, no navigation
  - no list/browse control is present anywhere on the page
  - both roles (`encargado`, `deposito`) can reach and use the search (PD-4)

**Phase 4 exit criteria**: `/ventas/recibo` reachable and functional standalone (independently
testable even before Phase 5 wires the POS link to it). **DONE**
(`feat/recibo-pr4-busqueda`, not pushed). `pnpm --filter web test` (404/404), `pnpm typecheck`,
`pnpm lint` all green.

---

## Phase 5 — POS success state (`pos-ui`, spec: `specs/pos-ui/spec.md`)

Depends on: Phase 3 (links to `/ventas/$id/recibo`). Independent of Phase 4 — may run in parallel
with it once Phase 3 is merged.

### Task 5.1 — `PagoPanel` per-call success callback [x]
- **File**: `apps/web/src/features/pos/PagoPanel.tsx` (modify)
- **Satisfies**: pos-ui spec, "Post-Confirmation Success State" (response retained), "Cart Clears
  On Confirmed Sale Or Explicit Empty Action, Success State Follows Confirmation" (D5's resolution
  of RECONCILE-CHECK-2 above — no `useConfirmarVenta.ts` change, per D5's explicit finding that the
  hook already exposes `mutation.data`).
- Add `onVentaConfirmada` prop; pass a per-call `onSuccess` to `mutation.mutate(input, {
  onSuccess })` (precedent: `routes/productosDetalle.tsx:79-88`), invoking
  `onVentaConfirmada(mutation.data)` (or the `onSuccess` payload) with the confirmed venta.
- This is also where D5's latent-defect fix lands for free: `PagoPanel`'s local `pagos`,
  `montoInput`, `precioOverrides` state (currently never reset post-sale) gets cleared because
  `pos.tsx` (Task 5.2) unmounts `PagoPanel` behind the success screen — no manual reset code is
  needed in this file, but the route-level test in 5.2 is what proves it, not a unit test here.
- RED test (hook/component level): `onVentaConfirmada` is called with the confirmed venta payload
  on a successful `mutate`.

### Task 5.2 — `pos.tsx` success screen + "Nueva venta" [x]
- **File**: `apps/web/src/routes/pos.tsx` (modify), `apps/web/src/routes/pos.module.css` (modify,
  if new styles are needed for the success screen)
- Depends on: 5.1, Task 3.2 (link target must exist).
- **Satisfies**: pos-ui spec, "Post-Confirmation Success State" (full requirement), "Cart Clears On
  Confirmed Sale Or Explicit Empty Action, Success State Follows Confirmation" (success-state
  persistence + "Nueva venta" scenarios).
- Holds the confirmed venta in local state; renders the success screen (correlativo + total, PD-10)
  in place of the two-pane grid when state is set. Two controls: "Ver recibo" (navigates to
  `/ventas/$id/recibo`, PD-1a) and "Nueva venta" (clears the success-screen state only — PD-7,
  cart data already cleared by `useConfirmarVenta`'s existing `onSuccess` per D5).
- RED tests, route level (not hook-level, per CLAUDE.md's "two defects shipped behind green hook
  tests" lesson):
  - successful confirmation shows the success state with correlativo + total
  - success state persists indefinitely with no auto-dismiss (spec: "Success state persists until
    explicit dismissal")
  - "Ver recibo" navigates to that sale's `/ventas/:id/recibo`
  - "Nueva venta" returns to a fresh, empty cart *and* empty payment lines (D5's latent-defect fix
    — assert `PagoPanel`'s local state, not just the cart, is reset)
  - explicit "empty cart" action still clears the cart without confirming a sale (regression check
    on the unchanged half of the modified requirement)

**Phase 5 exit criteria**: full POS → success screen → receipt flow works end to end for both
roles. `pnpm -r test`, `pnpm typecheck`, `pnpm lint` green. **DONE**
(`feat/recibo-pr5-exito`, not pushed). `pnpm --filter web test` (408/408), `pnpm typecheck`,
`pnpm lint` all green.

**All five phases of this change are now complete.**

---

## Dependency Graph

```
Phase 1 (backend, sequential 1.1→1.2→1.3→1.4→1.5)
   │
   ▼
Phase 2 (frontend data layer, sequential 2.1→2.2→2.3→2.4)
   │
   ▼
Phase 3 (receipt route, 3.1→3.2, then 3.3 in the same slice)
   │
   ├──▶ Phase 4 (search route)   ─┐
   │                               ├─ independent of each other, both may
   └──▶ Phase 5 (POS success)    ─┘  ship in parallel once Phase 3 is merged
```

No task in Phase 4 touches a file Phase 5 touches, and vice versa — safe to parallelize across two
contributors/PRs once Phase 3 lands, if desired.

## Slicing / PR Recommendation

Five phases as scoped above, matching `proposal.md`'s "4-6 slices" estimate. Recommended as a
**short chained PR sequence, one PR per phase (5 PRs)**, not a single PR:

- Phase 1 alone (backend: 2 files modified for the port/adapter, 1 route file, 1 errors.ts
  addition, 2 test-fake fixups, contract regen) is already a complete, independently reviewable
  and mergeable unit — and per `design.md`'s own reasoning (`GET /api/productos/:id` precedent),
  it carries the one file (`routes/ventas.ts`) most likely to need adversarial review attention
  (the route-shadowing RED test).
- Phases 3 and 5 are each large enough on their own (new route + component + CSS, or POS state
  restructuring + route-level tests) to be worth reviewing in isolation rather than bundled.
- Total estimated size (~800-1400 lines per `proposal.md`) is close to or over this session's
  `review_budget_lines: 800` ceiling *in aggregate*, but no single phase above should approach 800
  lines alone (Phase 1 and Phase 3 are the largest; Phase 2 and Phase 4 are small). Chaining keeps
  every individual review inside budget without needing to further split any one phase.
- This is a much smaller chain than #7's 9-16 slices, consistent with `proposal.md`'s own sizing
  note ("no slice should approach this session's `review_budget_lines` ceiling").
