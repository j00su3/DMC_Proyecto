# Archive Report: Movimientos de Inventario (Backlog #6)

**Change**: `movimientos-inventario`
**Archived**: `2026-08-31` to `openspec/changes/archive/2026-08-31-movimientos-inventario/`
**Status**: COMPLETE — PASS WITH WARNINGS (warning closed in later commit)

## Cycle Overview

Two new greenfield capabilities (`inventory-movements` and `movimientos-ui`) for registering stock movements (entrada/salida/ajuste) with role-based access control, motivo validation, and a 3-step registration modal. Cycle follows `sdd-archive` phase contract (hybrid artifact store).

## Artifact Traceability (Engram Observation IDs)

All artifacts retrieved and verified at archival time:

- **Proposal** (#194): `sdd/movimientos-inventario/proposal` — full intent, product decisions (PD-1 to PD-4), scope, risks
- **Delta Specs** (#195): `sdd/movimientos-inventario/spec` — two new greenfield specs: `inventory-movements` (10 requirements) and `movimientos-ui` (5 requirements)
- **Design** (#196): `sdd/movimientos-inventario/design` — 10 technical decisions (D1–D10), reconciled against four RECONCILE points
- **Tasks** (#198): `sdd/movimientos-inventario/tasks` — 9 code-bearing phases (S1–S8) plus S1c (Neon deploy gate) and Phase 9 (bookkeeping); 56 implementation tasks, all ticked
- **Verify Report** (#205): `sdd/movimientos-inventario/verify-report` — verdict PASS WITH WARNINGS (critical_findings: 0), evidence_revision sha256:643dfb6, all 717 tests green (api unit 332, web 250, api integration 135), requirements 10/10, scenarios 27/28

## Specs Promoted to Main

Two new capabilities published from `openspec/changes/movimientos-inventario/specs/` to primary sources:

| Domain | Action | Path | Requirements | Status |
|--------|--------|------|--------------|--------|
| inventory-movements | Created (greenfield) | `openspec/specs/inventory-movements/spec.md` | 10 (all) | ✅ Copied, verified, byte-identical |
| movimientos-ui | Created (greenfield) | `openspec/specs/movimientos-ui/spec.md` | 5 (all) | ✅ Copied, verified, byte-identical |

Mechanical copy verification (both specs):
```
✓ inventory-movements/spec.md: identical (diff -r exit 0)
✓ movimientos-ui/spec.md: identical (diff -r exit 0)
```

## Change Folder Moved to Archive

**Source**: `openspec/changes/movimientos-inventario/` (removed)
**Destination**: `openspec/changes/archive/2026-08-31-movimientos-inventario/` (created)
**Verification**: Mandatory `diff -r` readback, empty output (identical)

### Archive Contents Verified

- ✅ proposal.md
- ✅ design.md
- ✅ exploration.md
- ✅ tasks.md (56/56 boxes ticked)
- ✅ verify-report.md
- ✅ claims-report.md (archived with cycle per convention)
- ✅ specs/ (inventory-movements/spec.md, movimientos-ui/spec.md)

## Final Verification Status

### Task Completion Gate

**Result**: PASS — all 56 implementation tasks marked complete.

Verified in persisted `openspec/changes/archive/2026-08-31-movimientos-inventario/tasks.md`:
- S1–S8: 9 code-bearing phases, all tasks checked (`[x]`)
- S1c: Neon pre-flight and migration (owner action, completed 2026-08-30)
- Phase 9: Bookkeeping and claims-gate completion (all boxes ticked)
- 9.4: claims-report.md produced and verified (36/36 claims confirmed)

**No stale unchecked tasks remain in the archived tasks artifact.**

### Native Review Gate

**Result**: NOT APPLICABLE — no review was ever started for this candidate.

`reviewGate` is structurally absent. The kill switch (receipt-driven development mode) was not enabled for this candidate, so zero review code ran. Archive proceeds under ordinary repository policy. No receipt to validate.

### Intermediate Snapshot vs. Final State

**verify-report.md (Engram #205, written 2026-08-30 at sha256:643dfb6):**
- Verdict: PASS WITH WARNINGS
- Critical findings: 0
- Blockers: 0
- Test count at time: api unit 332, web 250, api integration 135 (717 total)
- Requirements: 10/10 covered
- Scenarios: 27/28 covered
- One WARNING (not CRITICAL): motivo round-trip scenario (spec.md:104-112) had no covering test at verify time.

**FINAL STATE per launch prompt (2026-08-31, main@6c38a00, working tree clean):**
- Test count AFTER verify: api unit 332, web 250, **api integration 136** (718 total)
- The missing scenario was closed by **integration test 7** in `apps/api/src/routes/movimientos.integration.test.ts`, added in later commit after verify-report was written.
- Mutation-probe evidence: flipping the service to lowercase `motivo` fails exactly that test while all 332 unit tests stay green.
- All other warnings and gaps recorded in verify-report are either design limitations (PD-3: motivo grouping lost as accepted tradeoff) or TDD discipline gaps (MovimientoModal and listByProducto not independently re-read, judged low risk given tests + mutations passed).

**Contradiction Analysis**: None. The verify report's PASS WITH WARNINGS verdict stands. The added integration test is proof of work landing after intermediate-snapshot time, not a contradiction. Final count (136 integration tests) supercedes intermediate snapshot (135).

## Deliverables Confirmed Present

### Backend Delivered (9 phases, S1–S5)

1. **S1**: Schema (es_merma column + 2 CHECKs), 3 error factories, Neon pre-flight
2. **S1c**: Owner-run Neon migration (completed 2026-08-30)
3. **S2**: MovimientosRepo.listByProducto, NuevoMovimiento.esMerma required, crearProducto ripple fixed
4. **S3**: movimientos/service.ts (D1 classification, D7 sign derivation, D8 motivo guard, D2 seam, no recordAudit)
5. **S4**: routes/movimientos.ts (4 routes per D5), app.ts registration, contract regenerated
6. **S5**: Integration tests (atomicity, audit-absence, 403-writes-nothing, INSUFFICIENT_STOCK real stock, merma distinct)

### Frontend Delivered (4 phases, S6–S8)

6. **S6**: Feature scaffolding (queries, hooks, schemas, error messages)
7. **S7a**: Modal step 1 (choice cards, role hiding, step wiring)
8. **S7b**: Modal steps 2–3 (validation, quantity/motivo gating, submit, error surfacing)
9. **S8**: Trigger button + MovimientosTable on productosDetalle.tsx, history pagination

### Verification Work Products

- **claims-report.md**: 36 verifiable claims extracted, all CONFIRMED after re-verification at 3d302e1
- **Mutation probes**: 2 per each dense slice (S3, S7a, S7b, S8); every probe observed failure when code was mutated, proving assertions are load-bearing

## Known Limitations Recorded

1. **Motivo grouping** (PD-3, accepted): sistem cannot group discrepancies by cause — users provide free-text reasons with no closed list. Flagged at proposal time as an inherited limitation for backlog #12's future reports phase.

2. **No per-task TDD Cycle Evidence table**: apply-progress artifact not produced separately; equivalent evidence lives inline in tasks.md per-task with mutation-probe logs.

3. **Two production files not independently re-read**: MovimientoModal.tsx and movimientos/repository.ts::listByProducto relied on passing tests + tasks.md mutation records + prior claims-gate verification, rather than independent line-by-line code review. Assess risk: low (no regressions observed across 718-test suite, mutations caught defects when present).

## Reconcilements Applied

Four RECONCILE points from tasks.md all implemented as specified:

1. **RECONCILE-1**: `insufficientStock(available: number)` — details key is `available` (English), not `disponible`
2. **RECONCILE-2**: `MOTIVO_MIN_LENGTH = 3` (web form schema matches this; api spec says "min-length only")
3. **RECONCILE-3**: Wire field name is `esMerma` (camelCase, Spanish-domain convention)
4. **RECONCILE-4**: `es_discrepancia` checkbox ships on ajuste step (TECH-DESIGNv2.md A9)

All four verified present in production code via code inspection and test coverage.

## Discrepancies Resolved at Apply Time

Two spec-vs-implementation discrepancies were discovered during S4/S5 apply and documented in tasks.md (corrections noted with "Corrected 2026-08-30"):

1. **RBAC on ajuste**: Spec originally named a dedicated error code `ADJUSTMENT_RESERVED_FOR_ENCARGADO` (403). Actual mechanism: `plugins/auth.ts:92-95` throws plain `forbidden()` (code `FORBIDDEN`) for any `config.roles` refusal — there is no per-route override. Routes use `config.roles = ['encargado']` as the boundary. Test assertion corrected to assert ACTUAL mechanism (`403 FORBIDDEN`), not spec's intended-but-impossible code. See S4 task 4.1 code comment.

2. **Quantity zero on ajuste**: Spec originally named `ADJUSTMENT_QUANTITY_ZERO` (400). Actual mechanism: D7's wire shape (`z.number().int().min(1)`) makes zero unrepresentable on the wire — Zod rejects it before any handler runs, yielding `VALIDATION_ERROR` from the contract pipeline. Both discrepancies documented in test/spec correction notes (S4.1, S6.1). Server-side boundary (403 from config.roles) is enforced regardless of client display, so spec's access-control intent is met; the error codes differed from implementation due to the framework's fixed RBAC path.

## Chain Strategy Applied

Nine work units (S1–S8, ignoring S1c which is an owner action with zero PR diff) split into a **stacked-to-main delivery chain**: each slice merged to main independently as soon as ready, no feature branch accumulator. Twelve PRs merged (#90–#102). All retargeting to main was manual per session convention (GitHub does not auto-retarget). No deletes-branch hazard as all PRs started from freshly-merged main.

Review budget: session budget was 800 lines; largest individual slice (S4) was ~410 lines. No single PR exceeded budget; total chain was ~2870 raw diff across 8 code slices, requiring chaining per proposal estimate.

## Archive Completion Checklist

- [x] Main specs updated correctly (inventory-movements, movimientos-ui created with byte-identical copy)
- [x] Change folder moved to archive (git mv, source removed, diff -r verified empty)
- [x] Archive contains all artifacts (proposal, specs, design, tasks, verify-report, claims-report, exploration)
- [x] Archived tasks.md has no unchecked implementation tasks (56/56 ticked)
- [x] Active changes directory no longer has this change
- [x] Verbatim diff -r readback output included and empty (no differences)
- [x] Task Completion Gate passed
- [x] Native Review Gate: not applicable (no review started)

## SDD Cycle Complete

**The change has been fully planned, implemented, verified, and archived.**

**What ships**: Two new capabilities enabling stock movement registration (backend + frontend) with RBAC, validation, and an append-only ledger. No audit rows per ADR-0012. Movement history readable and paginated per product.

**Ready for**: Next backlog item (backlog #7: venta registration, backlog #10: alert evaluator).

**Archive created**: 2026-08-31 (this date, working tree clean at main@6c38a00)
**Specs promoted**: 2 (inventory-movements, movimientos-ui)
**Tests passing**: 718 (api unit 332, web 250, api integration 136)
**PRs merged**: 12 (#90–#102)
**Claims verified**: 36/36 confirmed

---

*This report is the terminal record of the movimientos-inventario change cycle. It was written during the sdd-archive phase and reflects final state at close, per the Archive Final-State Authority contract.*
