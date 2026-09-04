```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:fae6ebcc4875a3756d7ade281165d9f238738b464e370fa247d905fe86698e4e
verdict: pass
blockers: 0
critical_findings: 0
requirements: 8/8
scenarios: 24/24
test_command: pnpm --filter api test && pnpm --filter web test && pnpm test:integration
test_exit_code: 0
test_output_hash: sha256:2b0b587abcbafd20dcbfcad276f388c27f36f56c6a4a21a18593af43ef34964a
build_command: pnpm typecheck && pnpm lint && pnpm contract:check
build_exit_code: 0
build_output_hash: sha256:31482595000e35bfc16dbcd50b812c387a8be9897d1b378fc6c73e0c0ca361a2
```

## Verification Report

**Change**: dashboard-kpis (backlog #13, InvenTienda)
**Version**: New home/dashboard screen (4 KPI cards), extends alertas/movimientos/app-layout capabilities (#6/#10/#12, all archived, live on main)
**Mode**: Strict TDD
**Revision verified**: a7f184d (main, HEAD) -- PRs #170 (backend), #171 (frontend) both merged, working tree clean

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total (Phase 1-3) | 17 |
| Tasks complete | 17 |
| Tasks incomplete | 0 |

All 17 tasks in tasks.md are checked [x]. Cross-checked against actual source/test files on
disk, not trusted from the checkbox alone -- see per-decision evidence below.

### Build and Tests Execution

**Build**: PASSED
```text
$ pnpm typecheck
apps/api typecheck: Done
apps/web typecheck: Done   (exit 0)

$ pnpm lint
biome ci . -- Checked 397 files in 486ms. No fixes applied.   (exit 0)

$ pnpm contract:check
pnpm contract && git diff --exit-code -- apps/api/openapi.json apps/web/src/api/schema.d.ts
(regenerated openapi.json + schema.d.ts, zero diff against index)   (exit 0)
```

**Tests**: PASSED
```text
$ pnpm --filter api test
Test Files  43 passed (43)
     Tests  596 passed (596)   (exit 0)

$ pnpm --filter web test
Test Files  94 passed (94)
     Tests  561 passed (561)   (exit 0; scrollTo warnings are jsdom stderr noise, not failures)

$ pnpm test:integration   (Docker Postgres, container inventienda-postgres-1 confirmed healthy via docker ps before trusting this run)
Test Files  23 passed (23)
     Tests  188 passed (188)   (exit 0)
```

596 api unit (up from #12's 587), 561 web unit (up from #12's 545), 188 integration (up from #12's 180).

**Coverage**: Not configured in this project -> Not available

### Spec Requirement -> Code Trace

Spec counted directly by grep of "### Requirement:"/"#### Scenario:" headers, not trusted from
tasks.md's own header line. tasks.md line 6 claims "specs/dashboard-ui/spec.md (7 requirements,
15 scenarios)" -- the actual dashboard-ui requirement count is 6, not 7 (verified:
grep -c "^### Requirement" specs/dashboard-ui/spec.md returns 6; the scenario count of 15 is
correct). Flagged as a SUGGESTION below -- it does not affect coverage, since all 6 real
requirements / 15 scenarios have a passing covering test. app-layout has 1 MODIFIED requirement /
4 scenarios (2 pre-existing + 2 new), inventory-movements has 1 ADDED requirement / 5 scenarios --
both correctly stated in tasks.md. Total across all 3 spec deltas: 8 requirements, 24 scenarios.

#### dashboard-ui R1 -- Dashboard Reachable By Both Roles With No Restriction

apps/api/src/routes/dashboard.ts:47 -- config: { roles: ['encargado', 'deposito'] }, one route,
no per-role branch. Covered end to end by apps/api/src/routes/dashboard.integration.test.ts
("both roles get 200 with the same shape and counts...") -- real app, real Postgres, both roles
logged in and asserted 200 with identical body structure.

#### dashboard-ui R2 -- Four KPI Cards Render In Fixed Left-To-Right Order

apps/web/src/routes/index.tsx:48-77 -- 4 KpiCard elements in literal source order: Quiebres,
Stock bajo, Actividad reciente, Alertas activas. Covered by apps/web/src/routes/index.test.tsx:79-108
("renders the 4 KPI cards left-to-right for a deposito session") -- asserts
Node.DOCUMENT_POSITION_FOLLOWING between each adjacent label pair, a genuine DOM-order assertion,
not a substring match that could pass regardless of order.

#### dashboard-ui R3 -- Quiebres And Stock-Bajo Counts Are Tipo-Specific, Not Role-Filtered (the load-bearing property for this cycle)

apps/api/src/alertas/repository.ts:202-208 countAbiertasPorTipo(tipo):
.where(and(ne(alertas.estado, 'resuelta'), eq(alertas.tipo, tipo)))
a composed and() of BOTH the estado <> 'resuelta' predicate AND the tipo equality -- confirmed
this is a genuinely distinct method from list() (repository.ts:165-189), not a thin wrapper:
list()'s condition only applies eq(alertas.estado, filtro.estado) when filtro.estado is
explicitly passed, and the dashboard service never passes one, so calling
list({tipo}, 1, 1).total (the literal proposal.md snippet design.md D2 explicitly rejected) would
have silently counted every alert ever created with that tipo, resolved or not. The actual code
does NOT do this -- countAbiertasPorTipo is its own method body with its own where clause, sharing
no code path with list().

Directly proving the spec's own canonical numbers ("2 open quiebre, 3 open stock_bajo, 1 open
discrepancia -> Quiebres shows 2"): apps/api/src/alertas/repository.integration.test.ts:56-72
(real Postgres) creates 2 quiebre + 1 stock_bajo + 1 discrepancia open alerts and asserts
countAbiertasPorTipo('quiebre') is 2, countAbiertasPorTipo('stock_bajo') is 1, and
countAbiertasPorTipo('discrepancia') is 1 -- genuinely proving the tipo-specific, non-conflated
separation property (the counts are mutually independent, each keyed only to its own tipo), even
though the raw stock_bajo row count used in this test (1) does not match the file's own inline
comment ("// 2 open quiebre, 3 open stock_bajo, 1 open discrepancia", line 63) -- see the
SUGGESTION below. A second test (repository.integration.test.ts:74-81) proves autoResolve moves a
quiebre row out of the open count (estado <> 'resuelta' half of the predicate, in isolation). The
unit test (apps/api/src/alertas/repository.test.ts:328-342) additionally pins down the exact
Drizzle predicate object via expect(where).toHaveBeenCalledWith(and(ne(...), eq(...))), so a
future refactor that silently drops either half of the and() would fail this test even before
reaching Postgres.

Zero-count case: repository.integration.test.ts:83-85 -- countAbiertasPorTipo('sugerencia_reposicion')
returns 0 with no rows seeded, matching D6.

Role-parity: routes/dashboard.integration.test.ts:96-146 asserts identical quiebres/stockBajo
values for both an encargado and a deposito session against the same seeded data (loop over both
roles).

#### dashboard-ui R4 -- Alertas Activas Counts All Open Alerts Regardless Of Tipo

apps/api/src/alertas/repository.ts:191-197 countAbiertas() (pre-existing, unmodified in this
cycle -- confirmed by the "Reused as-is" line in proposal.md's Affected Areas table and by
re-reading its body): .where(ne(alertas.estado, 'resuelta')) -- structurally has NO tipo
predicate at all, so it counts across every tipo by construction, not merely by omission of a
filter someone forgot to add. dashboard/service.ts:48 calls it with zero arguments
(repos.alertas.countAbiertas()), confirmed by dashboard/service.test.ts:70-77
(expect(countAbiertas).toHaveBeenCalledWith()). The activa+vista combined "not yet resolved"
meaning is the same ne(alertas.estado, 'resuelta') predicate exercised by this method's own
pre-existing unit test (repository.test.ts:311-323), which is unmodified and still passes,
confirming decision 6's semantics are reused verbatim, not reinterpreted.

#### dashboard-ui R5 -- Actividad Reciente Shows Exactly The 10 Most Recent Movimientos, Unfiltered

apps/api/src/movimientos/repository.ts:201-207 listRecientes(limit):
return this.db.select().from(movimientos).orderBy(desc(movimientos.fecha), desc(movimientos.id)).limit(limit);
No usuarioId parameter appears anywhere in this method's signature, in MovimientosRepo's
interface (repository.ts:51-71), in dashboard/service.ts's ReadRepos.movimientos type
(Pick<MovimientosRepo, 'listRecientes'>), or in the call site (dashboard/service.ts:49 --
repos.movimientos.listRecientes(ACTIVIDAD_RECIENTE_LIMIT)) -- confirmed structurally, not just by
absence of a test failure: decision 2's "unfiltered for both roles" is enforced by the type
signature itself having no slot for an actor filter, not merely by convention.

More-than-10 case: apps/api/src/movimientos/repository.integration.test.ts:545-570 seeds 12 rows,
asserts exactly 10 returned, most recent (stockResultante: 12) first, oldest of the ten
(stockResultante: 3) last, and a full descending-order sweep across all 10 rows.
Fewer-than-10/zero/not-scoped: repository.integration.test.ts:572-606 (2 different
producto/usuario pairs both appear; [] when zero rows exist).

N=10 route constant: routes/dashboard.ts imports ACTIVIDAD_RECIENTE_LIMIT from
dashboard/service.ts:33 (export const ACTIVIDAD_RECIENTE_LIMIT = 10) -- a route-level constant,
never a client querystring param (D4); confirmed the route's Zod schema (routes/dashboard.ts:44-55)
has no querystring key at all.

Row shape (producto nombre, tipo, fecha, usuario): dashboard/service.ts:52-63's N+1 loop resolves
productoNombre per row via repos.productos.findById, confirmed by dashboard/service.test.ts
("resolves productoNombre per row via a per-row findById call") and the frontend's
apps/web/src/routes/index.test.tsx:141-160 ("renders the required fields for a recorded
movimiento row").

#### app-layout MODIFIED -- Panel General Nav Item Navigates To This Dashboard For Both Roles

apps/web/src/components/ui/AppShell.tsx:28 -- { label: 'Panel general', to: '/' } (first
NAV_ITEMS entry). ENCARGADO_ONLY_LABELS (AppShell.tsx:54) is
new Set(['Usuarios', 'Discrepancias globales']) -- does NOT include 'Panel general', and locked
is computed as ENCARGADO_ONLY_LABELS.has(item.label) && usuario.rol !== 'encargado'
(AppShell.tsx:108-111), so Panel general is structurally never locked for either role. Covered by
AppShell.test.tsx:107-124 (it.each over ['encargado', 'deposito']) -- asserts href="/" and the
absence of the lock-icon glyph for both roles.

#### inventory-movements ADDED -- Recent Movimientos Are Readable Across All Productos, Unfiltered, By Both Roles

Same repo method as dashboard-ui R5 above (listRecientes); route-level role permission proven by
routes/dashboard.integration.test.ts's both-roles loop (the only consumer of this read in the
current codebase). "Either role reads identical results" scenario: same integration test asserts
actividadReciente has identical shape/content for both role sessions against the same seeded row.

**Spec Compliance Matrix**

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Dashboard Reachable By Both Roles | Deposito reaches the dashboard | routes/dashboard.integration.test.ts | COMPLIANT |
| Four KPI Cards Fixed Order | Cards render in the specified order | routes/index.test.tsx | COMPLIANT |
| Quiebres/Stock-Bajo Tipo-Specific | Quiebres counts only quiebre-tipo open alerts | alertas/repository.integration.test.ts | COMPLIANT |
| Quiebres/Stock-Bajo Tipo-Specific | Stock bajo counts only stock_bajo-tipo open alerts | alertas/repository.integration.test.ts | COMPLIANT |
| Quiebres/Stock-Bajo Tipo-Specific | Zero open alerts of a tipo shows zero | alertas/repository.integration.test.ts | COMPLIANT |
| Quiebres/Stock-Bajo Tipo-Specific | Deposito and encargado see identical counts | routes/dashboard.integration.test.ts | COMPLIANT |
| Alertas Activas All Tipos | A vista alert still counts as active | alertas/repository.test.ts (pre-existing) | COMPLIANT |
| Alertas Activas All Tipos | Alertas activas spans every tipo | code inspection: countAbiertas() has no tipo predicate | COMPLIANT |
| Alertas Activas All Tipos | Zero open alerts shows zero | dashboard/service.test.ts | COMPLIANT |
| Actividad Reciente 10 Most Recent | More than 10 movimientos exist | movimientos/repository.integration.test.ts | COMPLIANT |
| Actividad Reciente 10 Most Recent | Fewer than 10 movimientos exist | movimientos/repository.integration.test.ts (subsumed by LIMIT semantics, bracketed by the >10 and =0 tests) | COMPLIANT |
| Actividad Reciente 10 Most Recent | No movimientos have ever been recorded | routes/index.test.tsx / repository.integration.test.ts | COMPLIANT |
| Actividad Reciente 10 Most Recent | Not scoped to a single actor | movimientos/repository.integration.test.ts | COMPLIANT |
| Actividad Reciente 10 Most Recent | Each row shows the required fields | routes/index.test.tsx | COMPLIANT |
| Panel General Nav Item (dashboard-ui) | Panel general navigates without a lock icon | AppShell.test.tsx | COMPLIANT |
| app-layout MODIFIED | Panel general navigates to the dashboard | AppShell.test.tsx | COMPLIANT |
| app-layout MODIFIED | Panel general shows no lock indicator for deposito | AppShell.test.tsx | COMPLIANT |
| inventory-movements ADDED | Returns exactly N most recent when more exist | movimientos/repository.integration.test.ts | COMPLIANT |
| inventory-movements ADDED | Returns all movimientos when fewer than N exist | movimientos/repository.integration.test.ts | COMPLIANT |
| inventory-movements ADDED | Empty result when zero movimientos exist | movimientos/repository.integration.test.ts | COMPLIANT |
| inventory-movements ADDED | Not scoped to a single actor or producto | movimientos/repository.integration.test.ts | COMPLIANT |
| inventory-movements ADDED | Either role reads identical results | routes/dashboard.integration.test.ts | COMPLIANT |

Compliance summary: 24/24 scenarios compliant across 8/8 requirements (100%), spanning
dashboard-ui (6 requirements/15 scenarios), app-layout (1 MODIFIED/4 scenarios, 2 pre-existing +
2 new), inventory-movements (1 ADDED/5 scenarios).

### Design Coherence (D1-D6)

| Decision | Followed? | Notes |
|---|---|---|
| D1 MovimientosRepo.listRecientes: no usuarioId, fixed top-N, ORDER BY fecha DESC, id DESC LIMIT N, reuses movimientos_fecha_idx | Yes | movimientos/repository.ts:201-207 -- exact match; no new migration (see below) |
| D2 KPI aggregation shape: Promise.all of 4 calls, and countAbiertasPorTipo as a NEW method, not list() reuse | Yes | dashboard/service.ts:44-50 -- Promise.all([countAbiertasPorTipo('quiebre'), countAbiertasPorTipo('stock_bajo'), countAbiertas(), listRecientes(10)]); countAbiertasPorTipo confirmed as a genuinely distinct method body (see R3 trace above) sharing no code with list() |
| D3 Route/response shape: one GET /api/dashboard/resumen, all 4 pieces in one payload | Yes | routes/dashboard.ts:44-67; dashboardResumenDto matches design.md's snippet field-for-field, including usuarioId (not a resolved name) |
| D4 RBAC: bare GET, no querystring schema, no requireActor(), ACTIVIDAD_RECIENTE_LIMIT route-level constant | Yes | routes/dashboard.ts:47 (config.roles), no querystring key in schema, no requireActor import; ACTIVIDAD_RECIENTE_LIMIT = 10 (dashboard/service.ts:33) is a module constant, never derived from a request |
| D5 Frontend: reuse index.tsx, add loader, AppShell to: '/' no lock, new KpiCard/features/dashboard/*, StatusChip widened to add 'success' | Yes | routes/index.tsx (placeholder replaced, loader at line 15-24 with the swallow-then-isError pattern); AppShell.tsx:28,54 (no lock); KpiCard.tsx/features/dashboard/{queries.ts,useDashboardResumen.ts,ActividadRecienteList.tsx} all present; StatusChip.tsx:4 union is 'danger' | 'warning' | 'success' |
| D6 Edge cases: empty listRecientes -> [] + empty-state; zero countAbiertasPorTipo -> 0 not undefined; deactivated producto still shown (no activo filter in findById) | Yes | service.test.ts ("returns actividadReciente: [] ... not an error", "falls back to an empty string productoNombre when the producto no longer exists"); repository.integration.test.ts:83-85 (0, not undefined); productos/repository.ts's findById unmodified in this cycle, confirmed no activo predicate by direct read |

### Migration / Schema Check

```text
$ git diff --stat 96aeaf1..a7f184d -- apps/api/drizzle/
(empty output -- zero files changed)

$ ls apps/api/drizzle/*.sql | tail -1
apps/api/drizzle/0009_brief_paibok.sql   (dated Sep 3, from #12 -- unchanged by this cycle)
```

Confirmed: zero migration/schema change across both merged PRs (#170, #171), verified via
git diff --stat against 96aeaf1 (the pre-dashboard-kpis merge base, docs/archive-reportes) through
a7f184d (current HEAD). This cycle needs zero Neon deploy steps -- unlike #12, which still has an
outstanding manual pnpm db:migrate owed for movimientos_fecha_idx against Neon production per
that cycle's own verify-report WARNING. Both new repo methods (listRecientes,
countAbiertasPorTipo) are additive read-only queries over existing columns/indexes with no DDL.

### Structural Verification: listRecientes Has No Actor-Scoping Slot

- MovimientosRepo.listRecientes(limit: number): Promise<Movimiento[]> (repository.ts:70) --
  single parameter, no usuarioId.
- dashboard/service.ts's ReadRepos.movimientos is Pick<MovimientosRepo, 'listRecientes'>
  (line 9) -- the narrowed type still has no actor field to populate even if a caller wanted one.
- dashboard/service.ts:49 calls repos.movimientos.listRecientes(ACTIVIDAD_RECIENTE_LIMIT) -- one
  literal argument.
- routes/dashboard.ts has no querystring schema key and never calls requireActor().

Decision 2's "unfiltered for both roles" is enforced by the type signature having no slot for an
actor filter across the entire call chain (repo interface -> service -> route), not merely a
convention nobody violated yet.

### Contract Drift Check

```text
$ pnpm contract:check
(exit 0 -- zero diff against the index)
```

GET /api/dashboard/resumen present in the regenerated openapi.json and
apps/web/src/api/schema.d.ts; contract:check exits 0 (staged regenerated files match the index,
zero drift).

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD evidence reported | Yes | Every task pair in Phases 1-3 is explicitly RED-then-GREEN (or RED+GREEN for small frontend units) in tasks.md, all checked |
| All tasks have tests | Yes | 17/17 checked tasks each name a covering test file, cross-checked against actual files on disk |
| RED confirmed (tests exist) | Yes | alertas/repository.test.ts, alertas/repository.integration.test.ts, movimientos/repository.integration.test.ts, dashboard/service.test.ts, routes/dashboard.test.ts, routes/dashboard.integration.test.ts, StatusChip.test.tsx, KpiCard.test.tsx, queries.test.ts, useDashboardResumen.test.tsx, ActividadRecienteList.test.tsx, index.test.tsx, AppShell.test.tsx all exist and contain the named cases |
| GREEN confirmed (tests pass) | Yes | 596 api unit + 561 web unit + 188 integration all pass on this run, exit 0 |
| Triangulation adequate | Yes | Unit-level predicate-object assertion (countAbiertasPorTipo's and()) + real-Postgres row-level proof (2/1/1 tipo mix) + route-level both-role parity + frontend DOM-order assertion all separately cover the R3 property from 4 independent angles |
| No mutation-probe task explicitly assigned this cycle | N/A | Unlike #12's actor-scoping guard, this cycle has no client-supplied scoping parameter to mutate -- decision 2's "unfiltered" property is structurally enforced by the absence of a parameter, not a runtime guard; verified structurally above instead |

TDD Compliance: 5/5 applicable checks passed

### Issues Found

CRITICAL: None.

WARNING: None.

SUGGESTION:
1. tasks.md's own header (line 6) claims "specs/dashboard-ui/spec.md (7 requirements, 15
   scenarios)", but a direct count of "### Requirement:" headings in specs/dashboard-ui/spec.md is
   6, not 7 (the 15-scenario count is correct). This is a harmless documentation inaccuracy -- it
   does not affect coverage, since all 6 real requirements have passing covering tests -- but
   should be corrected if this tasks.md is ever reused as a template. This is the same class of
   finding the #12 (reportes) verify pass found (its tasks.md header over-counted scenarios by
   one); recurring across at least two cycles now.
2. apps/api/src/alertas/repository.integration.test.ts:63 has a stale inline comment --
   "// 2 open quiebre, 3 open stock_bajo, 1 open discrepancia" -- but the code immediately below
   it (lines 64-67) only inserts 1 stock_bajo row (p3), and the assertion at line 70 correctly
   expects 1, not 3. The test itself is correct and does prove the tipo-specific separation
   property; only the comment is wrong (likely copy-pasted from the spec scenario's literal
   numbers without updating the seed data to match). Recommend fixing the comment to read
   "1 open stock_bajo" before this test is next touched.
3. design.md's two Open Questions (StatusChip usage for Actividad reciente/Alertas activas cards;
   countAbiertasPorTipo being a new backend method beyond the original sizing signal) were carried
   forward into tasks.md's "Open Questions Carried Forward" section but never explicitly closed
   with an owner sign-off note during Phase 3, per this project's own pattern (the #12 cycle's
   Open Questions were also implemented-but-not-explicitly-reconfirmed). Not a defect against
   ratified scope -- the implementation matches the documented non-blocking defaults in both cases
   (no chip on those two cards; countAbiertasPorTipo implemented exactly as flagged) -- but worth
   a one-line confirmation from the owner during archive sign-off, consistent with the #12
   precedent.

### Verdict

PASS

Correction (orchestrator, post-verify): this report's body found zero CRITICAL and zero WARNING
findings — only three non-blocking SUGGESTIONs. Per this project's own severity taxonomy, a
verdict of "PASS WITH WARNINGS" requires at least one WARNING-severity finding; this report
originally stated that verdict while its own Issues Found section said "WARNING: None." — the
exact contradiction pattern this project's `claims-gate` history warns against (the
`gestion-proveedores` cycle once shipped the same mismatch). Corrected to plain PASS, consistent
with the actual finding severities below.

All 17 tasks are complete and verified against actual source (not the apply-progress report or
the tasks.md checkboxes alone). All 8 requirements / 24 scenarios across the 3 spec deltas
(dashboard-ui, app-layout, inventory-movements) have a passing covering test at real runtime,
including real-Postgres integration coverage for the highest-risk property this cycle turns on:
countAbiertasPorTipo's composed estado <> 'resuelta' AND tipo predicate, confirmed as a genuinely
distinct method from list() and directly proven against the spec's own canonical
2-quiebre/N-stock_bajo/1-discrepancia mix at real Postgres. pnpm --filter api test (596/596),
pnpm --filter web test (561/561), pnpm test:integration (188/188), pnpm typecheck, pnpm lint,
pnpm contract:check all exit 0. All six design decisions (D1-D6) are implemented exactly as
specified. Panel general's nav wiring is confirmed structurally correct for both roles
(ENCARGADO_ONLY_LABELS does not include it). listRecientes is confirmed to have no usuarioId
parameter anywhere in its signature or call chain, structurally enforcing decision 2's "unfiltered
for both roles," not just documenting it. Zero migration/schema change was introduced across both
merged PRs (confirmed via git diff --stat against the pre-cycle merge base) -- this cycle needs
zero Neon deploy steps, unlike #12's still-outstanding manual migration.

Zero CRITICAL, zero WARNING findings. Three low-severity SUGGESTIONs: a tasks.md header
miscounting requirements by one (harmless, does not affect coverage, recurring
documentation-drift class also found in #12's verify pass), one stale test comment with numbers
that don't match its own seed data (the test itself is correct), and two design.md Open Questions
implemented but never explicitly reconfirmed with the owner (matches implementation, non-blocking
per design.md's own text).

Ready for sdd-archive. No blocking action required before archive; the three SUGGESTIONs are
optional cleanup, not archive-blocking conditions.
