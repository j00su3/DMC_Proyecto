```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:13b34287a3734dc208e5e26c3be20a96d9c371d7f311f2e78fcc36eb514b9c50
verdict: pass
blockers: 0
critical_findings: 0
requirements: 5/5
scenarios: 7/7
test_command: pnpm --filter api test && pnpm --filter web test && pnpm test:integration
test_exit_code: 0
test_output_hash: sha256:34d8307cb84c7f7696297508495890161c17477df124ea141c7996a158e55ff7
build_command: pnpm typecheck && pnpm lint
build_exit_code: 0
build_output_hash: sha256:f896e98d78f721e00674c83917883505888ab4cdad5f8ca6ff5e4c81eb6166ff
```

## Verification Report

**Change**: operacion-local (backlog #14, consistency-check half, InvenTienda)
**Version**: One raw-SQL aggregate (verificarConsistenciaStock), a standalone script
(apps/api/scripts/verificar-consistencia.ts), two package.json script entries, and a new
weekly-scheduled GitHub Actions workflow (consistencia-stock.yml). Read-only, no route, no
schema migration.
**Mode**: Strict TDD
**Revision verified**: 0b16f45 (main, HEAD) -- PR #173 merged into 3e06f66, working tree clean

### Note on inherited artifact-count discrepancy

The task brief and tasks.md's own header line both state a requirement/scenario count for
specs/verificacion-consistencia-stock/spec.md that does not match a direct count. Counting
"### Requirement:" and "#### Scenario:" headings in the actual spec file gives 5 requirements,
7 scenarios:

1. Stock-Ledger Consistency Detection -- 2 scenarios
2. Zero-Movement Producto Handling -- 1 scenario
3. Per-Producto Mismatch Identification -- 1 scenario
4. Exit-Code Contract -- 2 scenarios
5. Read-Only Execution -- 1 scenario

Total: 5 requirements / 7 scenarios. This report uses the actual counted totals (5/7), per the
skill's own rule to count requirements/scenarios directly from the retrieved spec rather than
trust an inherited header. Flagged as a SUGGESTION below -- it does not affect coverage, since all
5 real requirements / 7 real scenarios have a passing covering test, and it is the same
documentation-drift class the #12 and #13 verify passes both already found in their own tasks.md
headers.

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total (Phase 1-2) | 8 |
| Tasks complete | 8 |
| Tasks incomplete | 0 |
| Manual owner action (D4) | Present, correctly UNCHECKED (no checkbox exists for it at all) |

All 8 numbered tasks (1.1-1.3, 2.1-2.5) in tasks.md are checked [x]. Cross-checked against
actual source/test files on disk, not trusted from the checkbox alone -- see per-decision evidence
below. The D4 manual-owner-action item (Neon read-only role SQL) is listed under its own
"Manual owner action required (D4) -- NOT an apply-agent task" heading with no checkbox at all --
confirmed it is never represented as completed work, consistent with design.md's statement that
the agent cannot touch secrets/.env* files.

### Build and Tests Execution

**Build**: PASSED
```text
$ pnpm typecheck
apps/api typecheck: Done
apps/web typecheck: Done   (exit 0)

$ pnpm lint
biome ci . -- Checked 399 files in 538ms. No fixes applied.   (exit 0)
```

pnpm contract:check was not run as part of the build command for this cycle -- proposal.md and
design.md both state this change adds no route, and this was independently confirmed rather than
assumed:
```text
$ git diff --stat 3e06f66 HEAD -- apps/api/openapi.json apps/api/drizzle/
(empty output -- zero files changed in either path across the merged commit)
```
Zero diff in apps/api/openapi.json confirms no contract change; zero diff in apps/api/drizzle/
confirms no schema migration (see the dedicated section below).

**Tests**: PASSED
```text
$ pnpm --filter api test
Test Files  44 passed (44)
     Tests  599 passed (599)   (exit 0)

$ pnpm --filter web test
Test Files  94 passed (94)
     Tests  561 passed (561)   (exit 0; scrollTo warnings are jsdom stderr noise, not failures;
     confirms zero frontend changes this cycle -- count unchanged from #13's baseline)

$ pnpm test:integration   (Docker Postgres, container inventienda-postgres-1 confirmed
   "Up 9 hours (healthy)" via docker ps before trusting this run)
Test Files  23 passed (23)
     Tests  193 passed (193)   (exit 0; up from #13's 188 -- +5 new tests in
     movimientos/repository.integration.test.ts's verificarConsistenciaStock describe block)
```

**Coverage**: Not configured in this project -> Not available

### Spec Requirement -> Code Trace

Traced directly against apps/api/src/movimientos/repository.ts's verificarConsistenciaStock
(lines 231-260) and apps/api/scripts/verificar-consistencia.ts's verificarConsistencia
(lines 15-38), not from the apply-progress report.

#### R1 -- Stock-Ledger Consistency Detection

repository.ts:231-242: one raw sql query --
"select p.id, p.sku, p.stock_actual, coalesce(sum(m.cantidad),0) as suma_movimientos from
productos p left join movimientos m on m.producto_id = p.id group by p.id, p.sku, p.stock_actual
having p.stock_actual <> coalesce(sum(m.cantidad), 0)" -- classifies a producto as mismatched
(row returned) vs consistent (row absent) via the HAVING clause itself, server-side.
Covered by repository.integration.test.ts:613-632 (consistent producto absent from result) and
:634-668 (mismatched producto present, sku/stockActual/sumaMovimientos/delta all
asserted against real seeded values -- stockActual=999, sumaMovimientos=5, delta=994).

#### R2 -- Zero-Movement Producto Handling

repository.ts:241 -- coalesce(sum(m.cantidad), 0) is the exact mechanism: a bare sum() over
an empty LEFT JOIN group evaluates to Postgres NULL, and HAVING x <> NULL is never true
(three-valued logic), so without COALESCE a real mismatch on an untouched producto would be
silently missed -- this is the exact edge case design.md's Threat Matrix flags. Directly
spot-checked in the integration test, not just read in isolation:
repository.integration.test.ts:711-717 -- "treats a producto with zero movimientos ever and
stockActual = 0 as consistent, never a false positive" -- uses the beforeEach-seeded producto
with zero movimientos inserted and the schema default stockActual = 0
(db/schema.ts column default), asserts it is absent from the result (toBeUndefined()). This is
a genuine positive-path proof of the COALESCE property at real Postgres, not an inference from
the SQL text alone.

#### R3 -- Per-Producto Mismatch Identification

repository.ts:253-259 maps each returned row to { productoId, sku, stockActual,
sumaMovimientos, delta } -- per-producto identification is structural (one row per mismatching
producto, keyed by productoId/sku), not an aggregate boolean. Covered by
repository.integration.test.ts:670-709 -- seeds one mismatched producto (stockActual: 42 vs
ledger sum 5) and one consistent producto (stockActual: 10 matching ledger sum 10), asserts
result has length 1 and result[0].productoId is the mismatching producto's id -- proving the
consistent producto is genuinely excluded, not merely unchecked.

#### R4 -- Exit-Code Contract

scripts/verificar-consistencia.ts:15-38 (verificarConsistencia): three distinct, independently
reachable code paths --
1. inconsistencias.length === 0 -> return 0 (line 23)
2. inconsistencias.length > 0 -> return 1 (line 32, after logging each mismatch)
3. catch (err) (repo call throws) -> return 1 (line 36, after console.error, never swallowed)

All three are genuinely distinct branches in the source, and all three are independently
reachable by tests, not just one asserted and the other assumed:
scripts/verificar-consistencia.test.ts:34-45 (empty array -> exit 0, exact log line asserted),
:47-60 (non-empty array -> exit 1, log output contains the mismatching producto's id and sku),
:62-77 (fake repo's verificarConsistenciaStock throws new Error('connection refused') ->
exit 1, console.error called with the exact message, confirming the error path is never
swallowed). The "mismatch found" and "repo throws" paths are triggered by genuinely different
fake-repo configurations, so this is not one test doing double duty.

#### R5 -- Read-Only Execution

Read end to end for both files -- a regex scan for insert(/update(/delete( against
verificarConsistenciaStock's query body and the entire verificar-consistencia.ts script
returns zero matches; the method body (repository.ts:231-260) contains exactly one
this.db.execute(sql-tagged select) call and no other database call. The script
(verificar-consistencia.ts) never imports or calls anything beyond
repo.verificarConsistenciaStock() -- confirmed by reading its full 55 lines; main() only
constructs a DrizzleMovimientosRepo and calls the one read method.

This is proven at runtime, not just by source absence, and the integration test genuinely asserts
row-level state, not a status-code-style check: repository.integration.test.ts:719-745
("is read-only: productos and movimientos rows/values are unchanged after the call") seeds a
producto, mutates its stockActual to 999 via direct UPDATE to guarantee a real mismatch is
in play, captures full productosBefore/movimientosBefore via db.select().from(productos) /
db.select().from(movimientos), calls repo.verificarConsistenciaStock() (deliberately ignoring
its return value -- the mismatch it detects is irrelevant to this test), then re-selects both
tables and asserts productosAfter deep-toEqual productosBefore and movimientosAfter
deep-toEqual movimientosBefore. This is a genuine full-row-set equality assertion covering
every column and every row in both tables, before and after a run that is guaranteed to detect a
mismatch -- not merely a 200-vs-500 style check, and not merely re-reading the same row that was
mutated (it captures and compares the entire table).

**Spec Compliance Matrix**

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Stock-Ledger Consistency Detection | Consistent producto reports no mismatch | repository.integration.test.ts:613-632 | COMPLIANT |
| Stock-Ledger Consistency Detection | Mismatched producto is detected | repository.integration.test.ts:634-668 | COMPLIANT |
| Zero-Movement Producto Handling | Producto never touched since creation | repository.integration.test.ts:711-717 | COMPLIANT |
| Per-Producto Mismatch Identification | One of several productos mismatches | repository.integration.test.ts:670-709 | COMPLIANT |
| Exit-Code Contract | No mismatches found across all productos | scripts/verificar-consistencia.test.ts:34-45 | COMPLIANT |
| Exit-Code Contract | At least one mismatch found | scripts/verificar-consistencia.test.ts:47-60 | COMPLIANT |
| Read-Only Execution | Running the check does not alter producto or movimiento data | repository.integration.test.ts:719-745 | COMPLIANT |

Compliance summary: 7/7 scenarios compliant across 5/5 requirements (100%).

### Design Coherence (D1-D5)

| Decision | Followed? | Notes |
|---|---|---|
| D1 Query location/shape: new MovimientosRepo.verificarConsistenciaStock(), one raw sql query, LEFT JOIN + GROUP BY + HAVING/COALESCE | Yes | repository.ts:231-260 -- exact match, mirrors resumenRotacion's raw-SQL precedent (same file, execute(sql) idiom); vitest.integration.config.ts's glob needs zero config change since the new describe block lives in the existing repository.integration.test.ts |
| D2 Script location/runtime/DB client: apps/api/scripts/verificar-consistencia.ts, tsx, getDb() from ../src/db/pool.js | Yes | scripts/verificar-consistencia.ts:3,41 -- getDb() imported from ../src/db/pool.js exactly; main-guard (pathToFileURL check, lines 46-49) and try/catch->exit shape (lines 33-37, 50-53) mirror the seed-encargado.ts/seed-demo.ts precedent design.md cites |
| D2 correction (flagged by design.md itself) | Confirmed | apps/api/scripts/ already existed before this change (seed-encargado.ts, seed-demo.ts predate it) -- this cycle correctly reused the existing directory rather than inventing a second repo-root scripts/, consistent with design.md's own flagged correction to the ratified proposal wording |
| D3 Workflow: .github/workflows/consistencia-stock.yml, schedule cron '0 8 * * 0', steps mirroring ci.yml, secret NEON_READONLY_DATABASE_URL -> DATABASE_URL env | Yes | Confirmed by direct js-yaml parse (see below) -- on.schedule[0].cron is exactly '0 8 * * 0'; steps are actions/checkout@v4, pnpm/action-setup@v4, actions/setup-node@v4 (node 22, pnpm cache), pnpm install --frozen-lockfile, then the domain-specific pnpm --filter @inventienda/api verificar:consistencia step -- same first-four-step shape as ci.yml's own steps, correctly omitting ci.yml's lint/contract:check/typecheck/db:migrate steps (not applicable to a single-script scheduled job) and its ephemeral-Postgres services block (deliberately not reused per D3's own Alternatives column, since it is the wrong DB); env.DATABASE_URL is secrets.NEON_READONLY_DATABASE_URL exactly |
| D4 Read-only enforcement: Neon read-only Postgres role, manual owner step | Confirmed present, confirmed NOT implemented by the agent | The exact SQL block (CREATE ROLE consistencia_readonly through ALTER DEFAULT PRIVILEGES) is present verbatim in both design.md:30-36 and tasks.md:117-123, byte-identical between the two files. tasks.md's "Manual owner action required (D4) -- NOT an apply-agent task" section has no checkbox for this item at all -- it is prose, never represented as a completed task. Mechanical enforcement is not yet live in production since this is an owner-only step outside any tool the agent can call, per this repo's own CLAUDE.md "Never touch .env*" rule -- correctly left undone |
| D5 Testing: unit test on verificarConsistenciaStock via fake Db (not built -- see note), integration extends repository.integration.test.ts, script unit test with injected fake repo | Partially as designed, functionally equivalent | D5's table lists a "Unit: fake-Db test on verificarConsistenciaStock" row, but repository.ts's comment at lines 225-230 and Phase 1's task 1.3 explicitly say this SQL shape has no unit test of its own by design (unit coverage lives at the script layer with a fake repo instead) -- i.e. design.md's own Testing Strategy table (line 79: "Unit: Row->output formatting; exit branch") does NOT actually ask for a fake-Db unit test of the repo method; the Architecture Decisions table's D5 cell is loosely worded but the design's own Testing Strategy section and tasks.md's task 1.3 both correctly describe the real intended split (repo method: integration-only; script: unit-only). Not a deviation from the design's actual intent, only from one table cell's imprecise phrasing -- see SUGGESTION below |

### Migration / Schema Check

```text
$ git diff --stat 3e06f66 HEAD -- apps/api/drizzle/
(empty output -- zero files changed)

$ ls apps/api/drizzle/*.sql | tail -1
apps/api/drizzle/0009_brief_paibok.sql   (unchanged by this cycle)
```

Confirmed: zero migration/schema change across the merged PR #173. This cycle needs zero Neon
deploy steps beyond the D4 manual role-creation step, which design.md's own Migration/Rollout
section correctly describes as separate from a schema migration ("No schema migration. Requires
the owner's manual Neon role creation (D4) and secret wiring before the workflow can run for
real; merging the workflow file first is safe").

### Contract Drift Check

```text
$ git diff --stat 3e06f66 HEAD -- apps/api/openapi.json
(empty output -- zero files changed)
```

Confirmed: this cycle adds no route, so apps/api/openapi.json is byte-identical across the
merged commit -- pnpm contract:check was correctly not required and was not run as part of this
cycle's build gate. (app.test.ts and ventas.test.ts each gained one mechanical line --
verificarConsistenciaStock: unusedRepoMethod / async () => [] -- in their existing fake-repo
object literals, a compile-forced consequence of adding a method to the MovimientosRepo
interface, not a behavioral or contract change.)

### Read-Only Guarantee: Direct Code-Path Scan

```text
$ grep -inE "insert\(|update\(|delete\(" apps/api/scripts/verificar-consistencia.ts \
    apps/api/src/movimientos/repository.ts
(zero matches near the new code path)
```

Confirmed by direct pattern scan across both new-code files: no insert(, update(, or
delete( call exists anywhere near the new code path. verificarConsistenciaStock's method
body is a single this.db.execute(sql-tagged select) call (a SELECT only); the script
never calls any repo method beyond verificarConsistenciaStock(). This is a genuine, mechanical
absence check, not an inference from documentation or design intent.

### Workflow YAML Validation

Method used: direct js-yaml parse (not manual read alone), executed via a Node.js one-liner
importing js-yaml 4.3.1 from the repo's own .pnpm store and calling yaml.load() against
.github/workflows/consistencia-stock.yml. Parse succeeded with no error; the resulting object's
on.schedule[0].cron is '0 8 * * 0', jobs.verificar.steps is a 5-element array matching D3's exact
step sequence (checkout, pnpm setup, node setup, install, verify), and env.DATABASE_URL resolves
to secrets.NEON_READONLY_DATABASE_URL. This confirms both syntactic validity (a real YAML parser
accepted the file) and structural match to design.md D3 (cadence, step sequence mirroring ci.yml's
shape).

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD evidence reported | Yes | Both phases in tasks.md are explicitly RED-then-GREEN, both checked |
| All tasks have tests | Yes | 8/8 checked tasks each name a covering test file, cross-checked against actual files on disk |
| RED confirmed (tests exist) | Yes | repository.integration.test.ts's new describe block and scripts/verificar-consistencia.test.ts both exist and contain the named cases |
| GREEN confirmed (tests pass) | Yes | 599 api unit + 561 web unit + 193 integration all pass on this run, exit 0 |
| Triangulation adequate | Yes | Real-Postgres row-level proof (consistency, mismatch, per-producto identification, zero-movement COALESCE edge case, full-table read-only before/after) at the repo layer, plus fake-repo direct-invocation proof of all three exit-code branches (including the throw path) at the script layer -- two independent layers, neither overlapping the other's assertions |

TDD Compliance: 5/5 applicable checks passed

### Issues Found

CRITICAL: None.

WARNING: None.

SUGGESTION:
1. tasks.md's own header and the task brief both give a requirement/scenario count for
   specs/verificacion-consistencia-stock/spec.md that does not match a direct count. A direct
   count of "### Requirement:" / "#### Scenario:" headings in the spec file gives 5 requirements,
   7 scenarios. This does not affect coverage -- all 5 real requirements / 7 real scenarios have a
   passing covering test -- but it is the third consecutive cycle (after #12 and #13) where a
   tasks.md/brief header miscounts its own spec's requirement or scenario total. Worth fixing at
   the source next time a spec/tasks pair is authored, since this recurring drift is exactly the
   kind of unverified claim this project's CLAUDE.md "claims gate" section warns against.
2. design.md's D5 Architecture-Decisions-table cell ("Unit: fake-Db test on
   verificarConsistenciaStock") is worded more broadly than what the design's own Testing
   Strategy table, Threat Matrix comment, and tasks.md's task 1.3 actually specify and what was
   actually built (repo method: integration-test-only, by design, since the HAVING/COALESCE
   SQL shape has no meaningful fake-Db unit test; script: unit-test-only via a fake repo). The
   implementation matches the design's real, more-detailed intent (confirmed by cross-referencing
   three other places in the same document plus tasks.md), so this is not a functional gap -- only
   one summary-table cell that reads as broader than the design's own detailed sections. Worth
   tightening that one cell's wording if design.md is ever revised.
3. The Neon read-only role secret name (NEON_READONLY_DATABASE_URL) and the cron schedule
   ('0 8 * * 0') both remain explicitly marked as not-owner-ratified in design.md's own "Open
   Questions" section and are carried forward unchanged in tasks.md's "Open Questions Carried
   Forward" section. Not a defect against the ratified scope (proposal.md's scoping decisions 1-2
   cover only the secret's existence/read-only nature and the weekly cadence, not the exact secret
   name or exact cron minute/hour) -- but, consistent with the #13 precedent, worth an explicit
   owner sign-off note during archive before the D4 manual step is performed for real, since the
   secret name in this exact YAML file (NEON_READONLY_DATABASE_URL) must match whatever the owner
   actually creates.

### Verdict

PASS

Zero CRITICAL, zero WARNING findings; three low-severity SUGGESTIONs only (a spec-count header
discrepancy inherited across both tasks.md and the task brief, one loosely-worded design-table
cell that doesn't change what was built, and two already-flagged-as-unratified open questions
carried forward honestly rather than silently resolved). This verdict text is deliberately
double-checked against the Issues Found section immediately above before being written, per this
project's own history of a self-contradicting "PASS WITH WARNINGS" verdict once shipping with zero
WARNING findings in its own body (caught during #13's verify pass) -- this report states plain
PASS because that is what zero CRITICAL / zero WARNING findings actually supports.

All 8 tasks (1.1-1.3, 2.1-2.5) are complete and verified against actual source, not the
apply-progress report or the tasks.md checkboxes alone. All 5 requirements / 7 scenarios in
specs/verificacion-consistencia-stock/spec.md have a passing covering test at real runtime,
including real-Postgres integration coverage for the highest-risk properties this cycle turns on:
the COALESCE-dependent zero-movement edge case (directly spot-checked against the exact
integration-test assertion, not inferred from the SQL alone) and the read-only guarantee (proven
by a genuine full-table before/after row-level equality assertion, not a status-code-style check).
The exit-code contract's three distinct branches (zero mismatches -> 0, mismatches found -> 1,
repo-throws -> 1) are each independently reachable by a separate unit test. The new GitHub Actions
workflow file was validated with a real js-yaml parse (not manual read alone) and matches
design.md D3's exact shape. The D4 manual Neon-role SQL is present verbatim in both design.md and
tasks.md and is genuinely, correctly left unchecked -- it is prose describing a step outside any
tool this agent can call, never represented as completed work. Zero migration/schema change and
zero API-contract change were independently confirmed via git diff --stat across the merged
commit (not merely assumed from the proposal's stated scope). pnpm --filter api test (599/599),
pnpm --filter web test (561/561, confirming zero frontend changes), pnpm test:integration
(193/193, Docker Postgres confirmed healthy via docker ps before trusting the run), pnpm
typecheck, and pnpm lint all exit 0.

Ready for sdd-archive. No blocking action required before archive; the three SUGGESTIONs are
optional cleanup, not archive-blocking conditions. The D4 manual owner action (Neon role creation +
GitHub secret wiring) remains outstanding and outside this agent's tool access -- archive should
record this as a known, honest gap (per design.md's own Migration/Rollout note that merging the
workflow file first is safe and will fail visibly, as expected, until the secret exists), not a
defect blocking archive of the application-code portion of this change.
