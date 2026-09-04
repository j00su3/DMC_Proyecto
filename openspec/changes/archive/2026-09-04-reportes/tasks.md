# Tasks: Reportes (backlog #12)

**Change**: `reportes` · **Artifact store**: hybrid (this file + Engram `sdd/reportes/tasks`)
**Inputs**: `proposal.md` (scoping decisions ratified 2026-09-03), `design.md` (D1-D5, Data Flow,
File Changes, Testing Strategy, Threat Matrix, Migration/Rollout), `specs/reportes/spec.md` (7
requirements, 11 scenarios).

Strict TDD: every behavior task is RED (failing test) → GREEN (implementation). Design.md's Open
Questions (bajoMinimo default order, stock-actual `q` omission) are implementation defaults, not
blockers — flagged inline where relevant, no task depends on resolving them first.

**Files affected** (per design.md's File Changes table): 3 new (`apps/api/src/reportes/service.ts`,
`apps/api/src/routes/reportes.ts`, one Drizzle migration), 6 modified
(`apps/api/src/productos/repository.ts`, `apps/api/src/productos/service.ts`,
`apps/api/src/movimientos/repository.ts`, `apps/api/src/db/schema.ts`,
`apps/api/src/alertas/repository.ts`, `apps/api/src/app.ts`), plus new
`apps/web/src/features/reportes/`.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~1400-1800 (3 new backend files, 6 modified, 1 migration, 1 new frontend feature dir — production ~350-450, tests ~600-800 incl. real-Postgres integration suites, frontend ~400-550) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 → PR 5 (feature-branch-chain) |
| Delivery strategy | ask-on-risk (default; orchestrator did not override) |
| Chain strategy | feature-branch-chain |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

Rationale: unlike #11 (4 files, ~380-480 lines, Medium risk, single PR), #12 adds a real schema
migration, a brand-new service file, a brand-new route file with 4 endpoints and 2 Zod schemas, the
first row-level (non-role) authorization filter in the codebase (needs its own real-Postgres
mutation-probed test), and a whole new frontend feature directory with no reusable existing route to
extend. Each of those alone approaches or exceeds the 400-line guard once RED tests are counted, so
grouping them into one PR would force a reviewer through 4+ unrelated concerns at once. Split at the
phase boundaries below (D1 and D4 are independent and safe to land first; D2's migration is isolated
on purpose per `CLAUDE.md`'s "adds a table and then 500s" risk; the service/route integration layer
is the highest-risk unit and gets its own PR; frontend depends on the routes existing).

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | `ProductosRepo.bajoMinimo` (D1) + `listBajoMinimo` service wrapper + `AlertasRepo.list()` `tipo` widening (D4) + unit tests | PR 1 (base = tracker branch `reportes`) | `pnpm --filter api exec vitest run src/productos/repository.test.ts src/productos/service.test.ts src/alertas/repository.test.ts` | `pnpm test:integration` — page/count predicate parity, real Postgres | Revert both repo methods and the service wrapper; nothing else consumes them yet |
| 2 | `movimientos_fecha_idx` migration + `MovimientosRepo.listByPeriodo` (D2) + integration tests | PR 2 (base = PR 1 branch) | `pnpm --filter api exec vitest run src/movimientos/repository.integration.test.ts` | `pnpm test:integration` (real Postgres, Docker) — range scan + actor filter | Revert `listByPeriodo`, drop the new migration file; **requires manual `pnpm db:migrate` rollback awareness** if already applied against Neon |
| 3 | `reportes/service.ts` (D3 actor-scoping, all 4 report orchestrations) + unit + integration tests | PR 3 (base = PR 2 branch) | `pnpm --filter api exec vitest run src/reportes/service.test.ts` | `pnpm test:integration` — **load-bearing**: deposito A never sees deposito B's movimientos, real Postgres, mutation-probed | Revert `reportes/service.ts`; PR 1/2's repo methods stay valid unconsumed |
| 4 | `routes/reportes.ts` (D5, 4 routes + Zod schemas) + `app.ts` registration + route tests | PR 4 (base = PR 3 branch) | `pnpm --filter api exec vitest run src/routes/reportes.test.ts` | `pnpm test:integration` — 403 on discrepancias for deposito, 400 on malformed date range | Revert `routes/reportes.ts` and the `app.ts` registration line; service layer (PR 3) stays valid unconsumed |
| 5 | `apps/web/src/features/reportes/` — 4 basic tables, empty states, route registration | PR 5 (base = PR 4 branch) | `pnpm --filter web exec vitest run src/features/reportes` | N/A — no runtime harness needed; frontend route tests run against MSW-mocked API per existing web test convention | Revert the new `features/reportes/` directory and its route registrations; backend (PR 1-4) stays independently deployable |

---

## Phase 1 — `ProductosRepo.bajoMinimo` (D1) + `AlertasRepo.list()` widening (D4)

Independent; no dependency on any other phase. Small, additive, isolated repo methods.

- [x] 1.1 RED: `apps/api/src/productos/repository.test.ts` — `bajoMinimo(page, pageSize)`: a
  producto with `stockActual === stockMinimo` (non-null) is included (spec "Product exactly at
  threshold is included"); a producto with `stockMinimo = null` is excluded regardless of
  `stockActual` (spec "Null stock mínimo is excluded"); `total` reflects the filtered count, not the
  unfiltered total, and stays consistent across pages (spec "Bajo mínimo total matches the filtered
  count") — assert the predicate is applied identically to both the page query and the count query
  (this repo's own documented D7/D11 trap).
- [x] 1.2 GREEN: `apps/api/src/productos/repository.ts` — add `bajoMinimo(page, pageSize):
  Promise<{rows, total}>` per D1: `stockActual <= stockMinimo AND stockMinimo IS NOT NULL`, order
  `asc(stockActual), asc(id)`. Do not touch `list()` or its existing callers (design.md's rejected
  alternative).
- [x] 1.3 GREEN: `apps/api/src/productos/service.ts` — add `listBajoMinimo` thin wrapper over 1.2;
  unit test asserts pass-through of page/pageSize and the returned envelope shape.
- [x] 1.4 RED: `apps/api/src/alertas/repository.test.ts` — `FiltroAlertas.tipo` widening (D4):
  filtering by `tipo = 'discrepancia'` returns only matching rows in both `data` and `total`;
  combined `estado` + `tipo` filters compose correctly (both predicates applied to page and count
  query, extending this file's own D9 precedent).
- [x] 1.5 GREEN: `apps/api/src/alertas/repository.ts` — add `tipo?: TipoAlerta` to `FiltroAlertas`;
  change the single-ternary condition to a composed `and()` of both optional predicates per D4's
  exact snippet.

**Satisfies**: design.md D1, D4. Spec "Bajo Mínimo Report" (both scenarios), "Discrepancias Globales
Report" (data-source predicate only — routing/403 covered in Phase 4), "Pagination Correctness Under
Filtering" (bajo mínimo scenario).

## Phase 2 — `movimientos_fecha_idx` migration + `MovimientosRepo.listByPeriodo` (D2)

Independent of Phase 1/3; Phase 4 depends on this. The migration is its own isolated, early task —
per `CLAUDE.md`: "a change that adds a table [or index] will deploy cleanly and then 500 on every
route that touches it until someone runs that migration." Neon migrations are always run manually by
the user (`pnpm db:migrate`) — never by the agent, per `CLAUDE.md`'s "Never touch `.env*`" /
manual-migration convention. This task only generates the migration file; it does not apply it.

- [x] 2.1 **Migration (isolated task)**: `apps/api/src/db/schema.ts` — add index
  `movimientos_fecha_idx` on `(fecha)` per D2. Run `drizzle-kit generate` to produce the new
  migration file under the existing migrations directory. **Do not run `pnpm db:migrate` against
  Neon** — flag in the PR description and in the final summary that the user must run it manually
  post-merge, exactly as `CLAUDE.md`'s Deployment section and design.md's Migration/Rollout section
  require. Only the `/api/reportes/movimientos` route is affected until this runs; the other three
  report routes need no schema change.
- [x] 2.2 RED: `apps/api/src/movimientos/repository.integration.test.ts` — real Postgres:
  `listByPeriodo` returns movimientos from all actors within `[fechaDesde, fechaHastaExclusiva)`
  (spec "Encargado sees all actors"); an optional `usuarioId` filter, when present, restricts rows
  to that actor only; predicate (date range + optional actor) applied identically to page and count
  query (extends D7/D11/D9 to a third repo); order `desc(fecha), desc(id)`; empty range returns
  `{rows: [], total: 0}` (spec "Empty period is not an error").
- [x] 2.3 GREEN: `apps/api/src/movimientos/repository.ts` — add `listByPeriodo(filtro, page,
  pageSize): Promise<{rows: Movimiento[], total: number}>` per D2's exact signature and predicate,
  using the new `movimientos_fecha_idx` index.

**Satisfies**: design.md D2. Spec "Movimientos — Encargado Scope" (query mechanics only — actor
enforcement is Phase 3), "Report Empty State" (movimientos case), "Pagination Correctness Under
Filtering" (movimientos actor-scope case).

## Phase 3 — `reportes/service.ts` (D3 actor-scoping, all 4 report orchestrations)

Depends on: Phase 1 (`bajoMinimo`, widened `AlertasRepo.list`), Phase 2 (`listByPeriodo`). This is
the highest-risk phase — the first row-level (non-role) authorization filter in the codebase.

- [x] 3.1 RED: `apps/api/src/reportes/service.test.ts` (unit, fake `ReadRepos`) —
  `listarMovimientosPeriodo`: `actor.rol === 'deposito'` always forces `usuarioId = actor.id` into
  the repo call args, regardless of any other input field (spec "Query parameters cannot override
  the scope" — assert the repo call args directly, since the Zod schema structurally has no
  `usuarioId` field to begin with); `actor.rol === 'encargado'` passes `usuarioId: undefined`; a
  calendar-day-inclusive `fechaHasta` is converted to a half-open `fechaHastaExclusiva` (+1 day)
  before reaching the repo (D3); per-row `productoNombre` resolution follows the `alertas/service.ts`
  D6 N+1-lookup idiom, not a join.
- [x] 3.2 GREEN: `apps/api/src/reportes/service.ts` — create the file per D3's exact interfaces
  (`ReadRepos`, `ListarMovimientosPeriodoInput`) and pseudocode; implement `listarMovimientosPeriodo`,
  `listBajoMinimo` passthrough (calls Phase 1's `listBajoMinimo`), `listStockActual` passthrough
  (calls existing `ProductosRepo.list()` unmodified — no new query), and `listDiscrepancias` (calls
  existing `alertas/service.ts::listar(repos, {filtro: {tipo: 'discrepancia'}, ...})` directly per
  D4 — zero new alertas service code).
- [x] 3.3 **Integration (real Postgres, load-bearing, mutation-probed)**:
  `apps/api/src/reportes/service.integration.test.ts` — seed deposito users A and B, each with
  movimientos in the same date range; assert A's request returns only A's rows, none of B's (spec
  "Deposito sees only their own movimientos"); assert supplying B's id as any client-controllable
  parameter has no effect (spec "Query parameters cannot override the scope"). Mutate the
  `actor.rol === 'deposito'` guard (remove it, invert it, compare against `'encargado'` instead) and
  confirm each mutant is caught before trusting the test — this is the named load-bearing test for
  #12 per CLAUDE.md's mutation discipline, mirroring #11's `anularVenta`-exclusion precedent.
- [x] 3.4 Integration: encargado's `listarMovimientosPeriodo` request returns movimientos from more
  than one actor in range (spec "Encargado sees all actors").

**Satisfies**: design.md D3. Spec "Movimientos — Deposito Row-Level Scope" (both scenarios), the
service-layer half of "Movimientos — Encargado Scope", "Stock Actual Report" (passthrough only),
"Discrepancias Globales Report" (service call only — 403 gating is Phase 4).

## Phase 4 — `routes/reportes.ts` (D5, 4 routes) + `app.ts` registration

Depends on: Phase 3. Wires all 4 report endpoints with per-route `config.roles` and Zod schemas.

- [x] 4.1 RED: `apps/api/src/routes/reportes.test.ts` — `GET /api/reportes/stock-actual` and
  `/bajo-minimo`: both roles get `200` and an identical result for identical paging (spec "Both
  roles get identical results"); `GET /api/reportes/movimientos`: malformed range
  (`fechaDesde > fechaHasta`) returns `400 VALIDATION_ERROR` via the Zod `.refine()` (design.md
  Threat Matrix); `GET /api/reportes/discrepancias`: encargado `200` with `estado`/`resueltaEn`/
  `resueltaPor` per row (spec "Encargado sees resolution state"), deposito `403` with no `data`
  (spec "Deposito is denied") — assert no data leaks in the 403 body.
- [x] 4.2 GREEN: `apps/api/src/routes/reportes.ts` — create the file with 4 routes per D5's table
  (`config.roles` per route, mirroring `productos.ts`/`movimientos.ts` — no shared conditional
  branch inside one endpoint per proposal.md's approach); `isoDateSchema` +
  `movimientosPeriodoQuerySchema` exactly per D5's snippet; each route resolves `requireActor` and
  calls the matching `reportes/service.ts` function from Phase 3; reuses
  `apps/api/src/lib/pagination.ts`'s envelope, no new shape.
- [x] 4.3 GREEN: `apps/api/src/app.ts` — register `reportesRoutes`.
- [x] 4.4 Integration: `apps/api/src/routes/reportes.integration.test.ts` (real Postgres) — an
  empty-range movimientos request returns `{data: [], total: 0}` with a 2xx status, not an error
  (spec "Empty period is not an error"); `page=0`/negative `pageSize` rejected by existing
  `pageQuerySchema.min(1)` (no new validation needed, confirm as regression coverage only).

**Satisfies**: design.md D5. Spec "Stock Actual Report", "Discrepancias Globales Report" (403
gating), "Report Empty State" (route-level), threat matrix's malformed-date-range and
`page=0`/negative-`pageSize` rows.

## Phase 5 — Frontend: `apps/web/src/features/reportes/`

Depends on: Phase 4 (routes must exist for real wiring; tables can be built against MSW mocks in
parallel but route registration needs the contract). Scope sized from spec's 4 report requirements
and this project's `AlertasTable.tsx`/`ProveedoresTable.tsx` precedent (~130 lines per presentational
table, `DataTable` + explicit `if (rows.length === 0) return <p>...</p>` empty state, no router
import inside the table component) — design.md explicitly left frontend architecture undetailed, so
no dashboard/chart/export scope is invented here (out of scope per proposal.md).

- [x] 5.1 RED+GREEN: `apps/web/src/features/reportes/StockActualTable.tsx` +
  `BajoMinimoTable.tsx` — presentational tables mirroring `ProveedoresTable.tsx`'s shape; empty
  state `<p>No hay productos para mostrar.</p>` equivalent; tests assert row rendering and the empty
  state, matching `AlertasTable.tsx`'s existing test convention.
- [x] 5.2 RED+GREEN: `apps/web/src/features/reportes/MovimientosPeriodoTable.tsx` — includes
  date-range filter controls (`fechaDesde`/`fechaHasta`, both roles get the same control per
  proposal.md's ratified scoping decision 2); test covers the filter triggering a re-fetch and the
  empty-range empty state.
- [x] 5.3 RED+GREEN: `apps/web/src/features/reportes/DiscrepanciasTable.tsx` — displays `estado`,
  `resueltaEn`, `resueltaPor` per row (spec "Encargado sees resolution state").
- [x] 5.4 Route registration: both-role reports (stock-actual, bajo-minimo, movimientos) under
  `shellLayout`; discrepancias under `encargadoLayout` only (proposal.md: "screens both roles can
  read are never under `encargadoLayout`"; mirrors `CLAUDE.md`'s "Route guards are for
  encargado-only subtrees"). Route-level test asserts deposito is redirected/denied access to the
  discrepancias route in the SPA (UX affordance only — the server's 403 from Phase 4 is the real
  boundary, document as such per `CLAUDE.md`'s Authorization note).
- [x] 5.5 `pnpm contract` / `pnpm contract:check` — regenerate `openapi.json` and
  `apps/web/src/api/schema.d.ts` for the 4 new routes; stage the regenerated artifacts before
  `contract:check` is trusted (per `CLAUDE.md`'s contract-pipeline note: unstaged regenerated files
  read as drift).

**Satisfies**: proposal.md's frontend scope; spec's 4 report requirements (screen-level presentation
only — all authorization/data logic already proven in Phases 1-4).

---

## Dependency Graph

```
Phase 1 (bajoMinimo D1, AlertasRepo widening D4)     Phase 2 (migration + listByPeriodo D2)
        \                                                    /
         \                                                  /
          ▼                                                ▼
                    Phase 3 (reportes/service.ts, D3 actor-scoping)
                                     │
                                     ▼
                    Phase 4 (routes/reportes.ts, D5, app.ts registration)
                                     │
                                     ▼
                    Phase 5 (frontend: apps/web/src/features/reportes/)
```

Phase 1 and Phase 2 have no dependency on each other and may proceed in parallel (separate PRs off
the same tracker branch, or sequential if a single implementer). Phase 3 requires both.

## Open Questions Carried Forward

- [ ] `bajoMinimo`'s default order (`asc(stockActual)`, most-depleted first) — implementation
  default per D1, not ratified in proposal.md. No task above blocks on this; confirm with product
  owner during Phase 5's UI review or leave as-is if no objection surfaces.
- [ ] Stock-actual report route omits `q` (search) per D5's minimal reading of "reuse `list()`
  as-is". No task above blocks on this; flag during Phase 5 if the report is expected to support
  search.

**Manual post-merge step (do not skip)**: after Phase 2's PR merges, the user must run `pnpm
db:migrate` against the Neon `DATABASE_URL` from their own machine before Phase 3/4's
`/api/reportes/movimientos` route is exercised against production — per `CLAUDE.md`'s Deployment
section, Render's free tier has no pre-deploy migration step, and the route will 500 until this
runs. This step is never performed by the agent (no `.env*`/secret access, per `CLAUDE.md`'s "Never
touch `.env*`").
