```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:d6cdfc634349c2705454d699a95c3d9f0e4de843c7c247b24704710c9154ed62
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 7/7
scenarios: 10/10
test_command: pnpm --filter api test && pnpm --filter web test && pnpm test:integration
test_exit_code: 0
test_output_hash: sha256:4d9cd085c0782384794a7d864c1c635a2d8593f94611fac3d8e12a9c30fbb5c3
build_command: pnpm typecheck && pnpm lint && pnpm contract:check
build_exit_code: 0
build_output_hash: sha256:8562700086dfaee507fb2836e62e9ae8684ae1a561efd885157a621f848c876f
```

## Verification Report

**Change**: reportes (backlog #12, InvenTienda)
**Version**: Extends productos/movimientos/alertas capabilities (#5-#11, all archived, live on main)
**Mode**: Strict TDD
**Revision verified**: a65fb54 (main, HEAD) -- PRs #164-#168 all merged, working tree clean

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total (Phase 1-5) | 21 |
| Tasks complete | 21 |
| Tasks incomplete | 0 |

All 21 tasks in tasks.md are checked [x]. Cross-checked against actual source/test files on
disk (not trusted from the checkbox alone) -- see per-decision evidence below.
### Build and Tests Execution

**Build**: PASSED
```text
$ pnpm typecheck
apps/api typecheck: Done
apps/web typecheck: Done   (exit 0)

$ pnpm lint
biome ci . -- Checked 380 files in 804ms. No fixes applied.   (exit 0)

$ pnpm contract:check
pnpm contract && git diff --exit-code -- apps/api/openapi.json apps/web/src/api/schema.d.ts
(regenerated openapi.json + schema.d.ts, zero diff against index)   (exit 0)
```

**Tests**: PASSED
```text
$ pnpm --filter api test
Test Files  41 passed (41)
     Tests  587 passed (587)   (exit 0)

$ pnpm --filter web test
Test Files  89 passed (89)
     Tests  545 passed (545)   (exit 0; scrollTo warnings are jsdom stderr noise, not failures)

$ pnpm test:integration   (Docker Postgres, container inventienda-postgres-1 confirmed healthy via docker ps)
Test Files  21 passed (21)
     Tests  180 passed (180)   (exit 0)
```

587 api unit (up from #11's 564), 545 web unit (up from #11's 525), 180 integration (up from
#11's 169).

**Coverage**: Not configured in this project -> Not available
### Spec Requirement -> Code Trace (7/7 requirements)

Spec counted directly by grep, not trusted from tasks.md's header (#### Scenario: x10,
### Requirement: x7) -- tasks.md's own header line claims "11 scenarios," which is a minor
documentation inaccuracy (actual count is 10); flagged as a SUGGESTION below, it does not affect
coverage since all 10 real scenarios have a passing covering test.

#### R1 -- Stock Actual Report

reportes/service.ts:76-81 listStockActual is a direct passthrough to
repos.productos.list(input.page, input.pageSize) -- ProductosRepo.list() is unmodified (no
diff to that method in this cycle). Route: routes/reportes.ts:160-182,
config.roles: ['encargado', 'deposito'], unfiltered for both. Covered by
routes/reportes.test.ts ("Both roles get identical results") and
routes/reportes.integration.test.ts.

#### R2 -- Bajo Minimo Report

productos/repository.ts:173-196 bajoMinimo(): predicate
and(lte(productos.stockActual, productos.stockMinimo), isNotNull(productos.stockMinimo))
applied identically to both the page query (line 182-188, .where(whereCondition)) and the count
query (line 190-193, same whereCondition reference) -- the D7/D11 trap is not reintroduced, both
queries close over the same whereCondition variable. Inclusive comparison (lte) matches the
"Product exactly at threshold is included" scenario. isNotNull on stockMinimo matches "Null
stock minimo is excluded." Order asc(stockActual), asc(id) matches D1's implementation default.
Covered by productos/repository.test.ts (unit, both scenarios) and
productos/repository.integration.test.ts.

#### R3 -- Movimientos, Encargado Scope

movimientos/repository.ts:162-189 listByPeriodo() with usuarioId filter omitted (encargado
path); reportes/service.ts:45-68 listarMovimientosPeriodo passes usuarioId: undefined when
input.actor.rol is not deposito. Confirmed by
reportes/service.integration.test.ts:137-160 ("returns movimientos from more than one actor for
an encargado's request") -- real Postgres, two seeded actors, result.total equals 2.

#### R4 -- Movimientos, Deposito Row-Level Scope

reportes/service.ts:49 is the sole row-level scoping line:
const usuarioId = input.actor.rol === 'deposito' ? input.actor.id : undefined;. input.actor
comes exclusively from requireActor(request.user) at the route
(routes/reportes.ts:223 const actor = requireActor(request.user);,
productos/service.ts:30-38 derives it strictly from the authenticated session, throwing
unauthorized() if user is null -- no query/body path reaches it). The Zod querystring schema
movimientosPeriodoQuerySchema (routes/reportes.ts:36-41) has fields page, pageSize,
fechaDesde, fechaHasta only -- no usuarioId/actor field exists on the wire contract, so
there is structurally nothing for a client to supply. Confirmed via a live mutation sweep of this
exact guard (see Mutation-Probe Verification below) -- all 3 mutants caught by
reportes/service.integration.test.ts.

#### R5 -- Discrepancias Globales Report

alertas/repository.ts:158-166 list()'s condition is a composed and() of estado and tipo
optional predicates, applied identically to page and count query.
reportes/service.ts:104-116 listDiscrepancias calls the existing
alertas/service.ts::listar(..., { filtro: { tipo: 'discrepancia' }, ... }) directly -- zero new
alertas service code, matching D4. routes/reportes.ts:243-265:
config.roles: ['encargado'] only -- deposito gets 403 via the existing RBAC plugin (no
route-level conditional). alertaDto (routes/reportes.ts:85-95) includes estado, resueltaEn,
resueltaPor per row. Covered by routes/reportes.test.ts (encargado 200 with resolution fields,
deposito 403 with no data) and alertas/repository.test.ts (tipo widening).

#### R6 -- Report Empty State

All four service functions return the repo's {rows, total} unmodified through
lib/pagination.ts::paginated(), which is {data, page, pageSize, total} -- an empty rows array
maps to {data: [], total: 0} with no special-case branch. Confirmed by
routes/reportes.integration.test.ts ("empty-range movimientos request returns
{data: [], total: 0} with a 2xx status").

#### R7 -- Pagination Correctness Under Filtering

Both bajoMinimo() (R2) and listByPeriodo() (R3/R4) compute total from a count query sharing
the identical where condition as the page query -- confirmed by direct code read above, not
inferred. Covered by productos/repository.test.ts ("total reflects the filtered count... stays
consistent across pages") and movimientos/repository.integration.test.ts.
**Spec Compliance Matrix**

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Stock Actual Report | Both roles get identical results | routes/reportes.test.ts | COMPLIANT |
| Bajo Minimo Report | Product exactly at threshold is included | productos/repository.test.ts | COMPLIANT |
| Bajo Minimo Report | Null stock minimo is excluded | productos/repository.test.ts | COMPLIANT |
| Movimientos Encargado Scope | Encargado sees all actors | reportes/service.integration.test.ts | COMPLIANT |
| Movimientos Deposito Row-Level Scope | Deposito sees only their own movimientos | reportes/service.integration.test.ts | COMPLIANT |
| Movimientos Deposito Row-Level Scope | Query parameters cannot override the scope | reportes/service.integration.test.ts | COMPLIANT |
| Discrepancias Globales Report | Encargado sees resolution state | routes/reportes.test.ts | COMPLIANT |
| Discrepancias Globales Report | Deposito is denied | routes/reportes.test.ts | COMPLIANT |
| Report Empty State | Empty period is not an error | routes/reportes.integration.test.ts | COMPLIANT |
| Pagination Correctness Under Filtering | Bajo minimo total matches the filtered count | productos/repository.test.ts | COMPLIANT |

**Compliance summary**: 10/10 scenarios compliant (7/7 requirements, 100%).

### Design Coherence (D1-D5)

| Decision | Followed? | Notes |
|---|---|---|
| D1 ProductosRepo.bajoMinimo: new dedicated method, inclusive comparison, both queries share predicate | Yes | productos/repository.ts:173-196, verbatim match to design.md's predicate and order |
| D2 MovimientosRepo.listByPeriodo: bare rows, new movimientos_fecha_idx index, half-open interval | Yes | movimientos/repository.ts:162-189; index confirmed in schema.ts:235; query has no productoId predicate (confirmed by direct read of condition at line 167-173: only fecha/usuarioId), so the pre-existing (productoId, fecha) index cannot serve this query as an index-condition scan -- the new (fecha) index is genuinely load-bearing here, not redundant |
| D3 Actor-scoping: service-layer only, no client-supplied actor field | Yes | reportes/service.ts:49 is the only scoping line in the entire change; ListarMovimientosPeriodoInput.actor (service.ts:29) is populated only from requireActor(request.user) at the route; Zod schema has no usuarioId field; confirmed by live mutation of this exact line (see below) |
| D4 AlertasRepo.list() widening: additive tipo field, composed and() | Yes | alertas/repository.ts:41,158-166, verbatim match to design.md's snippet |
| D5 Routes and Zod schemas: config.roles per route, isoDateSchema + movimientosPeriodoQuerySchema with refine() | Yes | routes/reportes.ts:33-41,157-266; each of the 4 routes has its own config.roles array, no shared conditional branch |
### Migration / Schema Check

```text
$ ls apps/api/drizzle/*.sql | tail -1
apps/api/drizzle/0009_brief_paibok.sql

$ cat apps/api/drizzle/0009_brief_paibok.sql
CREATE INDEX "movimientos_fecha_idx" ON "movimientos" USING btree ("fecha");
```

Confirmed: exactly one new migration file (0009), matching design.md D2/Migration-Rollout's "one
new index migration, no data backfill, no feature flag." Applied to the LOCAL Docker Postgres
(the integration suite run above exercises listByPeriodo against it directly and passes) --
NOT YET applied to Neon production, confirmed by the DEPLOY-PLAN.md gap below.

### Actor-Scoping Structural Verification (D3, Requirement 4)

- ListarMovimientosPeriodoInput (reportes/service.ts:24-30) fields: fechaDesde, fechaHasta,
  page, pageSize, actor: { id: string; rol: 'encargado' | 'deposito' }. actor is populated
  exclusively at the route (routes/reportes.ts:223) from requireActor(request.user)
  (productos/service.ts:30-38), which reads the Fastify session-derived request.user and throws
  unauthorized() if absent -- no request body, querystring, or header value ever reaches this
  field.
- movimientosPeriodoQuerySchema (routes/reportes.ts:36-41) is
  pageQuerySchema.extend({ fechaDesde, fechaHasta }).refine(...) -- its Zod shape has page,
  pageSize, fechaDesde, fechaHasta only. There is no usuarioId/actor key on the wire
  contract for a client to supply, and Fastify+Zod strips/rejects unknown querystring keys by this
  project's existing convention (matches productos.ts/movimientos.ts), so even a client that
  tried to add one would have it discarded before reaching the service layer.

### Mutation-Probe Verification (1 named load-bearing test, re-executed live)

Per this cycle's task 3.3 instruction and the orchestrator's explicit request (backlog #11's
verify-report cited a prior spot-check attribution error as precedent), I mutated the guard
directly and re-ran the exact integration test file myself, rather than relying on close reading
alone.

Target: reportes/service.ts:49
const usuarioId = input.actor.rol === 'deposito' ? input.actor.id : undefined;

| Mutant | Code | Result |
|---|---|---|
| 1. Remove the guard | const usuarioId = undefined; | CAUGHT -- "returns only deposito A's..." failed: expected 2 to be 1 (deposito A saw both A's and B's rows) |
| 2. Invert the guard | rol === 'deposito' ? undefined : input.actor.id | CAUGHT -- both tests failed: deposito test got expected 2 to be 1, encargado test got expected 1 to be 2 (roles' behavior swapped) |
| 3. Compare against 'encargado' instead | rol === 'encargado' ? input.actor.id : undefined | CAUGHT -- both tests failed with the same swapped-behavior signature as mutant 2 |

Command used for each mutant: pnpm --filter api exec vitest run --config
vitest.integration.config.ts src/reportes/service.integration.test.ts (real Docker Postgres).
After the third mutant, reverted via git checkout -- apps/api/src/reportes/service.ts and
confirmed:
```text
$ git status --short
(empty -- zero output)

$ pnpm --filter api exec vitest run --config vitest.integration.config.ts src/reportes/service.integration.test.ts
Test Files  1 passed (1)
     Tests  2 passed (2)   (exit 0)
```

All 3 named mutants of the exact guard the task/orchestrator flagged (remove, invert, wrong-role
comparison) are genuinely caught by reportes/service.integration.test.ts as re-executed live in
this verify pass -- not spot-checked by reading alone. This is the first row-level (non-role)
authorization filter in the codebase and the highest-risk test in this change; it is proven
mutation-sensitive by direct execution.
### Frontend RBAC Affordance vs. Backend Enforcement

apps/web/src/routes/reportesDiscrepancias.tsx:36 -- getParentRoute: () => encargadoLayout,
matching routes/reportes.ts:246 -- config: { roles: ['encargado'] } on
GET /api/reportes/discrepancias. The route's own docblock (lines 24-34) explicitly documents
this as a UX affordance only, citing the server's 403 as the real boundary -- matching
CLAUDE.md's "Route guards are for encargado-only subtrees" / "the server's 403 is the boundary"
convention verbatim, and matching usuarios.tsx's precedent pattern. The other three routes
(reportesStockActual.tsx, reportesBajoMinimo.tsx, reportesMovimientos.tsx) all use
getParentRoute: () => shellLayout, matching their config.roles: ['encargado', 'deposito']
route-level RBAC -- confirmed by direct grep of all four route files' getParentRoute line, zero
mismatches.

### Contract Drift Check

```text
$ pnpm contract:check
(exit 0 -- zero diff against the index)

$ grep -n '"/api/reportes/' apps/api/openapi.json
7898: "/api/reportes/stock-actual"
8086: "/api/reportes/bajo-minimo"
8274: "/api/reportes/movimientos"
8528: "/api/reportes/discrepancias"

$ grep -n '"/api/reportes/' apps/web/src/api/schema.d.ts
3771: "/api/reportes/stock-actual"
3856: "/api/reportes/bajo-minimo"
3941: "/api/reportes/movimientos"
4046: "/api/reportes/discrepancias"
```

All 4 new routes present in both generated contract artifacts; contract:check exits 0 (staged
regenerated files match the index, zero drift).

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD evidence reported | Yes | Every task pair in Phases 1-5 is explicitly RED-then-GREEN in tasks.md, both steps checked |
| All tasks have tests | Yes | 21/21 checked tasks each name a covering test file, cross-checked against actual files on disk |
| RED confirmed (tests exist) | Yes | productos/repository.test.ts, alertas/repository.test.ts, movimientos/repository.integration.test.ts, reportes/service.test.ts, reportes/service.integration.test.ts, routes/reportes.test.ts, routes/reportes.integration.test.ts, 4 frontend table test files all exist and contain the named cases |
| GREEN confirmed (tests pass) | Yes | 587 api unit + 545 web unit + 180 integration all pass on this run, exit 0 |
| Triangulation adequate | Yes | Both-page/count-query predicate parity (3 repos), real-Postgres row isolation, 403/400 route-level, empty-state, and frontend empty-state cases all separately covered |
| Mutation-probe task (3.3) completed | Yes (re-executed live) | See Mutation-Probe Verification above -- all 3 mutants caught, revert confirmed clean |

**TDD Compliance**: 6/6 checks passed
### Issues Found

**CRITICAL**: None.

**WARNING**:
1. docs/DEPLOY-PLAN.md has NO entry for migration 0009_brief_paibok.sql
   (movimientos_fecha_idx). The file's last dated entry is "2026-09-03 -- Sugerencia de
   reposicion (#11) merged" (line 881) and the file ends at line 909 with no further content --
   confirmed by direct read of the full file (909 lines) and grep for "0009"/"reportes", both
   empty. This breaks the project's own established precedent: #8's render.yaml incident,
   #10's 0008_superb_kronos.sql entry (line 849-873), and #11's explicit "no migration, safe
   auto-deploy" entry (line 881-908) all got a dated docs/DEPLOY-PLAN.md registry entry before
   or during their archive phase. This cycle's migration is genuinely applied to the LOCAL Docker
   Postgres only (confirmed via the passing integration suite above) -- it is NOT yet applied to
   Neon production, and per CLAUDE.md's "a change that adds a table [or index] will deploy
   cleanly and then 500" rule, GET /api/reportes/movimientos will 500 against Neon until the
   owner runs pnpm db:migrate manually. Without a DEPLOY-PLAN.md entry, this operational fact is
   undocumented and easy to lose track of. Recommend: sdd-archive add a dated entry mirroring
   #10's format before this cycle closes, per this project's own established convention.

**SUGGESTION**:
1. tasks.md's own header (line 6) claims "11 scenarios," but a direct count of
   #### Scenario: headings in specs/reportes/spec.md is 10 (verified by grep, shown above).
   This is a harmless documentation inaccuracy -- it does not affect coverage, since all 10 real
   scenarios have a passing covering test -- but should be corrected if this tasks.md is ever
   reused as a template.
2. design.md's Open Questions (bajoMinimo default order, stock-actual q omission) were never
   explicitly re-confirmed with the product owner during Phase 5, per the tasks.md note that this
   was optional ("confirm... or leave as-is if no objection surfaces"). Implementation matches the
   documented defaults in both cases (asc(stockActual), asc(id) order; no q param on
   stock-actual). Not a defect against ratified scope, but worth a one-line confirmation from the
   owner during archive sign-off since both are genuine, if minor, product-facing choices.

### Verdict

**PASS WITH WARNINGS**

All 21 tasks are complete and verified against actual source (not the apply-progress report or
the tasks.md checkboxes alone). All 7 requirements / 10 scenarios (tasks.md's own header
over-counts by one; verified by direct grep) have a passing covering test at real runtime,
including real-Postgres integration coverage for the highest-risk property: pnpm --filter api
test (587/587), pnpm --filter web test (545/545), pnpm test:integration (180/180), pnpm
typecheck, pnpm lint, pnpm contract:check all exit 0. All five design decisions (D1-D5) are
implemented exactly as specified, including D2's genuinely load-bearing new index (confirmed the
query has no productoId predicate, so the old index cannot serve it) and D3's actor-scoping
guard, which I mutated live three ways (removed, inverted, wrong-role comparison) and confirmed
each mutant is caught by reportes/service.integration.test.ts, then reverted to a clean git
diff. The frontend's encargadoLayout/shellLayout split matches the backend's config.roles
exactly, with zero mismatches across all 4 routes. Contract drift is zero across all 4 new routes
in both openapi.json and schema.d.ts.

One real WARNING blocks nothing functionally but should be fixed before archive closes:
docs/DEPLOY-PLAN.md has no entry documenting that migration 0009 (movimientos_fecha_idx) is
applied locally but NOT yet to Neon -- breaking this project's own established per-cycle
documentation convention (#8, #10, #11 precedent). Recommend sdd-archive add this entry as part
of closing the cycle, mirroring #10's dated-entry format, before merging any further work that
assumes this route is production-ready.

Ready for sdd-archive, contingent on the DEPLOY-PLAN.md entry being added (either by archive
itself, per #10's precedent of archive owning this deliverable, or by the user directly before
archive runs).
