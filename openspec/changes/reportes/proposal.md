# Proposal: Reportes (backlog #12)

## Intent

`docs/BACKLOG.md` item #12 asks for read-only reporting over data #6 (movimientos) and #7
(punto-de-venta) already produce. Today an encargado or deposito user has no way to see stock
levels, low-stock items, movement history, or discrepancy totals without querying the database
directly — `GET /api/productos` exists but has no bajo-mínimo predicate, `MovimientosRepo` only
supports a single-product view, and there is no discrepancy report at all. This change closes that
gap with four purpose-built, read-only endpoints, gated per role per `docs/PRD.md:62-64`'s
verbatim RBAC split, and their minimal frontend screens.

Success: an encargado can see stock actual, bajo mínimo, movimientos por período (any product,
any actor), and discrepancias globales; a deposito user can see the same stock actual and bajo
mínimo views (unfiltered) plus their own movimientos, and is denied discrepancias globales at the
route level (403), matching `docs/TECH-DESIGNv2.md:341-348`.

## Scope

### In scope

- **`ProductosRepo.bajoMinimo(page, pageSize)`** (or equivalent) — a new server-side query that
  filters `stock_actual <= stock_minimo` (excluding null `stock_minimo`, per existing semantics of
  that nullable column) BEFORE pagination and BEFORE the count query, applying the identical
  predicate to both — this repo already documents the D7/D11 trap (`repository.ts:106-108,
  122-123`: "the search predicate is built once and composed into BOTH the page query and the count
  query. Applying it to only one is the single most likely defect here") and this change must not
  reintroduce it.
- **`MovimientosRepo.listByPeriodo(...)`** (or equivalent) — a new cross-producto, date-range
  paginated query with an optional actor filter, since `listByProducto` today is single-product
  only. Used directly by encargado's movimientos-por-período report; used with an actor filter
  forced server-side by deposito's own-movimientos report.
- **Discrepancias globales query** — resolves open question 1 below; encargado-only.
- **4 routes**, each with explicit `config.roles`, mirroring `proveedores.ts`/`usuarios.ts`
  precedent — no shared conditional branch inside one endpoint:
  - `GET /api/reportes/stock-actual` — `['encargado', 'deposito']`, unfiltered for both roles
    (reuses `ProductosRepo.list()`, no new query needed here).
  - `GET /api/reportes/bajo-minimo` — `['encargado', 'deposito']`, unfiltered for both roles.
  - `GET /api/reportes/movimientos` — `['encargado', 'deposito']`; encargado gets the full
    cross-producto/date-range query; deposito's request is scoped server-side to
    `WHERE usuario_id = :actor` inside the service layer per ADR-0007's resolution of finding A6
    (`docs/REVISION-ADVERSARIAL.md:468-491`) — never inside RBAC middleware, which stays
    per-endpoint only.
  - `GET /api/reportes/discrepancias` — `['encargado']` only; deposito gets a 403.
- Reuse `apps/api/src/lib/pagination.ts`'s `{data, page, pageSize, total}` envelope for all four —
  no new envelope shape.
- Frontend: basic report screens/tables under `apps/web/src/features/reportes/`, both-role reports
  under `shellLayout` (mirrors proveedores/productos precedent — screens both roles can read are
  never under `encargadoLayout`), discrepancias under `encargadoLayout`. Explicit empty state per
  screen, matching `AlertasTable.tsx:121-123` / `ProveedoresTable.tsx:124-126`'s existing
  `if (rows.length === 0) return <p>...</p>` pattern — no new backend envelope needed for this,
  `{data: [], total: 0}` is already structurally distinct from an error envelope.
- New test coverage for the row-level `usuario_id = :actor` filter specifically: this is the first
  row-level (non-role) authorization filter in the codebase (`apps/api/src/plugins/auth.ts:35-97`
  is default-deny but strictly per-endpoint), so a test asserting deposito A never sees deposito
  B's movimientos is required, not optional.

### Out of scope

- Any dashboard or KPI visualization (charts, aggregated summaries beyond a plain table) — that is
  backlog #13, not #12.
- CSV/PDF export or any download capability — not mentioned in `docs/PRD.md` or
  `docs/TECH-DESIGNv2.md` for this item.
- Any change to how alertas or `esDiscrepancia` movimientos are created, resolved, or classified —
  this change only reads existing data, it never writes.
- Any change to `ProductosRepo.list()`, `MovimientosRepo.listByProducto()`, or existing RBAC
  middleware behavior — those stay as-is; this change is additive.

### Depends on

#6 (movimientos) and #7 (punto-de-venta), both satisfied, archived, live on `main`.

## Approach

Follow exploration.md's recommended approach 1: four purpose-built endpoints, each backed by its
own repo query, actor-scoping applied explicitly in the service/query layer per finding A6's
resolution (row-level filtering is the service layer's job; RBAC middleware stays per-endpoint
only). This was chosen over a single role-driven-projection endpoint because it matches every
existing precedent in this codebase (`proveedores.ts`, `usuarios.ts` per-route `config.roles`) and
keeps the novel `usuario_id = :actor` filter isolated in one place, easy to audit and to test in
isolation, rather than hidden inside a shared conditional branch that both roles' traffic flows
through.

Three layers per domain, per `CLAUDE.md`: `routes/reportes.ts` (Fastify + Zod, `config.roles` per
route) → `reportes/service.ts` (business rules, including the actor-scoping decision) →
repository methods added to the existing `ProductosRepo`/`MovimientosRepo`/`AlertasRepo` ports
(no new repo needed — reportes reads through the domains that already own this data, it doesn't
own a table of its own).

## Scoping decisions (ratified by the owner, 2026-09-03)

1. **Discrepancias globales data source: `alertas`** (tipo='discrepancia'), as recommended below.
2. **Deposito's movimientos report scope: shares the same date-range-filterable query as
   encargado's**, just row-scoped, as recommended below.

## Ratified scoping rationale (kept for reference)

### 1. Discrepancias globales data source

`movimientos.esDiscrepancia` (permanent historical boolean, set once at write time via
`RegistrarMovimientoInput.esDiscrepancia`, `movimientos/service.ts:33,120` — never revised
afterward) vs. `alertas` where `tipo = 'discrepancia'` (has `estado`/`resueltaEn`/`resueltaPor`,
i.e. tracks whether the discrepancy is still open).

**Recommendation: `alertas`.** Reasons:

- `AlertasRepo.list(filtro, page, pageSize)` (`apps/api/src/alertas/repository.ts:59-63,
  149-175`) already exists with correct pagination (filter applied to both the page and count
  query, matching this repo's own D9 precedent comment). `FiltroAlertas` only needs one additive
  field (`tipo?: TipoAlerta`) to support it — smaller, lower-risk change than writing a new
  discrepancy query against `movimientos` from scratch.
- `alertas` rows carry resolution state (`estado: 'activa' | 'vista' | 'resuelta'`,
  `resueltaEn`, `resueltaPor`) that is directly useful report context ("is this still an open
  problem or was it already handled") — `movimientos.esDiscrepancia` is a permanent flag with no
  such lifecycle, so a report built on it can only ever show "this write was flagged," never "is
  this still unresolved."
- Building the report on `alertas` avoids introducing a second, semantically overlapping query
  path for the same underlying concept (a discrepancy movement always produces exactly one
  `alertas` row of `tipo = 'discrepancia'` — see `alertas.create()`'s dedup unique index — so
  nothing is lost by reading the alert instead of the raw movement).

Ratify or override before spec/design starts — this is a real product decision (what "discrepancias
globales" shows: raw historical flags vs. currently-tracked problems with resolution state), not a
pure implementation detail, and the spec phase needs it settled to write the report's fields and
filters.

### 2. Deposito's movimientos report scope

`docs/TECH-DESIGNv2.md:341-348` calls encargado's report "movimientos por período" (i.e.
date-range filterable). `docs/PRD.md:62-64` describes deposito's as "sus propios movimientos"
without repeating the "por período" qualifier.

**Recommendation: the same date-range-filterable query, just row-scoped**, not a separate
unfiltered own-history list. Reasons:

- The approach in scope already builds one shared cross-producto/date-range query
  (`MovimientosRepo.listByPeriodo`) with an optional actor filter — reusing it for deposito by
  forcing the actor filter server-side costs nothing extra in the data layer, whereas building a
  second, simpler own-history query would be pure duplication of a query the encargado path
  already needs.
- PRD's matrix line (`PRD.md:39-42`) labels deposito's access "🔒 (operativos)" without saying the
  period control itself is denied — the more plausible reading is that "por período" was omitted
  from the deposito sentence as elliptical shorthand (the qualifier was already established two
  sentences earlier for encargado), not that deposito is deliberately denied date filtering.

Ratify or override before spec/design — if the owner intends a genuinely simpler own-history view
(no date-range control in the UI, or a fixed recent window), that changes the frontend's filter
controls and needs to be settled before spec.

## Risks

- Both open questions above are product-facing, not implementation detail; leaving either
  unratified before spec/design risks a spec written against the wrong assumption (mirrors the
  "spec and design run in parallel and cannot see each other" rule in `CLAUDE.md` — a contradiction
  discovered late costs a correction cycle).
- Row-level `usuario_id = :actor` scoping is unprecedented in this codebase; the temptation to fold
  it into RBAC middleware (like the other three roles-only routes) instead of the service layer
  must be resisted — that was finding A6's exact failure mode.
- Bajo-mínimo report risks the documented D7/D11 fetch-then-filter trap if the predicate is applied
  to the page query only, or applied after the existing search/soloActivos predicate is already
  composed, without also updating the count query.
- No wireframe/mockup exists for reportes screens; frontend scope for this change is basic
  tables only, matching `AlertasTable.tsx`/`ProveedoresTable.tsx`'s existing shape, to avoid
  scope creep into #13's territory.
