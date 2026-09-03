```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:3cdf0063c3c1d39e9ddf555c2bb2004a9e0fe06c
verdict: pass
blockers: 0
critical_findings: 0
requirements: 5/5
scenarios: 13/13
test_command: pnpm --filter api test && pnpm --filter web test && pnpm test:integration
test_exit_code: 0
test_output_hash: sha256:92c0700c97914e9ffc37d4450469bf42fce95a61f90b7158a36f15d92ab43f1b
build_command: pnpm typecheck && pnpm lint && pnpm contract:check
build_exit_code: 0
build_output_hash: sha256:c4a23b831fed9be85b2eb5a71c60dba1fe41e4a76b5b5f0b6458d1ad1974509b
```

## Verification Report

**Change**: sugerencia-reposicion (backlog #11, InvenTienda)
**Version**: Extends alertas capability (backlog #10, archived 2026-09-02)
**Mode**: Strict TDD
**Revision verified**: 3cdf006 (main, HEAD) -- PR #161 (0e304f8) + PR #162 (3cdf006) both merged, working tree clean

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total (Phase 1-2) | 11 |
| Tasks complete | 11 |
| Tasks incomplete | 0 |

All 11 tasks in tasks.md are checked [x]. Cross-checked against actual source/test files on
disk (not trusted from the checkbox alone) -- see per-decision evidence below.

### Build and Tests Execution

**Build**: PASSED
```text
$ pnpm typecheck
apps/api typecheck: Done
apps/web typecheck: Done   (exit 0)

$ pnpm lint
biome ci . -- Checked 353 files in 609ms. No fixes applied.   (exit 0)

$ pnpm contract:check
pnpm contract && git diff --exit-code -- apps/api/openapi.json apps/web/src/api/schema.d.ts
(regenerated openapi.json + schema.d.ts, zero diff against index)   (exit 0)
```

**Tests**: PASSED
```text
$ pnpm --filter api test
Test Files  39 passed (39)
     Tests  564 passed (564)   (exit 0)

$ pnpm --filter web test
Test Files  83 passed (83)
     Tests  525 passed (525)   (exit 0; scrollTo warnings are jsdom stderr noise, not failures)

$ pnpm test:integration   (Docker Postgres, container inventienda-postgres-1 confirmed healthy)
Test Files  19 passed (19)
     Tests  169 passed (169)   (exit 0)
```

564 api unit (up from #10's 552) and 169 integration (up from #10's 159).

**Coverage**: Not configured in this project -> Not available

### Spec Requirement -> Code Trace (5/5 requirements)

#### R1 -- Sugerencia De Reposicion Evaluation Rule (S7 Heuristic)

Read apps/api/src/alertas/evaluador.ts:165-184 directly:

```ts
if (movimiento.tipo !== 'anulacion') {
  const { unidadesSalida30d, diasHistoria } =
    await repos.movimientos.resumenRotacion(movimiento.productoId);
  if (diasHistoria >= 7) {
    const divisor = Math.min(diasHistoria, 30);
    const promedioDiario = unidadesSalida30d / divisor;
    if (promedioDiario > 0) {
      const coberturaDias = movimiento.stockResultante / promedioDiario;
      if (coberturaDias < 14) { await crearYAuditar(..., 'sugerencia_reposicion', ...); }
    }
  }
}
```

Byte-for-byte match to design.md's Evaluator Logic pseudocode (design.md:141-153). All 5
scenarios covered by evaluador.test.ts:319-513 (diasHistoria 6/7/29/30/31, promedioDiario = 0,
coberturaDias exactly-14 vs 13.99) -- all pass in the 564/564 unit run above.

#### R2 -- Evaluated Only At Specific Call Sites

Read all four call sites directly (grep + read, not from apply-progress):

| Call site | Evidence | Fires S7? |
|---|---|---|
| movimientos/service.ts:140 | registrarSiCorresponde(txRepos, tx, { movimiento, ... }), movimiento.tipo = input.operacion | Yes |
| productos/service.ts:126 (crearProducto, stockInicial > 0) | Same call, movimiento.tipo = 'ajuste' | Structurally never (see finding below) |
| ventas/service.ts:265 (confirmarVenta) | Same call, movimiento.tipo = 'venta' | Yes |
| ventas/service.ts:398 (anularVenta) | Same call, movimiento.tipo = 'anulacion' | No -- evaluator's tipo-not-anulacion guard short-circuits before resumenRotacion is ever called |

Confirmed via evaluador.test.ts:495-513: tipo === 'anulacion' asserts
h.resumenRotacion not toHaveBeenCalled. Integration proof in
sugerencia-reposicion.integration.test.ts (319 new lines) exercises all four real call sites
against real Postgres.

#### R3 -- Reuses Existing De-Duplication

No new dedup code was written (design.md D5/D7 explicitly state this). The existing partial unique
index (alertas_producto_tipo_abierta_unique, from #10) and AlertasRepo.create()'s
onConflictDoNothing are unchanged and apply to the fourth tipo automatically since TipoAlerta
already included sugerencia_reposicion as a pgEnum value from #10 (design D5 there). Covered by
integration task 2.7.

#### R4 -- Carries No Suggested Quantity

repository.ts:20-29's Alerta interface is unchanged by this cycle -- no new field was added. No
new route was introduced (grep of routes/alertas.ts shows no diff for this change -- confirmed
by the git diff --stat below showing zero touched route files). Alerts surface via the existing
GET /api/alertas endpoints, unchanged.

#### R5 (MODIFIED) -- Manual Resolution Restricted To Encargado

service.ts:94-97:
```ts
const TIPOS_MANUALMENTE_RESOLVIBLES: readonly TipoAlertaEvaluada[] = [
  'discrepancia',
  'sugerencia_reposicion',
];
```
Matches design.md D2 exactly. Covered by service.test.ts (unit) and routes/alertas.test.ts
(route, 200/403 + DB-unchanged-on-refusal assertions per CLAUDE.md convention).

**Spec Compliance Matrix**

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| S7 Evaluation Rule | Below-threshold triggers | evaluador.test.ts | COMPLIANT |
| S7 Evaluation Rule | Exactly 14 does not trigger | evaluador.test.ts | COMPLIANT |
| S7 Evaluation Rule | Fewer than 7 days skipped | evaluador.test.ts | COMPLIANT |
| S7 Evaluation Rule | Partial history averages over available days | evaluador.test.ts | COMPLIANT |
| S7 Evaluation Rule | promedio_diario=0 never suggests | evaluador.test.ts | COMPLIANT |
| Call-Site Scope | Qualifying call site triggers | sugerencia-reposicion.integration.test.ts | COMPLIANT |
| Call-Site Scope | anularVenta does not trigger | evaluador.test.ts (unit) + sugerencia-reposicion.integration.test.ts | COMPLIANT |
| Dedup Reuse | No duplicate open alert | sugerencia-reposicion.integration.test.ts | COMPLIANT |
| No Quantity Field | Alert row has no quantity field | sugerencia-reposicion.integration.test.ts | COMPLIANT |
| Manual Resolution (encargado) | Encargado resolves discrepancia | service.test.ts / alertas.test.ts | COMPLIANT (pre-existing #10 case) |
| Manual Resolution (encargado) | Deposito refused (discrepancia) | routes/alertas.test.ts | COMPLIANT (pre-existing #10 case) |
| Manual Resolution (encargado) | Encargado resolves sugerencia_reposicion | service.test.ts, routes/alertas.test.ts | COMPLIANT |
| Manual Resolution (encargado) | Deposito refused (sugerencia_reposicion) | routes/alertas.test.ts | COMPLIANT |

**Compliance summary**: 13/13 scenarios compliant (5/5 requirements, 100%).

### Design Coherence (D1-D7)

| Decision | Followed? | Notes |
|---|---|---|
| D1 TipoAlertaEvaluada = TipoAlerta (drop Exclude) | Yes | repository.ts:17 -- type alias verbatim |
| D2 TIPOS_MANUALMENTE_RESOLVIBLES gains sugerencia_reposicion, never auto-resolves | Yes | service.ts:94-97; evaluador.ts only calls crearYAuditar for this tipo, never autoResolverYAuditar |
| D3 anularVenta exclusion keyed on movimiento.tipo, inside evaluar() | Yes | evaluador.ts:165 exact guard; zero call-site changes confirmed by git diff; EvaluadorMovimiento.tipo added at evaluador.ts:18 |
| D4 boundary semantics: strict less-than-14, diasHistoria greater-or-equal-7, divisor = min(diasHistoria, 30) | Yes | evaluador.ts:168-173, all strict, no epsilon. Confirmed against 6 boundary unit tests |
| D5 resumenRotacion SQL, existing index, no migration | Yes | movimientos/repository.ts:115-139 -- SQL is a verbatim match to design.md's query; no new index/migration |
| D6 evaluator reads movimiento.stockResultante, never fresh producto.stockActual | Yes | evaluador.ts:172 -- no producto lookup anywhere in the S7 branch |
| D7 EvaluadorRepos.movimientos narrowed via Pick, zero call-site changes | Yes | evaluador.ts:37; confirmed zero diff in movimientos/service.ts, productos/service.ts, ventas/service.ts |

**D5 SQL, read verbatim** (movimientos/repository.ts:116-123):
```sql
select
  coalesce(sum(case when tipo in ('venta', 'salida') and fecha >= now() - interval '30 days'
                     then -cantidad else 0 end), 0)::int as unidades_salida_30d,
  floor(extract(epoch from (now() - min(fecha))) / 86400)::int as dias_historia
from movimientos
where producto_id = $1
```
Reuses movimientos_producto_id_fecha_idx (design.md D5) -- no new index or migration.

### Migration / Schema Check

```text
$ git diff e755bcc..3cdf006 --stat -- apps/api/drizzle/
(empty -- zero output)

$ ls apps/api/drizzle/*.sql
0000_old_omega_flight.sql ... 0008_superb_kronos.sql   (9 files, all pre-dating this cycle)
```

Confirmed: zero migration files added by PR #161 or PR #162. This change requires no Neon
deploy step -- unlike #10, this is a pure code change against schema already generic enough
(pgEnum carries all four TipoAlerta values since #10's D5).

### Zero production-code-changes claim -- Direct Diff Verification

```text
$ git diff e755bcc..3cdf006 -- apps/api/src/movimientos/service.ts apps/api/src/productos/service.ts apps/api/src/ventas/service.ts
(empty -- zero output)
```

Confirmed genuinely true, diffed directly against the pre-change base commit (e755bcc, tip of
#10's archive/docs chain, immediately before PR #161's first commit 2f49272). Full stat for
the entire cycle:

```text
apps/api/src/alertas/evaluador.test.ts             | 213 +++++++++++++-
apps/api/src/alertas/evaluador.ts                  |  27 ++
apps/api/src/alertas/repository.ts                 |  14 +-
apps/api/src/alertas/service.test.ts               |  28 ++
apps/api/src/alertas/service.ts                    |  11 +-
sugerencia-reposicion.integration.test.ts (new)    | 319 +++++++++++++++++++++
apps/api/src/app.test.ts                           |   1 +
movimientos/repository.integration.test.ts         | 142 ++++++++-
apps/api/src/movimientos/repository.ts             |  42 +++
apps/api/src/routes/alertas.test.ts                |  51 +++-
routes/movimientos.integration.test.ts             |   1 +
apps/api/src/routes/movimientos.test.ts             |   5 +
routes/productos.integration.test.ts               |   1 +
apps/api/src/routes/ventas.test.ts                 |   1 +
+ openspec artifacts (design/exploration/proposal/spec/tasks)
19 files changed, 1586 insertions, 12 deletions
```

Exactly the 4 files named in tasks.md's Files affected list carry production-code changes
(evaluador.ts, repository.ts alertas, service.ts alertas, repository.ts movimientos). All
other touched files are tests, one app.test.ts line (route registration snapshot), or openspec
artifacts.

### Mutation-Probe Verification (2 named load-bearing tests)

Both spot-checked by close re-reading of the test assertions, not by re-running the actual mutation
sweep myself:

1. **30-day boundary** (movimientos/repository.integration.test.ts:305-322, "counts a movimiento
   at day 29 but excludes one older than 30 days"): inserts a day-29 movimiento (cantidad -5) and a
   day-31 movimiento (cantidad -7), asserts unidadesSalida30d equals 5. This precise numeric
   equality would fail under every mutant task 1.3 names: flipping the interval comparison operator
   would break the adjacent inclusive-boundary test (line 324, exactly-30-days-ago row); widening
   the tipo filter list would pull in an entrada/ajuste row and break the 5 expectation; inverting
   the cantidad sign would flip the result to -5, failing the equality directly. Real,
   mutation-sensitive test.

2. **anularVenta exclusion** (evaluador.test.ts:495-513, "a movimiento with tipo anulacion never
   calls resumenRotacion at all, D3"): harness sets resumenRotacionResult to values that WOULD
   trigger sugerencia_reposicion if the guard were bypassed (unidadesSalida30d 300, diasHistoria
   30), then asserts resumenRotacion was never called and create was never called with tipo
   sugerencia_reposicion. Removing the tipo-not-anulacion guard, inverting it, or comparing against
   'venta' instead of 'anulacion' would all cause resumenRotacion to be called for this fixture,
   failing the not-called assertion directly. Real, mutation-sensitive test.

Both tests are genuine and would fail without their respective guards. I did not re-run the actual
mutation sweep in this verify pass (task 1.3/2.5's mutation probing was done during apply); I
confirmed by close reading that the assertions are precise enough to catch every mutant the task
descriptions name.

### crearProducto structural-impossibility finding -- Independently Re-Derived

Re-read productos/service.ts:96-131 and evaluador.ts:165-184 directly (not taking the apply
report's word for it):

- crearProducto's stockInicial-greater-than-0 branch calls movimientos.create with tipo ajuste --
  this INSERT is the producto's very first-ever movimiento row (the producto was just created in
  the same transaction, with no prior movimientos possible).
- resumenRotacion's diasHistoria is the floor of days since the producto's OLDEST movimiento. For a
  producto whose only movimiento is the one just inserted in this same transaction, that minimum
  fecha is approximately now, so diasHistoria evaluates to 0.
- The evaluator's S7 branch requires diasHistoria greater-or-equal-7 before computing
  promedioDiario/coberturaDias at all (evaluador.ts:168).
- Therefore: diasHistoria = 0 structurally fails the greater-or-equal-7 gate on every single
  crearProducto call, with no code path able to produce a sugerencia_reposicion alert from this
  call site -- regardless of stockInicial's value or any velocity data (there is none yet).

Confirmed correct. This matches design.md's own Threat/Edge-Case Matrix row (design.md:209:
stockInicial = 0 product creation -> inherited #10 limitation) but the S7-specific consequence
(this call site can NEVER fire sugerencia_reposicion, for ANY stockInicial) is a distinct,
correct, independently-verified deduction from reading the code -- not a design.md claim being
restated. It is a SUGGESTION-level observation, not a defect: nothing in the spec or design
promises crearProducto will ever produce a sugerencia_reposicion alert.

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD evidence reported | Yes | Every task pair is explicitly RED-then-GREEN in tasks.md, both steps checked |
| All tasks have tests | Yes | 11/11 checked tasks each name a covering test file, cross-checked against actual files on disk |
| RED confirmed (tests exist) | Yes | evaluador.test.ts, service.test.ts, repository.integration.test.ts, sugerencia-reposicion.integration.test.ts, routes/alertas.test.ts all exist and contain the named cases |
| GREEN confirmed (tests pass) | Yes | 564 api unit + 525 web unit + 169 integration all pass on this run, exit 0 |
| Triangulation adequate | Yes | 6 distinct diasHistoria boundary cases (6/7/29/30/31 plus greater-than-30), exact-14 vs 13.99, promedio-zero case, anulacion-exclusion case |
| Mutation-probe tasks (1.3, 2.5) completed | Yes (spot-checked, not re-run) | See Mutation-Probe Verification above |

**TDD Compliance**: 6/6 checks passed

### Issues Found

**CRITICAL**: None.

**WARNING**: None.

**SUGGESTION**:
1. crearProducto's stockInicial-greater-than-0 branch can structurally never fire
   sugerencia_reposicion (confirmed above) -- not a defect against this cycle's ratified scope,
   but worth flagging for whoever eventually revisits the stockInicial = 0 limitation so any future
   fix accounts for both the missing-evaluation-entirely case and the always-diasHistoria-zero case.
2. No claims-report.md exists yet for this cycle (CLAUDE.md's claims-gate convention). Per #10's
   precedent this is an sdd-archive-owned deliverable, not a verify-phase gap -- flagging so
   archive does not skip it, mirroring #10's Phase-5-deferred pattern.
3. Mutation probing for the two named load-bearing tests (1.3, 2.5) was spot-checked by close
   reading in this pass rather than re-executed; if a future regression touches either guard,
   re-run the actual mutation sweep rather than relying on this report's reasoning alone.

### Verdict

**PASS**

All 11 tasks are complete and verified against actual source (not the apply-progress report alone
or the tasks.md checkboxes). All 5 requirements / 13 scenarios across the alertas spec delta have
a passing covering test at real runtime, including real-Postgres integration coverage for the
highest-risk properties (30-day boundary aggregation, anularVenta exclusion, all three qualifying
call sites, dedup, and the route-level resolve path). pnpm --filter api test (564/564),
pnpm --filter web test (525/525), pnpm test:integration (169/169), pnpm typecheck, pnpm lint,
pnpm contract:check all exit 0. All seven design decisions (D1-D7) are implemented exactly as
specified, including D3's anularVenta guard, D4's strict boundary semantics, and D5's exact SQL
reusing the existing index. Zero migration files were introduced -- this change needs zero Neon
deploy steps. The claimed "zero production-code changes to movimientos/service.ts,
productos/service.ts, ventas/service.ts" is confirmed true by direct diff. The flagged
crearProducto structural-impossibility finding is independently re-derived and confirmed correct.
Ready for sdd-archive.
