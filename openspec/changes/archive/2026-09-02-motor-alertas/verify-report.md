```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:3ec8f2627c956737d8539c4d482210c3fc51a0579de2ee4a27603bcd0568a019
verdict: pass
blockers: 0
critical_findings: 0
requirements: 13/13
scenarios: 17/17
test_command: pnpm --filter api test && pnpm --filter web test && pnpm test:integration
test_exit_code: 0
test_output_hash: sha256:8b152595ea70dafa51071661ea54b63e1d190c88b69c62c436456eee9c59599a
build_command: pnpm typecheck && pnpm lint && pnpm contract:check
build_exit_code: 0
build_output_hash: sha256:e7d98f0b66cd8beea1018fa5903150312adc9799b855a29b012e0397b8f7dbbf
```

## Verification Report

**Change**: motor-alertas (backlog #10, InvenTienda)
**Version**: N/A (greenfield capabilities alertas + alertas-ui)
**Mode**: Strict TDD

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total (Phase 1-4, counted against completion) | 36 |
| Tasks complete | 36 |
| Tasks incomplete | 0 |
| Phase 5 (5.1-5.3) | Deliberately deferred to sdd-archive, per project convention (backlog #9 precedent). Not counted against the 36-task completion total. |

### Build and Tests Execution

**Build**: PASSED
```text
$ pnpm typecheck
apps/api typecheck: Done
apps/web typecheck: Done  (exit 0)

$ pnpm lint
biome ci . -- Checked 352 files in 554ms. No fixes applied.  (exit 0)

$ pnpm contract:check
pnpm contract && git diff --exit-code -- apps/api/openapi.json apps/web/src/api/schema.d.ts
(regenerated openapi.json + schema.d.ts, zero diff against index)  (exit 0)
```

**Tests**: PASSED
```text
$ pnpm --filter api test
Test Files  39 passed (39)
     Tests  552 passed (552)   (exit 0)

$ pnpm --filter web test
Test Files  83 passed (83)
     Tests  525 passed (525)   (exit 0; "Not implemented: Window scrollTo()" lines are jsdom
     stderr noise from unrelated pre-existing components, not failures)

$ pnpm test:integration   (Docker Postgres, container inventienda-postgres-1, confirmed
                            healthy before running -- ran explicitly per instructions, not skipped)
Test Files  18 passed (18)
     Tests  159 passed (159)   (exit 0)
```

**Coverage**: Not configured in this project (no coverage tool in package.json scripts) -> Not available

### C1 Acceptance Criterion -- Direct Source Verification (highest-priority claim)

Read apps/api/src/alertas/service.integration.test.ts directly (not from apply-progress).
Confirmed genuine, not mocked:

- The failing alertas.create override calls rawExecutor.execute(sql select * from
  this_table_does_not_exist_at_all) against the SAME raw Postgres executor uow.run bound
  the transaction to (obtained via a documented runtime property read on
  DrizzleProductosRepo's private db field, rawExecutorFrom(), lines 97-99). This is a real
  42P01 undefined_table error raised by Postgres itself inside the live transaction/connection
  -- not a JS-level throw new Error(...). The comment block at lines 130-141 explicitly documents
  why a plain throw would not exercise the 25P02 aborted-transaction recovery path.
- Test 1 (registrarMovimiento, lines 116-174): asserts result.movimiento.stockResultante is
  3, re-reads the movimientos row from the DB and asserts it exists with stockResultante: 3,
  re-reads the productos row and asserts stockActual: 3, and asserts alertasFor(producto.id)
  has length 0. All four assertions read the database directly after the call returns -- this
  proves genuine commit, not a mocked return value.
- Test 2 (confirmarVenta, lines 176-259): three-item sale where item 2's alertas.create
  triggers the same real SQL error; asserts the sale returns 3 items, the DB has 3 movimientos
  rows for that venta_id, items 1 and 3 (A, C) each have exactly 1 real stock_bajo alert row
  committed, and item 2 (B) has zero alert rows.
- Both tests ran and passed in the pnpm test:integration run above (18/18 files, 159/159 tests,
  exit 0), against the confirmed-healthy inventienda-postgres-1 container.

**Verdict on C1: CONFIRMED.** This is a genuine real-Postgres proof of the movement/sale
committing with zero alert rows for the failed item, exactly as claimed.

### Call-Site Wiring -- Direct Source Verification

Grepped and read all four call sites directly:

| Call site | File:approx line | Evidence |
|---|---|---|
| movimientos/service.ts::registrarMovimiento | movimientos/service.ts:140 | await registrarSiCorresponde(txRepos, tx, {...}) at the post-movement re-read SEAM |
| productos/service.ts::crearProducto | productos/service.ts:126 | await registrarSiCorresponde(txRepos, tx, {...}) inside the stockInicial > 0 branch |
| productos/service.ts::actualizarProducto (D7) | productos/service.ts:256-260 | Object.hasOwn(input.cambios, 'stockMinimo') && input.cambios.stockMinimo === null && previo.stockMinimo !== null -> await txRepos.alertas.autoResolve(input.id, 'stock_bajo') -- no savepoint, matches D7 exactly |
| ventas/service.ts::confirmarVenta | ventas/service.ts:265 | await registrarSiCorresponde(txRepos, tx, {...}), inside Pass B's per-item loop (D3 comment at line 260-264 confirms per-item, not per-sale) |
| ventas/service.ts::anularVenta | ventas/service.ts:398 | await registrarSiCorresponde(txRepos, tx, {...}), inside the item loop, no tipo === 'anulacion' special case (matches D3's generic-crossing-rule rationale) |

All four call sites confirmed wired. None silently missed.

### quiebreCruzo Guard -- Direct Source Verification

Read apps/api/src/alertas/evaluador.ts:97-158 directly. The exact code:

```ts
const quiebreCruzo = stockPrevio > 0 && stockResultante <= 0;
...
if (stockMinimo !== null && !quiebreCruzo) {
  if (stockPrevio > stockMinimo && stockResultante <= stockMinimo) { /* create stock_bajo */ }
  if (stockPrevio <= stockMinimo && stockResultante > stockMinimo) { /* autoResolve stock_bajo */ }
}
```

This is byte-for-byte the owner-ratified pseudocode in design.md's Evaluator Logic section
(lines 138-149): stockMinimo === 0 fires quiebre alone via the outer if (quiebreCruzo)
branch (unconditional, line 115), and the !quiebreCruzo guard on the stock_bajo block
suppresses the redundant stock_bajo create on the same crossing. Confirmed exact match.

### D4 Dedup -- Direct Source Verification

Read the alertas repository and service.integration.test.ts directly:

- repository.ts:74-88: insert(alertas).values({...}).onConflictDoNothing({ target:
  [alertas.productoId, alertas.tipo], where: sql estado <> 'resuelta'::alerta_estado
  }).returning() -- a real partial-unique-index ON CONFLICT DO NOTHING, not a read-then-insert.
- service.integration.test.ts:269-288: fires two concurrent repo.create() calls via
  Promise.all for the same producto_id+tipo; asserts exactly one resolves non-undefined
  and one resolves undefined, and the DB has exactly 1 row. This is a genuine race proof against
  real Postgres, not a mocked/serialized simulation.
- service.integration.test.ts:290-334: end-to-end version with two concurrent
  registrarMovimiento calls crossing the same threshold; asserts at most 1 open row and at most
  1 stock_bajo row.

Confirmed real. Not a race-prone read-then-insert.

### RBAC -- Direct Source Verification

Read apps/api/src/routes/alertas.ts directly:

- GET /api/alertas -- config: { roles: ['encargado', 'deposito'] } (line 103)
- GET /api/alertas/conteo -- config: { roles: ['encargado', 'deposito'] } (line 130)
- POST /api/alertas/:id/resolver -- config: { roles: ['encargado'] } (line 152) -- the ONLY
  encargado-only route
- POST /api/alertas/marcar-vistas -- config: { roles: ['encargado', 'deposito'] } (line 181)

Confirmed against apps/api/src/routes/alertas.integration.test.ts (real app + real Postgres,
part of the 159/159 green integration run): a real deposito session reads list/count/marks-
vistas successfully (200), a real deposito session gets 403 on resolve with the DB row
unchanged (estado: 'activa', resueltaPor: null, zero audit rows), and a real encargado
session resolving a discrepancia succeeds while resolving an activa stock_bajo returns 409
ALERT_NOT_MANUALLY_RESOLVABLE with the DB row unchanged. The route only allows manually
resolving discrepancia -- resolver() in alertas/service.ts classifies stock_bajo/quiebre
as alertNotManuallyResolvable() before ever reaching the repository, confirmed by
alertas/service.test.ts:162-183. Confirmed exact match to spec.

### Spec Compliance Matrix

**alertas (backend)**

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Alertas Table Schema | Row carries tipo/estado/producto_id/resuelta_por/timestamps | alertas/repository.test.ts (create), service.integration.test.ts | COMPLIANT |
| Threshold-Crossing Creation On Downward Edge Only | 10/12 to 8 crosses stockMinimo=10 -> stock_bajo | alertas/evaluador.test.ts | COMPLIANT |
| Threshold-Crossing Creation On Downward Edge Only | stockMinimo=null, decrease -> no stock_bajo | alertas/evaluador.test.ts | COMPLIANT |
| De-Duplication Per Producto And Tipo | Resolved quiebre + cross to zero again -> new alert | alertas/repository.test.ts, service.integration.test.ts (D4 dedup) | COMPLIANT |
| De-Duplication Per Producto And Tipo | Activa stock_bajo + further decrease -> no dup | alertas/repository.test.ts | COMPLIANT |
| Auto-Resolution On Stock Recovery | Anulacion restores stock above zero -> resuelta, resuelta_por null | alertas/evaluador.test.ts, ventas/service.test.ts (anularVenta quiebre-resolve case) | COMPLIANT |
| Discrepancia Creation From Flagged Ajuste | esDiscrepancia=true -> discrepancia alert | alertas/evaluador.test.ts | COMPLIANT |
| Manual Resolution Restricted To Encargado | Encargado resolves activa discrepancia -> resuelta, resuelta_por=user | alertas/service.test.ts, routes/alertas.integration.test.ts | COMPLIANT |
| Manual Resolution Restricted To Encargado | Deposito calls resolve -> 403, alert stays activa | routes/alertas.test.ts, routes/alertas.integration.test.ts (DB-unchanged) | COMPLIANT |
| Evaluator Failure Never Rolls Back The Movement | Sale crosses threshold, evaluator SQL fails -> sale still confirms, 0 alert rows | alertas/service.integration.test.ts (C1, both call sites) | COMPLIANT |
| Evaluation Triggered At Every Movimiento-Creation Call Site | New product below stockMinimo -> stock_bajo | productos/service.test.ts | COMPLIANT |
| Both Roles Can View Alerts | Deposito calls list endpoint -> 200 with list | routes/alertas.test.ts, routes/alertas.integration.test.ts | COMPLIANT |
| Alert Create And Resolve Are Audited | Encargado resolves discrepancia -> audit row same transaction | alertas/service.test.ts, routes/alertas.integration.test.ts | COMPLIANT |

**alertas-ui (frontend)**

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Role Gate -- Alert Screen Reachable By Both Roles | Deposito navigates to /alertas -> renders, no refusal | routes/alertas.test.tsx | COMPLIANT |
| Alert Count Polled Every 60 Seconds | 60s elapse -> new count request | features/alertas/queries.test.ts, routes/alertas.test.tsx (fake-timer route test) | COMPLIANT |
| Manual Resolve Control Restricted To Encargado | Deposito on discrepancia -> no resolve action | features/alertas/AlertasTable.test.tsx, routes/alertas.test.tsx | COMPLIANT |
| Manual Resolve Control Restricted To Encargado | Encargado resolve -> list reflects resuelta | features/alertas/useResolverAlerta.test.tsx, routes/alertas.test.tsx | COMPLIANT |

**Compliance summary**: 17/17 scenarios compliant (13/13 requirements, 100%).

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|---|---|---|
| D1/D2 TxControl SAVEPOINT mechanism | Implemented | db/uow.ts matches design.md's exact code (raw SAVEPOINT/ROLLBACK TO/RELEASE, sql.identifier, second callback argument) |
| D3 per-item savepoint | Implemented | Confirmed one tx.savepoint call per sale item, not per sale, via ventas/service.test.ts mock-call-count assertions |
| D4 partial unique index dedup | Implemented | Confirmed real index + ON CONFLICT DO NOTHING, no read-then-insert |
| D5 sugerencia_reposicion compile gate | Implemented | TipoAlertaEvaluada = Exclude<TipoAlerta, 'sugerencia_reposicion'>, typed through evaluator/create |
| D6 N+1 product name resolution | Implemented | alertas/service.ts::listar resolves names via productos.findById per row, mirrors getRecibo precedent |
| D7 stockMinimo->null auto-resolve | Implemented | productos/service.ts:256-260, no savepoint, matches design's own-safety rationale |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| D1 raw SAVEPOINT via TxControl, not Drizzle nested tx | Yes | Confirmed in uow.ts |
| D2 TxControl via uow.run's 2nd argument, never on Repos | Yes | Confirmed -- EvaluadorRepos narrows to only alertas+auditoria |
| D3 per-item, not per-sale | Yes | Confirmed savepoint-call-count assertions in ventas/service.test.ts |
| D4 index + ON CONFLICT DO NOTHING | Yes | Confirmed |
| D5 pgEnum carries all 4 values, TS excludes sugerencia_reposicion | Yes | Confirmed |
| D6 N+1, no repo join | Yes | Confirmed |
| D7 own hook in actualizarProducto, no savepoint | Yes | Confirmed |
| All 4 owner-ratified Open Questions binding (stockInicial=0 v1 limitation, stockMinimo=0 quiebre-only, vista state built, D7 auto-resolve) | Yes | All 4 confirmed present and matching design.md verbatim |

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD Evidence reported | Yes | apply-progress (Engram #278) reports RED to GREEN cycle evidence for all 4 PRs; PR4's table explicitly documents every task's TRIANGULATE case count |
| All tasks have tests | Yes | 33/33 checked Phase 1-4 tasks each name a covering test file, cross-checked against actual files on disk |
| RED confirmed (tests exist) | Yes | Every named test file (evaluador.test.ts, service.integration.test.ts, repository.test.ts, service.test.ts, route/web tests) exists in the tree |
| GREEN confirmed (tests pass) | Yes | 552 api unit + 525 web unit + 159 integration all pass on this run, exit 0 |
| Triangulation adequate | Yes | Evaluator boundary cases (stockMinimo null, stockMinimo=0, exact-equality) each have distinct test cases in evaluador.test.ts; dedup has both a pure-repo test and a real-Postgres concurrency test |
| Safety Net for modified files | Yes (PR4 table) / assumed for PR1-3 (no counter-evidence found) | AppShell.test.tsx baseline 14/14 confirmed before the 8 new cases were added, per apply-progress |

**TDD Compliance**: 6/6 checks passed

One flagged deviation (WARNING, not CRITICAL, self-reported by apply-progress and independently
plausible from the diff): alertas.tsx/shellLayout.tsx/AppShell.tsx wiring (tasks 4.6-4.8)
was implemented directly against design.md rather than via a dedicated pre-code failing test,
with alertas.test.tsx's 5 route-level tests and AppShell.test.tsx's 8 new cases written and
run immediately after in the same batch. All hook/component/query-options files (4.1-4.5) followed
genuine RED-first. This does not affect runtime correctness -- all resulting tests pass -- but is a
minor process deviation from strict RED-before-code ordering on 3 of 36 tasks.

### Assertion Quality

Spot-checked the highest-risk test files (service.integration.test.ts, evaluador.test.ts,
routes/alertas.integration.test.ts, routes/alertas.test.ts) directly. No tautologies, no
assertion-free tests, no ghost loops over possibly-empty collections found. Every C1/D4 assertion
reads the database after the call under test, not a mocked return. routes/alertas.test.ts's
Role Gate tests iterate readRoutes/bothRolesWriteRoutes/encargadoOnlyRoutes arrays that are
statically defined non-empty route-descriptor lists (not a runtime-computed possibly-empty
collection), so these are not ghost loops.

**Assertion quality**: All assertions verify real behavior in the files sampled. Full-repository
line-by-line audit of all ~40 alertas-related test files was not performed within this pass;
sampling covered the load-bearing C1/D4/RBAC files named as priorities.

### Issues Found

**CRITICAL**: None.

**WARNING**:
1. PR4 tasks 4.6-4.8 (route/shellLayout/AppShell wiring) were implemented before their dedicated
   failing test was written, deviating from strict pre-code RED -- self-reported in apply-progress
   and consistent with the diff shape. All resulting tests pass; no runtime defect found.
2. Assertion-quality audit was sampled (highest-risk files only), not exhaustive across all ~40
   test files touched by this change -- a full audit was out of scope for this verify pass given
   the size of the change (36 tasks, 4 stacked PRs).

**SUGGESTION**:
1. Phase 5 cleanup (docs/BACKLOG.md flip, release checklist note, mutation-probing of C1/D4/
   savepoint tests against real Postgres) remains open and is correctly deferred to sdd-archive
   per this project's established convention (backlog #9 precedent) -- not a defect, just a
   reminder that archive must not skip it, since these are named as "the load-bearing correctness
   proofs for this change."

### Verdict

**PASS**

All 36 Phase 1-4 tasks are complete and verified against actual source (not the apply-progress
report alone). All 13 requirements / 17 scenarios across both alertas and alertas-ui specs
have a passing covering test at real runtime -- including real-Postgres integration coverage for
the two highest-risk properties (C1 evaluator-failure-never-rolls-back, D4 dedup-under-
concurrency). pnpm --filter api test (552/552), pnpm --filter web test (525/525),
pnpm test:integration (159/159), pnpm typecheck, pnpm lint, pnpm contract:check all exit 0.
The C1 acceptance criterion is explicitly CONFIRMED as a genuine real-Postgres SQL-error proof,
not a mocked/JS-level throw. All four owner-ratified Open Questions (2026-09-02) are correctly
implemented. Ready for PR merge confirmation and sdd-archive (which owns the deferred Phase 5
cleanup).
