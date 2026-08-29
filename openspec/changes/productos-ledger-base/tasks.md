# Tasks: productos-ledger-base (backlog #5)

`design.md` proposes seven slices (S1–S7) at a target budget of ~600–800 raw changed lines per PR,
explicitly *above* this project's usual 400-line review budget, "accepted deliberately per proposal
D1 to reduce CI round-trips." That target is **not honored here**: the review budget for this cycle
is 400 raw diff lines per PR — tests, generated files, migrations, `tasks.md` checkbox ticks,
everything, per the standing project rule ("size the review budget against the raw diff") and this
change's own explicit instruction. Every one of design's seven slices is forecast over or at that
line when its own Slicing table (`design.md:458-466`) is read as raw diff, so every slice that
design sized at ~500+ is split into an `a`/`b` (or `core`/`breadth`) pair below, following the exact
precedent `gestion-proveedores/tasks.md` set for its own S3 and S5. This is a compile-order/budget
refinement of `design.md`'s seams, not a re-litigation of them.

## RECONCILE resolutions (read before starting)

`design.md:506-524` marked four items `[RECONCILE]`, stating the spec wins on every one. Resolved
against `specs/product-management/spec.md` and `specs/productos-ui/spec.md` as follows — **binding
for every task below**:

- **R1 — `stockActual` in `FIELD_CLASSIFICATION.productos.excludedFields` (D2).**
  **Settled by the owner on 2026-08-29: excluded.** The spec is silent — its "Audit Trail Recorded
  For Every Mutation" requirement (`spec.md:208-223`) requires exactly one `auditoria` row per
  mutation with the right `entidad`/verb, but says nothing about which columns that row's snapshot
  must carry — so "the spec wins" could not settle it and the owner decided directly. `stockActual`
  goes in `excludedFields`, per ADR-0012 rule 1 (a change in physical units belongs to
  `movimientos`) and rule 2 (no double write: a movement already audits itself). `PATCH` cannot
  change `stock_actual` at all (`spec.md:97`), so including it would repeat one unchanging value in
  every snapshot. Accepted cost, on the record: a create with initial stock `0` writes no
  `movimientos` row, so the opening zero is recorded nowhere. Implemented by tasks 1.8/1.9.
- **R2 — Wire code for the inactive-supplier refusal.** **Resolved by spec.** `spec.md`'s failure
  table (`spec.md:24`) and the "New Products May Not Reference An Inactive Supplier" requirement's
  scenario (`spec.md:197-200`) both use `409 SUPPLIER_INACTIVE` verbatim — the exact code
  `design.md` proposed at D4/[RECONCILE-2]. Ship `SUPPLIER_INACTIVE` as designed; no design change
  needed.
- **R3 — `productos.proveedor_id` NOT NULL.** **Settled by the owner on 2026-08-29: NOT NULL.**
  The spec is silent — no requirement states `proveedor_id` may be omitted, and none states it MUST
  be present, though every create/update scenario assumes one is supplied — so "the spec wins" could
  not settle it and the owner decided directly. Every product carries a supplier:
  `uuid not null references proveedores.id`, matching `TECH-DESIGNv2.md:103`, D8, and every scenario
  the spec actually writes. Implemented by task 1.2. A later reversal would drop `not null` and is a
  migration-reopening change owed its own slice, never a mid-cycle patch.
- **R4 — `CHECK (tipo <> 'ajuste' OR motivo IS NOT NULL)` (D5).** **Resolved by spec — drop it.**
  `spec.md`'s "Movimientos CHECK Constraints Enforce Sign/Type And Discrepancy Coherence"
  requirement (`spec.md:121-133`) states the table "MUST enforce **two** CHECK constraints" and
  names exactly those two (sign↔tipo, discrepancy↔tipo). The spec's own count excludes a third
  motivo CHECK. This is the design's own stated fallback ("If the spec scopes the motivo rule
  entirely to #6, drop the CHECK") triggered by the spec's explicit "two" — task 1.2 ships the
  migration **without** this CHECK; #6 owns the motivo rule.

Two further design Open Questions (`design.md:520-523`, `cantidad <> 0` and `q` matching
`categoria`) are **not** RECONCILE items — the design already resolved both against the spec's
silence in the direction the spec supports (no `cantidad <> 0` CHECK; `q` matches name/SKU only,
per the owner's proposal answer 2) — no task below revisits them.

## The audit compile gate — non-negotiable ordering

`AuditableEntidad = keyof typeof FIELD_CLASSIFICATION` (`apps/api/src/auditoria/service.ts:8`) means
`recordAudit({ entidad: 'productos' })` **does not compile** until
`apps/api/src/auditoria/fields.ts` gains a `productos` entry. The `entidadAuditoria` pgEnum already
lists `'productos'` (`apps/api/src/db/schema.ts`) and looks like it settles this — it does not; the
pgEnum is the database's opinion, `FIELD_CLASSIFICATION` is the compiler's, and only the second one
gates `recordAudit`. #4 lost a correction cycle to exactly this. The `fields.ts` entry ships in
**task 1.6, inside S1**, two slices before the first `recordAudit({ entidad: 'productos' })` call
site (S3a) — never later.

## The Neon migration — a task, not a footnote

Per `docs/DEPLOY-PLAN.md`'s Fase 2 ("Migración ADITIVA: aplicar a Neon ANTES de mergear") and its
explicit call-out of this exact change (`docs/DEPLOY-PLAN.md:336-345,358-360,623-624`): the
`productos`/`movimientos` migration is purely additive (new tables, no `NOT NULL` on an existing
table, no destructive change to `proveedores`), so **the owner runs `pnpm db:migrate` against Neon
before the PR containing S1 merges**, not after. This is task **1.7** below, positioned immediately
before that PR's merge step, with the exact preconditions from the deploy checklist. Skipping this
is the documented failure mode: the deploy goes green (health check only runs `select 1`) and every
`/api/productos` route then 500s until someone remembers.

## Deadline-aware slicing and drop order

Deadline 2026-09-01, today 2026-08-29. Order below runs backend-first, screens as soon as the
contract they read exists, per `design.md`'s own compile-order walk. **Minimum viable cut — what
must land for a demoable, coherent product**: **S1 + S2 + S3 + S4 + S5-core + S6**. Below that
line there is either no data model, no working backend, or no screen; a backend-only #5 shows
nothing new (proposal D1).

**Drop order for the tail, worst-first:**
1. **S7 (create/edit form + deactivate/reactivate controls) — the whole slice is the honest first
   drop.** Products can be created through the API for a demo; the list (S6) already reads as an
   inventory screen. If S7 must be partially cut, cut inside it in this order: (a) deactivate/
   reactivate controls first, (b) the edit route second, (c) the create form last — the create form
   is the only UI path that exercises the initial-stock ledger write end to end, so it is the last
   thing to lose.
2. **S5-breadth (RBAC matrix, pagination/search re-proofs against real sessions) — droppable,
   S5-core is not.** S4's route unit tests already cover the same RBAC/pagination/search matrix
   against fakes; S5-breadth is the real-Postgres/real-session re-proof of the same ground. Drop it
   and keep exactly S5-core's four atomicity tests, because those are the only proof anywhere in
   this change of ADR-0003's invariant (stock and ledger move together or not at all) — the entire
   point of #5. Shipping the invariant unproven is shipping the risk, not the feature.

Nothing above S1–S4 is dropped without an explicit owner decision; this order only makes the
consequence of a schedule slip visible, it does not pre-authorize cutting anything.

---

## Phase 1: S1a — Schema, Migration, Error Factories (audit gate + RECONCILE R2/R3/R4 land here)

No spec requirement is independently satisfied by this slice alone — it is the foundation every
later slice needs; the CHECK-constraint requirement is proven at the database and reachable by no
endpoint yet.

**Forecast: ~90 prod / ~200 test = ~290 raw diff. Under budget.**

- [x] 1.1 RED `apps/api/src/db/schema.integration.test.ts` (extend, Docker PG) — against a database
      with no `productos`/`movimientos` tables: insert `entrada` with negative `cantidad` → CHECK
      rejects; insert `salida`/`venta` with positive `cantidad` → CHECK rejects; insert `ajuste`
      with any sign → accepted; insert `es_discrepancia = true` with `tipo = 'entrada'` → CHECK
      rejects (this is the direct-insert scenario `spec.md:130-133` names); `es_discrepancia = true`
      with `tipo = 'ajuste'` → accepted; two products with SKUs differing only by case (`'ABC-1'`
      vs `'abc-1'`) collide via `productos_sku_lower_unique`, surviving row keeps original casing;
      a `productos` insert with `proveedor_id` pointing at a deleted/nonexistent supplier → FK
      violation; `pnpm db:generate` run twice emits no second migration file (round-trip proof)
- [x] 1.2 GREEN `apps/api/src/db/schema.ts` (modify) — add `movimientoTipo` pgEnum (complete:
      `entrada | salida | ajuste | venta | anulacion`, D5); `productos` table (`id`, `nombre`,
      `sku: text not null`, `productos_sku_lower_unique` functional index on `lower(sku)`,
      `categoria: text` nullable, `stockActual: integer not null default 0`,
      `stockMinimo: integer` nullable, `precio: numeric(12,2) not null`,
      `proveedorId: uuid not null references proveedores.id, onDelete: 'restrict'` — **R3: NOT NULL,
      settled by the owner 2026-08-29 (spec silent — see the RECONCILE section)**, `activo:
      boolean not null default true`, `creadoEn`); `movimientos` table (`id`, `productoId`, `tipo`,
      `cantidad: integer not null`, `motivo: text` nullable, `esDiscrepancia: boolean not null
      default false`, `usuarioId`, `fecha`, `ventaId: uuid` nullable **no FK** — `ventas` does not
      exist until #7, `stockResultante: integer not null`); CHECK
      `movimientos_signo_tipo` (`entrada > 0`, `salida`/`venta < 0`, `anulacion > 0`, `ajuste`
      unconstrained); CHECK `movimientos_discrepancia_solo_ajuste`
      (`es_discrepancia = false OR tipo = 'ajuste'`); index
      `movimientos_producto_id_fecha_idx` on `(producto_id, fecha)`. **Deliberately NOT added: the
      `CHECK (tipo <> 'ajuste' OR motivo IS NOT NULL)` constraint — R4, dropped per spec's explicit
      "two CHECK constraints" count (`spec.md:121-133`).** No `cantidad <> 0` CHECK (design's own
      resolved Open Question, not a RECONCILE item — `TECH-DESIGNv2.md:125` states `ajuste` is
      *libre*)
- [x] 1.3 GREEN generate and apply the migration: `pnpm db:generate` → `apps/api/drizzle/0004_*.sql`
      + `meta/0004_snapshot.json`; `pnpm db:migrate` against the local Docker Postgres; re-run 1.1 →
      green
- [x] 1.4 Verify the round-trip claim from 1.1's last assertion: `pnpm db:generate` a second time
      emits no new migration file
- [x] 1.5 RED `apps/api/src/lib/errors.test.ts` (extend) — against factories that do not exist:
      `productNotFound()` → 404 `PRODUCT_NOT_FOUND`; `skuAlreadyInUse()` → 409 `SKU_ALREADY_IN_USE`;
      `fieldReservedForEncargado()` → 403 `FIELD_RESERVED_FOR_ENCARGADO` (owner-approved deviation
      from `docs/TECH-DESIGNv2.md:235`'s `campo_reservado_encargado`, per proposal D2 — not
      re-decided here); `supplierInactive()` → 409 `SUPPLIER_INACTIVE` (**R2 — confirmed by spec**,
      `spec.md:24`, `:200`); all four map through `toErrorEnvelope`, none carries `details`
- [x] 1.6 GREEN `apps/api/src/lib/errors.ts` (extend) — add all four factories from 1.5, zero
      dependencies, matching the shape of `emailAlreadyInUse()`/`supplierNameInUse()` exactly
- [x] 1.7 Verify S1a: `pnpm --filter api test`, `pnpm --filter api test:integration`,
      `pnpm typecheck`, `pnpm lint`, `pnpm contract:check` (byte-identical — no route touched
      yet). The audit compile gate is **not** part of S1a; it is Phase 1b, tasks 1.8-1.10.

## Phase 1b: S1b — Audit Compile Gate (`FIELD_CLASSIFICATION.productos`)

**Forecast: ~50 prod / ~110 test = ~160 raw diff. Under budget.** Split out of design's single S1
purely for the 400-line budget; there is no dependency reason to separate it from 1.1–1.6, and it
may be folded into the same PR as S1a if the combined diff still clears 400 — measure the actual PR
before deciding.

- [x] 1.8 RED `apps/api/src/auditoria/fields.test.ts` (extend) — against `FIELD_CLASSIFICATION`
      with no `productos` key: assert a `productos` key exists; assert
      `auditableFields` exactly equals every column name from `getTableColumns(productos)` **except**
      `stockActual`, failing by column name when one is missing or extra; assert `stockActual`
      appears in `excludedFields` (**R1 — settled by the owner
      2026-08-29; see the RECONCILE section**); a compile-level assertion that a throwaway
      `recordAudit({ entidad: 'productos', ... })` call type-checks (`tsc --noEmit`) only after 1.9
      lands — this is the proof that the compile gate, not just the pgEnum, is what's closing
- [x] 1.9 GREEN `apps/api/src/auditoria/fields.ts` (extend) — add `productos: { auditableFields: [
      'id', 'nombre', 'sku', 'categoria', 'stockMinimo', 'precio', 'proveedorId', 'activo',
      'creadoEn' ], excludedFields: ['stockActual'] }` (D2/R1, settled)
- [x] 1.10 Verify: `pnpm --filter api test`, `pnpm --filter api test:integration`, `pnpm typecheck`,
      `pnpm lint`, `pnpm contract:check` (byte-identical — no route touched yet)

## Phase 1c: Deploy gate — migrate Neon before this PR merges

**Not a code change. Owner action, timed to land immediately before the PR carrying 1.1–1.10
merges**, per `docs/DEPLOY-PLAN.md` Fase 2 (additive migration ⇒ migrate before merge).

- [ ] 1.11 Confirm the migration is classified **additive** in the PR description (new tables only,
      no `NOT NULL` added to an existing table, no destructive change to `proveedores` or any other
      existing table) — true for 1.2/1.3 as written
- [ ] 1.12 Owner runs, from a machine with Neon's `DATABASE_URL` loaded (never pasted into a chat,
      issue, log, or this document): confirm in the Neon console which project/branch is targeted,
      then `pnpm db:migrate`
- [ ] 1.13 Confirm in the Neon console that `productos` and `movimientos` now exist
- [ ] 1.14 Confirm the **currently deployed** (old) API is still healthy after the migration:
      `curl -sS https://dmc-proyecto.vercel.app/api/health` → `{"status":"ok",...,"db":"up"}`. Old
      code does not reference the new tables, so this window is inert by construction
- [ ] 1.15 Only then merge the PR carrying S1a + S1b

## Phase 2: S2a — `ProductosRepo` (Port + Drizzle Adapter)

Satisfies spec at the repository layer, proven against real Postgres, not yet reachable over HTTP:
**Unique SKU** (database half). Depends on Phase 1 (schema, `isUniqueViolation` from
`apps/api/src/lib/db-errors.ts`, reused per proposal — not reimplemented).

**Forecast: ~160 prod / ~230 test = ~390 raw diff. At budget.**

- [x] 2.1 RED `apps/api/src/productos/repository.integration.test.ts` (new, Docker PG) — against
      code that does not exist: `list(page, pageSize)` paginates and returns the correct `total` on
      an out-of-range page; `list(page, pageSize, q)` filters on `nombre` **and** `sku`
      case-insensitively and the count statement reflects the same filter (the D7 trap — assert
      `total` directly, not just `data.length`); an unescaped `%`/`_`/`\` in `q` is treated literally,
      not as a wildcard; `findById` returns `undefined` for a missing id; `create` surfaces
      `SKU_ALREADY_IN_USE` (not a raw pg error) on a case-insensitive SKU collision; `update` with a
      colliding `sku` does the same; `update` never accepts a `stockActual` key at the type level
      (compile-level assertion — `CambiosProducto` has no such key); `setActivo(id, false)` leaves
      the row present and readable, never deletes; `aplicarDelta` returns the new `stock_actual` on
      a normal increment; returns `undefined` when `activo = false`; returns `undefined` when the
      result would go negative; returns the correct value under two concurrent calls (serialized by
      the row's own UPDATE, not a separate lock)
- [x] 2.2 GREEN `apps/api/src/productos/repository.ts` (new) — `Producto`, `NuevoProducto`,
      `CambiosProducto` (no `stockActual` key), `ProductosRepo` port (`list`, `findById`,
      `findByIdForUpdate`, `create`, `update`, `setActivo`, `aplicarDelta`), `DrizzleProductosRepo`.
      `create`/`update` catch `isUniqueViolation` (imported from `../lib/db-errors.js`, per proposal
      — reused, not reimplemented) and throw `skuAlreadyInUse()`. `aplicarDelta` issues exactly the
      one conditional `UPDATE … SET stock_actual = stock_actual + :delta WHERE id = :id AND activo =
      true AND stock_actual + :delta >= 0 RETURNING stock_actual` (D1) — never a `SELECT … FOR
      UPDATE` plus a plain `SET`. No `findBySku` on the port (D5's folding rule — any future SKU
      selector must be written `where lower(sku) = lower($1)` at the call site). `q` composes
      `(nombre ILIKE :pattern OR sku ILIKE :pattern)` into **both** the page query and the count
      query, with `pattern` escaped for `\`, `%`, `_` before binding (D7)
- [x] 2.3 Verify: `pnpm --filter api test`, `pnpm --filter api test:integration`, `pnpm typecheck`,
      `pnpm lint`

## Phase 3: S2b — `MovimientosRepo` + `Repos` Widening

No spec requirement alone — wiring that makes S2a's repository and the new `MovimientosRepo`
reachable by the service layer in Phase 4. Depends on S2a.

**Forecast: ~90 prod / ~150 test = ~240 raw diff. Under budget.**

- [x] 3.1 RED `apps/api/src/movimientos/repository.integration.test.ts` (new, Docker PG) — against
      code that does not exist: `create` inserts a row and returns it with `stockResultante` taken
      verbatim from the input, never recomputed; a `create` that violates a CHECK (e.g. `tipo =
      'entrada'`, `esDiscrepancia = true`) surfaces the raw Postgres error uncaught — `Movimientos`
      has no domain-error mapping in this change, unlike `ProductosRepo`
- [x] 3.2 GREEN `apps/api/src/movimientos/repository.ts` (new) — `Movimiento`, `NuevoMovimiento`,
      `MovimientosRepo` port (`create` only, deliberately — makes the forced-failure fake in the
      Phase 6 atomicity test an honest full replacement, and #6 extends it), `DrizzleMovimientosRepo`
- [x] 3.3 RED `apps/api/src/plugins/repos.test.ts` (extend) — `buildRepos` returns `productos` and
      `movimientos` members bound to the given executor; the injected-fakes case includes both.
      Fails today because `Repos` has neither key
- [x] 3.4 GREEN `apps/api/src/plugins/repos.ts` (modify) — widen `Repos` with `productos:
      ProductosRepo` and `movimientos: MovimientosRepo`; `buildRepos` constructs
      `new DrizzleProductosRepo(executor)` and `new DrizzleMovimientosRepo(executor)`
- [x] 3.5 GREEN fix every test file this widening breaks by name (mirrors the precedent's Phase 4,
      task 3b.3 in `gestion-proveedores/tasks.md` — expect the same shape of breakage): `app.test.ts`
      (stub `satisfies Repos`), `plugins/auth.test.ts`, `routes/auth.test.ts`,
      `routes/usuarios.test.ts`, `routes/proveedores.test.ts`, `plugins/repos.test.ts`. Do **not**
      touch any file with its own local narrow `Repos` interface (e.g.
      `proveedores/service.test.ts`'s two-key type) unless it independently breaks — verify each
      touched file against `git diff` before committing, not by assumption.
      **Apply note**: the prediction was incomplete — `pnpm typecheck` also broke
      `apps/api/src/auth/service.test.ts` (its `fakeUow` builds a `Repos`-shaped object for
      `changePassword`'s `UnitOfWork` param, not the file's own local two-key `Repos`), and it was
      fixed alongside the six named files, confirmed by `git status --short` before committing
- [x] 3.6 Verify: `pnpm --filter api test`, `pnpm typecheck`, `pnpm lint`, `pnpm contract:check`
      (still byte-identical — no route touched)

## Phase 4: S3a — Product Service, Create Path

Satisfies spec: **Product Creation Writes `stock_actual` And Its Initial Movement In One
Transaction** (`spec.md:70-94`), **Field-Level Permission — `stock_minimo` Reserved To Encargado**
(create half, `spec.md:46-68`), **New Products May Not Reference An Inactive Supplier**
(create half, `spec.md:191-200`), **Audit Trail Recorded For Every Mutation** (create half,
`spec.md:208-223`). Depends on S2b (`app.repos`/`app.uow` carry `productos`/`movimientos`).

**Forecast: ~150 prod / ~240 test = ~390 raw diff. At budget.**

- [ ] 4.1 RED `apps/api/src/productos/service.test.ts` (new, fake repos + `{ run: (work) =>
      work(stubs) }`) — against code that does not exist: `crearProducto` with `stockInicial = 0`
      calls `productos.create` and **not** `movimientos.create` or `aplicarDelta`;
      `stockInicial = 50` calls `productos.create` (with `stockActual: 0`), then `aplicarDelta(id,
      +50)`, then `movimientos.create` with `tipo: 'ajuste'`, fixed `motivo: 'stock inicial (alta de
      producto)'`, `esDiscrepancia: false`, and `stockResultante` taken from `aplicarDelta`'s return
      value — never recomputed in the test's stub math; a `deposito` actor whose payload includes
      the key `stockMinimo` (including `{ stockMinimo: null }`) throws
      `fieldReservedForEncargado()` **before** `uow.run` is ever called (key-presence check, not
      `!== undefined` — assert with a spy on `uow.run`); the identical payload without that key
      succeeds for `deposito`; an `encargado` actor sets `stockMinimo` freely; `proveedores.findById`
      returning `undefined` throws `supplierNotFound()`; returning a row with `activo: false` throws
      `supplierInactive()`, both before the product insert; every call happens inside exactly one
      `uow.run` invocation; the final statement inside `uow.run` is `recordAudit({ entidad:
      'productos', accion: 'crear', ... })`
- [ ] 4.2 GREEN `apps/api/src/productos/service.ts` (new) — `crearProducto` only in this slice
      (`actualizarProducto`/`setProductoActivo`/`listProductos`/`getProducto` are Phase 5).
      `requireActor(request.user): { id, rol }`, generalised from
      `routes/proveedores.ts:76-81`'s `requireActorId` (D6). Field guard and inactive-supplier guard
      both run **before** `uow.run` opens (rejected requests never open a transaction). Inside
      `uow.run`: `proveedores.findById` → product insert with `stockActual: 0` → (if `stockInicial >
      0`) `aplicarDelta` then `movimientos.create` with `stockResultante` from `aplicarDelta`'s
      return → `recordAudit` last
- [ ] 4.3 Verify: `pnpm --filter api test`, `pnpm typecheck`, `pnpm lint`

## Phase 5: S3b — Product Service, Read/Update/Deactivate Paths

Satisfies spec: **Field-Level Permission** (update half), **New Products May Not Reference An
Inactive Supplier** (update-only-when-`proveedorId`-present half, D8's TOCTOU-avoidance clause),
**Stock Correction After Creation Requires A Movement, Not This Endpoint** (schema half proven in
Phase 6's route slice; this phase proves `CambiosProducto` has no `stockActual` key at the type
level — already covered by 2.1's compile assertion, re-asserted here at the service boundary),
**Logical Deactivation And Reactivation**, **List Products Supports Pagination And Search**,
**Audit Trail** (update/deactivate/reactivate halves). Depends on S3a.

**Forecast: ~90 prod / ~170 test = ~260 raw diff. Under budget.**

- [ ] 5.1 RED `apps/api/src/productos/service.test.ts` (extend) — `actualizarProducto` with an empty
      diff makes no repo write and no `recordAudit` call (mirrors `proveedores/service.ts`'s D10
      no-op rule); `findByIdForUpdate` returning `undefined` throws `productNotFound()` before any
      write; a PATCH that includes `proveedorId` re-runs the inactive-supplier guard; a PATCH that
      **omits** `proveedorId` does **not** re-run it, even when the product's existing supplier is
      already inactive (the D8 regression proof — this is the assertion the proposal calls "the one
      that matters more"); `setProductoActivo(id, false)`/`(id, true)` each wrap one repo call and
      one `recordAudit` inside `uow.run`; `listProductos`/`getProducto` pass `q` through to the
      repository unchanged
- [ ] 5.2 GREEN `apps/api/src/productos/service.ts` (extend) — `actualizarProducto`,
      `setProductoActivo`, `listProductos`, `getProducto`
- [ ] 5.3 Verify: `pnpm --filter api test`, `pnpm typecheck`, `pnpm lint`

## Phase 6: S4a — Routes: Read + Create + Update

Satisfies spec at the HTTP shape: **Role Gate** (read/create/update half), **Unique SKU** (HTTP
409), **Field-Level Permission** (HTTP 403), **Stock Correction After Creation Requires A Movement**
(`.strict()` rejection), **Category Is Free Text**, **`stock_minimo` Is Optional**, **List
Products…** (HTTP shape), **New Products May Not Reference An Inactive Supplier** (HTTP 409).
Depends on S3b.

**Forecast: ~170 prod / ~240 test = ~410 raw diff. Marginally over — acceptable per the same
reasoning `gestion-proveedores`'s S3a used (peeling a smaller unit would cost more in review focus
than it saves in line count); flag for `size:exception` if it drifts further during apply.**

- [ ] 6.1 RED `apps/api/src/routes/productos.test.ts` (new, `buildApp({ repos, uow, cookieSecret })`
      + `inject`) — against code that does not exist: unauthenticated → 401 on all five routes this
      slice adds; `deposito` → 200/201 on both GETs and on `POST` without `stock_minimo`; `deposito`
      → 403 `FIELD_RESERVED_FOR_ENCARGADO` on `POST`/`PATCH` with `stock_minimo` present (any
      value); `encargado` → 200/201/200 on all three with `stock_minimo` present; `PATCH` with a
      `stock_actual` key → 400 `VALIDATION_ERROR` before any handler runs; `POST` missing
      `proveedor_id` → 400; duplicate `sku` on `POST`/`PATCH` → 409 `SKU_ALREADY_IN_USE`; inactive
      `proveedor_id` on `POST`/`PATCH` → 409 `SUPPLIER_INACTIVE`; `GET /api/productos?q=...` reaches
      the service; `GET /api/productos?page&pageSize` responds with the `{ data, page, pageSize,
      total }` envelope
- [ ] 6.2 GREEN `apps/api/src/routes/productos.ts` (new, partial — this slice only) —
      `GET /api/productos`, `GET /api/productos/:id`, `POST /api/productos`,
      `PATCH /api/productos/:id`, each `config: { roles: ['encargado', 'deposito'] }` (spec's Role
      Gate requirement). `crearProductoBody`/`actualizarProductoBody` Zod schemas — the latter
      `.strict()`, with **no `stock_actual` field in its shape at all**, same technique as
      `actualizarProveedorBody` (`routes/proveedores.ts:52-60`)
- [ ] 6.3 Verify: `pnpm --filter api test`, `pnpm typecheck`, `pnpm lint` (`contract:check` deferred
      to 6.4 — the route now changes observable API surface)

## Phase 7: S4b — Routes: Deactivate/Reactivate + Contract Regeneration

Satisfies spec at the HTTP shape: **Role Gate** (deactivate/reactivate half — encargado-only, plain
`FORBIDDEN`), **Logical Deactivation And Reactivation** (HTTP shape). Depends on S4a — must land in
the same PR chain link or the next, never before (the route file it extends must exist).

**Forecast: ~110 prod / ~140 test = ~250 raw diff. Under budget.**

- [ ] 7.1 RED `apps/api/src/routes/productos.test.ts` (extend) — `deposito` → 403 `FORBIDDEN` (plain
      code, not the field-level one — ordinary RBAC per D6's table) on both
      `POST /api/productos/:id/{deactivate,reactivate}`; `encargado` → 200 on both; a deactivated
      product still returns 200 (not 404) from `GET /api/productos/:id`, with `activo: false`
- [ ] 7.2 GREEN `apps/api/src/routes/productos.ts` (extend) —
      `POST /api/productos/:id/deactivate`, `POST /api/productos/:id/reactivate`, each `config: {
      roles: ['encargado'] }`. Register `productosRoutes` in `apps/api/src/app.ts`, after
      `authPlugin`, alongside the other route plugins (registering before the auth hook silently
      drops coverage — the precedent's own D6 note)
- [ ] 7.3 GREEN regenerate the contract: `pnpm contract` → `apps/api/openapi.json`,
      `apps/web/src/api/schema.d.ts` pick up all six `productos` paths and every declared status
- [ ] 7.4 Verify: `pnpm --filter api test`, `pnpm typecheck`, `pnpm lint`, `pnpm contract:check` (now
      asserts real content, not byte-identity)

## Phase 8: S5-core — Atomicity Proof (mandatory, not droppable)

Satisfies spec: **Product Creation Writes `stock_actual` And Its Initial Movement In One
Transaction** (`spec.md:70-94`, all three scenarios), **Audit Trail** (failed-audit-write rollback
scenario, `spec.md:219-223`). This is the **only** proof anywhere in this change of ADR-0003's
invariant — see "Deadline-aware slicing" above for why it cannot be dropped even under schedule
pressure. Depends on S4b (needs the live `POST /api/productos` route).

**Forecast: 0 prod / ~150 test = ~150 raw diff. Well under budget — this is the compressed
"S5-core" shape from `design.md`'s own stated fallback ("keep exactly the four atomicity tests…
roughly 150 lines instead of 500"), adopted here as the default, not the fallback.**

- [ ] 8.1 RED `apps/api/src/routes/productos.integration.test.ts` (new, real app + Docker PG,
      `failingUow` technique from `apps/api/src/routes/proveedores.integration.test.ts:526-543` — a
      real `createUnitOfWork(db)` with one repo replaced by a thrower):
      1. **Positive.** Create with `stockInicial = 5` ⇒ `productos.stock_actual = 5`; exactly one
         `movimientos` row (`tipo='ajuste'`, `cantidad=5`, `stock_resultante=5`,
         `es_discrepancia=false`, motivo verbatim `"stock inicial (alta de producto)"`);
         `select sum(cantidad) from movimientos where producto_id = …` equals `stock_actual`
      2. **Ledger fails.** `movimientos.create` throws ⇒ zero `productos` rows, zero `movimientos`
         rows, zero `auditoria` rows
      3. **Audit fails.** `auditoria.record` throws ⇒ same three zeroes, response
         `500 { error: { code: "AUDIT_WRITE_FAILED" } }`
      4. **Zero initial stock.** `stockInicial = 0` ⇒ product row exists, zero `movimientos` rows
- [ ] 8.2 GREEN whatever wiring gap 8.1 exposes (expected: none — S3a/S3b/S4a/S4b already implement
      this path; this slice is the real-Postgres proof, not new production code)
- [ ] 8.3 Verify: `pnpm --filter api test`, `pnpm --filter api test:integration`, `pnpm typecheck`,
      `pnpm lint`

## Phase 9: S5-breadth — RBAC/Pagination/Search Real-Session Re-Proof (stretch, droppable)

No spec requirement uniquely depends on this slice — every requirement it re-proves is already
covered by S4a/S4b's route unit tests against fakes. This is the second item in the drop order
above; drop it under schedule pressure before touching S1–S4 or S5-core.

**Forecast: ~0 prod / ~350 test = ~350 raw diff. Under budget alone, but this is exactly the
breadth `design.md` names as safe to cut first.**

- [ ] 9.1 RED/GREEN `apps/api/src/routes/productos.integration.test.ts` (extend) — real `deposito`
      session refused on deactivate/reactivate, table unchanged afterward; real `deposito` session
      with `stock_minimo` in the payload refused, no row written; exactly one `auditoria` row per
      mutation type (`crear`/`actualizar`/`baja_logica`/`reactivar`) with `entidad = 'productos'`;
      search (`?q=`) and pagination against a real seeded table, asserting both `data` and `total`
- [ ] 9.2 Verify: `pnpm --filter api test:integration`, `pnpm typecheck`, `pnpm lint`

## Phase 10: S6a — Web: List Screen + Pagination

Satisfies spec: **Product List Is Open To Both Roles Under shellLayout** (`productos-ui`
spec.md:17-25), **List With Pagination, Search, And Derived Status Chips** (pagination half).
Depends on S4b (`schema.d.ts` must carry the `productos` paths — regeneration cannot slip past S4b).

**Forecast: ~200 prod / ~180 test = ~380 raw diff. Under budget.**

- [ ] 10.1 RED `apps/web/src/routes/productos.test.tsx` (new, full `routeTree` +
      `createMemoryHistory`, `await router.load()` before render, per house rule) — against a route
      that does not exist: `/inventario` renders for a `deposito` session with no redirect; the list
      renders `DataTable` rows from `GET /api/productos`'s `data`; `Pagination` reflects `page`/
      `pageSize`/`total`
- [ ] 10.2 GREEN `apps/web/src/features/productos/queries.ts` (new) — key factory,
      `productosListQueryOptions(page, q)`, `PAGE_SIZE = 20`, mirroring
      `features/usuarios/queries.ts:5-18`'s invalidate-never-`setQueryData` rule
- [ ] 10.3 GREEN `apps/web/src/features/productos/useProductos.ts`,
      `apps/web/src/features/productos/ProductosTable.tsx` (new)
- [ ] 10.4 GREEN `apps/web/src/routes/productos.tsx`, `apps/web/src/routes/routeTree.ts` (new/modify)
      — `productosListRoute` at `/inventario` under `shellLayout`, `validateSearch` carries `page`
- [ ] 10.5 GREEN `apps/web/src/components/ui/AppShell.tsx` (modify) — the inert
      `{ label: 'Inventario' }` (`:15-23`) gains `to: '/inventario'`; **must land in the same commit
      as 10.4** — the docblock at `:6-14` makes a `to` a type error until the route is registered
- [ ] 10.6 GREEN `apps/web/src/components/ui/AppShell.test.tsx` (modify) — move the Inventario
      inert-marker expectation to the linked-item expectation, same commit as 10.5
- [ ] 10.7 Verify: `pnpm --filter web test`, `pnpm typecheck`, `pnpm lint`

## Phase 11: S6b — Web: Search + Derived Chips + Errors

Satisfies spec: **List With Pagination, Search, And Derived Status Chips** (search + chip halves),
**Error Surfacing By Code** (`productos-ui` spec.md:87-96). Depends on S6a.

**Forecast: ~180 prod / ~150 test = ~330 raw diff. Under budget.**

- [ ] 11.1 RED `apps/web/src/routes/productos.test.tsx` (extend) — typing into the search input
      makes the list request include `?q=<term>`, showing only matching rows; changing `q` resets
      `page` to 1 (same clamping style as `routes/usuarios.tsx:24-30`, `.catch()`, never throw); a
      product with `stock_minimo = null` and any `stock_actual` shows no chip; `stock_minimo = 10,
      stock_actual = 8` shows `bajo`; `stock_actual <= 0` shows `quiebre` regardless of
      `stock_minimo`; each of `PRODUCT_NOT_FOUND`, `SKU_ALREADY_IN_USE`,
      `FIELD_RESERVED_FOR_ENCARGADO`, `SUPPLIER_INACTIVE`, `VALIDATION_ERROR`, `FORBIDDEN` renders a
      distinct message, not a generic fallback
- [ ] 11.2 GREEN `apps/web/src/features/productos/format.ts` (new) — pure `estadoStock(stockActual,
      stockMinimo)` function per D9's exact branching (`stockActual <= 0` → `'quiebre'`;
      `stockMinimo !== null && stockActual <= stockMinimo` → `'bajo'`; else `'ok'`), rendered through
      the existing `components/ui/StatusChip.tsx`. No server-computed status field anywhere
- [ ] 11.3 GREEN `apps/web/src/features/productos/errorMessages.ts` (new) — switch on the six codes
      above, following the `usuarios`/`proveedores` `errorMessages.ts` convention
- [ ] 11.4 GREEN search input wired into `productos.tsx`'s `validateSearch` (`q` param, bookmarkable,
      loader participates)
- [ ] 11.5 Verify: `pnpm --filter web test`, `pnpm typecheck`, `pnpm lint`

## Phase 12: S7a — Web: Create Form (stretch, last item to drop within S7)

Satisfies spec: **Create/Edit Form With Role-Gated stock_minimo And Create-Only Initial Stock**
(create half, `productos-ui` spec.md:50-69). Depends on S6b (reuses `errorMessages.ts`, `format.ts`
is unrelated but the route tree convention is shared).

**Forecast: ~220 prod / ~200 test = ~420 raw diff. Marginally over — if it drifts further, split
the supplier-selector (active-suppliers-only fetch + its own test) into its own micro-PR ahead of
this one, mirroring the `gestion-proveedores` S3a precedent.**

- [ ] 12.1 RED `apps/web/src/routes/productosNuevo.test.tsx` (new) — a `deposito` session sees
      `stock_minimo` visible, disabled, with 🔒 (present, not hidden — the visible-locks convention
      from `usuarios-ui`); an `encargado` session can type into it; the initial-stock field is
      present and, on submit with a value `> 0`, reaches `POST /api/productos` as `stockInicial`;
      the supplier selector offers only suppliers with `activo: true` (fetched via
      `GET /api/proveedores`, filtered client-side or via query param per whatever
      `proveedores`'s list route already supports); a `SKU_ALREADY_IN_USE` response renders its
      mapped message inline, not a toast-only generic error
- [ ] 12.2 GREEN `apps/web/src/features/productos/schemas.ts`, `useCrearProducto.ts` (new)
- [ ] 12.3 GREEN `apps/web/src/features/productos/ProductoForm.tsx` (new, create mode) —
      `react-hook-form` + Zod resolver, mirroring `UsuarioForm.tsx`'s shape
- [ ] 12.4 GREEN `apps/web/src/routes/productosNuevo.tsx` (new) — `productosNuevoRoute` at
      `/inventario/nuevo` under `shellLayout`
- [ ] 12.5 Verify: `pnpm --filter web test`, `pnpm typecheck`, `pnpm lint`

## Phase 13: S7b — Web: Edit Form + Deactivate/Reactivate Controls (stretch, first two items to drop
within S7)

Satisfies spec: **Create/Edit Form…** (edit half — no initial-stock field, `spec.md:61-64`),
**Deactivate/Reactivate Controls, Encargado-Only, Visible-Locked For Deposito**
(`productos-ui` spec.md:71-85). Depends on S7a (`ProductoForm.tsx` extended to edit mode, not
duplicated).

**Forecast: ~200 prod / ~180 test = ~380 raw diff. Under budget.** Within this slice, if time is
short, drop in this order per the top-level drop order: deactivate/reactivate controls first, the
edit route second.

- [ ] 13.1 RED `apps/web/src/routes/productosDetalle.test.tsx` (new) — the edit form renders with no
      initial-stock input present; an `encargado` triggers deactivate and the row's chip updates
      from the response without a full reload; a `deposito` sees the deactivate/reactivate control
      visible, disabled, with 🔒
- [ ] 13.2 GREEN `apps/web/src/features/productos/useActualizarProducto.ts`,
      `useEstadoProducto.ts` (new)
- [ ] 13.3 GREEN `ProductoForm.tsx` (extend) — edit mode omits the initial-stock field entirely
- [ ] 13.4 GREEN `apps/web/src/routes/productosDetalle.tsx` (new) — `productosDetalleRoute` at
      `/inventario/:id` under `shellLayout`, deactivate/reactivate controls per the 🔒 pattern
- [ ] 13.5 Verify: `pnpm --filter web test`, `pnpm typecheck`, `pnpm lint`

## Phase 14: Bookkeeping

- [ ] 14.1 Confirm no `.env*` file was touched or referenced by any task above, and no new
      environment variable was introduced — `DATABASE_URL` is the only input and already exists
- [ ] 14.2 If PRs are chained/stacked, retarget each PR to `main` as its predecessor merges
      (`gh pr edit <n> --base main`) — GitHub does not auto-retarget, per the `gestion-proveedores`
      precedent (#36→#37→#38)
- [ ] 14.3 Before archiving the change, confirm both flagged owner decisions (R1 — `stockActual`
      audit visibility, R3 — `proveedor_id` nullability) are recorded as **resolved with an
      explicit owner answer**, not silently left on the design's default, in the same place
      `gestion-proveedores`'s task 8.3 confirmed its own open questions stayed visible after merge
- [ ] 14.4 Confirm the claims-gate report (`openspec/changes/productos-ledger-base/claims-report.md`)
      is produced before this cycle reaches verify/archive, per `CLAUDE.md`'s claims gate section —
      out of scope for this tasks document to produce, in scope to not forget

## Requirement Coverage Map

| Requirement | Slice(s) |
|---|---|
| Role Gate — Read Open To Both Roles, Deactivate/Reactivate Encargado-Only | S4a/S4b (unit) + S5-breadth (real-session) |
| Field-Level Permission — `stock_minimo` Reserved To Encargado | S3a (create) + S3b (update) + S4a (HTTP) + S5-breadth (real-session) |
| Product Creation Writes `stock_actual` And Its Initial Movement In One Transaction | S1a (schema) + S2a (`aplicarDelta`) + S3a (service) + S4a (route) + S5-core (atomicity proof) |
| Stock Correction After Creation Requires A Movement, Not This Endpoint | S2a (`CambiosProducto` type) + S4a (`.strict()` HTTP proof) |
| Unique SKU | S1a (index) + S2a (repo mapping) + S4a (HTTP 409) |
| Movimientos CHECK Constraints Enforce Sign/Type And Discrepancy Coherence | S1a (schema + direct-insert proof) |
| Logical Deactivation And Reactivation Are Encargado-Only; History Stays Readable | S3b (service) + S4b (route) + S5-breadth (real-session) |
| `stock_minimo` Is Optional And Never Blocks Creation | S1a (nullable column) + S4a (HTTP) |
| Category Is Free Text And Nullable | S1a (nullable column) + S4a (HTTP) |
| List Products Supports Pagination And Search By Name Or SKU | S2a (repo) + S3b (service) + S4a (route) + S5-breadth (real-session) |
| New Products May Not Reference An Inactive Supplier; Existing References Survive | S3a (create guard) + S3b (update guard, D8's presence-keyed clause) + S4a (HTTP 409) + S5-breadth |
| Audit Trail Recorded For Every Mutation, Atomic With The Write | S1b (compile gate) + S3a/S3b (`recordAudit` call sites) + S5-core (failed-audit rollback) + S5-breadth (one-row-per-mutation, real session) |
| **productos-ui**: Product List Is Open To Both Roles Under shellLayout | S6a |
| **productos-ui**: List With Pagination, Search, And Derived Status Chips | S6a (pagination) + S6b (search + chips) |
| **productos-ui**: Create/Edit Form With Role-Gated stock_minimo And Create-Only Initial Stock | S7a (create) + S7b (edit) |
| **productos-ui**: Deactivate/Reactivate Controls, Encargado-Only, Visible-Locked For Deposito | S7b |
| **productos-ui**: Error Surfacing By Code | S6b |

No requirement is left without a covering slice; S5-breadth, S7a, S7b are the stretch slices named
in the drop order above, not gaps.

## Raw Diff Forecast Summary

| Slice | Prod | Test | Total | Budget (400) |
|---|---|---|---|---|
| S1a — schema, migration, error factories | ~90 | ~200 | ~290 | Under |
| S1b — audit compile gate | ~50 | ~110 | ~160 | Under |
| S2a — `ProductosRepo` | ~160 | ~230 | ~390 | At |
| S2b — `MovimientosRepo` + `Repos` widening | ~90 | ~150 | ~240 | Under |
| S3a — service, create path | ~150 | ~240 | ~390 | At |
| S3b — service, read/update/deactivate paths | ~90 | ~170 | ~260 | Under |
| S4a — routes, read/create/update | ~170 | ~240 | ~410 | Marginally over |
| S4b — routes, deactivate/reactivate + contract | ~110 | ~140 | ~250 | Under |
| S5-core — atomicity proof (mandatory) | 0 | ~150 | ~150 | Under |
| S5-breadth — RBAC/pagination re-proof (stretch) | 0 | ~350 | ~350 | Under |
| S6a — list + pagination | ~200 | ~180 | ~380 | Under |
| S6b — search + chips + errors | ~180 | ~150 | ~330 | Under |
| S7a — create form (stretch) | ~220 | ~200 | ~420 | Marginally over |
| S7b — edit form + deactivate controls (stretch) | ~200 | ~180 | ~380 | Under |
| **Chain total** | **~1710** | **~2690** | **~4400** | — |

Two slices (S4a, S7a) land marginally over the 400-line budget by design's own reasoning — peeling a
smaller unit out of either costs more in reviewer context-switching than it saves in line count,
mirroring exactly the call `gestion-proveedores/tasks.md` made for its own S3a (~430 lines, accepted
as "the smallest honest split"). Flag both for `size:exception` if they drift further during apply;
do not pre-split them speculatively.

**Minimum viable cut total (S1a + S1b + S2a + S2b + S3a + S3b + S4a + S4b + S5-core + S6a + S6b):**
~3140 raw diff lines across eleven PRs/slices — everything through Phase 11, before either S5-breadth
or the S7 pair.
