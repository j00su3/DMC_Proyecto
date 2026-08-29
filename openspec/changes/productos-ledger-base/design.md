# Design: productos-ledger-base (backlog #5)

## Authority and scope of this document

`docs/TECH-DESIGNv2.md` is the design of record (its line 3 supersedes v1). ADR-0003 governs
the stock model, ADR-0012 the audit/ledger boundary. Every product-behaviour decision is
already settled in `proposal.md` (owner-answered 2026-08-29) — this document decides **how to
build them**, not what they are. Where a rule looked like it belonged to the spec and I had to
take a position to keep the design coherent, it is marked **[RECONCILE]** and listed again at
the end. `sdd-spec` is running in parallel and I cannot see its output; every **[RECONCILE]**
item is a place where the spec wins if it disagrees.

## Technical Approach

Mirror the shipped `proveedores` vertical exactly — `routes/*.ts` → `*/service.ts` →
repository port + Drizzle adapter, every write inside `uow.run`, audit via `recordAudit` as
the last statement of the transaction callback — and add one thing `proveedores` does not
have: a **signed-delta stock mutation** that is the single seam through which
`productos.stock_actual` ever changes. #5 calls it exactly once (the create-time `ajuste`).
#6 calls it for every entrada/salida/ajuste without changing its shape.

Frontend mirrors `apps/web/src/features/usuarios/` as a peer `features/productos/`, with
routes registered under `shellLayout` (deposito reads inventory, so `encargadoLayout` would be
wrong) and quiebre/bajo chips computed client-side from two numbers already on the DTO.

## Architecture Decisions

### D1 — The stock/ledger seam: one conditional UPDATE, never a plain SET

**Choice.** `ProductosRepo.aplicarDelta(id, delta)` issues one statement:

```
UPDATE productos
   SET stock_actual = stock_actual + :delta
 WHERE id = :id
   AND activo = true
   AND stock_actual + :delta >= 0
RETURNING stock_actual
```

It returns `number | undefined`. `undefined` means the guard rejected — the service maps that
to a domain error; it never means "row missing" alone, because the caller has already read the
row. The `stock_actual + :delta >= 0` form is the signed-ledger spelling of the brief's
`stock >= :n`: for a salida of `n`, `delta = -n`, so the two predicates are identical.

`crearProducto` therefore inserts the product with `stock_actual = 0`, then — only when
`stockInicial > 0` — calls `aplicarDelta(id, stockInicial)` and writes the `movimientos` row
with `stock_resultante` taken from the UPDATE's `RETURNING`, never recomputed in TypeScript.

**Alternatives rejected.**

| Option | Why rejected |
|---|---|
| Insert the product with `stock_actual = stockInicial` directly | Works for #5 and only #5. #6 then has to introduce the conditional UPDATE and retrofit the initial-stock path onto it, which is precisely the seam the brief says not to leave. It also means #5 ships a code path that writes stock without a guard — the thing ADR-0003 exists to prevent. |
| `SELECT … FOR UPDATE` then a plain `SET` in TS | Two statements and a TS-side arithmetic that the database cannot check. The CHECK/guard lives where the write lives or it does not live. |
| A database trigger keeping `stock_actual` in sync with the ledger | Moves the invariant somewhere no test in this repo can see it, and makes `stock_resultante` circular. Rejected on observability, not correctness. |

**Rationale.** One statement, one guard, one returned truth. `stock_resultante` is by
construction the value Postgres committed, so `Σ(movimientos.cantidad) = productos.stock_actual`
holds from the first row — which is exactly what #14's reconciliation script will assert.

### D2 — Where `recordAudit` sits, and what it is allowed to see

Inside `uow.run`, after the stock and ledger writes, as the last statement — same position as
`proveedores/service.ts:101-109`. The `movimientos` insert is **not** an audit write:
ADR-0012 keeps the record trail (`auditoria`) and the stock trail (`movimientos`) apart, and
this change is the first one where both fire in the same transaction, so the distinction stops
being theoretical.

Consequence for `FIELD_CLASSIFICATION.productos`: `stockActual` goes in **`excludedFields`**,
not `auditableFields`. `recordAudit`'s `filterExcluded` then strips it from both snapshots, so
no stock change is ever double-filed into `auditoria`. Every other column
(`id`, `nombre`, `sku`, `categoria`, `stockMinimo`, `precio`, `proveedorId`, `activo`,
`creadoEn`) is auditable. **[RECONCILE-1]** — if the spec says the `crear` audit snapshot
carries the opening stock, this flips and the ledger becomes the sole reader of that column
only for updates.

### D3 — The audit compile gate lands in S1, with its own failing test first

`AuditableEntidad = keyof typeof FIELD_CLASSIFICATION` (`apps/api/src/auditoria/service.ts:8`)
means `recordAudit({ entidad: 'productos' })` **does not compile** until
`apps/api/src/auditoria/fields.ts:20-41` gains a `productos` key.

The trap that cost #4 a correction cycle is still armed: `entidadAuditoria` in
`apps/api/src/db/schema.ts:96-100` **already lists `'productos'`**. Checking the pgEnum and
concluding the wiring is done is the exact wrong move — the pgEnum is the database's opinion,
`FIELD_CLASSIFICATION` is the compiler's, and only the second one gates `recordAudit`.

So the `fields.ts` entry ships in **S1**, the same slice as the schema (it needs
`getTableColumns(productos)` to exist and nothing more), two slices before the first caller.
Guarded by extending `apps/api/src/auditoria/fields.test.ts` with a `productos` case mirroring
its existing `proveedores` case at `:33-47` — RED first, failing **by column name** when one is
missing — plus a compile-level assertion that `entidad: 'productos'` type-checks.

### D4 — All four error factories ship in S1, before any thrower exists

#4 placed error factories in a later slice than the repository that throws one, and `sdd-tasks`
had to catch it. The fix is not "be careful about ordering" — it is to remove the ordering
problem: `apps/api/src/lib/errors.ts` gains all four factories in S1, ~40 lines, zero
dependencies, nothing to order.

| Factory | Code | Status | First thrower |
|---|---|---|---|
| `productNotFound()` | `PRODUCT_NOT_FOUND` | 404 | S3 service |
| `skuAlreadyInUse()` | `SKU_ALREADY_IN_USE` | 409 | S2 repo (caught 23505) |
| `fieldReservedForEncargado()` | `FIELD_RESERVED_FOR_ENCARGADO` | 403 | S3 service |
| `supplierInactive()` | `SUPPLIER_INACTIVE` | 409 | S3 service |

`FIELD_RESERVED_FOR_ENCARGADO` is the owner-approved deviation from `docs/TECH-DESIGNv2.md:120`
and `:235-236`'s ratified `campo_reservado_encargado`, decided in `proposal.md` D2 with the
`LAST_ACTIVE_ENCARGADO` precedent (`apps/api/src/lib/errors.ts:154-160`). It is **not**
re-decided here.

`SUPPLIER_INACTIVE` is a name I had to invent — the proposal ratifies the rule ("refused with a
named error code") but not the code. 409 by the `emailAlreadyInUse()` reasoning: the request is
valid, the current state of the suppliers collection conflicts, and the remedy (reactivate the
supplier) changes that state. **[RECONCILE-2]** — the spec owns this wire name.
`supplierNotFound()` already exists and is reused for a `proveedor_id` that resolves to nothing.

### D5 — Schema, constraints, and the SKU folding question

New migration `apps/api/drizzle/0004_*.sql`, generated by `pnpm db:generate`, never hand-written.

`movimientoTipo` pgEnum ships **complete** (`entrada | salida | ajuste | venta | anulacion`) so
#6/#7/#9 never reopen the type.

| Object | Shape | Note |
|---|---|---|
| `productos.sku` | `text not null` | stored verbatim, no TS-side case normalisation |
| `productos_sku_lower_unique` | `uniqueIndex on lower(sku)` | see below |
| `productos.categoria` | `text` nullable | free text, per proposal answer 1 |
| `productos.precio` | `numeric(12,2) not null` | never float (S10, `TECH-DESIGNv2.md:103`) |
| `productos.stockActual` | `integer not null default 0` | only D1 writes it |
| `productos.stockMinimo` | `integer` nullable | null ⇒ never a `bajo` chip, never an alert |
| `productos.proveedorId` | `uuid not null → proveedores.id`, `onDelete: 'restrict'` | **[RECONCILE-3]** |
| `movimientos.ventaId` | `uuid` nullable, **no FK** | `ventas` does not exist until #7; the FK is added by #7's migration |
| `movimientos_signo_tipo` | CHECK: `entrada > 0`, `salida`/`venta` `< 0`, `anulacion > 0`, `ajuste` unconstrained | verbatim from `TECH-DESIGNv2.md:124-125` |
| `movimientos_discrepancia_solo_ajuste` | CHECK: `es_discrepancia = false OR tipo = 'ajuste'` | A9, `TECH-DESIGNv2.md:126-127` |
| `movimientos_producto_id_fecha_idx` | index on `(producto_id, fecha)` | serves #6's history and #14's reconciliation; ships now because it is free and adding it later reopens the table |

**SKU uniqueness is case-folded**, via a functional `lower(sku)` unique index — the same
technique `proveedores_nombre_lower_unique` uses (`apps/api/src/db/schema.ts:62-64`), for a
different reason. For supplier names the point was human equivalence; here the point is
`TECH-DESIGNv2.md:101`'s stated purpose for the constraint — *"único → cubre 'producto
duplicado'"*. `ABC-1` and `abc-1` are the same product by any reading, and a stock clerk typing
a code at a keyboard is exactly the input that produces the pair. Case-sensitive uniqueness
would let the duplicate through while claiming to prevent it.

Following #4's D2 rule: no `findBySku` on the port, so there is no TS-side folding to get
wrong, and any future SKU selector **must** be written `where lower(sku) = lower($1)`.

The collation caveat #4 measured carries over but is weaker here.
`openspec/changes/archive/2026-08-29-gestion-proveedores/design.md:345-363` records
`datcollate = en_US.utf8` on the local Docker instance, with the surviving caveat that a
deployment initialised with `C` collation folds ASCII only. Supplier names contain accents;
SKUs in practice do not, so for the realistic input set `C` and `en_US.utf8` fold identically
and this change is materially less exposed than #4 was. That is an argument, not a proof —
S1's integration test asserts the folding pair against whatever the database actually is, so a
`C`-collation deployment with a non-ASCII SKU produces a real signal rather than silence.

Deliberately **not** added: a `cantidad <> 0` CHECK. `TECH-DESIGNv2.md:125` says `ajuste` is
*"libre"*, and inventing a stricter product rule than the authority is not the design's call.
A zero-quantity ajuste is unreachable from #5 (the movement only exists when
`stockInicial > 0`). Flagged for #6 as an open question, with the cost named: adding it later
is one more migration on this table.

**[RECONCILE-4]**: `movimientos.motivo`. `TECH-DESIGNv2.md:126` makes it mandatory for ajustes
and merma salidas. "Merma" is a reason, not a `tipo`, so only half is expressible as a CHECK.
I recommend shipping `CHECK (tipo <> 'ajuste' OR motivo IS NOT NULL)` now, because #5's only
writer already satisfies it (fixed motivo `"stock inicial (alta de producto)"`) and because
the proposal's stated intent is that later migrations do not reopen this table. If the spec
scopes the motivo rule entirely to #6, drop the CHECK and let #6 add it.

### D6 — Field-level RBAC on `stock_minimo`: service layer, keyed off payload presence

`docs/TECH-DESIGNv2.md:402` puts this rule in the product service layer explicitly, because
ADR-0007's RBAC is per-endpoint and this permission is per-field. Implementation:

- The route builds `{ actorId, actorRol }` from `request.user` — a full `Usuario`, so `rol` is
  already there (`apps/api/src/plugins/auth.ts:22-23`). Generalise
  `routes/proveedores.ts:76-81`'s `requireActorId` into `requireActor(user): { id, rol }`.
- `crearProducto` / `actualizarProducto` check **before** `uow.run` — a rejected request should
  never open a transaction: if `actorRol === 'deposito'` and `'stockMinimo'` is a **present key**
  on the payload, throw `fieldReservedForEncargado()`.
- Key presence, not `!== undefined`. `{ stockMinimo: null }` is a deposito *clearing* the
  threshold and must be refused too; `undefined`-checking would let it through. Fastify+Zod
  hands the handler a parsed object, so the route passes the raw parsed body key set down.

**How it composes with `config.roles`.** They are different questions at different layers and
deliberately produce different codes:

| Route | `config.roles` | Service guard |
|---|---|---|
| `GET /api/productos`, `GET /api/productos/:id` | `['encargado','deposito']` | — |
| `POST /api/productos`, `PATCH /api/productos/:id` | `['encargado','deposito']` | field guard (deposito **may** create/edit products — `TECH-DESIGNv2.md:233`) |
| `POST /api/productos/:id/{deactivate,reactivate}` | `['encargado']` | — (plain `FORBIDDEN` from the hook) |

The hook answers *may you call this endpoint*; the service answers *may you set this field*.
A deposito deactivating a product gets `FORBIDDEN` from the preHandler before any handler runs;
a deposito sending `stock_minimo` gets `FIELD_RESERVED_FOR_ENCARGADO` from the service. Two
403s with two codes is the correct outcome, not an inconsistency.

The SPA's 🔒 on the field is an affordance only (`TECH-DESIGNv2.md:121`, `:238`). The route test
that calls the endpoint directly with a deposito session is the proof.

### D7 — Search (`q`): ILIKE over name and SKU, no new index

Repository `list(page, pageSize, q?)` composes one predicate into **both** statements:

```
(nombre ILIKE :pattern OR sku ILIKE :pattern)
```

with `pattern = '%' + escaped(q) + '%'`, where `escaped` neutralises `\`, `%` and `_`. Drizzle's
`ilike` passes the pattern as a bound parameter, so an unescaped `%` typed by a user is still a
wildcard — the escape is required, and it is pattern escaping, not case folding, so it does not
violate #4's "fold only in the database" rule.

**The predicate must be applied to the count statement too.** `DrizzleProveedoresRepo.list`
(`apps/api/src/proveedores/repository.ts:66-82`) runs two statements — a page query and a
`count(*)::int`. If `q` reaches only the first, `total` counts the whole table, `Pagination`
renders phantom pages, and the user pages into an empty screen. This is the single most likely
defect in the search work and it belongs in a test, not a comment.

**No new index, and that is the honest answer.** A leading-wildcard `ILIKE '%x%'` cannot use a
btree index — not a plain one, not a `lower()` one. Only a `pg_trgm` GIN index would help, and
that needs a Postgres extension, which #4 rejected specifically to keep deployment at zero
manual steps. At the catalog size the proposal describes (hundreds of rows) a sequential scan
is sub-millisecond and an index would be cost with no benefit. Revisit trigger, stated so a
future reader is not left guessing: tens of thousands of products, or a measured list latency
above ~200 ms. Note also that `productos_sku_lower_unique` serves **uniqueness only** — it does
not accelerate this search, and nobody should assume it does.

### D8 — Inactive supplier: guard the *incoming choice*, never the stored row

`crearProducto` inside `uow.run`, before the product insert:
`repos.proveedores.findById(input.proveedorId)` → missing ⇒ `supplierNotFound()`,
`activo === false` ⇒ `supplierInactive()`. `actualizarProducto` runs the same check **only when
`proveedorId` is present in the PATCH payload**.

That last clause is the whole design. If the guard were written as "the product's supplier must
be active", then every edit of a product whose supplier was deactivated later would start
failing — which is exactly the #4 guarantee this rule is supposed to protect
(`docs/BACKLOG.md:34`, proposal lines 266-274). The guard keys off what the caller is choosing,
never off what the row already holds.

**What does NOT change when a supplier is deactivated afterwards — nothing.** No cascade, no
`activo` flip on the product, no broken FK: `DrizzleProveedoresRepo.setActivo`
(`apps/api/src/proveedores/repository.ts:154-161`) touches `activo` and nothing else, and no
DELETE path exists anywhere in the codebase. The product still lists, still reads, still
PATCHes (including PATCHes that touch `nombre`, `precio`, `stock_minimo`…), still deactivates
and reactivates, and will still accept movements when #6 ships. The only refused operation is
*choosing* an inactive supplier on a create or an explicit supplier change.

No row lock on `proveedores` from this path, deliberately. There is a TOCTOU window — a
supplier deactivated between the check and the commit — but locking a `proveedores` row from
the product-create path introduces a cross-table lock-ordering hazard against
`setProveedorActivo`, which already takes `findByIdForUpdate` on the same row. The unguarded
outcome is a product created microseconds before its supplier was deactivated, which is
indistinguishable from one created a second earlier, and which D8's own rule declares
acceptable and permanent. Cost of the lock exceeds the cost of the window.

### D9 — UI structure

Routes under `shellLayout` (`apps/web/src/routes/shellLayout.tsx`), **not** `encargadoLayout`:
deposito reads inventory, so a subtree role guard would be wrong. Write controls gate
per-component with the 🔒 affordance; the server 403 is the boundary. Same reasoning #4/#4.1
used.

| Route | Path | Parent |
|---|---|---|
| `productosListRoute` | `/inventario` | `shellLayout` |
| `productosNuevoRoute` | `/inventario/nuevo` | `shellLayout` |
| `productosDetalleRoute` | `/inventario/:id` | `shellLayout` |

`apps/web/src/features/productos/` mirrors `features/usuarios/` file-for-file: `queries.ts`
(key factory + `productosListQueryOptions(page, q)` + `PAGE_SIZE = 20`), `useProductos.ts`,
`useProducto.ts`, `useCrearProducto.ts`, `useActualizarProducto.ts`, `useEstadoProducto.ts`,
`schemas.ts`, `errorMessages.ts`, `format.ts`, `ProductosTable.tsx`, `ProductoForm.tsx`.
Mutations invalidate, never `setQueryData` — the uniform rule from
`features/usuarios/queries.ts:5-18`.

**Chips are derived, never stored.** A pure function in `format.ts`:

```
estadoStock(stockActual, stockMinimo):
  stockActual <= 0                                   -> 'quiebre'
  stockMinimo !== null && stockActual <= stockMinimo -> 'bajo'
  otherwise                                          -> 'ok'
```

`stockMinimo === null` can never yield `bajo` — `TECH-DESIGNv2.md:251-252` requires that a
product without a threshold produces no false alarms. Rendered through the existing
`components/ui/StatusChip.tsx`. No server-computed status field on the DTO.

**Search input** writes `q` into the route's `validateSearch` so it is bookmarkable and the
loader participates in it. Changing `q` resets `page` to 1 — otherwise a filtered result of two
pages is viewed at page 7 and renders empty. Same clamping style as
`routes/usuarios.tsx:24-30` (`.catch()`, never throw).

**`NAV_ITEMS`** (`apps/web/src/components/ui/AppShell.tsx:15-23`): the inert
`{ label: 'Inventario' }` gains `to: '/inventario'`. The docblock at `:6-14` states that a `to`
is a type error until the route is registered — so `AppShell.tsx`, `routes/productos.tsx` and
`routes/routeTree.ts` must change **in the same slice**, and `AppShell.test.tsx`'s inert-marker
expectation for Inventario has to move to the linked-item expectation in that same commit.

`errorMessages.ts` switches on `PRODUCT_NOT_FOUND`, `SKU_ALREADY_IN_USE`,
`FIELD_RESERVED_FOR_ENCARGADO`, `SUPPLIER_INACTIVE`, `VALIDATION_ERROR`, `FORBIDDEN`.

## Data Flow

    POST /api/productos  { …, stockInicial: 5, stockMinimo?: 3 }
      │
      ├─ preHandler  config.roles ['encargado','deposito']  ─── 403 FORBIDDEN
      │
      ├─ requireActor(request.user) → { id, rol }
      ├─ field guard: rol==='deposito' && 'stockMinimo' in body → 403 FIELD_RESERVED_FOR_ENCARGADO
      │
      └─ uow.run(repos =>                         ── ONE TRANSACTION ──
            proveedores.findById(proveedorId)     → inactive ⇒ 409 SUPPLIER_INACTIVE
            productos.create(...)                 → 23505 ⇒ 409 SKU_ALREADY_IN_USE
            if stockInicial > 0:
              stock = productos.aplicarDelta(id, +5)        ← the D1 conditional UPDATE
              movimientos.create({ tipo:'ajuste', cantidad:+5,
                                   motivo:'stock inicial (alta de producto)',
                                   esDiscrepancia:false, stockResultante: stock })
            recordAudit(repos.auditoria, { entidad:'productos', accion:'crear', … })
         )                                        ── all four, or none ──

## File Changes

| File | Action | Slice |
|---|---|---|
| `apps/api/src/db/schema.ts` | Modify — `movimientoTipo`, `productos`, `movimientos` | S1 |
| `apps/api/drizzle/0004_*.sql` + `meta/` | Create — generated | S1 |
| `apps/api/src/lib/errors.ts` | Modify — 4 factories | S1 |
| `apps/api/src/auditoria/fields.ts` | Modify — `productos` entry | S1 |
| `apps/api/src/auditoria/fields.test.ts` | Modify — exhaustiveness + compile gate | S1 |
| `apps/api/src/db/schema.integration.test.ts` | Modify — CHECKs, folding, FK | S1 |
| `apps/api/src/productos/repository.ts` | Create — port + Drizzle adapter | S2 |
| `apps/api/src/movimientos/repository.ts` | Create — port (`create` only) + adapter | S2 |
| `apps/api/src/plugins/repos.ts` | Modify — two new members | S2 |
| `apps/api/src/productos/service.ts` | Create | S3 |
| `apps/api/src/routes/productos.ts` | Create | S4 |
| `apps/web/src/api/schema.d.ts` | Regenerate | S4 |
| `apps/api/src/routes/productos.integration.test.ts` | Create | S5 |
| `apps/web/src/features/productos/*` (list half) | Create | S6 |
| `apps/web/src/routes/productos.tsx`, `routeTree.ts`, `components/ui/AppShell.tsx(+test)` | Create/Modify | S6 |
| `apps/web/src/features/productos/*` (form half) | Create | S7 |
| `apps/web/src/routes/productosNuevo.tsx`, `productosDetalle.tsx` | Create | S7 |

## Interfaces / Contracts

```ts
// apps/api/src/productos/repository.ts
export interface ProductosRepo {
  list(page: number, pageSize: number, q?: string): Promise<{ rows: Producto[]; total: number }>;
  findById(id: string): Promise<Producto | undefined>;
  findByIdForUpdate(id: string): Promise<Producto | undefined>;
  create(input: NuevoProducto): Promise<Producto>;      // maps 23505 -> SKU_ALREADY_IN_USE
  update(id: string, cambios: CambiosProducto): Promise<Producto>;  // no stockActual key, ever
  setActivo(id: string, activo: boolean): Promise<Producto>;        // never DELETE
  aplicarDelta(id: string, delta: number): Promise<number | undefined>; // D1; undefined = guard rejected
}

// apps/api/src/movimientos/repository.ts — intentionally one method in #5.
export interface MovimientosRepo {
  create(input: NuevoMovimiento): Promise<Movimiento>;
}
```

`CambiosProducto` has **no `stockActual` key** and `actualizarProductoBody` (Zod, `.strict()`)
has no `stock_actual` field — absent from the shape, not accepted-then-rejected
(`TECH-DESIGNv2.md:113-115`, `:247-248`; the technique is
`routes/proveedores.ts:52-60`). `.strict()` is what makes an incoming `stock_actual` a
`VALIDATION_ERROR`.

`MovimientosRepo` stays one method on purpose: it makes the forced-failure fake in the
atomicity test an honest full replacement rather than a partial stub, and #6 extends it.

## Compile-order walk

Every symbol is introduced no later than the slice that first references it.

| Symbol | Introduced | First referenced |
|---|---|---|
| `productos` / `movimientos` tables, `movimientoTipo` | S1 | S1 (`fields.test.ts`), S2 |
| `skuAlreadyInUse()` | S1 | **S2** (repo `create` catch) — the #4 trap, closed |
| `productNotFound()`, `fieldReservedForEncargado()`, `supplierInactive()` | S1 | S3 |
| `FIELD_CLASSIFICATION.productos` | S1 | S3 (`recordAudit`) — will not compile without it |
| `Producto`, `ProductosRepo`, `aplicarDelta` | S2 | S3 |
| `MovimientosRepo.create` | S2 | S3 |
| `Repos.productos` / `Repos.movimientos` | S2 | S3 (`uow.run` callback) |
| `crearProducto` … `setProductoActivo` | S3 | S4 |
| `requireActor()` | S4 | S4 |
| `paths['/api/productos']` in `schema.d.ts` | **S4** | S6 (`queries.ts` types) — regeneration cannot slip to S6 |
| `productosListRoute` | S6 | S6 (`routeTree.ts`) |
| `to: '/inventario'` in `NAV_ITEMS` | S6 | S6 — type error unless the route is registered in the same slice |

## Testing Strategy

Strict TDD: RED before GREEN in every slice, including the schema slice (a CHECK that was never
seen to reject anything is not a tested CHECK).

| Layer | What | How |
|---|---|---|
| DB integration | sign↔tipo CHECK; `es_discrepancia` only on `ajuste`; `lower(sku)` collision; FK restrict; `db:generate` twice emits no second migration | `schema.integration.test.ts`, raw inserts — a CHECK is only provable at the database |
| Repo unit/integration | `aplicarDelta` returns the new stock; returns `undefined` when `activo=false`; returns `undefined` when the result would go negative; `list(q)` filters **and** counts | `productos/repository.integration.test.ts` |
| Service unit | field guard fires on `{stockMinimo: null}` from deposito and not from encargado; inactive-supplier guard fires on create and on a supplier-changing PATCH, and **does not** fire on a PATCH that omits `proveedorId`; `stockInicial = 0` writes no movement | fakes, mirroring `proveedores/service.test.ts` |
| Route unit | role matrix per route; `.strict()` rejects `stock_actual` with `VALIDATION_ERROR`; `q` reaches the service; DTO shape | `app.inject` with injected fakes |
| API integration | atomicity, audit rows, RBAC with real sessions, SKU 409 with casing intact, search + pagination | Docker `inventienda-postgres-1`; `*.integration.test.ts`, excluded from the default run by `apps/api/vitest.config.ts:7` |
| Web route | list renders, chips derive correctly, search updates the URL and resets page, form submits, 🔒 for deposito, error codes map to messages | full `routeTree` + `createMemoryHistory`, **`await router.load()` before render** |

**The atomicity proof.** The invariant "stock and ledger move together or not at all"
(`TECH-DESIGNv2.md:259-260`) is not provable with fakes. Following the `failingUow` technique at
`apps/api/src/routes/proveedores.integration.test.ts:526-543` — wrap a **real**
`createUnitOfWork(db)` and replace one repo with a thrower, so the product INSERT is a genuine
Postgres write and the ROLLBACK is a genuine ROLLBACK:

1. **Positive.** Create with `stockInicial = 5` ⇒ `productos.stock_actual = 5`; exactly one
   `movimientos` row with `tipo='ajuste'`, `cantidad=5`, `stock_resultante=5`,
   `es_discrepancia=false`, motivo verbatim `"stock inicial (alta de producto)"`; and
   `select sum(cantidad) from movimientos where producto_id = …` equals `stock_actual`. That
   last assertion is #14's reconciliation invariant, asserted on day one.
2. **Ledger fails.** `movimientos.create` throws ⇒ zero `productos` rows, zero `movimientos`
   rows, zero `auditoria` rows. This is the one that proves the ledger and the stock column are
   one transaction — #4's suite only ever forced the *audit* repo to fail.
3. **Audit fails.** `auditoria.record` throws ⇒ same three zeroes, response
   `500 AUDIT_WRITE_FAILED`. Direct mirror of `proveedores.integration.test.ts:523-565`.
4. **Zero initial stock.** `stockInicial = 0` ⇒ product row exists, **zero** `movimientos`
   rows (`TECH-DESIGNv2.md:111`, `:246`).

**`await router.load()` is mandatory in every web route test**, before render, without
exception. A test that leans on `findBy`'s retry to paper over an unsettled loader passes in
isolation and fails under full-suite contention. The existing suites already do this 19 times
across five files — it is the house rule, not a preference.

**Route-level coverage, not hook-level.** #3.1 shipped two defects behind green hook tests, one
of which reached production in #2.1. Every behaviour in the table above that a user can reach
through a screen gets an assertion at the route level, through the real `routeTree`. Hook tests
are additional, never a substitute.

## Threat Matrix

Routing here is in-application HTTP and SPA routing only. No shell command, subprocess,
VCS/PR automation, executable-file classification, or process-integration boundary is
introduced or modified by this change — `N/A` for every row of
`references/threat-matrix.md`. The authorization surface that *is* introduced (D6, and the
deactivate/reactivate role gate) is covered as ordinary RBAC testing above, with the
server-side proof required by `TECH-DESIGNv2.md:238`.

## Slicing, budgets, and what survives a deadline

Target ~600–800 changed lines per PR (above the usual 400 budget, accepted deliberately per
proposal D1 to reduce CI round-trips). Deadline 2026-09-01; today 2026-08-29; #6 must start
after this.

| Slice | Content | Prod lines | Test lines | Demo-critical |
|---|---|---|---|---|
| S1 | schema + migration + errors + `fields.ts` | ~230 | ~320 | **Yes** |
| S2 | both repositories + `repos.ts` | ~300 | ~420 | **Yes** |
| S3 | product service | ~230 | ~400 | **Yes** |
| S4 | routes + role matrix + `schema.d.ts` | ~280 | ~380 | **Yes** |
| S5 | API integration suite | 0 | ~500 | Partly — see below |
| S6 | list screen + search + chips + nav | ~380 | ~330 | **Yes** |
| S7 | create/edit form + activate controls | ~420 | ~380 | No |

**Router-level integration tests are budgeted explicitly**, because the last three cycles
underestimated by 17%–165% and every miss was this line item. The numbers above are not
padding: #4's equivalent API integration suite was **526 lines for 13 tests**
(`proveedores.integration.test.ts`), and #5's is strictly larger — it adds four atomicity
tests, the CHECK-constraint proofs and the search/pagination pair. S6/S7's web route tests
(~330 and ~380) are sized against `routes/usuarios.test.ts` and its two siblings, which are the
only honest comparables in this repo.

**Load-bearing for a 2026-09-01 demo:** S1, S2, S3, S4, S6. Below that set there is either no
data or no screen, and a backend-only #5 shows nothing new (proposal D1).

**S5 is not droppable, but it is compressible.** It is the only proof of the ADR-0003 invariant,
which is the entire point of #5 — shipping the invariant unproven would be shipping the risk,
not the feature. If time runs short, drop the *breadth* (the RBAC matrix, pagination and search
re-proofs, all of which S4's route unit tests already cover against fakes) and keep exactly the
four atomicity tests above: roughly 150 lines instead of 500.

**S7 is the honest drop candidate.** A screen that lists inventory with derived quiebre/bajo
chips and working search reads as an inventory system; products can be created through the API
for a demo. Dropping it costs the UI paths for `FIELD_RESERVED_FOR_ENCARGADO` and
`SUPPLIER_INACTIVE`, and #6 will have to build the form seam anyway. If S7 is partially cut,
cut in this order: (1) deactivate/reactivate controls, (2) the edit route, (3) the create form
last — the create form is the only one that exercises the initial-stock path end to end.

**Plainly, on the time available:** seven slices at these budgets is roughly 1,800 production
lines and 2,700 test lines in about two working days, with #6 queued behind. I do not believe
all seven land. The defensible commitment is **S1–S4 + S6, with S5 compressed to its four
atomicity tests**, and **S7 as stretch**. Planning all seven as firm would repeat exactly the
estimation failure the brief names.

## Migration / Rollout

One additive Drizzle migration (`0004_*`), generated not hand-written, gated by the
double-`pnpm db:generate` check #4 established. No Postgres extension, no new environment
variable, no manual deployment step. Rollback is a revert of the commits plus rolling back the
migration; everything is additive, so nothing existing changes shape. `DATABASE_URL` is the only
input and already exists.

## Open Questions

Spec-reconciliation items — the spec wins on every one of these:

- [x] **[RECONCILE-1]** `stockActual` in `FIELD_CLASSIFICATION.productos.excludedFields` (D2).
      Design position: excluded, per ADR-0012. Flips if the spec requires the `crear` audit
      snapshot to carry opening stock.
      **Resolved 2026-08-29 — excluded.** The spec is silent on snapshot contents, so the owner
      decided directly, upholding the design position (ADR-0012 rules 1 and 2). See `tasks.md` R1.
- [x] **[RECONCILE-2]** The wire code for the inactive-supplier refusal. Design proposes
      `SUPPLIER_INACTIVE` / 409. The proposal ratifies the rule, not the name.
      **Resolved 2026-08-29 by the spec — `SUPPLIER_INACTIVE`.** Used verbatim at `spec.md:24`
      and `:200`. See `tasks.md` R2.
- [x] **[RECONCILE-3]** `productos.proveedor_id` NOT NULL. `TECH-DESIGNv2.md:103` lists the FK
      unconditionally and D8 presumes a supplier is always chosen, but nothing states a product
      may not exist without one.
      **Resolved 2026-08-29 — NOT NULL.** The spec is silent, so the owner decided directly,
      upholding the design position. See `tasks.md` R3.
- [x] **[RECONCILE-4]** `CHECK (tipo <> 'ajuste' OR motivo IS NOT NULL)` (D5). Recommended now
      to avoid reopening the table in #6; drop it if the spec scopes the motivo rule to #6.
      **Resolved 2026-08-29 by the spec — dropped.** `spec.md:121-133` states the table "MUST
      enforce **two** CHECK constraints" and names only sign/type and discrepancy; a motivo CHECK
      would be a third. #6 owns the motivo rule. See `tasks.md` R4.
- [ ] `cantidad <> 0`: not shipped, because `TECH-DESIGNv2.md:125` says `ajuste` is *libre*.
      Unreachable from #5. Named here so #6 decides it rather than inherits it.
- [ ] Whether `q` should also match `categoria`. Design says no (name and SKU only, per the
      owner's answer 2); flagged because a free-text category is a plausible thing to search.
