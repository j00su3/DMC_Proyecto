# Exploration: punto-de-venta (backlog #7)

**Date**: 2026-08-31
**Change**: `punto-de-venta`
**Artifact store**: hybrid — this file plus Engram topic `sdd/punto-de-venta/explore`
**Phase**: explore (no code written, no source file modified)

> Persistence note: the `sdd-explore` agent has no Write tool in its runtime, so it persisted
> only to Engram. This file was materialized by the orchestrator from that topic. Every
> structural `file:line` claim below was independently re-read from disk by the orchestrator
> before this file was written — the schema enum, the `venta_id` column, the sign CHECK, the
> repository types, the absence of any decimal library, and the absence of any production
> `localStorage` usage.

## Current State

Backlog #6 (`movimientos-inventario`, archived 2026-08-31 as
`openspec/changes/archive/2026-08-31-movimientos-inventario/`) built the entire stock-write
primitive #7 needs, and deliberately left every seam #7 requires untouched. **#7 is a new
`ventas`/`items_venta`/`pagos` slice that calls #6's existing machinery per cart item — it is
not a new stock-write mechanism.**

### The one stock-write primitive — unchanged, reused verbatim

`apps/api/src/productos/repository.ts:205-218` — `aplicarDelta(id, delta)`:

```ts
async aplicarDelta(id: string, delta: number): Promise<number | undefined> {
  const rows = await this.db.update(productos)
    .set({ stockActual: sql`${productos.stockActual} + ${delta}` })
    .where(and(eq(productos.id, id), eq(productos.activo, true),
      sql`${productos.stockActual} + ${delta} >= 0`))
    .returning({ stockActual: productos.stockActual });
  return rows[0]?.stockActual;
}
```

One conditional UPDATE, still the sole authority (ADR-0005). #7 must not touch it — call it
once per cart item, inside one `uow.run`, with items **sorted by `producto_id` first**.

### `movimientos` already anticipates `venta`/`anulacion` — schema needs zero new columns for #7

`apps/api/src/db/schema.ts:152-158` — the `movimientoTipo` pgEnum already ships `venta` and
`anulacion` (added in #5/#6, never used yet). The `movimientos` table already carries:

- `ventaId: uuid('venta_id')` (`schema.ts:214-215`) — **nullable, no FK**. Its own comment
  names this change explicitly: `// No FK — 'ventas' does not exist until backlog #7.`
- The `movimientos_signo_tipo` CHECK (`schema.ts:223-231`) **already** groups `venta` with
  `salida` (`cantidad < 0`) and treats `anulacion` as positive. Written during #5 anticipating
  #7/#9; needs no edit.

`apps/api/src/movimientos/repository.ts:5-41` — `Movimiento`/`NuevoMovimiento` already type
`tipo` as `'entrada' | 'salida' | 'ajuste' | 'venta' | 'anulacion'` and already carry
`ventaId`. **`MovimientosRepo` needs zero interface changes for #7** — `create()` is already
the exact shape a venta-item write needs. Only a `ventas.ventaId` FK is missing, and whether
to add it is a design call. `docs/adrs/0011-claves-primarias-uuid.md:39` already pre-names the
tables `ventas`, `items_venta` and `pagos` for this change.

### The transaction shape to mirror — `registrarMovimiento`, not `crearProducto`

`apps/api/src/movimientos/service.ts:88-141` is the closer precedent because it already
handles the "apply delta, classify failure, write the ledger row" cycle a sale needs per item:

```ts
export async function registrarMovimiento(uow, input) {
  // ...guards before uow.run...
  return uow.run(async (txRepos) => {
    const nuevoStock = await txRepos.productos.aplicarDelta(input.productoId, delta);
    if (nuevoStock === undefined) return rechazarMovimiento(txRepos, input.productoId);
    const movimiento = await txRepos.movimientos.create({ ..., stockResultante: nuevoStock });
    const producto = await txRepos.productos.findById(input.productoId);
    // ── SEAM (backlog #10, ADR-0008) ── SAVEPOINT alertas goes exactly here ──
    return { movimiento, producto };
  });
}
```

`rechazarMovimiento` (`service.ts:41-53`) is the exact classification helper #7 needs per
item: `productNotFound()` / `productInactive()` / `insufficientStock(producto.stockActual)` —
all three already exist in `apps/api/src/lib/errors.ts:189-246` and are directly reusable. A
venta's per-item failure is not a new domain-error shape; it is the same `aplicarDelta`-
undefined classification #6 already built, called once per cart line, still inside one
transaction, still aborting the whole sale on the first rejection (ADR-0005: *"si alguno
falla, se hace rollback de toda la venta"*).

**The #10 alert seam is explicit and load-bearing** (`service.ts:132-137`). For a multi-item
sale that seam must exist **per item** — each `tipo: 'venta'` row is its own
`evaluar(movimiento, producto)` candidate for #10's future threshold check.
`apps/api/src/db/uow.ts:9-11` hands the callback only `Repos`, never the raw `tx` executor —
#7 must not pre-widen that port "for #10", the same rule #6 followed.

### RBAC precedent — POS is open to both roles; anulación (#9, not #7) is encargado-only

`docs/PRD.md:69-70`: *"el personal de depósito puede procesar ventas (actúa como cajero) y
registrar el pago, pero anular o devolver una venta ya confirmada queda reservado al
encargado."* `docs/TECH-DESIGNv2.md:233` confirms depósito may *"registrar entradas, procesar
ventas, registrar salidas, registrar ajustes con motivo."* So confirming a venta follows
`config.roles: ['encargado', 'deposito']`, the same shape as #6's entrada/salida routes
(`apps/api/src/routes/movimientos.ts:145,171,207`). Anulación is out of scope for #7
(backlog #9 depends on #7, `docs/BACKLOG.md:44`).

### Money — `NUMERIC(12,2)` as a string on the wire; no decimal library exists anywhere

`apps/api/src/db/schema.ts:169` — `productos.precio` is `numeric('precio', { precision: 12,
scale: 2 })`. `apps/api/src/routes/productos.ts:61-66` carries its own comment: *"drizzle's
default numeric mode is a string, so this never touches floating-point precision"*, with the
wire shape `z.string().trim().regex(/^\d+(\.\d{1,2})?$/, ...)`, echoed at `productos.ts:35,108`.
`docs/TECH-DESIGNv2.md:103,141-155` and `docs/REVISION-ADVERSARIAL.md:279-280` (S10) confirm
every money field in #7's model — `Venta.total`, `ItemVenta.precio_unitario`,
`ItemVenta.subtotal`, `Pago.monto`, `Pago.vuelto` — is `NUMERIC(12,2)`.

**Confirmed by search, zero results**: neither `apps/api/package.json` nor
`apps/web/package.json` declares `decimal.js`, `big.js`, `bignumber.js`, `dinero.js` or any
decimal-arithmetic library. Nothing in the codebase today sums or multiplies money in JS —
`crearProducto` never touches `precio` arithmetically. Summing `ItemVenta.subtotal` into
`Venta.total`, and computing `Pago.vuelto = monto - total`, are the **first** money-arithmetic
operations this codebase will ever perform. Whether that arithmetic happens in SQL (Postgres
`numeric` is exact) or in JS (needing a new dependency, since floating-point subtraction of two
decimal strings is unsafe) is a genuine open design question with a correctness stake.

### `numero_correlativo` — mechanism and where the gap comes from

`docs/TECH-DESIGNv2.md:145-151` (S6) and `docs/REVISION-ADVERSARIAL.md:209-223`: implemented
with a **Postgres SEQUENCE**. Sequences are **non-transactional** — `nextval()` is never
rolled back even when the surrounding transaction aborts — so a venta that rolls back
(insufficient stock on a later item, a write failure) still consumes a value never attached to
a persisted row. That is the documented "hueco": *"un número faltante en la traza = venta que
no llegó a confirmarse, no una venta borrada"* (`TECH-DESIGNv2.md:147`). This is explicitly
**decoupled** from a future etapa-2 `numero_fiscal`, which needs strict gap-free correlativity
via its own transaction-scoped counter (`TECH-DESIGNv2.md:148-151`). #7 must not conflate the
two. `drizzle-orm` is pinned at `^0.45.2` (`apps/api/package.json:24`), which ships a
`pgSequence` helper; whether to use it or a hand-written `CREATE SEQUENCE` is a design choice.

### Deterministic ordering by `producto_id` — what it protects against

`docs/adrs/0005-update-atomico-condicional.md:31-34`: *"Para ventas multi-ítem, cada ítem
aplica su propio update condicional dentro de una única transacción, procesados en un orden
determinístico (por `producto_id`) para evitar deadlocks entre transacciones concurrentes que
toquen los mismos productos en distinto orden; si alguno falla, se hace rollback de toda la
venta."* `docs/REVISION-ADVERSARIAL.md:393-418` (finding A3, resolved 2026-08-13) is the
adversarial-review finding that produced the rule: two concurrent multi-item sales touching
overlapping products **in different orders** can deadlock in Postgres (`40P01`), which would
reach the cashier as a confusing failure. The fix is a fixed global lock order — sort cart
items by `producto_id` ascending before any `aplicarDelta` call.

This **does not eliminate waiting** between two sales sharing a product (one still blocks on
the other's row-level write); it only prevents the deadlock, accepted as sufficient at
single-shop concurrency (ADR-0005:78-82). It **composes with `aplicarDelta` unmodified**: the
primitive needs no knowledge of ordering — the *caller* sorts the item list once, before the
loop, and then makes the same call `registrarMovimiento` already makes once, N times in one
transaction.

### Does a sale write one `movimientos` row per item, and does the audit gate matter?

Yes to the first — ADR-0003:55 (*"el modelo de la venta se diseña como transacción con
ítems"*) and ADR-0005:34 (*"Cada update exitoso va acompañado, en la misma transacción, del
asiento en el ledger"*) both describe one ledger entry per successful item update, matching
`MovimientosRepo.create()`'s existing shape — no repo change, only N calls.

On the audit gate: `AuditableEntidad = keyof typeof FIELD_CLASSIFICATION`
(`apps/api/src/auditoria/service.ts:10`) has exactly three keys (`usuarios`, `proveedores`,
`productos` — `apps/api/src/auditoria/fields.ts:20-60`). ADR-0012 rule 2 says a movement never
gets its own `auditoria` row — that applies unchanged to `venta`-typed movements. **Whether
`Venta` itself needs a fourth `FIELD_CLASSIFICATION` entry is genuinely open**: ADR-0012 rule
1's decision test is written for entities that get PATCHed, not for an immutable append-only
record that already carries its own `usuario_id`/`fecha`. No document settles it. Flagged
below rather than assumed either way.

### Where a sale's stock refusal surfaces

`insufficientStock(available)` already exists (`apps/api/src/lib/errors.ts:233-237`, `409
INSUFFICIENT_STOCK`, `details: { available }`), built by #6 for exactly this shape.
`docs/PRD.md:278` / `docs/TECH-DESIGNv2.md:277-278`: *"si un ítem no tiene stock, se rechaza la
venta completa y ningún ítem se descuenta (rollback)."* The mechanism is identical to #6's: the
**first** item in `producto_id` order whose `aplicarDelta` returns `undefined` runs the same
classification read inside the same transaction, and the error aborts the whole `uow.run` —
every prior item's stock change rolls back automatically, no compensating write needed.

### `localStorage` cart — no precedent exists in this codebase

Searching `apps/web/src` for `localStorage` returns **zero production hits**. The only two
occurrences are in `features/usuarios/useCrearUsuario.test.ts` and
`useRestablecerPassword.test.ts` — both **security assertions**
(`expect(JSON.stringify(localStorage)).not.toContain(PLAINTEXT)`) proving a temporary password
never leaks into browser storage, not usage of `localStorage` as a data store.

**#7 is the first feature in this project to persist any state in `localStorage`.** There is
no hook, wrapper, or serialization convention to extend. `docs/TECH-DESIGNv2.md:38-42` and
`docs/REVISION-ADVERSARIAL.md:255-269` (S9, resolved 2026-08-13) describe the requirement: the
cart lives in the SPA and persists in `localStorage`, keyed per device **and** per user,
survives reload/tab close/connection loss, restores on returning to the POS screen, clears on
confirm or explicit empty, and is **not** shared across devices. The project's TanStack Query
usage is exclusively server-state caching — the cart is genuinely client-only local state, a
new architectural category for this app.

### POS layout — tokens only, the same situation #6's modal was in

`docs/design.md:93` — *"POS: grilla `1.2fr | 460px` (catálogo | carrito fijo a la derecha)."*
`docs/design.md:95` — *"POS apilado en móvil (**pendiente de diseño**)"*; no mobile layout is
specified anywhere. `docs/design.md:35` — Total POS 28px/800, Vuelto 22px/800 green.
`docs/design.md:26` — success `#2f9e63` on `#e6f6ec` covers "entradas, vuelto, transacciones."
`docs/design.md:68` — POS tap targets: *"padding generoso, mínimo 44px de alto."*
`docs/design.md:52` — "Punto de venta" is artboard #7 in the Figma reference (not fetchable
here; only the token summary is verifiable). `docs/TECH-DESIGNv2.md:171` — the chip family
VENTA/AJUSTE/ENTRADA/ANULACIÓN maps 1:1 to `Movimiento.tipo`, reusable from #6's `StatusChip`
precedent. No wireframe exists for the catalog/cart internals — exactly the "tokens only,
invent the rest" situation #6's design phase faced for its modal's steps 2-3.

## Affected Areas

| Path | Change |
| --- | --- |
| `apps/api/src/db/schema.ts` | **Modify** — add `ventas`, `items_venta`, `pagos`, a `numero_correlativo` sequence, and (design call) the FK from `movimientos.ventaId` |
| `apps/api/drizzle/000X_*.sql` + `meta/` | **Create** — generated migration(s), including the sequence |
| `apps/api/src/ventas/repository.ts` | **NEW** — port + Drizzle adapter, mirroring `apps/api/src/proveedores/repository.ts` |
| `apps/api/src/ventas/service.ts` | **NEW** — `confirmarVenta`: sort by `producto_id`, loop `aplicarDelta` + `movimientos.create` per item in one `uow.run`, payment validation, vuelto |
| `apps/api/src/routes/ventas.ts` | **NEW** — `POST /api/ventas`, `config.roles: ['encargado','deposito']` |
| `apps/api/src/lib/errors.ts` | **Modify** — payment-validation factories; no wire code is pre-ratified anywhere |
| `apps/api/src/plugins/repos.ts` | **Modify** — add `ventas: VentasRepo` to `Repos` and `buildRepos` |
| `apps/api/src/movimientos/repository.ts` | **No interface change expected** — `create()` already accepts `tipo: 'venta'` and `ventaId` |
| `apps/api/src/productos/repository.ts` | **No change** — `aplicarDelta` untouched |
| `apps/api/src/auditoria/*` | **Open question** — whether `ventas` needs a fourth `FIELD_CLASSIFICATION` key |
| `apps/web/src/features/pos/*` | **NEW** — catalog, cart state (`localStorage`-backed), payment step, hooks, schemas; no scaffold exists |
| `apps/web/src/routes/pos.tsx` | **NEW** — POS route, `1.2fr \| 460px` per `design.md:93` |
| `apps/web/src/api/schema.d.ts` | **Regenerate** — `pnpm contract` |
| `docs/BACKLOG.md:42` | Flip on archive, per project convention |

## Constraints Confirmed Against Source (not re-decided here)

- **ADR-0003** (`docs/adrs/0003-postgres-stock-guardado-ledger.md:22-30`): `stock_actual` never
  changes without a paired `movimientos` row in the same transaction. Exactly one `uow.run` per
  confirmed sale, covering every item.
- **ADR-0005/0006** (`0005:20-45`, `0006:17-22`): the conditional UPDATE is the sole authority;
  insufficient stock blocks, never goes negative; "hay N" is read inside the same transaction.
- **ADR-0008** (`0008:65-76`, `TECH-DESIGNv2.md:179-188`): #10's evaluator runs inside the same
  transaction behind `SAVEPOINT alertas`; an application `try`/`catch` cannot substitute
  (Postgres `25P02`). The marker at `movimientos/service.ts:132-137` is the shape to replicate
  per item.
- **ADR-0012 rule 2** (`0012:46-47`): a movement never produces an `auditoria` row.
  `venta`-typed movements follow the same rule.
- **#6's D1**: `aplicarDelta` stays exactly as shipped; the "classify on the rejection path
  only" pattern is replicated per cart item, not replaced.
- **The audit compile gate**: `AuditableEntidad` (`auditoria/service.ts:10`) has exactly three
  keys. #7 is the first change since #6 that could plausibly add a fourth.
- **Two naming families**: tables/repos Spanish; error factories and wire codes English
  UPPER_SNAKE; wire fields camelCase. `ADR-0011:39` pre-names `ventas`, `items_venta`, `pagos`.
- **Three layers per domain**, mirroring `apps/api/src/proveedores/`.

## Open Questions Needing A Product or Design Decision

None are answered by any document read in this session. Listed as forks, not resolved.

1. **Server-side price authority.** `ItemVenta.precio_unitario` must be read from
   `productos.precio` at confirmation, never trusted from the client cart. Open: does the cart
   store a price snapshot for display, and is "price changed since it was added" in scope for
   #7 or deferred?
2. **Money arithmetic mechanism.** No decimal library exists, and `NUMERIC` round-trips as a JS
   string. Is `Venta.total` computed by SQL aggregation over `items_venta` (exact, no new
   dependency) or in JS (needs a dependency, since two decimal strings cannot be safely
   subtracted with `Number()` for `vuelto`)? A correctness fork, not a style choice.
3. **Payment rules and cardinality.** The three rules ("medio obligatorio, monto ≥ total,
   cálculo de vuelto") are confirmed at `TECH-DESIGNv2.md:280-281`, but no wire error code
   exists yet for "missing medio" or "monto < total" — spec-time decisions, mirroring #6's
   RECONCILE-1. Also unresolved: **can one `Venta` carry several `Pago` rows** (split cash +
   card), or is v1 exactly one? `TECH-DESIGNv2.md:154-159` speaks in the singular but never
   states cardinality. **This one changes the schema, not just the service.**
4. **`ventas` FK on `movimientos.ventaId`.** The column's comment implies #7 adds one; whether
   `onDelete` follows the existing `restrict` convention needs a decision. `restrict` is
   precedent-consistent given the append-only ledger, but no document says so.
5. **Does `Venta` need a `FIELD_CLASSIFICATION` entry?** Structurally closer to `movimientos`
   (self-auditing, append-only, carries its own `usuario_id`/`fecha`) than to the PATCHable
   entities the rule was written for. If the answer is "no fourth key," it should be stated as
   explicitly as #6's tasks.md did, so a future cycle does not reconsider it by accident.
6. **Catalog browsing on the POS screen.** No document specifies filter/search behaviour beyond
   the grid. Does it reuse `productos/repository.ts:89-115`'s `list(page, pageSize, q)`
   search-by-name/SKU, or does the POS need a different shape? Barcode scanning is explicitly
   out of scope (`docs/PRD.md:141-142`).
7. **Mobile POS layout.** `docs/design.md:95` marks it "pendiente de diseño". In #7's scope or
   deferred? No document commits either way.
8. **Cart item identity.** If the same product is added twice, does the cart merge the lines
   (summing quantity) or keep them separate? This affects both the `localStorage` shape and the
   ordering step: duplicate `producto_id` entries would need pre-merging before the
   deterministic-order loop, since `aplicarDelta` calls are 1:1 per item today.

## Risks and Traps

- **This is the largest single change in the project's history by every available estimate.**
  #6 — a strict subset of this pattern, one item rather than N — forecast ~2870 raw diff lines
  across 9 chained slices. #7 adds three tables, a sequence, a new repo/service/route layer,
  payment validation, a brand-new client-persistence category, and a two-pane screen with no
  wireframe. Four backlog items (#8, #9, #10, #12) block on it landing correctly, so getting
  the seams wrong here has a wider blast radius than any prior cycle.
- **The deadlock mitigation is easy to get subtly wrong.** ADR-0005/A3's fix only works if
  *every* concurrent path touching multiple products applies the same ordering. A future path
  that loops in insertion order — matching what the cashier actually clicked — silently
  reintroduces the deadlock, and nothing but a concurrency test would catch it.
- **Money arithmetic is a live correctness risk.** Computing `vuelto = Number(monto) -
  Number(total)` risks floating-point error at `NUMERIC(12,2)` precision. This codebase has
  never had to solve it, and the wrong choice at design time is a bug TypeScript cannot catch.
- **Sequence migrations are new ground.** No existing migration in `apps/api/drizzle/` creates
  a Postgres SEQUENCE — #5's and #6's only ever `ALTER TABLE` / `ADD COLUMN` / `ADD CONSTRAINT`.
  Confirming `pgSequence` round-trips cleanly through `pnpm db:generate`'s double-run check is
  unproven for this project's tooling.
- **The `localStorage` cart is new architecture, not a variation on an existing hook.** There is
  no serialization or versioning convention. A stored shape from an older deployed version,
  restored after a release, could crash the POS on load. That needs its own resilience design,
  not an assumption that `JSON.parse` suffices.
- **No wireframe for the POS internals** — item rows, quantity controls, payment selector and
  the vuelto display all get invented from tokens, at larger surface area than #6's modal.
- **`Pago` cardinality is unstated**, and getting it wrong changes the schema, not just the
  service logic. Worth settling before `sdd-design`, not during it.

## Approaches (backend transaction shape — options, not a choice)

| Approach | Description | Pros | Cons | Effort |
|---|---|---|---|---|
| **A — Reuse `MovimientosRepo.create` in a loop, one new `ventas` service** | `confirmarVenta` sorts items by `producto_id`, opens one `uow.run`, loops `aplicarDelta` + `movimientos.create({tipo:'venta', ventaId, ...})` per item, then writes `ventas`/`items_venta`/`pagos` in the same transaction | Zero changes to `aplicarDelta` or `MovimientosRepo`; reuses #6's proven classification and error factories; smallest blast radius on shipped code | The venta service re-derives `rechazarMovimiento`'s shape rather than calling `registrarMovimiento`, which owns its own `uow.run` and cannot be composed into a larger transaction as written | Medium |
| **B — Widen `registrarMovimiento` to accept a pre-opened transaction** | Same as A, but literally reuses the existing function N times inside one `uow.run` | Maximum reuse; one function is the single source of truth for "apply delta then write ledger row" | Changes `registrarMovimiento`'s contract, which #6's D2 explicitly forbade ("no second `uow.run`, no nesting"); risks destabilizing shipped, tested code for a change outside its own cycle | Medium-High, plus regression risk |
| **C — Extract a lower-level primitive shared by both** | Refactor the common "aplicarDelta → classify-on-undefined → movimientos.create" tail into one function both callers use | Removes the duplication A accepts, without touching #6's public transaction boundary | A refactor of shipped code as a prerequisite to a new feature; touches files outside this cycle's folder, which complicates the claims-gate freshness boundary and needs its own re-verification | Medium |

No option changes `aplicarDelta` itself.

## Ready for Proposal

Yes, with the same caveat #6's exploration carried: the eight open questions above are genuine
forks and none should be silently resolved by a proposal. Given this change's size — larger
than #6's ~2870-line, 9-slice chain by every structural signal — the review-workload guard
should be expected to flag `Decision needed before apply: Yes` and `Chained PRs recommended:
Yes` at `sdd-tasks` time, at larger scale than #6.
