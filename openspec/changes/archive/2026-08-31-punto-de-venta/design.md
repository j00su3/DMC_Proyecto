# Design: Punto de Venta (Backlog #7)

**Change**: `punto-de-venta` · **Artifact store**: hybrid (this file + Engram `sdd/punto-de-venta/design`)
**Inputs**: `proposal.md` (PD-1..PD-9 are settled and binding — not reopened here), `exploration.md`.
**Update 2026-08-31**: `proposal.md` now also has PD-10..PD-14, settling this file's own "PRODUCT MUST
DECIDE" section below. See that section for the resolution of each item — PD-14 (cart expires after
4h) overrides this file's D14 provisional "no expiry" stance; D14 is amended accordingly.
**Written blind to `specs/`** — `sdd-spec` runs in parallel and cannot see this file, and this file
did not read any spec. Wire error codes below are therefore design *proposals* subject to a
RECONCILE pass at `sdd-tasks`, exactly as #6 did with RECONCILE-1..5.

**Size estimate**: already recorded in `proposal.md:79-93` (~4000–5500 raw diff lines, 12–16 chained
slices, anchored against #6's ~2870/9). Verified present; not restated here.

---

## Technical Approach

`confirmarVenta` mirrors `registrarMovimiento`'s per-item shape (`aplicarDelta` →
classify-on-`undefined` → `movimientos.create`) N times inside **one** `uow.run`, per the proposal's
approach (option A). Three new tables, one Postgres sequence, one new domain folder
(`apps/api/src/ventas/`) following the `proveedores/` three-layer shape, one new POS route, and the
project's first `localStorage`-backed client state.

Nothing in `aplicarDelta`, `MovimientosRepo`, or `registrarMovimiento` is modified (#6 D1/D2).

---

## D1 — Money arithmetic (the correctness fork, resolved before any code exists)

**Facts established by reading source, not assumed**: `productos.precio` is
`numeric('precio', { precision: 12, scale: 2 })` (`apps/api/src/db/schema.ts:169`); Drizzle's default
numeric mode returns it as a **JS string** (`Producto.precio: string`,
`apps/api/src/productos/repository.ts:14`); the wire shape is a decimal string validated by
`precioSchema` (`apps/api/src/routes/productos.ts:63-66`) and its web twin `PRECIO_RE`
(`apps/web/src/features/productos/schemas.ts:16-19`); **no decimal library exists in either
workspace**, and no code in this repository performs money arithmetic today
(`ProductosTable.tsx:44` renders `row.precio` verbatim).

#7 introduces the first four money operations in the project: `subtotal = precio × cantidad`,
`total = Σ subtotal`, `Σ pagos.monto ≥ total`, and `vuelto = Σ pagos.monto − total`.

### Choice: integer minor units (centavos) in a dedicated pure module

`NUMERIC(12,2)` decimal **strings remain the only representation** in the database and on the wire.
Arithmetic happens exclusively on `number` values that are **safe integers of centavos**, produced
and consumed by one small module. `Number()` / `parseFloat` is **never** applied to a money string
anywhere in this change — that rule is the design requirement, the module is only its mechanism.

```ts
// apps/api/src/lib/dinero.ts  (byte-identical twin at apps/web/src/lib/dinero.ts)
export type Centavos = number;                 // non-negative safe integer, never fractional
export const MAX_CENTAVOS = 999_999_999_999;   // the numeric(12,2) ceiling: 9_999_999_999.99

export function aCentavos(monto: string): Centavos;  // "10.5" and "10.50" -> 1050
export function aMonto(centavos: Centavos): string;  // 1050 -> "10.50", always 2 decimals
export function multiplicar(monto: Centavos, unidades: number): Centavos;
export function sumar(valores: readonly Centavos[]): Centavos;
```

- `aCentavos` parses by **string split**, never `parseFloat`:
  `Number(entero) * 100 + Number(frac.padEnd(2, '0'))`. Both operands are integers (`entero ≤ 10^10`,
  `frac < 100`), so the multiply and the add are exact in IEEE-754.
- `aMonto` formats with `Math.trunc(c / 100)` + `String(c % 100).padStart(2, '0')` — integer ops only.
- **Overflow guard**: every operation asserts `Number.isSafeInteger(result) && result <= MAX_CENTAVOS`
  and otherwise throws `saleAmountOutOfRange()`. This is sound even for an inexact product: any
  product above `2^53` is astronomically larger than `MAX_CENTAVOS` (`~10^12`), so the `>` comparison
  is correct regardless of representation error. Without this guard the failure surfaces as a raw
  Postgres `22003`, which #6's S3 rule forbids as a user-facing mechanism.
- **No division exists anywhere in this change** — no discounts, no taxes, no proration — therefore
  **no rounding policy is needed and none is invented**. If a future backlog item adds discounts or
  tax, rounding becomes a *product* decision at that time, not an inherited default.

### Alternatives rejected

| Alternative | Why rejected |
|---|---|
| **Sum in SQL** (`UPDATE ventas SET total = (SELECT SUM(subtotal) …)`, compare payments in SQL) | Exact, and storage stays exact either way — but it moves the PD-1/PD-2/PD-7 payment rules into SQL, where this project's unit tests cannot reach them: services are tested against **fake repos** and `pnpm -r test` **excludes** integration tests. It also forces insert-before-validate ordering (venta → items → `SELECT SUM` → `UPDATE total`), contradicting "validate, then write", and adds round-trips on the POS hot path. Rejected on architecture and testability, not on correctness. |
| **Add a decimal library** (`decimal.js` / `big.js` / `dinero.js`) | Correct, but it would be the project's first runtime decimal dependency and would be needed in **both** workspaces (the web cart must display the same total the server will compute). Every value it handles is exactly representable as an integer within `NUMERIC(12,2)`'s range, so the dependency buys generality this change never uses. Rejected on cost, not correctness. |
| **`Number()` on decimal strings** (`Number(monto) - Number(total)`) | Rejected outright. `0.1 + 0.2 ≠ 0.3`; the loss is silent, TypeScript cannot catch it, and it lands on `vuelto` — the number a cashier hands back in cash. This is the exact risk `proposal.md:101` named. |

### Why the module is duplicated instead of shared

`pnpm-workspace.yaml` globs `apps/*` only; a `packages/` entry would be a new workspace category
(workspace config + tsconfig + build wiring) inside the largest change in the project's history.
The project already has precedent for a deliberately duplicated money **format** rule across the same
boundary (`precioSchema` in the API vs `PRECIO_RE` in the web). The two files therefore carry a
header comment naming each other and the rule: *keep byte-identical; a third consumer promotes this to
`packages/`*. Both ship the **same test-vector table**, so drift is a red test, not a silent bug.

### Belt-and-braces: the database re-checks the JS arithmetic

`CHECK (subtotal = precio_unitario * cantidad)` on `items_venta`. Postgres `numeric × integer` is
exact and yields scale 2, so equality holds. This constraint can only ever fire on an internal
arithmetic bug — never on user input — which is the same class as `movimientos_signo_tipo` and
therefore compatible with #6's "a CHECK violation is never a user-facing error mechanism" rule.
`total = Σ subtotal` is **not** enforced by a trigger (new machinery, rejected); it is covered by an
integration test instead.

---

## Architecture Decisions

| # | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| **D2** | **Two passes inside one `uow.run`.** Pass A (read-only, sorted): `findById` per item → not found / inactive / **price comparison** → compute `total`; then validate payments; then insert `ventas`. Pass B (same sorted array): `aplicarDelta` → classify on `undefined` → `movimientos.create` → `items_venta` insert → per-item #10 alert seam. Then `pagos`. | Single pass computing the total as it goes | PD-5/PD-6 require the price check to surface **before** the sale closes. A single pass would apply stock deltas before discovering a mismatch — harmless (rollback) but it also means every mismatch costs a wasted write cycle and a consumed correlativo. Pass A reads each price **once** and that same value is used for both the mismatch check and `precio_unitario`, so no intra-transaction drift is possible. |
| **D3** | **Sorting by `producto_id` ascending is a named helper (`ordenarItems`) called once, and both passes iterate only its result.** | Sorting inline in the loop header | ADR-0005/A3's deadlock (`40P01`) fix only holds if *every* path uses the same order. `proposal.md:100` names "a future path that loops in click order" as a Medium risk. A named function is assertable by a unit test against call order and by a concurrency integration test; an inline `.sort()` is not. |
| **D4** | **Pass A uses plain `findById`, not `findByIdForUpdate`.** | `SELECT … FOR UPDATE` in producto_id order (would also lock-order the sale and freeze the price) | `FOR UPDATE` reintroduces exactly what ADR-0005 D1 rejected — locks held for the whole transaction on the POS hot path, serializing concurrent sales that share a product. The conditional UPDATE stays the sole stock authority. **Accepted race, documented**: a price committed by another transaction between Pass A and Pass B is ignored; the sale charges the price the cashier confirmed in Pass A, which is what PD-5 asks for. |
| **D5** | **Price authority is a per-item `precioUnitarioEsperado` on the wire, required (`.strict()`).** Mismatch → `409 PRICE_CHANGED` listing **every** mismatched line at once; the client re-submits with the corrected values. | A server-side "confirmation token"; an optional expected-price field; reporting only the first mismatch | Stateless — no second server-side state to expire. Required, so PD-6's re-confirmation is **unrepresentable to bypass** on the wire rather than merely guarded. Comparison is done in centavos, so `"10.5"` vs `"10.50"` is not a false mismatch. All-at-once because reporting one line at a time turns re-confirmation into a loop. |
| **D6** | **PD-7 is enforced by a unique index** `pagos_venta_id_medio_unique (venta_id, medio)`; **PD-2 by a CHECK** `pagos_vuelto_solo_efectivo`: `vuelto = 0 OR medio = 'efectivo'`; **PD-3 by a unique index** `items_venta_venta_id_producto_id_unique`. | Application-level checks only | Structurally identical to the project's existing style (`proveedores_nombre_lower_unique`, `movimientos_merma_solo_salida`, which PD-2 explicitly cites). The application still refuses these cases first with a domain error so the CHECK never becomes the user-facing mechanism; the constraint is the invariant that survives a future writer (#9). |
| **D7** | **`numero_correlativo` is an `integer` column defaulting to `nextval('ventas_numero_correlativo_seq')`**, declared with drizzle's `pgSequence`, plus a unique index. Value is read back from `.returning()`. | Calling `nextval()` as a separate statement; `bigint` | One fewer round-trip; the value can never be forgotten by a future writer. `integer` (max 2.1e9) is inexhaustible for a single shop and stays a JS `number` on the wire — a `bigint` would round-trip as a *second* string-typed numeric field. Because the `ventas` insert must precede the `movimientos.venta_id` FK writes, a rolled-back sale consumes a correlativo — **this is precisely the documented S6 gap** (`TECH-DESIGNv2.md:145-151`), not a defect. **Verification step**: run `pnpm db:generate` twice; the second run must produce no migration. If `pgSequence` does not round-trip, fall back to a hand-written `CREATE SEQUENCE` in the generated SQL (no existing migration in `apps/api/drizzle/` creates a sequence). |
| **D8** | **`movimientos.venta_id` gains a FK to `ventas.id` with `onDelete: 'restrict'`** (column stays nullable). All new FKs (`items_venta.venta_id`, `items_venta.producto_id`, `pagos.venta_id`, `ventas.usuario_id`) are also `restrict`. | `cascade` on the child rows | Every FK in `schema.ts` is `restrict` except `sesiones.usuario_id`. A venta is append-only and is never deleted (#9 anulación is a state change plus a compensating movement, not a delete), so `cascade` would document an intent that contradicts immutability. Adding the constraint is safe today: `venta_id` is currently NULL in every row. |
| **D9** | **`ventas` needs NO fourth `FIELD_CLASSIFICATION` key** (`apps/api/src/auditoria/fields.ts`), and therefore no `entidad_auditoria` enum value and no `recordAudit` call anywhere in `ventas/service.ts`. | Adding a `ventas` key | ADR-0012 rule 1's decision test is written for entities that get PATCHed. A `Venta` is immutable and self-auditing — it already carries its own `usuario_id` and `fecha` — which is structurally the `movimientos` case that rule 2 exempts. Adding the key would require a migration for zero call sites. **Stated explicitly so a later cycle does not reconsider it by accident.** Revisit only if #9 makes a `ventas` row mutable (`anulada_por`/`anulada_en`); that is #9's decision, taken with its own write path in hand. |
| **D10** | **`ventas.estado` (`confirmada` \| `anulada`, default `confirmada`) and `pagos.estado` (`registrado` \| `revertido`, default `registrado`) ship now; `anulada_por` / `anulada_en` / `motivo_anulacion` are deferred to #9.** | Ship the whole anulación shape now (the `movimientos.venta_id` precedent); ship no `estado` at all | Both `estado` columns are ratified at `TECH-DESIGNv2.md:142,155` and are read by #8 (recibo) and #12 (reports), so their absence would force a migration on a *read-only* consumer. The three anulación columns need a FK, a CHECK, and a write path that only #9 can specify; #5's cheap one-nullable-column precedent does not extend to that. |
| **D11** | **POS catalog is a new route `GET /api/ventas/catalogo` owned by `routes/ventas.ts`**, backed by an additive optional argument on `ProductosRepo.list(page, pageSize, q?, opts?: { soloActivos?: boolean })`. | `?activo=true` on the shipped `GET /api/productos`; filtering client-side | PD-8 excludes inactive products entirely and keeps zero-stock ones visible; `list()` today applies **no** `activo` filter, so client-side filtering would break `total` and pagination. Adding a query param to `GET /api/productos` would modify the `product-management` capability contract, which `proposal.md:44-47` states is unchanged. A POS-owned route keeps that boundary and lets the catalog diverge (see the flagged ordering question below) without touching a shipped route's schema. |
| **D12** | **Payment-medium and shape validation split**: missing/unknown `medio`, non-decimal `monto`, empty `items`, empty `pagos` are **wire** `VALIDATION_ERROR`s from Zod at the route; only state conflicts get domain codes. | A domain code per case | Mirrors #6 exactly (`routes/movimientos.ts:38-42`: `.strict()` at the route is what prevents an unrepresentable combination from reaching a CHECK). Proposed new factories in `apps/api/src/lib/errors.ts`, English UPPER_SNAKE per the two-naming-families rule: `DUPLICATE_SALE_ITEM` (400), `PAYMENT_MEDIUM_DUPLICATED` (400), `PAYMENT_BELOW_TOTAL` (409, `details: { total, pagado }`), `CASHLESS_PAYMENT_MUST_MATCH_TOTAL` (409), `PRICE_CHANGED` (409, `details: { items: [{ productoId, precioEsperado, precioActual }] }`), `SALE_AMOUNT_OUT_OF_RANGE` (400). `INSUFFICIENT_STOCK` / `PRODUCT_NOT_FOUND` / `PRODUCT_INACTIVE` are **reused unchanged** from #6. |
| **D13** | **Duplicate `producto_id` in the request body is refused (`DUPLICATE_SALE_ITEM`), never merged server-side.** | Merging server-side | This is the server-side enforcement of PD-3, not a new product rule. Merging would silently change the item count the cashier confirmed and would hide a client bug that the deterministic-order loop (one `aplicarDelta` per product) depends on not existing. |
| **D14** | **Cart persistence: one versioned envelope per user+device**, key `inventienda.pos.carrito.v1.<usuarioId>`, value `{ v: 1, items: [...], savedAt: number }` (`savedAt` = `Date.now()`, rewritten on every mutation). On load: `JSON.parse` inside `try/catch` → **Zod `safeParse`** against the stored-shape schema → **`Date.now() - savedAt > CART_TTL_MS` (4h, PD-14)** → on *any* of these failing, delete the key and start with an empty cart. Writes are `try/catch`ed (quota) and degrade to in-memory. | Bare `JSON.parse`; a migration function per old version; no expiry (this file's original provisional stance, overridden by `proposal.md` PD-14) | `proposal.md:102` names "a stale stored shape from an older release could crash the POS on load" as a Medium risk. Zod is already a web dependency. Discarding is correct rather than lossy: the cart is re-buildable in seconds, and the alternative is a POS that will not open. A version *migration* path is not written until a v2 shape actually exists. The expiry check reuses the identical discard path — an expired cart is not a distinct code path, just another reason the same guard fires. |
| **D15** | **The cart stores a price snapshot** (`productoId, nombre, sku, precioSnapshot, cantidad`) used for display **and** as the `precioUnitarioEsperado` sent at confirmation. | Storing no price and re-fetching on restore | The snapshot is exactly "what the cashier saw", which is the input PD-6's re-confirmation needs. It is display-only authority: the server never trusts it (PD-5), it only compares against it (D5). The web computes the displayed total with the **same** `dinero` module, so the number the cashier says out loud matches the server's to the cent. |

---

## Data Flow

```
POS screen ──add──> carrito reducer ──> localStorage (versioned, per usuario)
    │                    │
    │  GET /api/ventas/catalogo (activos only, PD-8)
    │                    │
    └── confirmar ──> POST /api/ventas  { items[{productoId,cantidad,precioUnitarioEsperado}],
                                          pagos[{medio,monto}] }
                              │
                    routes/ventas.ts  (Zod .strict(), roles: ['encargado','deposito'])
                              │
                    ventas/service.ts  confirmarVenta
                              │
             ordenarItems(by producto_id asc)   ← ADR-0005 / A3
                              │
                        uow.run  ──────────────────────────────────────────┐
                          Pass A  findById ×N → price check → total (centavos)
                                  → payment rules (PD-1/PD-2/PD-7)
                                  → ventas.insert  (nextval correlativo)
                          Pass B  per item, in sorted order:
                                  aplicarDelta → classify-on-undefined
                                  → movimientos.create(tipo:'venta', ventaId)
                                  → items_venta.insert
                                  → ── SEAM (#10, SAVEPOINT alertas) ──
                                  pagos.insert ×M   (vuelto on the efectivo row only)
                        ────────────────────────────────────────────────────┘
                              │
                        201 { venta, items, pagos }
                              │
             web: clear cart (PD-9) + invalidate productosKeys.all
```

Any throw inside `uow.run` rolls the whole sale back: no partial stock, no `items_venta`, no `pagos`,
no `movimientos`. Only the correlativo is consumed (D7).

---

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/src/lib/dinero.ts` | Create | D1 centavos module + overflow guard |
| `apps/api/src/lib/dinero.test.ts` | Create | Shared vector table (twin of the web file) |
| `apps/api/src/db/schema.ts` | Modify | `ventas`, `items_venta`, `pagos`, `venta_estado`/`pago_estado`/`medio_pago` enums, `ventas_numero_correlativo_seq`, D6 constraints, D8 FK on `movimientos.venta_id` |
| `apps/api/drizzle/0006_*.sql` + `meta/` | Create | Generated migration incl. the sequence (D7 double-run check) |
| `apps/api/src/ventas/repository.ts` | Create | `VentasRepo` port + Drizzle adapter (`proveedores/repository.ts` shape) |
| `apps/api/src/ventas/service.ts` | Create | `confirmarVenta`, `ordenarItems`, `rechazarVenta` |
| `apps/api/src/routes/ventas.ts` | Create | `POST /api/ventas`, `GET /api/ventas/catalogo`, `roles: ['encargado','deposito']` |
| `apps/api/src/lib/errors.ts` | Modify | D12 factories |
| `apps/api/src/plugins/repos.ts` | Modify | `ventas: VentasRepo` in `Repos` + `buildRepos` |
| `apps/api/src/productos/repository.ts` | Modify | D11 additive `opts.soloActivos` on `list` only — `aplicarDelta` untouched |
| `apps/api/src/app.ts` | Modify | Register `ventasRoutes` under `{ prefix: '/api' }` |
| `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts` | Regenerate | `pnpm contract` |
| `apps/web/src/lib/dinero.ts` (+ `.test.ts`) | Create | Byte-identical twin (D1) |
| `apps/web/src/features/pos/{carrito,storage,schemas,queries,errorMessages}.ts` | Create | Pure reducer, versioned persistence, wire schemas, keys, message map |
| `apps/web/src/features/pos/{useCarrito,useCatalogo,useConfirmarVenta}.ts` | Create | Cart store hook, catalog query, confirm mutation |
| `apps/web/src/features/pos/{CatalogoGrid,CarritoPanel,PagoPanel}.tsx` (+ `.module.css`) | Create | Two-pane internals, tokens only |
| `apps/web/src/routes/pos.tsx` | Create | `/pos` under `shellLayout` (both roles), grid `1.2fr \| 460px` (`docs/design.md:93`) |
| `apps/web/src/routes/routeTree.ts` | Modify | Register `posRoute` as a `shellLayout` child |
| `docs/BACKLOG.md:42` | Modify | Flip on archive |

`apps/api/src/movimientos/*`, `apps/api/src/auditoria/*` (D9) and `aplicarDelta` are **not modified**.

---

## Interfaces / Contracts

```ts
// apps/api/src/ventas/service.ts
export interface ItemVentaInput {
  productoId: string;
  cantidad: number;              // positive integer; the service derives the negative delta
  precioUnitarioEsperado: string; // what the cashier saw (D5) — required, never trusted as the price
}
export interface PagoInput { medio: MedioPago; monto: string; }   // at most one per medio (PD-7)
export type MedioPago = 'efectivo' | 'tarjeta' | 'transferencia' | 'qr'; // TECH-DESIGNv2.md:154

export interface ConfirmarVentaInput {
  items: ItemVentaInput[];       // >= 1, no duplicate productoId (D13)
  pagos: PagoInput[];            // >= 1
  actor: { id: string; rol: 'encargado' | 'deposito' };
}
export async function confirmarVenta(
  uow: UnitOfWork, input: ConfirmarVentaInput,
): Promise<{ venta: Venta; items: ItemVenta[]; pagos: Pago[] }>;
```

`VentasRepo` is deliberately narrow — `create(NuevaVenta)`, `createItems(ItemVenta[])`,
`createPagos(Pago[])`, `findCatalogo(...)` if D11's read lands here — so a fake is a full replacement,
the same rule `MovimientosRepo` states at `apps/api/src/movimientos/repository.ts:31-33`.

---

## Testing Strategy

| Layer | What to test | Approach |
|---|---|---|
| Unit (api) | `dinero`: `"10.5"`/`"10.50"` → 1050, format round-trip, `MAX_CENTAVOS` boundary, overflow throws, malformed input throws | Vector table shared verbatim with the web twin |
| Unit (api) | `confirmarVenta` with fake repos: `aplicarDelta` **call order is producto_id-ascending regardless of input order**; price mismatch lists every line; `Σ pagos ≥ total`; cashless must equal exactly; `vuelto` lands on the efectivo row and nowhere else; duplicate item/medio refused | Fakes; assert recorded call sequence, not just the result |
| Unit (web) | `carrito` reducer: duplicate add merges (PD-3), explicit empty (PD-9), quantity edits; `storage`: corrupt JSON / wrong `v` / quota → empty cart, key removed, no throw | Pure functions, no RTL |
| Integration (real PG, excluded from the default run) | Insufficient stock on the **last** sorted item leaves zero `productos`/`movimientos`/`items_venta`/`pagos` rows — assert the **database**, not the status; correlativo shows a gap after that rollback (S6); `pagos_vuelto_solo_efectivo` and `pagos_venta_id_medio_unique` reject; `subtotal = precio × cantidad` CHECK holds | Real `createUnitOfWork(db)`, override only the failing dependency (`routes/proveedores.integration.test.ts` precedent) |
| Integration (concurrency) | Two overlapping multi-item sales submitted in opposite click order do not raise `40P01` | The only test that can catch a future click-order regression (D3) |
| Route (api) | 401/403 for anonymous and for a role outside the allowlist; 201 body shape; a bodyless/`Content-Type`-bearing POST behaves as the SPA's `apiFetch` sends it | `app.inject`, with the CLAUDE.md header-parity caveat honoured |
| Route (web) | `/pos` renders catalog + cart; add → confirm → cart cleared and `productosKeys.all` invalidated; `PRICE_CHANGED` surfaces the re-confirmation affordance and does **not** close the sale | Full `routeTree` + `createMemoryHistory`, **`await router.load()` before every render** |

Every test above must be mutation-probed before it is trusted (CLAUDE.md: "a test you have never
seen fail is not evidence").

---

## Threat Matrix

**N/A** — this change introduces no routing of shell commands, no subprocess, no VCS/PR automation,
no executable-file classification, and no process integration. The only external boundaries are HTTP
(guarded by per-route `config.roles` in `apps/api/src/plugins/auth.ts` plus Zod `.strict()` bodies)
and SQL (parameterized by Drizzle; the one dynamic-pattern path, `escapeLikePattern`, is reused
unchanged from `productos/repository.ts:79-81`).

---

## Migration / Rollout

Additive only. No existing table, route, or repository behaviour changes; `productos/repository.ts`
gains an **optional** argument with the existing behaviour as its default.

**Manual step, not automatable here**: migrations against Neon are run by hand
(`docs/adrs/0010-despliegue-tiers-gratuitos.md:71-72`). This change adds three tables and a sequence,
so the deploy will succeed and then **500 on every `/api/ventas*` request until `pnpm db:migrate` is
run**. That ordering belongs in the release checklist for the last slice.

`pnpm contract` must be re-run and the regenerated `openapi.json` / `schema.d.ts` **staged** before
`pnpm contract:check` is believed (CLAUDE.md: it compares the tree against the index).

Delivery is chained/stacked PRs; `sdd-tasks` owns the slicing and is expected to report
`Chained PRs recommended: Yes` and `Decision needed before apply: Yes` (`proposal.md:91-93`).

---

## PRODUCT MUST DECIDE — flagged, now RESOLVED (2026-08-31)

PD-1..PD-9 did not cover the following. Per the project rule that a design phase which finds itself
deciding product behaviour must flag the conflict rather than quietly resolving it
(CLAUDE.md, SDD workflow), each item below was flagged with the design's provisional technical
stance instead of being decided here. The owner has since answered all four; each is now binding as
`proposal.md` PD-10..PD-14. This section is kept as the historical record of what was flagged and why.

1. **Non-cash overpayment.** PD-2 fixes `vuelto` to the cash row and requires an exact sum when there
   is no cash payment, but nothing states whether **non-cash media may exceed the total**. Today's
   rules would accept `total 100 = tarjeta 120 + efectivo 5` and compute `vuelto = 25` — i.e. cash
   change handed back for a card overcharge, with `vuelto` larger than the cash tendered.
   *Provisional stance*: refuse it — require `Σ(pagos where medio ≠ efectivo) ≤ total`.
   → **Resolved as `proposal.md` PD-10, matching the provisional stance.**
2. **POS catalog ordering and paging.** PD-8 settles *which* products appear, not their order or how
   the cashier moves through them. `ProductosRepo.list` orders `creadoEn desc` (newest first), which
   is the wrong default for a POS grid. *Provisional stance*: alphabetical by `nombre`, paginated at
   the existing `PAGE_SIZE = 20`. D11's separate endpoint exists precisely so this can be answered
   without touching a shipped route.
   → **Resolved as `proposal.md` PD-12, matching the provisional stance.**
3. **Partial-stock lines in the cart.** PD-8 covers only *zero* stock. If stock is 3 and the cashier
   types 5, does the client refuse at add/edit time using the catalog's `stockActual`, or does only
   the server refuse at confirmation? *Server side is already settled and is not in question*:
   `aplicarDelta` refuses and the whole sale rolls back (`INSUFFICIENT_STOCK`). The gap is purely the
   client-side affordance.
   → **Resolved as `proposal.md` PD-13 — opposite of the provisional stance.** The client now DOES
   block at add/edit time, on the explicit understanding that `stockActual` is a snapshot and can be
   stale; the server confirmation stays the sole authority regardless.
4. **Cart lifetime.** PD-9 covers clear-on-confirm and explicit empty. Nothing says whether a cart
   restored days later (or after a price change, or after a shift change on a shared terminal) should
   still be there. *Provisional stance*: no expiry — restore as-is and let PD-5/PD-6 catch stale
   prices at confirmation.
   → **Resolved as `proposal.md` PD-14 — opposite of the provisional stance.** The cart now expires
   after 4 hours of inactivity; see D14 above (amended with `savedAt` and the TTL check).

## Open Questions (technical, resolvable without the owner)

- [ ] Does drizzle-kit `pgSequence` round-trip cleanly through a double `pnpm db:generate`? First
      slice must prove it; the fallback is a hand-written `CREATE SEQUENCE` (D7).
- [ ] Wire error codes (D12) are design proposals written blind to `specs/`. A RECONCILE pass at
      `sdd-tasks` must settle any divergence **before** code exists — renaming a code later is a spec
      delta, not a refactor (CLAUDE.md).
- [ ] Two browser tabs on the same device share one cart key and last-write-wins. Accepted as a
      single-terminal limitation; confirm no test asserts otherwise.
