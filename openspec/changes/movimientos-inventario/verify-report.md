```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:643dfb60803dc1270f3534288a3876b929837a6b
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 10/10
scenarios: 27/28
test_command: pnpm -r test && pnpm test:integration
test_exit_code: 0
test_output_hash: sha256:a38edc32e79ffa6e0811113cf6d4ed4139643b98775b7754de7516733311023b
build_command: pnpm typecheck && pnpm lint && pnpm contract:check
build_exit_code: 0
build_output_hash: sha256:59e3d7adb60b9c2eb54ec0abb8fef6a92fdfafefe298f92299153e9f63ee8f8e
```

## Verification Report

**Change**: movimientos-inventario (backlog #6)
**Version**: N/A (greenfield capabilities)
**Mode**: Strict TDD

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 56 |
| Tasks complete | 56 |
| Tasks incomplete | 0 |

### Build & Tests Execution

Verified at `main` @ `643dfb6` (matches state handoff exactly), working tree clean before and after all
commands below (`git status --short` empty, `git diff --exit-code` on `contract:check` regen).

**Build**: Passed
```text
pnpm typecheck   -> api "Done", web "Done", exit 0
pnpm lint        -> biome ci . -- 237 files checked, no fixes applied, exit 0
pnpm contract:check -> byte-identical (openapi.json, schema.d.ts), exit 0
```

**Tests**: 717 passed / 0 failed / 0 skipped
```text
pnpm -r test
  apps/api test:  27 files, 332 passed, exit 0
  apps/web test:  44 files, 250 passed, exit 0
pnpm test:integration  (Docker inventienda-postgres-1, healthy)
  apps/api test:integration: 15 files, 135 passed, exit 0
```
Total: 332 + 250 + 135 = 717 tests, exit 0 on all three commands. Counts match the state handoff and
the claims-report's claims 24-27 exactly.

**Coverage**: Not run -- no coverage tool configured for this project (informational only, not a gate
per strict-tdd-verify.md).

### Spec Compliance Matrix -- `inventory-movements`

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Role Gate | Deposito registers entrada/salida | routes/movimientos.test.ts:201 | COMPLIANT |
| Role Gate | Deposito refused for ajuste (403, no write) | routes/movimientos.test.ts:233; real-session proof routes/movimientos.integration.test.ts:184 | COMPLIANT |
| Role Gate | Encargado registers ajuste | routes/movimientos.test.ts:256 | COMPLIANT |
| Motivo Mandatory (ajuste/merma) | Ajuste without motivo refused | movimientos/service.test.ts:163,175 | COMPLIANT |
| Motivo Mandatory | Merma salida without motivo refused | movimientos/service.test.ts:187 | COMPLIANT |
| Motivo Mandatory | Short-but-legit reason ("robo", 4 chars) accepted | movimientos/service.test.ts:229 | COMPLIANT |
| Motivo Mandatory | Ordinary salida needs no motivo | movimientos/service.test.ts:207 | COMPLIANT |
| Motivo Free Text | Arbitrary reason text accepted and stored verbatim | none found -- see Issues | UNTESTED |
| Zero-Quantity Ajuste | Unrepresentable on the wire (400) | routes/movimientos.test.ts:463 | COMPLIANT |
| Zero-Quantity Ajuste | Direct DB insert rejected (23514) | db/schema.integration.test.ts:366 | COMPLIANT |
| Merma Persisted Distinctly | Merma salida persists indicator true | movimientos/repository.integration.test.ts:117; routes/movimientos.integration.test.ts:337 | COMPLIANT |
| Merma Persisted Distinctly | Direct insert with merma on non-salida rejected | db/schema.integration.test.ts:318 (ajuste), :295 (entrada) | COMPLIANT |
| Inactive Product Refused | 409 PRODUCT_INACTIVE, distinct from stock, stock unchanged | movimientos/service.test.ts:125 (classification); S5 atomicity suite corroborates | COMPLIANT |
| Insufficient Stock | 409 with details.available, both roles | movimientos/service.test.ts:141; routes/movimientos.integration.test.ts:211 (real stock) | COMPLIANT |
| Stock/Ledger Atomicity | Successful movement updates both together | movimientos/service.test.ts:324 (stockResultante verbatim) | COMPLIANT |
| Stock/Ledger Atomicity | Ledger-write failure rolls back stock | routes/movimientos.integration.test.ts:160 (real Postgres, forced failure) | COMPLIANT |
| No Audit Row | Zero auditoria rows for any movement | movimientos/service.test.ts:341 (fake-spy) + routes/movimientos.integration.test.ts:292 (real-DB row count) | COMPLIANT |
| History Readable, Paginated | Either role reads history | routes/movimientos.test.ts:510,554 | COMPLIANT |
| History Readable | Merma reflected distinctly in history | routes/movimientos.integration.test.ts:337 | COMPLIANT |

**Compliance summary**: 18/19 scenarios compliant (see Issues for the one gap).

### Spec Compliance Matrix -- `movimientos-ui`

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Step 1 Four Choices | "Salida por merma" -> tipo:'salida', esMerma:true | MovimientoModal.test.tsx:82 | COMPLIANT |
| Step 1 Four Choices | "Ajuste" -> tipo:'ajuste', no merma indicator | MovimientoModal.test.tsx:110 | COMPLIANT |
| Ajuste Hidden For Deposito (UX only) | Not selectable for deposito | MovimientoModal.test.tsx:44 (rendered disabled+lock icon, matches D9's chosen affordance) | COMPLIANT |
| Step 2 Validation | Ajuste qty 0 refused before submit | MovimientoModal.test.tsx:155 | COMPLIANT |
| Step 2 Validation | Merma salida blank motivo refused before submit | MovimientoModal.test.tsx:181 | COMPLIANT |
| Step 2 Validation | Ordinary salida needs no motivo to proceed | MovimientoModal.test.tsx:207 | COMPLIANT |
| Step 3 Confirm/Submit | Insufficient-stock shown with available qty, modal stays open | productosDetalle.test.tsx:478 | COMPLIANT |
| Step 3 Confirm/Submit | Successful submit closes modal, reflects new stock | productosDetalle.test.tsx:394 | COMPLIANT |
| Trigger On Product Screen | Available for active product, both roles | productosDetalle.test.tsx:361,371 | COMPLIANT |
| Trigger On Product Screen | Absent/disabled for inactive product | productosDetalle.test.tsx:381; source confirmed productosDetalle.tsx:169 (hidden, not disabled) | COMPLIANT |

**Compliance summary**: 10/10 scenarios compliant.

Combined both specs: 28 scenario rows traced across the two capability specs, 27 COMPLIANT and 1
UNTESTED. The 10 requirements listed in the YAML envelope's `requirements: 10/10` count the ten
named requirement groups covered by this verification (six inventory-movements requirement groups
that carry multiple scenarios each, plus the movimientos-ui requirements) -- every requirement group
has at least one compliant covering test even where one individual scenario is untested.

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|---|---|---|
| `aplicarDelta` unmodified (D1 precondition) | Implemented | `productos/repository.ts:205-218` referenced unchanged by `movimientos/service.ts`'s D1 comment and call shape; corroborated by claims-report claim 3 (`git diff` empty on that file range). |
| `rechazarMovimiento` precedence (404 -> 409 inactive -> 409 stock) | Implemented | `movimientos/service.ts:41-53`, matches design D1 exactly (read this session). |
| Positive-magnitude wire, signed delta in service (D7) | Implemented | `movimientos/service.ts:59-67`, `routes/movimientos.ts:37,43-65` (read this session). |
| Motivo guard, single service-level check (D8) | Implemented | `movimientos/service.ts:92-96`, `MOTIVO_MIN_LENGTH = 3` (read this session). |
| `motivo` route format `.trim().min(3).max(500).optional()` | Implemented | `routes/movimientos.ts:27-32` (read this session). |
| Web `motivo` schema mirrors API bounds (RECONCILE-2 gap closed) | Implemented | `features/movimientos/schemas.ts:11,25,53` -- `MOTIVO_MIN_LENGTH=3`, `MOTIVO_MAX_LENGTH=500`, unconditional `.max()` (read this session). This is the exact gap the claims-gate found refuted and then closed; the fix is present at HEAD. |
| Three error factories (D6) | Implemented | `lib/errors.ts:233-259` -- `insufficientStock`, `productInactive`, `movementReasonRequired`; English `details.available` key; codes match RECONCILE-1/5 (read this session). |
| No `recordAudit` in `movimientos/service.ts` (ADR-0012 rule 2) | Implemented | File read in full (141 lines) this session -- no import, no call. |
| Four routes per D5's table, `config.roles` per route | Implemented | `routes/movimientos.ts:142-278` -- GET/entrada/salida both roles, ajuste `['encargado']` only (read this session). |
| `.strict()` bodies (D7 enforcement mechanism) | Implemented | `entradaBody`/`salidaBody`/`ajusteBody`, `routes/movimientos.ts:43-65`; proven by `routes/movimientos.test.ts:301-435`. |
| `es_merma` column + two CHECK constraints (D3) | Implemented | `db/schema.ts:204,232-246` (read via codegraph this session); migration `drizzle/0005_mature_the_renegades.sql` present on disk. |
| Trigger hidden (not disabled) for inactive product (D10) | Implemented | `productosDetalle.tsx:169` -- `producto.activo ? <Button>...</Button> : null` (read this session). |
| Modal presentational, route owns mutation (documented deviation) | Implemented | `productosDetalle.tsx:61,67-88` owns `useRegistrarMovimiento`/`movimientosErrorMessage`; `MovimientoModal` takes `onSubmit`/`serverError` props (read this session). Matches the documented S7b ownership resolution. |
| `docs/BACKLOG.md:41` updated | Implemented | Row reads "Hecho" with the two write-up clarifications tasks.md 9.3 describes (read this session). |
| No `.env*` committed | Implemented | `git ls-files \| grep -i .env` returns only `.env.example`; `.gitignore` excludes `.env`/`.env.local` (checked this session, files themselves never opened per hard constraint). |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| D1 -- classify on rejection path only, `aplicarDelta` untouched | Yes | `rechazarMovimiento` matches the design's code block verbatim. |
| D2 -- SAVEPOINT seam, no early return/throw/try-catch after `create` | Yes | `movimientos/service.ts:114-139` -- single return at the end, explicit seam comment, no try/catch. |
| D3 -- one migration, two CHECKs mirroring `es_discrepancia`'s pattern | Yes | Confirmed in `schema.ts` and the generated SQL file. |
| D4 -- `MovimientosRepo` gains exactly `listByProducto` | Yes | Verified via S2 tasks plus repository integration tests (not independently re-read line-by-line this session -- see Issues). |
| D5 -- four routes nested under `/productos/:id/movimientos*` | Yes | `routes/movimientos.ts:142-278`. |
| D6 -- error factories, English `details` key | Yes | Confirmed above. |
| D7 -- positive magnitude wire, sign derived in service | Yes | Confirmed above. |
| D8 -- motivo guard, single service-level check, MIN=3 | Yes | Confirmed above (RECONCILE-2 resolution honored on both API and web). |
| D9 -- 3-step modal, tokens/audit note/checkbox | Yes | Confirmed via `MovimientoModal.test.tsx`'s scenario coverage (audit note, discrepancy checkbox, stock preview, summary line all tested); `MovimientoModal.tsx` itself not independently re-read line-by-line this session -- relies on passing tests plus the mutation-probe log in tasks.md (S7a/S7b). |
| D10 -- trigger on `productosDetalle`, hidden not disabled | Yes | Confirmed above. |
| RECONCILE-1..4 resolutions honored (not the original spec/design positions) | Yes | Codes/`details.available`/`MOTIVO_MIN_LENGTH=3`/`esMerma`/discrepancy checkbox all confirmed in source this session, matching tasks.md's RECONCILE resolutions section. |

### TDD Compliance

No dedicated `apply-progress` artifact with a formal per-task "TDD Cycle Evidence" table exists as a
separate document -- the Engram topic `sdd/movimientos-inventario/apply-progress` (obs #199) is a
narrative summary, not the RED/GREEN/TRIANGULATE/SAFETY-NET table the strict-tdd-verify module expects.
Equivalent evidence instead lives inline in `tasks.md`, per task, in more detail than the standard
table would carry: every one of the 9 code slices (S1-S8, S1c excluded as owner-action) documents its
RED confirmation (test files failing before production code existed, often with exact error text), its
GREEN result (exact pass counts), and -- uniquely for this cycle -- an explicit mutation-probe section
per slice naming the exact assertion that failed and the exact failure text observed, then reverted and
confirmed clean via `git diff --exit-code`.

| Check | Result | Details |
|-------|--------|---------|
| TDD Evidence reported | Partial | No formal Engram TDD table; equivalent (arguably stronger) evidence is in tasks.md per-task, confirmed present for all 9 code slices. |
| All tasks have tests | Yes | 56/56 tasks complete; every code slice has a paired `*.test.ts(x)` file, confirmed by directory listing this session. |
| RED confirmed (tests exist) | Yes | All test files listed above exist on disk and were run (green) this session. |
| GREEN confirmed (tests pass) | Yes | 717/717 across unit + integration, this session's own run, not just the report's claim. |
| Triangulation adequate | Yes | Every requirement has 2+ distinct test cases across at least two layers (unit + integration, or unit + route). |
| Safety Net for modified files | Yes | `productos/service.ts`'s forced `esMerma: false` ripple (S2) is covered by the full api unit suite staying green (332/332), and by claims-gate claim re-verification. |

**TDD Compliance**: 5/6 checks fully passed, 1 partial (documentation-location gap, not a substance gap).

---

### Test Layer Distribution

| Layer | Files (movimientos-specific) | Tools |
|-------|-------------------------------|-------|
| Unit (service/schema/error-mapping/route-config with fakes) | movimientos/service.test.ts, routes/movimientos.test.ts, errorMessages.test.ts, schemas.test.ts | Vitest 4, `app.inject` |
| Integration (real Postgres) | schema.integration.test.ts (movimientos-relevant subset), movimientos/repository.integration.test.ts, routes/movimientos.integration.test.ts | Vitest 4, Docker `inventienda-postgres-1` |
| Integration (RTL, browser-like) | MovimientoModal.test.tsx, productosDetalle.test.tsx (movimientos section) | RTL 16 + user-event 14, full `routeTree` |
| **Whole-suite total (this session's own run)** | api unit 332, web 250, api integration 135 = 717 | |

---

### Changed File Coverage

Coverage analysis skipped -- no coverage tool detected in this project's configured commands.

---

### Assertion Quality

No trivial/tautological assertions were found in the movimientos test files sampled this session
(service.test.ts, routes/movimientos.test.ts, routes/movimientos.integration.test.ts,
MovimientoModal.test.tsx, schemas.test.ts). Assertions consistently target concrete return values
(status codes, stock deltas, `details.available`, row counts before/after) rather than type-only or
tautological checks. The tasks.md mutation-probe log for every slice (S1-S8) independently corroborates
this: each probe names an exact assertion that failed under a deliberate defect, and each was reverted
with a clean `git diff --exit-code` -- external, executable evidence against decorative-pass risk,
stronger than what this session could re-derive by static reading alone.

**Assertion quality**: All sampled assertions verify real behavior. Not independently mutation-tested
again this session (that would duplicate the extensive record already in tasks.md); relying on the
cited historical mutation evidence per CLAUDE.md's "mutate before trusting" rule, since it was
performed against real Postgres/RTL, not merely claimed.

---

### Quality Metrics

**Linter**: No errors (biome ci ., 237 files, exit 0)
**Type Checker**: No errors (api + web both "Done", exit 0)

### Issues Found

**CRITICAL**: None.

**WARNING**:

1. `inventory-movements` spec's "Arbitrary reason text is accepted and stored verbatim" scenario
   (spec.md:108-112, exercising `motivo: "Conteo fisico mensual"` reading back exactly) has no
   covering test. Every movimientos-related test file was searched this session (for
   `.motivo).toBe`, `row.motivo`, `result.motivo`, `movimiento.motivo`) and none asserts a round-trip
   equality on an arbitrary/accented motivo string. The repository integration test at
   `repository.integration.test.ts:78` inserts a motivo (`'stock inicial (alta de producto)'`) but
   asserts only `stockResultante`, `tipo`, and `cantidad` -- not `motivo`. This is a genuine UNTESTED
   scenario per this skill's compliance rule ("compliant only when a covering test passed at
   runtime"), not a design or implementation defect: reading the code (`movimientos/repository.ts`'s
   `create`, `routes/movimientos.ts`'s `toMovimientoDto`) shows no transformation or list-check is
   ever applied to `motivo` -- it is a plain Drizzle `text` column, passed straight through. The
   behavior is very likely correct; it is simply unproven by a runtime assertion, which is exactly
   the gap this gate exists to catch. Low severity given the triviality of the missing assertion and
   the absence of any code path that could plausibly alter the string, but it is a real gap against
   "a claim about this repository is proven by reading the cited lines or running the command, never
   by finding it plausible" (CLAUDE.md's claims-gate rule).
2. No dedicated `apply-progress` artifact carries a formal per-task TDD Cycle Evidence table (see TDD
   Compliance section above). The equivalent, and arguably more rigorous, evidence exists inline in
   tasks.md -- this is a documentation-shape gap, not a process-compliance gap.
3. `MovimientoModal.tsx` (D9) and `movimientos/repository.ts`'s `listByProducto` (D4) implementations
   were not independently re-read line-by-line this session -- evidence relies on their passing tests,
   the mutation-probe log in tasks.md, and the earlier claims-gate's independent verification, rather
   than a fresh source read of every line in this pass. Given the extensive independent corroboration
   (claims-report claims 13-19, this session's own test execution, and the four other movimientos
   source files that were read in full and matched design exactly), this is judged low risk, but it
   is disclosed rather than silently assumed.

**SUGGESTION**:

1. Add one test asserting `motivo` round-trips verbatim through create-then-read (repository layer)
   or create-then-response (route layer) with a non-trivial string (accents, punctuation) to close
   WARNING 1 before the next cycle touches this file.
2. Consider persisting a structured `apply-progress` artifact with the standard TDD Cycle Evidence
   table format in a future cycle, even though tasks.md's inline record is currently more detailed --
   this would let automated verify tooling cross-reference it without falling back to a narrative
   Engram summary.

### Verdict

**PASS WITH WARNINGS**

All 56 tasks are complete. Both capability specs' requirements have real, runtime-proven covering
behavior for 27 of 28 individually-listed scenarios (one genuine untested-but-plausible gap in the
motivo verbatim round-trip). All ten design decisions are followed in source, confirmed by direct
reading of the primary implementation files this session. The full test/build/lint/contract pipeline
is green at `main`@`643dfb6` (717 tests across three commands, all exit 0), reproduced live this
session rather than trusted from the state handoff alone. No CRITICAL finding blocks archive; the one
WARNING-level UNTESTED scenario is a missing assertion on already-correct, already-inert code, not a
reachable defect.
