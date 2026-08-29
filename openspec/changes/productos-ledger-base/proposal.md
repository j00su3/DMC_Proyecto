# Proposal: productos-ledger-base (backlog #5)

## Authority

`docs/TECH-DESIGNv2.md` (v2, 2026-08-13) is the technical design of record. It supersedes
`docs/TECH-DESIGN.md` (v1) per its own line 3: *"Versión 2 — 2026-08-13. Supersede a
`TECH-DESIGN.md` (v1)."* v2 incorporates Round 2 of the adversarial review
(`docs/REVISION-ADVERSARIAL.md`): 2 Critical (C1–C2), 5 Warnings (A7–A11), 5 Suggestions
(S6–S10). Every claim below cites `docs/TECH-DESIGNv2.md` or `docs/REVISION-ADVERSARIAL.md`
by file:line. Where this proposal needed to check v1 for contrast, that is called out
explicitly; otherwise v1 is not used as a source.

## Intent

Backlog #5 (`docs/BACKLOG.md:36`) is the first of two items that make the application an
actual inventory system: **Producto** and **Movimiento** (the stock ledger), with the
invariants ADR-0003 requires — a stored `stock_actual` column that never changes except in
lockstep with a ledger entry, in the same transaction (`docs/TECH-DESIGNv2.md:108-115`,
`:259-260`).

Why now: #4 (proveedores backend) archived today (2026-08-29), and its dependency chain —
#2 (auth), #2.2 (audit), #4 — is fully archived. #5 depends on exactly those three
(`docs/BACKLOG.md:36`, dependency column). Nothing else is blocking it, and #6 (movements),
#7 (POS), #10 (alerts) all transitively depend on #5 — it is the spine of the remaining
backlog under a 2026-09-01 deadline that is three days away.

Success for this change: an encargado can create a product with SKU, category, price,
stock_minimo, and an optional initial stock quantity; both roles can list/view/search
products; the encargado can edit, deactivate/reactivate a product; the deposito role is
blocked by the server (not just hidden by the UI) from setting `stock_minimo` and from
deactivating; the resulting product list is navigable through the SPA today, not a
theoretical API surface waiting for a future UI slice.

## Scope

### In scope

**Data model** (`docs/TECH-DESIGNv2.md:100-133`):
- `productos` table: `id`, `nombre`, `sku` (unique), `categoria`, `stock_actual`,
  `stock_minimo` (nullable), `precio` (`NUMERIC(12,2)`), `proveedor_id` FK, `activo`.
- `movimientos` table: `id`, `producto_id`, `tipo` (enum: `entrada` | `salida` | `ajuste` |
  `venta` | `anulacion` — only `entrada`, `ajuste` are actually writable from this change; the
  other three belong to #6/#7/#9 but the enum ships complete now so the CHECK and later
  migrations do not reopen this table), `cantidad` (signed, CHECK ties sign to `tipo`),
  `motivo`, `es_discrepancia` (boolean, default false, CHECK restricts to `tipo = ajuste`),
  `usuario_id`, `fecha`, `venta_id` (nullable, unused until #7/#9), `stock_resultante`.
- CHECK constraints: sign↔tipo (`entrada` > 0, `salida`/`venta` < 0, `anulacion` > 0, `ajuste`
  free) and `es_discrepancia` only true when `tipo = ajuste`
  (`docs/TECH-DESIGNv2.md:123-127`, `:137-140`).

**Backend** (mirrors `apps/api/src/proveedores/` — routes → service → repository port +
Drizzle adapter):
- Product CRUD: list (paginated, both roles read), get by id, create, update (PATCH,
  `.strict()` body), deactivate/reactivate as two explicit POST routes (mirrors
  `apps/api/src/routes/proveedores.ts:190-218`), never DELETE.
- SKU uniqueness enforced at the database (unique index) and mapped from the driver's 23505
  via `isUniqueViolation` (`apps/api/src/lib/db-errors.ts`, reused, not reimplemented — #4
  already extracted it to lib level per the assignment brief).
- **Initial stock (C2 — resolved in v2, `docs/TECH-DESIGNv2.md:108-112`, `:244-246`):** if
  the create payload's initial stock is > 0, the same transaction that inserts the product
  also inserts a `Movimiento` of `tipo = ajuste`, fixed motivo `"stock inicial (alta de
  producto)"`, `es_discrepancia = false`. Stock 0 at creation writes no movement. This is
  the entire reason `productos.stock_actual` and `Σ(movimientos)` reconcile from day one —
  which is what backlog #14's periodic reconciliation script will check later.
- **Edit excludes `stock_actual` (C2, `docs/TECH-DESIGNv2.md:113-115`, `:247-248`):** the
  Zod PATCH schema does not accept `stock_actual` as a field — not "accepts and rejects it",
  it is absent from the schema shape entirely, same technique as
  `actualizarProveedorBody`'s `.strict()` (`apps/api/src/routes/proveedores.ts:52-60`). The
  column exists on the table (ADR-0003's stored-column side of the model); only the PATCH
  input schema excludes it. Any stock correction after creation is out of scope for #5 — it
  requires a `Movimiento` write path, which is #6.
- **Field-level RBAC on `stock_minimo` (A7):** see Decisions below — this is the one
  deviation from the letter of `docs/TECH-DESIGNv2.md:120`, recorded explicitly.
- Logical deactivation (`activo = false`) restricted to encargado; deposito gets a plain
  403 (`FORBIDDEN`, existing code, not a new one — this is ordinary RBAC, unlike the field
  case). An inactive product is read-only for history but otherwise unreachable via
  create/update endpoints in this slice, since no movement-writing endpoint ships in #5 to
  test the "inactive rejects new movements" rule end to end (that assertion belongs to #6,
  where movement endpoints exist).
- Audit integration: add a `productos` entry to
  `apps/api/src/auditoria/fields.ts`'s `FIELD_CLASSIFICATION` (this is a compile gate per
  `auditoria/service.ts:8`'s `AuditableEntidad = keyof typeof FIELD_CLASSIFICATION` — #4 hit
  this exact miss and needed a correction cycle; called out here so it does not repeat).
  `recordAudit({ entidad: 'productos' })` calls at create/update/deactivate/reactivate,
  mirroring `apps/api/src/proveedores/service.ts:101-109`, `:130-140`, `:169-178`.
- Every write goes through `UnitOfWork` (`apps/api/src/db/uow.ts`) — the create-with-initial-
  movement path is the reason this matters most in this change: product insert, movement
  insert, and audit write are one transaction or none of them commit.
- Pagination via the existing `{ data, page, pageSize, total }` envelope
  (`apps/api/src/lib/pagination.ts`), error envelope via `apps/api/src/lib/errors.ts`'s
  `AppError`/`toErrorEnvelope`, RBAC via `config.roles` on `apps/api/src/plugins/auth.ts`.

**Frontend** (mirrors `apps/web/src/features/usuarios/` — hooks, forms, table, error
messages, as a peer `features/productos/` directory):
- Product list screen: `DataTable` + `Pagination`, quiebre/bajo chips derived client-side
  from `stock_actual` vs `stock_minimo` (no server-computed status field — the chip is a
  pure function of two numbers already on the DTO, same pattern as any derived UI state).
- Product create/edit form via `react-hook-form` + Zod resolver, mirroring
  `UsuarioForm.tsx`. `stock_minimo` field renders with 🔒 for deposito sessions
  (`docs/TECH-DESIGNv2.md:121` — SPA affordance only, never the authorization boundary).
  Initial-stock field on create only, absent from the edit form (there is no edit-time
  concept of "initial stock").
- Deactivate/reactivate controls, encargado-only, same 🔒 pattern.
- Routes register under `shellLayout`, not `encargadoLayout` — deposito reads products, so a
  subtree guard would be wrong; write controls gate per-component and the server 403 is the
  real boundary. Identical reasoning to #4/#4.1
  (`openspec/changes/archive/2026-08-29-gestion-proveedores/design.md` and the equivalent
  proveedores routing, both under `shellLayout`).
- `NAV_ITEMS` in `apps/web/src/components/ui/AppShell.tsx:15-23` gets `to: '/inventario'` on
  the existing inert `{ label: 'Inventario' }` entry (verified: it currently has no `to`,
  confirming it is the intended, already-reserved slot for this screen).
- Error codes surfaced by code, mirroring `errorMessages.ts`'s switch: `PRODUCT_NOT_FOUND`,
  `SKU_ALREADY_IN_USE`, `FIELD_RESERVED_FOR_ENCARGADO` (see Decisions), `VALIDATION_ERROR`,
  `FORBIDDEN`.

### Out of scope (and where it goes)

- **Any movement-writing endpoint beyond the create-time `ajuste`** — entrada, salida,
  free-standing ajuste with motivo, the ≤3-step registration modal, `stock_resultante`
  computation on arbitrary movements, the atomic conditional stock UPDATE
  (`stock >= :n AND activo = true`) — all of it is backlog #6 by its own scope line
  (`docs/BACKLOG.md:37`). See "Movement UI boundary" below for the explicit reasoning.
- Alerts (quiebre/stock_bajo creation, SAVEPOINT-wrapped evaluator, C1) — #10, depends on
  #6 and #7, not reachable from #5's data alone since nothing except the one create-time
  `ajuste` writes to the ledger in this change.
- Reconciliation (stock_actual vs Σ(ledger) periodic check) — #14, explicitly depends on #5
  but is its own item.
- Reporting, dashboard, POS — untouched, unblocked by #5's completion but not part of it.
- `es_discrepancia = true` UI (discrepancy marking on ajuste) — the CHECK ships now because
  the column exists on the table from day one, but nothing in #5 sets it true; that flag is
  only meaningful on movements #6 creates.

### Movement UI boundary — explicit decision

**The ≤3-step movement-registration modal belongs to #6, not #5.** #5 ships exactly one
movement write path: the create-time initial-stock `ajuste`, embedded in the product-create
transaction and invisible as a standalone UI flow (the user fills a stock field on the
product form; there is no separate "register a movement" screen reachable from #5). This is
consistent with backlog #6's own scope line naming the ≤3-step modal explicitly
(`docs/BACKLOG.md:37`: *"flujo de alta en ≤ 3 pasos (modal 3 pasos del design.md)"*) and
with `docs/TECH-DESIGNv2.md:257-271`'s "Registro de movimiento" acceptance criteria being a
distinct section from "Gestión de productos" (`:241-255`). Building a generic movement modal
in #5 to serve only one call site (initial stock) would be premature generalization against
a deadline that cannot afford rework when #6 defines the real shape (entrada/salida/ajuste,
motivo rules, atomic conditional UPDATE) three days from now.

## Decisions

### D1 — Vertical slice, reversing the #3/#4 split

#3 (users backend) and #4 (proveedores backend) each shipped backend-only, with UI deferred
to #3.1/#4.1. #5 ships backend and screens together, in one change. Two reasons, both
already true and neither optional given the deadline:

1. The application currently has **zero** inventory UI. There is no partial screen to
   fast-follow — #5 is the first user-visible inventory feature, and a demo on 2026-09-01
   with a backend-only #5 shows nothing new.
2. Eleven backlog items remain, four to seven are realistically achievable by the deadline.
   Splitting #5/#5.1 the way #3/#3.1 and #4/#4.1 split adds a full extra SDD cycle (proposal
   → spec → design → tasks → review) for a screen that has no reason to wait — unlike #4.1's
   maestro-detalle view, which was deferred because it needed genuine new UI pattern work
   with no design.md wireframe backing it. The product list/form here reuses
   `DataTable`/`Pagination`/`Modal` unchanged, same as #4's CRUD-adjacent form work; there is
   no discovery risk that justifies a second cycle.

### D2 — `FIELD_RESERVED_FOR_ENCARGADO` deviates from the ratified wire code, by design

`docs/TECH-DESIGNv2.md:120` and its acceptance criterion at `:235-236` both ratify
`campo_reservado_encargado` — Spanish, lowercase, snake_case — as the A7 error code. This
proposal ships `FIELD_RESERVED_FOR_ENCARGADO` instead: English, UPPER_SNAKE, decided by the
owner on 2026-08-29.

This is recorded here as an **explicit, owner-approved deviation from a ratified design
document**, not a silent substitution, because a future reader who diffs this change against
`docs/TECH-DESIGNv2.md:235` needs the reasoning without having to ask:

- Every wire code shipped across four cycles so far is English UPPER_SNAKE:
  `VALIDATION_ERROR`, `FORBIDDEN`, `USER_NOT_FOUND`, `EMAIL_ALREADY_IN_USE`,
  `SUPPLIER_NOT_FOUND`, `SUPPLIER_NAME_IN_USE` (`apps/api/src/lib/errors.ts:76-181`).
  `campo_reservado_encargado` would be the only Spanish, non-UPPER_SNAKE code in the entire
  error contract.
- The deciding precedent is `LAST_ACTIVE_ENCARGADO`, already shipped
  (`apps/api/src/lib/errors.ts:154-160`) and explicitly reasoned about in
  `openspec/changes/archive/2026-08-29-gestion-proveedores/design.md:44-45`: *"`lastActiveEncargado()`
  / `LAST_ACTIVE_ENCARGADO` is not a counter-example: `encargado` there is the literal `rol`
  enum value, so it is a domain datum, not a language choice."* The same reasoning transfers
  directly: `FIELD_RESERVED_FOR_ENCARGADO` keeps English UPPER_SNAKE shape and carries
  `encargado` — the literal `rol` enum value — as the domain datum, exactly the precedent's
  shape.
- Consequence acknowledged: this is public contract, reaching `openapi.json`, then
  `apps/web/src/api/schema.d.ts`, then `errorMessages.ts`'s switch
  (`openspec/changes/archive/2026-08-29-gestion-proveedores/design.md:47-49` states this
  cost explicitly for the analogous `SUPPLIER_NAME_IN_USE` naming decision). Renaming after
  shipping breaks every consumer, so this is decided once, here, before spec.

### D3 — Naming: Spanish types/repos, English error factories/codes

Same split #4 settled and #5 must not re-litigate: `Producto`, `ProductosRepo`, `Movimiento`,
`MovimientosRepo` in Spanish; error factories and codes in English —
`productNotFound()`/`PRODUCT_NOT_FOUND`, `skuAlreadyInUse()`/`SKU_ALREADY_IN_USE`. #4 shipped
`Proveedor`/`ProveedoresRepo` (Spanish) paired with `supplierNotFound()`/`SUPPLIER_NOT_FOUND`
and `supplierNameInUse()`/`SUPPLIER_NAME_IN_USE` (English, using `supplier`, not
`proveedor`) and needed a rename mid-cycle to get there
(`openspec/changes/archive/2026-08-29-gestion-proveedores/design.md:37-42`). Settling it in
the proposal, before spec, is exactly the fix.

## Risks / at-risk scope

- **Deadline is real and tight.** 2026-09-01 delivery, today is 2026-08-29 — two days for
  spec, design, tasks, implementation, and review of #5 before #6 can even start. If #5
  slips, #6/#7/#10 (the rest of the demoable spine) are at direct risk of not fitting at all.
- **`stock_minimo` nullable interacts with alert generation (#10), not #5** — #5 only needs
  to accept and store null; no alert logic exists yet to validate against. Low risk here,
  flagged only because a nullable optional threshold is an easy field to under-specify in
  the Zod schema if rushed.
- **The audit compile-gate (`FIELD_CLASSIFICATION`) is a known trap** — #4 already lost a
  correction cycle to it. Named explicitly in scope above so it is caught in design/tasks,
  not discovered mid-implementation again.
- **Vertical slice increases surface reviewed per change** compared to #3/#4's split, which
  raises review budget per cycle. Given the deadline this is accepted deliberately (see D1)
  but is worth naming as the tradeoff it is: a bigger #5 review vs. a #5.1 cycle the calendar
  cannot afford.
- **Movement UI boundary (see above) is a judgment call, not a certainty.** If #6 turns out
  to need more from #5 than the create-time `ajuste` path (e.g., a shared `MovimientosRepo`
  interface shape #6 must match exactly), that dependency should surface in #6's own
  proposal/design, not retrofitted into #5.

## Proposal question round

This proposal makes several product-shaping calls under time pressure (D1 vertical slice,
the movement-UI boundary, `stock_minimo` nullability handling, and the deactivate/reactivate
UX for a product referenced by ledger history). Given the 2026-09-01 deadline, I am not
blocking on a full question round before delivering this proposal, but flagging the
questions that would sharpen it if there is time to answer them before spec:

1. **Category field** — `docs/TECH-DESIGNv2.md:101` lists `categoria` as a bare data-model
   field with no enum, no separate table, and no UI treatment specified anywhere in the
   design docs. Is it a free-text field for #5, or does it need a fixed list (which would
   need its own small decision before the Zod schema is written)?
2. **Search/filter on the product list** — the list screen mirrors `DataTable` + pagination
   like proveedores, but products realistically need search-by-name/SKU sooner than
   proveedores did (a store's catalog is larger). Should #5 include a search query param, or
   is plain pagination acceptable until #12 (reports) or a later fast-follow needs it?
   Leaving it out now is the assumption unless told otherwise.
3. **What happens to `proveedor_id` when a product references an inactive supplier?**
   `productos.proveedor_id` is an FK to `proveedores`. #4 made supplier deactivation
   preserve references (`docs/BACKLOG.md:34`), so this should already be safe by
   construction — confirming there is no additional guard #5 needs here (e.g. blocking new
   products from choosing an inactive supplier) would remove one open question from design.

### Answered by the owner, 2026-08-29 — these are decisions, not assumptions

1. **Category is free text**, nullable. `docs/TECH-DESIGNv2.md:101` lists `categoria` as a bare
   field with no enum, no table and no UI treatment anywhere in the design docs. A category
   taxonomy is its own backlog item, not a corner of #5.

2. **Product list DOES include search by name and SKU** — a `q` query parameter, case-insensitive,
   matching either field. Chosen deliberately against the deadline: a real catalog runs to
   hundreds of rows, and paging blind through them is the difference between a screen that reads
   as an inventory system and one that reads as a table. Roughly 60 lines across route, service,
   repository, hook and a search input.

3. **A new product MAY NOT be created against an inactive supplier; existing references are never
   broken.** This is the coherent reading of #4's policy: logical deactivation exists to
   *preserve* references and history (`docs/BACKLOG.md:34`), not to invite new ones. A product
   already pointing at a supplier that is later deactivated keeps working, keeps its FK and keeps
   its history — nothing about it changes. Only the create/update path refuses to *choose* an
   inactive supplier, because that is a data-entry error rather than a historical fact. The
   remedy is reactivating the supplier, so the rule is cheap to get wrong in the safe direction.

   Consequence for spec: this needs its own requirement and scenario pair (create refused with a
   named error code; an existing product whose supplier was deactivated still reads, updates and
   moves stock normally). The second half matters more than the first — it is the regression that
   would silently break #4's guarantee.

## Dependencies confirmed available

#2 (auth/RBAC), #2.2 (audit service), #4 (proveedores backend, for `proveedor_id` FK) are all
archived (`docs/BACKLOG.md:28,30,34,58-62`). No blocking dependency remains for #5.
