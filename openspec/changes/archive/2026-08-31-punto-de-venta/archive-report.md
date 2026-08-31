# Archive Report: Punto de Venta (Backlog #7)

**Change**: `punto-de-venta`
**Archived**: `2026-08-31` to `openspec/changes/archive/2026-08-31-punto-de-venta/`
**Status**: COMPLETE — PASS (0 CRITICAL, 0 WARNING, 2 SUGGESTION, all non-blocking)

## Cycle Overview

Two new greenfield capabilities (`point-of-sale` backend and `pos-ui` frontend) implementing the
POS sale-registration flow: multi-item cart, deterministic `producto_id`-ascending write order,
multi-payment validation (medio obligatorio, monto ≥ total, cálculo de vuelto), server-side price
re-check with explicit re-confirm on mismatch, and a `localStorage`-persisted cart with a 4h TTL.
Cycle follows the `sdd-archive` phase contract (hybrid artifact store).

## Artifact Traceability (Engram Observation IDs)

All artifacts retrieved and read in full at archival time:

- **Proposal** (#213): `sdd/punto-de-venta/proposal` — intent, 9 first-round product decisions
  (PD-1..PD-9), scope, risks, size estimate
- **Delta Specs** (#217): `sdd/punto-de-venta/spec` — two new greenfield specs: `point-of-sale`
  (12 requirements, 19 scenarios) and `pos-ui` (10 requirements, 16 scenarios)
- **Design** (#218): `sdd/punto-de-venta/design` — 15 technical decisions (D1–D15), written blind
  to `specs/` per the two-rules-earned-the-hard-way convention in `CLAUDE.md`
- **Tasks** (#219): `sdd/punto-de-venta/tasks` — 9 code-bearing phases (Phase 1–8) plus Phase 9
  (bookkeeping); 35 implementation tasks. RECONCILE-1 (D12 wire codes vs. spec's unratified codes)
  resolved with no behavioral conflict.
- **Verify Report** (#221): `sdd/punto-de-venta/verify-report` — verdict PASS (0 CRITICAL, 0
  WARNING, 2 SUGGESTION), verified revision `82b5be3` (merge of PR #114 into `main`), full
  test/build/lint/contract/integration suite independently reproduced: 403 api unit + 375 web unit
  + 144 integration tests, all green; typecheck and lint clean; contract regeneration zero diff.
- **Claims Report** (filesystem only, `openspec/changes/punto-de-venta/claims-report.md` at
  archival time, now archived alongside this report; not separately persisted to Engram under a
  dedicated topic key by prior phases) — 50 claims extracted from `verify-report.md`, `tasks.md`
  checkboxes, and the 10 merged PR bodies/commits (#105–#114). **50 CONFIRMED, 0 REFUTED, 0
  UNVERIFIABLE.** Two items required an owner-directed correction pass the same day (claim #45's
  PR #112 body overcounted RTL tests by one, corrected via `gh pr edit`; claim #46 was initially
  unverifiable and the owner chose to check out PR #112's merge commit in detached HEAD to verify
  it directly) — both resolved to CONFIRMED before this report was written, not left open.

## Specs Promoted to Main

Two new capabilities published from `openspec/changes/punto-de-venta/specs/` to primary sources.
Both are **greenfield** (no prior `openspec/specs/point-of-sale/` or `openspec/specs/pos-ui/`
existed) — mechanical `cp` copy, not a delta merge:

| Domain | Action | Path | Requirements | Status |
|--------|--------|------|--------------|--------|
| point-of-sale | Created (greenfield) | `openspec/specs/point-of-sale/spec.md` | 12 (all) | ✅ Copied, verified, byte-identical |
| pos-ui | Created (greenfield) | `openspec/specs/pos-ui/spec.md` | 10 (all) | ✅ Copied, verified, byte-identical |

Mechanical copy verification (both specs, `diff -r` src-vs-copy, run before the change folder was
moved):
```
=== diff -r for point-of-sale (src vs temp) ===
diff exit: 0
=== diff -r for pos-ui (src vs temp) ===
diff exit: 0
```

Final cross-check against the still-present change-folder source (before the folder move):
```
=== final diff point-of-sale ===
IDENTICAL (exit 0)
=== final diff pos-ui ===
IDENTICAL (exit 0)
```

## Change Folder Moved to Archive

**Source**: `openspec/changes/punto-de-venta/` (removed)
**Destination**: `openspec/changes/archive/2026-08-31-punto-de-venta/` (created)
**Mechanism**: `git mv` (directory move; git staged renames for all 6 tracked files, and the move
carried the 2 untracked files — `claims-report.md`, `verify-report.md` — with it on the
filesystem; both were staged separately with `git add`)
**Verification**: Mandatory `diff -r` readback against a pre-move recursive snapshot (`cp -R` to a
temp dir before the `git mv`), empty output:

```
=== source gone check ===
source removed OK
=== diff -r snapshot vs dest ===
diff exit=0
```

### Archive Contents Verified

- ✅ proposal.md
- ✅ design.md
- ✅ exploration.md
- ✅ tasks.md (35/35 boxes ticked — see Task Completion Gate below for the one exceptional
  reconciliation)
- ✅ verify-report.md
- ✅ claims-report.md (archived with the cycle per convention)
- ✅ specs/ (point-of-sale/spec.md, pos-ui/spec.md)

## Final Verification Status

### Task Completion Gate

**Result**: PASS, with one exceptional, pre-approved reconciliation.

At the moment `sdd-verify` wrote `verify-report.md`, 34/35 implementation tasks were checked; task
9.1 (`docs/BACKLOG.md:42` flip) was deliberately left unchecked. This was not a gap: `tasks.md`
itself states the deferral explicitly (*"Deferred to `sdd-archive`, per the #6
(movimientos-inventario) precedent: the backlog flip landed in that cycle's archive PR (#104), not
in apply"*), the orchestrator's launch prompt for this archive phase explicitly assigned task 9.1
to this run, and `verify-report.md`'s own verdict section calls it "not a gap" and its "Next
Recommended" section instructs `sdd-archive` to "complete task 9.1 ... and close the cycle."

Per the skill's exceptional-reconciliation clause (*"Only proceed if the orchestrator explicitly
instructs you to reconcile stale checkboxes and apply-progress/verify-report prove every unchecked
task is complete"*), this run completed task 9.1 during the archive phase itself — flipping
`docs/BACKLOG.md` row 7 to `✅ Archivado` with an embedded closing note — and then ticked task 9.1
in `tasks.md` to `[x]` **before** the change folder was moved, so the archived artifact carries no
stale unchecked box. This mirrors the exact precedent set by movimientos-inventario (#6), whose
task 9.1-equivalent (its own backlog-flip bookkeeping) also landed in that cycle's archive PR
(#104), not its apply phase.

**No stale unchecked tasks remain in the archived tasks artifact.**

### Native Review Gate

**Result**: NOT APPLICABLE — no review was ever started for this candidate.

`reviewGate` is structurally absent. Receipt-driven development (the review kill switch) was not
enabled for this candidate, so zero review code ran. Archive proceeds under ordinary repository
policy. No receipt to validate.

### Intermediate Snapshot vs. Final State — Contradiction Check

**verify-report.md (Engram #221, written 2026-08-31 at revision `82b5be3`):**
- Verdict: PASS
- Critical findings: 0, Warnings: 0, Suggestions: 2 (both non-blocking, informational)
- Test count at verification time: api unit 403/403, web unit 375/375, integration 144/144
  (independently reproduced this session, matching apply-progress's claimed evidence exactly)
- Tasks: 34/35 checked; task 9.1 explicitly, deliberately deferred to `sdd-archive`
- Requirements: 22/22 covered (12 point-of-sale + 10 pos-ui); scenarios: 35/35 covered
  (19 point-of-sale + 16 pos-ui)
- 2 suggestions: (1) D8/D9/D10/D15 design-coherence checks confirmed present but not re-derived
  byte-for-byte in that pass; (2) claims-report.md was not yet present at verify time, flagged so
  `sdd-archive` would not skip it.

**Claims-gate report (filesystem `claims-report.md`, written 2026-08-31 at revision `82b5be3`,
same revision as verify):**
- 50/50 claims CONFIRMED, 0 REFUTED, 0 UNVERIFIABLE
- Verdict: PASS — gate is GREEN. `gh pr merge` unblocked for this cycle's closing work.

**FINAL STATE at archive time (2026-08-31, working tree clean before this phase's edits, `main` at
`82b5be3`):**
- Task 9.1 completed during this phase (see Task Completion Gate above); `tasks.md` now shows
  35/35 tasks checked in the archived artifact.
- `docs/BACKLOG.md` row 7 flipped from `⬜ Pendiente` to `✅ Archivado`, matching the exact format
  precedent set by commit `87aa1f9` (movimientos-inventario's own row-6 flip).
- No other facts changed between verify time and archive time — no code changed, no PRs merged
  after #114, no test counts changed.

**Contradiction Analysis**: **None.** The verify report's PASS verdict stands unmodified. The
claims-gate's PASS/GREEN verdict stands unmodified. Task 9.1's unchecked state at verify time was
an explicit, documented, intentional deferral (not a defect or omission), and it closed exactly as
both `verify-report.md`'s "Next Recommended" section and `tasks.md`'s own inline note said it
would — during this archive phase, per established project precedent (#6). Unlike the #6 cycle
(where a warning was closed by a later commit between verify and archive, requiring an explicit
supersession note), this cycle has no gap between what verify reported and what archive found:
verify and archive fully agree.

## Deliverables Confirmed Present

### Backend Delivered (5 phases, Phase 1–4 + wiring)

1. **Phase 1** (PR1–PR2): `dinero` money module (centavos, no `parseFloat`, byte-identical
   api/web twins); `ventas`/`items_venta`/`pagos` schema, enums, `ventas_numero_correlativo_seq`
   sequence, D6 constraints and CHECKs
2. **Phase 2** (PR3–PR4): D12 error factories per RECONCILE-1; `VentasRepo` port+adapter;
   `ventas/service.ts` (`ordenarItems`, `confirmarVenta` two-pass, `rechazarVenta`)
3. **Phase 3** (PR5): `productos/repository.ts` additive `opts.soloActivos` (D11); `routes/ventas.ts`
   (`POST /api/ventas`, `GET /api/ventas/catalogo`); wiring; contract regeneration
4. **Phase 4** (PR6–PR7): real-Postgres integration tests (atomicity/rollback, correlativo gap,
   CHECK constraints); concurrency test (opposite click-order, no `40P01`)

### Frontend Delivered (4 phases, Phase 5–8)

5. **Phase 5** (PR6): cart foundation — wire Zod schemas, `carrito.ts` pure reducer (dup-merge,
   explicit empty, stock-bound qty edit), `storage.ts` versioned envelope + 4h TTL
6. **Phase 6** (PR7): data layer — `queries.ts`, `errorMessages.ts` (D12 code → cashier text map),
   `useCarrito`/`useCatalogo`/`useConfirmarVenta` hooks
7. **Phase 7** (PR8): UI — `CatalogoGrid.tsx` (zero-stock visible/disabled), `CarritoPanel.tsx`,
   `PagoPanel.tsx` (multi-payment, vuelto cash-only); 17 RTL tests (5+6+6, corrected from an
   initial miscount of 18 — see claims-gate correction below)
8. **Phase 8** (PR9): `/pos` route under `shellLayout`, full-flow route test (`await
   router.load()`, add→confirm→cart-cleared, `PRICE_CHANGED` blocks close until re-confirm)

### Cleanup (Phase 9, PR10 + this archive phase)

9. **9.2**: Release checklist — `pnpm db:migrate` against Neon documented as a manual pre/post-merge
   step for migration `0006_magical_mandarin.sql` (three new tables + sequence), same pattern as
   #6's S1c.
10. **9.3**: Four mutation probes (PD-10 payment-sum guard inversion, `ordenarItems` sort removal,
    `pagos_vuelto_solo_efectivo` CHECK removal via `db:generate` diff, `CART_TTL_MS` → `Infinity`),
    each independently confirmed RED-then-reverted-GREEN, and independently re-confirmed by the
    claims gate via `git show --stat` on the PR10 commit (only `tasks.md` changed, no production
    file has a net diff).
11. **9.1** (this archive phase): `docs/BACKLOG.md:42` flip, completed here — see Task Completion
    Gate above.

### Verification Work Products

- **verify-report.md**: full independent reproduction of build/test/lint/contract/integration
  suites; 22/22 requirements and 35/35 scenarios traced to passing tests and direct source
  inspection (not tasks.md claims alone)
- **claims-report.md**: 50 verifiable claims extracted from verify-report.md, tasks.md checkboxes,
  and the 10 merged PR bodies/commits, all CONFIRMED after re-verification (including two
  owner-directed corrections, both closed the same day, before this report)

## Known Limitations Recorded

1. **Correlativo gap after rollback (D7)**: `numero_correlativo` is assigned from a sequence, so a
   rolled-back sale leaves a gap in the sequence. Documented in `design.md` and in the integration
   test's own comments as expected behavior, not a defect.
2. **Concurrency test non-determinism**: the two-opposite-order-sales deadlock test races two real
   Postgres transactions and is inherently timing-sensitive by nature. It passed in the verify run
   (16/16 integration files green). Documented as an already-accepted limitation of this test
   class, not a new finding.
3. **D8/D9/D10/D15 design-coherence spot-checks** (verify-report SUGGESTION 1): confirmed present
   but not independently re-derived byte-for-byte during the verify pass; no contradicting evidence
   found; flagged as low-risk, non-blocking.
4. **Neon migration not executed by this cycle**: `0006_magical_mandarin.sql` (adds `ventas`,
   `items_venta`, `pagos`, their enums, and the correlativo sequence) has not been run against the
   production Neon database by any automated step in this cycle — per `CLAUDE.md`'s Deployment
   section, this is a manual, developer-run step. Until it runs, `/api/ventas*` in production will
   500 with a "relation does not exist" class of error. This is a **release action item for the
   owner**, not a cycle defect; documented in `tasks.md` task 9.2 and now here for visibility.

## Reconcilements Applied

RECONCILE-1 (design's D12 wire codes vs. spec's unratified failure-code rows) resolved with **no
behavioral conflict** — design's codes satisfy every spec scenario line-by-line:

- `PAYMENT_BELOW_TOTAL` 409, `PAYMENT_MEDIUM_DUPLICATED` 400,
  `CASHLESS_PAYMENT_MUST_MATCH_TOTAL` 409, `PRICE_CHANGED` 409, `DUPLICATE_SALE_ITEM` 400 all
  ratified against specific spec line ranges; `SALE_AMOUNT_OUT_OF_RANGE` 400 accepted as
  design-only additive (no spec scenario to conflict with).

All 6 codes confirmed present end-to-end in `verify-report.md` (factory → service → route → web
error-message mapping) and independently re-confirmed by the claims gate.

## Corrections Applied During the Cycle (owner-directed, 2026-08-31)

Two claims-gate findings were corrected the same day, before this archive report was written —
carried forward here for the audit trail, per `CLAUDE.md`'s claims-gate policy ("a claim about
this repository is proven by reading the cited lines or running the command, never by finding it
plausible"):

1. **PR #112 body overcounted RTL tests** — originally claimed 18 new tests across
   `CatalogoGrid.test.tsx`/`CarritoPanel.test.tsx`/`PagoPanel.test.tsx`; actual count is 17 (5+6+6).
   Owner corrected the PR body via `gh pr edit` rather than accept the discrepancy; re-verified
   CONFIRMED against the corrected text. No test file or test count changed — only the PR
   description.
2. **PR #112's `pnpm -r test` claim was initially unverifiable** at current `HEAD` (subsequent
   commits had changed counts) — owner chose to verify against the historical commit rather than
   accept it unproven. Checked out PR #112's merge commit in detached HEAD, ran `pnpm -r test`
   (403/403 api, 372/372 web — exact match to the claim), returned cleanly to `main`. Now CONFIRMED.

## Chain Strategy Applied

Nine code-bearing work units (Phase 1–8, split into 10 PR-sized slices per the tasks.md Suggested
Work Units table, plus PR10 cleanup) split into a **stacked-to-main delivery chain** — each slice
merged to `main` independently as soon as ready, no feature-branch accumulator, matching the
owner-decided chain strategy recorded in `tasks.md`'s Review Workload Forecast. Ten PRs merged
(#105–#114). Review budget risk was forecast **High** (~4000–5500 estimated changed lines across
13 planned slices); actual delivery used 10 slices, each independently reviewable and rollback-able
per the Suggested Work Units table's rollback boundaries.

## Archive Completion Checklist

- [x] Main specs updated correctly (point-of-sale, pos-ui created with byte-identical copy)
- [x] Change folder moved to archive (`git mv`, source removed, `diff -r` verified empty)
- [x] Archive contains all artifacts (proposal, specs, design, tasks, verify-report,
      claims-report, exploration)
- [x] Archived tasks.md has no unchecked implementation tasks (35/35 ticked, one exceptional
      pre-approved reconciliation for task 9.1 documented above)
- [x] Active changes directory no longer has this change
- [x] Verbatim `diff -r` readback output included and empty (no differences) — see Specs Promoted
      to Main and Change Folder Moved to Archive sections above
- [x] Task Completion Gate passed (with documented exceptional reconciliation)
- [x] Native Review Gate: not applicable (no review started)
- [x] `docs/BACKLOG.md` row 7 flipped to `✅ Archivado` (task 9.1)

## SDD Cycle Complete

**The change has been fully planned, implemented, verified, and archived.**

**What ships**: A complete point-of-sale flow — catalog browsing with stock-aware cart, multi-item
multi-payment sale confirmation with server-side price and stock authority, atomic
ventas/items_venta/pagos/movimientos writes with deterministic write order, and a persistent
localStorage cart that survives reloads and expires after 4 hours of inactivity.

**Ready for**: Next backlog item. `docs/BACKLOG.md` lists backlog #8 (Recibo interno) and #9
(Anulación de venta) as depending on #7, both now unblocked; #10 (Motor de alertas) and #12
(Reportes) also depend on #7 alongside #6.

**Archive created**: 2026-08-31
**Specs promoted**: 2 (point-of-sale, pos-ui)
**Tests passing**: 922 (api unit 403, web unit 375, api integration 144)
**PRs merged**: 10 (#105–#114)
**Claims verified**: 50/50 confirmed, 0 refuted, 0 unverifiable

---

*This report is the terminal record of the punto-de-venta change cycle. It was written during the
sdd-archive phase and reflects final state at close, per the Archive Final-State Authority
contract. Cross-checked against `verify-report.md` (#221) and `claims-report.md`: no contradiction
found between the two — see "Intermediate Snapshot vs. Final State — Contradiction Check" above.*
