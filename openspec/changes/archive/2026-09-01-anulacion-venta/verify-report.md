# Verify Report: Anulación de Venta (backlog #9)

**Change**: `anulacion-venta` · **Mode**: full artifacts (proposal + specs + design + tasks) ·
**Verified revision**: `7ebe04c4a05d126188aeed6c729849a004163f6a` (main, working tree clean)

## Scope

PR1 (backend, #130, merge `5218df3`), PR2 (web, #131, merge `c6c7a69`), and a follow-up test-fidelity
fix (#132, merge `7ebe04c`, commit `8585cd6`) are all merged to `main`. This report verifies the
combined result of all three against `specs/point-of-sale/spec.md`, `specs/recibo-ui/spec.md`,
`design.md`, and `tasks.md`.

## Completeness (tasks.md)

23/23 tasks checked `[x]` across Phases 1-8. Read the file directly (not trusted from prior agent
claims). Cross-checked against git log and source: every phase's stated deliverable exists on
main at the cited commits. Task 8.1 (BACKLOG.md flip) is correctly left undone -- docs/BACKLOG.md
row 9 still reads "Pendiente", matching this project's documented convention (verified: #6/#7/#8's
flips each land in their own chore(sdd): archive <cycle> commit, never inside apply). This is
expected, not a gap -- flip belongs to sdd-archive.
## Spec Requirement/Scenario Coverage (measured)

Counted directly with rg '^### Requirement:' / rg '^#### Scenario:' against the two spec files:

| Spec | Requirements | Scenarios |
|---|---|---|
| point-of-sale | 8 | 13 |
| recibo-ui | 1 | 5 |
| Total | 9 | 18 |

All 9 requirements / 18 scenarios have covering implementation and a passing runtime test. No
UNTESTED or FAILING scenario found.

### point-of-sale (8 requirements / 13 scenarios)

| Requirement | Scenario(s) | Evidence |
|---|---|---|
| Anulacion Is Encargado-Only | encargado succeeds; deposito refused 403 | routes/ventas.ts:244-247 (roles: ['encargado']); ventas.test.ts; ventas.integration.test.ts:772 (403 writes nothing, DB asserted) |
| Motivo Anulacion Is Mandatory (PD-1) | missing motivo refused; motivo persisted verbatim | service.ts:307-317 (payload guard, trim().min(3).max(500), ratified bound); service.test.ts; routes/ventas.ts:87-91 (anularVentaBody) |
| No Time Limit On Anulacion (PD-2) | old venta still anulable | service.ts:303-372 -- no age/date check anywhere in anularVenta; service.test.ts |
| Atomic Across Stock/Ledger/Pagos/Venta State | full success; inactive-product still reverses; failure rolls back | service.ts:319-371 (single uow.run); ventas.integration.test.ts:565,639,691 -- all real Postgres |
| Exempt From Activo/Stock Guards (A8) | movimiento created regardless of activo | productos/repository.ts:257-273 (revertirStockPorAnulacion, no activo predicate); productos/repository.test.ts, repository.integration.test.ts (A8 case, mutation-probed per Task 8.3) |
| Already-Anulada Refused With Conflict | second attempt refused 409; concurrent race leads to exactly one succeeds | service.ts:329-338 (classify-on-undefined); repository.ts:201-213 (conditional UPDATE, serialization point); ventas.integration.test.ts:822 (concurrency, mutation-probed) |
| Numero Correlativo Immutable (PD-5) | unchanged before/after | repository.ts:201-213 -- marcarAnulada's UPDATE never touches numeroCorrelativo; ventas.integration.test.ts:565 asserts it |
| Total, Not Partial (v1) | all items/pagos reverse together, no selection param | anularVentaBody (wire shape, no item/pago param); service.ts:343-368 (unconditional per-item loop + bulk revertirPagos) |

### recibo-ui (1 requirement / 5 scenarios)

| Requirement | Scenario(s) | Evidence |
|---|---|---|
| Anulacion Entry Point On The Venta/Receipt View (PD-3, provisional to ratified in design.md) | encargado sees/triggers; deposito does not; blocked without motivo; anulada shows no control; success reflects via Recibo.tsx's existing estado field, no new banner (PD-4) | routes/recibo.tsx:72-88 (gate: usuario.rol === 'encargado' && venta.estado === 'confirmada'); AnularVentaModal.tsx (isValid-gated submit, mode: 'onChange'); recibo.test.tsx (6 route-level cases, await router.load() per CLAUDE.md); Recibo.tsx untouched -- confirmed via git show on both PR1/PR2 diffs, zero lines changed in that file |
## Design Coherence (design.md)

All architecture decisions verified against source, not merely plausible:

| Decision | Verified |
|---|---|
| POST /api/ventas/:id/anular (action-style) | routes/ventas.ts:245 |
| marcarAnulada UPDATE runs FIRST (serialization point) | service.ts:319-327 -- first call inside uow.run |
| revertirStockPorAnulacion returns Promise<number>, never undefined | repository.ts:257-273 -- expectOneRow-style throw on zero rows, no `| undefined` in signature |
| Anulacion movimientos carry motivo: null, linked by ventaId | service.ts:355-365 |
| No recordAudit call | Confirmed absent in anularVenta; ventas is not AuditableEntidad |
| Ratified Open Question 1: motivoAnulacion bound trim().min(3).max(500) | Implemented identically in 3 places: service.ts:84-90/307-317 (server), routes/ventas.ts:87-91 (wire schema), apps/web/.../schemas.ts (client form schema) -- matches movimientos.ts's MOTIVO_MIN_LENGTH/MAX_LENGTH mirror exactly |
| UI entry point on receipt route, not POS screen | routes/recibo.tsx hosts the trigger + modal; no pos-ui change exists in the diff |

One documented, accepted deviation from tasks.md's phrasing (task 3.2/3.3): the motivo-bound guard
runs as a direct AppError('VALIDATION_ERROR', ...) throw in service.ts, not via Zod. This was
flagged by the apply phase itself as a deviation, not discovered here -- confirmed present and
functionally equivalent (400 VALIDATION_ERROR, same message shape as the rest of the codebase's
errorEnvelopeSchema). WARNING, not CRITICAL: does not violate any spec requirement.
## Test / Build Evidence (this run, re-executed, not trusted from prior reports)

All commands run fresh against HEAD=7ebe04c, working tree clean before and after.

| Command | Exit | Result | Output hash (SHA-256) |
|---|---|---|---|
| pnpm --filter api test | 0 | 451/451 passed, 32 files | 1357cb032bb0c761fdc5a65144830e9c96ce365c41b8e536406c29606d2a6ce7 |
| pnpm test:integration (real Docker Postgres) | 0 | 151/151 passed, 16 files | 4fe8378be2ba7565bdb29081617270c0f6334f67887e59e525393f7ca7ab50da |
| pnpm --filter web test | 0 | 441/441 passed, 65 files | aab6276b4e893e368f2e67c6f9f6fbc03c6c3982797442eeac15dbddb7876d75 |
| pnpm typecheck | 0 | api + web clean | 327bb206d3433632b2ea79f6129a1f1f6325f0ab64b3fd82d2e5f773affcdf07 |
| pnpm lint (biome ci) | 0 | 297 files, no fixes needed | f13d273f54521f1b8d98f570176454b523bc9e647f34b1af15fd0986c90a3ec5 |
| pnpm contract:check | 0 | byte-identical, no drift | 986f288bd27abbdf2a62ddbc1c2607c48000907db62ef293e13d9a8d38d2eee2 |

Backend integration coverage includes, verified by reading ventas.integration.test.ts directly
(all it(...) names confirmed against real assertions, not just names):
- full atomic reversal on success (line 565)
- a now-inactive product (activo = false) still reverses its stock (line 639)
- a failure partway through the transaction rolls back everything (line 691)
- 403 for rol = deposito writes nothing (line 772)
- two concurrent anulacion requests -- exactly one succeeds, the other gets 409 (line 822)

## Follow-up PR #132 -- test-fidelity fix, verified

Task 8.3 of tasks.md flagged a real fidelity gap in the atomicity rollback test's failure-injection
override (spreading a class instance drops prototype methods, so the transaction failed at the
first call instead of the intended last call). This report confirms PR #132 (8585cd6) actually
fixes it: Object.create(Object.getPrototypeOf(...)) + Object.assign now preserves every other
method, so the test genuinely exercises "partial writes made, then the final step fails, then
everything rolls back" -- read the diff directly (git show 8585cd6), not inferred. No outstanding
gap remains; the recommended follow-up from apply-progress is resolved.
## Issues

### CRITICAL
None found.

### WARNING
1. Deviation from tasks.md wording (task 3.2/3.3): the motivo-length guard is a hand-written
   AppError throw in service.ts, not routed through Zod as the task description phrased it. This
   is functionally correct and spec-compliant (400 VALIDATION_ERROR either way), and was
   self-disclosed by the apply run rather than discovered fresh here -- recorded as a documentation
   / task-wording mismatch, not a behavior gap.
2. design.md Open Question 4 (whether anuladaPor/anuladaEn/motivoAnulacion should be exposed on
   ventaDto) remains formally unchecked in design.md's own Open Questions list, though tasks.md
   records it as resolved ("widened-but-unused"). The field IS widened (routes/ventas.ts:79-81)
   and no web code renders it (Recibo.tsx untouched, confirmed). Cosmetic: the design.md checkbox
   itself was never ticked even though the decision was made and implemented consistently.
   Recommend ticking it at archive time for artifact hygiene.

### SUGGESTION
1. docs/BACKLOG.md row 9 correctly remains "Pendiente" -- no action needed until sdd-archive
   flips it per the established #6/#7/#8 convention. Noted here only so the archive step does not
   miss it.

## Verdict

PASS

All 23 tasks complete and verified against source (not trusted from prior claims). All 9 spec
requirements / 18 scenarios have passing runtime coverage, confirmed by reading the actual test
bodies and re-running the suites fresh at HEAD=7ebe04c. All 6 gate commands (api test,
test:integration against real Docker Postgres, web test, typecheck, lint, contract:check) exit 0.
Design decisions match source exactly, including the ratified motivoAnulacion trim().min(3).max(500)
bound applied consistently server + wire + client. The one prior known gap (atomicity test
fidelity, Task 8.3) was fixed by follow-up PR #132 and independently re-verified by reading that
diff. Two WARNING-level findings are documentation/artifact-hygiene only, neither blocks archive.

Recommended next phase: sdd-archive.
