# Archive Report: recibo-interno (Backlog #8)

**Change**: `recibo-interno` (Backlog #8 — Receipt internal: on-demand read path for Venta+ItemVenta+Pago, printable view with `window.print()` + `@media print`, searchable by numero_correlativo)

**Archived**: 2026-08-31

**Status**: COMPLETE — Change is archived and closed. All final-state facts are confirmed via native authority and persisted task artifacts.

---

## Archival Summary

### Specs Promoted to `openspec/specs/`

| Domain | Action | Details | Observation ID |
|--------|--------|---------|-----------------|
| `point-of-sale` | Merged into existing | Delta: +4 req/+9 scenarios (ADDED-only); Sale Detail Read Path, Estado Verbatim, Lookup By Numero Correlativo, Detail Path Excludes Store Config. All requirements reuse SALE_NOT_FOUND wire code, settled at design time. | #228 |
| `pos-ui` | Merged into existing | Delta: 1 MODIFIED (Cart Clears / Success State now includes post-confirmation success screen, PD-7) + 1 ADDED (Post-Confirmation Success State — link to `/ventas/:id/recibo`). Migrated OpenQ1 (cart-clear timing ambiguity flagged for owner validation). | #228 |
| `recibo-ui` | Created new | Full capability spec, greenfield, 5 req/10 scenarios. Printable Receipt Route (PD-3, window.print + @media print), Estado Plain Text (PD-6), Receipt Omits Store (PD-2), Correlativo Search (PD-1), Receipt Access Audit-Style (PD-4). | #228 |

**Merge Process**: Performed via direct file edits into main specs using Edit() tool to ensure no byte truncation. source:

- `openspec/specs/point-of-sale/spec.md`: 4 new Requirement blocks inserted before Open Questions section, preserving all pre-existing 10 requirements and their scenarios.
- `openspec/specs/pos-ui/spec.md`: existing "Cart Clears On Confirmed Sale" requirement updated with new PD-7 success-state language and two-scenario expansion; "Post-Confirmation Success State" requirement (PD-1, PD-7) added; Open Questions section expanded from 3 items to 4 (cart-clear timing OQ promoted from delta).
- `openspec/specs/recibo-ui/spec.md`: created new file via mechanical `cp` from `openspec/changes/recibo-interno/specs/recibo-ui/spec.md` to `openspec/specs/recibo-ui/spec.md`.

All merges preserve requirement names, scenarios, and ADDED/MODIFIED designation from the delta artifacts. No requirements removed or destructively altered.

### Change Folder Moved to Archive

```
Source:      openspec/changes/recibo-interno/
Destination: openspec/changes/archive/2026-08-31-recibo-interno/
Verified:    diff -r returned empty (0 differences)
```

Archive contains:
- `proposal.md` (PD-1..PD-7, 7 product decisions binding; 4 Open Questions deferred to design) ✅
- `design.md` (D1..D7, 7 architecture decisions; 6 PROD questions flagged not resolved) ✅
- `specs/{point-of-sale,pos-ui,recibo-ui}/spec.md` (3 delta specs, grounded in proposal + design) ✅
- `tasks.md` (5 phases, 15/15 tasks, all [x] checked) ✅
- `verify-report.md` (verdict: PASS, 0 CRITICAL/WARNING, 2 non-blocking SUGGESTION) ✅
- `claims-report.md` (25/25 claims CONFIRMED, 0 REFUTED/UNVERIFIABLE; PR #121 documentation corrections merged to main) ✅
- `explore.md`, `exploration.md` (reference artifacts) ✅

### Task Completion Gate

**Persisted artifact**: `tasks.md` (15/15 tasks marked [x] — no unchecked implementation task remains).

**Verification**: Confirmed via `grep '\[ \]' openspec/changes/archive/2026-08-31-recibo-interno/tasks.md` returns zero matches (verified at archive time). All phases completed:
- Phase 1 Backend read path (1.1–1.5): SALE_NOT_FOUND error, VentasRepo methods, getRecibo service, routes (GET /ventas/:id + GET /ventas/numero/:numeroCorrelativo with explicit route-shadowing RED test), contract regeneration.
- Phase 2 Frontend recibo data layer (2.1–2.4): queries.ts, useRecibo hook, error message mapping, date formatter.
- Phase 3 Receipt route + print surface (3.1–3.3): Recibo presentational component, print CSS, routes/recibo.tsx.
- Phase 4 Correlativo search route (4.1): routes/reciboBuscar.tsx with /ventas/recibo landing.
- Phase 5 POS success state (5.1–5.2): PagoPanel onVentaConfirmada prop, pos.tsx success screen.

**Status**: PASS — Task Completion Gate satisfied; no stale checkboxes, no blockers for archive.

---

## Final-State Facts (per SKILL.md Final-State Authority Hierarchy)

### 1. Native Review Authority

**Structured status**: No native review transaction exists for this change (receipt-driven development kill switch off for this project). The review gate is structurally absent, and archive proceeds under ordinary repository policy. See `CLAUDE.md` in this project.

### 2. Persisted Tasks Artifact

**Source**: `openspec/changes/archive/2026-08-31-recibo-interno/tasks.md` (final state at archive time).

**Completeness**: 15/15 implementation tasks checked. All phases green per `verify-report.md`'s independent verification run (revision 32b9d7c, merge of PR #120).

### 3. Orchestrator Launch Prompt Facts

**Provided context**: The user specified that this change is complete and verified:
- Implementation: 5 PRs mergeado a main (#116–#120), 5 fases de tasks.md, 15/15 tareas.
- Verification: `sdd-verify` PASS, 0 critical, 0 warning, 2 non-blocking suggestions.
- Claims gate: 25/25 CONFIRMED, 0 REFUTED, 0 UNVERIFIABLE; documentation corrections (PR #121) already merged.

**Final state confirmed**: All 5 PRs are merged to main as of the orchestrator's launch time. No intermediate work remains pending.

### 4. Verify Report (Intermediate Snapshot — Ranked Lower)

**Source**: `openspec/changes/recibo-interno/verify-report.md` (generated 2026-08-31 21:00:58, evidence_revision 32b9d7c, artifact mode hybrid).

**Key facts**:
- Verdict: **PASS** (0 blockers, 0 CRITICAL findings, 0 WARNING, 2 non-blocking SUGGESTION)
- Requirements: **11/11** (point-of-sale 4, pos-ui 2, recibo-ui 5)
- Scenarios: **24/24** (point-of-sale 9, pos-ui 5, recibo-ui 10) — all COMPLIANT
- Tests: api 420/420 (30 files), web 408/408 (62 files), contract:check zero diff
- All PD-1..PD-12 confirmed implemented in shipped code (source-inspected)
- PROD-F (revertido pago row printing) confirmed explicitly deferred to #9, not half-resolved this cycle (proven by ventas/service.test.ts:742–759 "PROD-F, deferred" test)
- All 5 PRs (#116–#120) confirmed merged into main via git log

**Consistency check (no contradiction)**: Verify-report's "PASS, all 24/24 scenarios compliant" is consistent with the final archive fact that all 15 tasks are checked and all product decisions (PD-1..PD-12) are implemented in main at revision 32b9d7c. The two suggestions flagged in verify-report are non-blocking (claims-report production deferred to archive phase per CLAUDE.md; some frontend route assertions via describe/it structure rather than line-quoted) and do not alter the verdict. No contradiction exists.

---

## Engram Observation IDs (Traceability)

Artifacts retrieved and grounded per Section B of `sdd-phase-common.md`:

| Artifact | Engram ID | Topic Key | Scope |
|----------|-----------|-----------|-------|
| Proposal | #227 | sdd/recibo-interno/proposal | decision |
| Spec (3 deltas) | #228 | sdd/recibo-interno/spec | architecture |
| Design | #229 | sdd/recibo-interno/design | architecture |
| Tasks | #231 | sdd/recibo-interno/tasks | architecture |
| Verify Report | #234 | sdd/recibo-interno/verify-report | architecture |

**No review gate observation IDs required** — `reviewGate` is structurally absent (kill switch off).

---

## Key Decisions & Notes

### Architecture

- **D1 (Route shadowing resolved)**: Explicit RED test in Task 1.4 confirmed `GET /ventas/catalogo` (existing) coexists with `GET /ventas/:id` (new parametric) without collision; Fastify's static-vs-parametric resolution is correct as implemented.
- **D2 (Wire code)**: Single `SALE_NOT_FOUND` code for both id-lookup and numero-correlativo-lookup 404s, settling PD-5's requirement for generic, undifferentiated not-found at the wire level.
- **D3 (Search landing)**: Dedicated `/ventas/recibo` route (shellLayout, not parametric) for correlativo search entry point, solving OQ-1 (route shape left open by spec).
- **D4 (Guard placement)**: Both receipt routes under `shellLayout`, not `encargadoLayout`, mirroring the backend role gate (PD-4 audit-style, both roles). No `deposito` cashier will be redirected to `/` on accessing their own sale's receipt.
- **D5 (useConfirmarVenta unchanged)**: Proposal claim that the hook "stops discarding the response" was inaccurate; useMutation already retains mutation.data by default. Success-state lifts to pos.tsx via onSuccess callback; no hook code change required, only component lifecycle change (PagoPanel unmount fixes latent defect of unpersisted local payment state).
- **D6 (Print CSS scope)**: Global body.printing class REJECTED (mutable global state). Per-route `@media print` in AppShell.module.css suppresses chrome; `@page margin 12mm` only (no size, since paper stock unknown); post-print cleanup delegated to browser (no afterprint handler needed for print CSS).
- **D7 (N+1 accepted)**: VentasRepo join-free (4 narrow read methods per item); service composes cajero/product names sequentially. N+1 precedent already in confirmarVenta (ventas/service.ts:137–138). No optimization expected this cycle.

### Product Decisions Confirmed Implemented

All PD-1..PD-12 present in shipped code per verify-report source-inspection:
- **PD-1** (search affordance, no history list): Correlativo search in routes/reciboBuscar.tsx, not expanding to sales browse.
- **PD-2** (no store identity): okRecibo DTO shape has no store field, confirmed at routes/ventas.ts and rendered Recibo.tsx.
- **PD-3** (printable receipt, window.print, no PDF lib): Recibo.tsx + Recibo.module.css with @media print, routes/recibo.tsx, window.print() button.
- **PD-4** (audit-style access, both roles, any cashier): config.roles ['encargado', 'deposito'] on both read routes and receipt route; role gate at pre-handler level (plugins/auth.ts).
- **PD-5** (generic not-found, no distinction): SALE_NOT_FOUND wire code, identical 404 for both id-lookup and numero-lookup failures.
- **PD-6** (estado plain text, no visual flag): Estado rendered as plain text in Recibo.tsx, no banner/watermark, no separate ui.estado field.
- **PD-7** (explicit "nueva venta", no auto-dismiss): pos.tsx success state persists until explicit button click; no timeout/auto-dismiss.
- **PD-9** (cart clears automatically): Already shipped in #7; pos.tsx existing useConfirmarVenta.onSuccess cart-clear unchanged.
- **PD-10** (success state as separate view): pos.tsx success state is a distinct view layered above cart/catalog, dismissed only by explicit action.
- **PD-11** (link to receipt from success state): "Ver recibo" link in pos.tsx success state navigates to `/ventas/:id/recibo`.
- **PD-12** (every pagos row printed): Recibo.tsx renders all pagos entries unfiltered, including vuelto on cash row when nonzero.

### Product Questions Deferred (Not Resolved This Cycle)

Per design.md § "6 product decisions FLAGGED, not resolved":
- **PROD-A**: Target paper stock (thermal roll vs. A4) — determines @page size + narrow layout necessity.
- **PROD-B**: Auto-open print dialog on `/ventas/$id/recibo` navigate (PD-3 doesn't specify).
- **PROD-C**: Embedding vs. linking receipt in success screen (interacts with PROD-B and sidebar entry decision).
- **PROD-D**: Sidebar entry for search (adds to AppShell NAV_ITEMS, which is ratified in docs/design.md).
- **PROD-E**: Receipt prints every pago medio and vuelto (PD-12 says list all pagos; #7 ships multi-payment + vuelto on cash, but decision is ours).
- **PROD-F**: Revertido pago rows printing when #9 ships (PD-6 covers Venta.estado only; pagos.estado separate axis) — **explicitly deferred to #9 per verify-report**.

All PROD questions are intentional gaps, not oversights, and have been flagged for future cycles.

### Size & Delivery

- **Estimated scope** (proposal): ~800–1400 lines, 4–6 rebanadas. **Actual delivered**: 5 PRs (#116–#120), 15 tasks across 5 phases, ~1400 lines gross (api + web + test code + migrations).
- **Review strategy**: Chained/stacked 5 PRs per phase, each autonomous. Recommendation: **5 independent PRs rather than 1 monolithic** (aggregate ~1400 lines approaches session review budget even though individual phases stay well under per-PR ceiling).
- **Build & tests**: `pnpm typecheck` pass, `pnpm -r test` pass (api 420 + web 408), `pnpm contract:check` pass (zero diff), `pnpm lint` pass (288 files, no fixes).

---

## Risks & Gaps

### Resolved

- **Route shadowing (D1)**: Explicit RED test in routes/ventas.test.ts:625–657 confirms ordering is correct.
- **Cart-clear timing (OQ1, moved to pos-ui spec)**: Resolved via D5 (cart data clears immediately, success screen separate view, "nueva venta" only clears screen state). Validated against actual code (pos.tsx/PagoPanel.tsx).
- **Wire code uniqueness (RECONCILE-CHECK-1)**: SALE_NOT_FOUND checked against errors.ts, no collision exists.
- **Spec/design alignment (RECONCILE-CHECK-2)**: PD-9 vs. PD-7 cart-clear timing already resolved in design.md D5.

### Outstanding (Product, Not Technical)

- **PROD-A..F**: Six product questions deferred to future cycles (primarily #9). None are implementation blockers; all are design-level choices that can be made independently or layered later.

### Not This Cycle (Out of Scope)

- Full sales-history/browse screen (backlog #9+ or future).
- Anulación itself (backlog #9).
- Server-side PDF generation (rejected per PD-3; window.print() is the chosen mechanism).
- Store configuration / multi-location support (out of scope per PD-2; no such entity exists).

---

## SDD Cycle Stats

| Phase | Deliverable | Status | Evidence |
|-------|-------------|--------|----------|
| Propose | proposal.md (PD-1..PD-7 + 4 OQ) | ✅ Complete | Engram #227, filed 2026-08-31 16:39 |
| Spec | 3 delta specs (point-of-sale, pos-ui, recibo-ui) | ✅ Complete | Engram #228, filed 2026-08-31 16:52 |
| Design | design.md (D1..D7 + 6 PROD questions) | ✅ Complete | Engram #229, filed 2026-08-31 16:56 |
| Tasks | tasks.md (5 phases, 15 tasks) | ✅ Complete | Engram #231, filed 2026-08-31 17:31 |
| Apply | 5 PRs (#116–#120) merged to main | ✅ Complete | git log, reviewed with claims-gate |
| Verify | verify-report.md (PASS, 0 CRITICAL) | ✅ Complete | Engram #234, filed 2026-08-31 21:00 |
| Archive | This report, specs promoted, change folder archived | ✅ Complete | 2026-08-31 (this session) |

---

## Conclusion

The `recibo-interno` (Backlog #8) change has been fully planned, implemented, tested, verified, and archived. All final-state facts are confirmed:

✅ **Proposal**: 7 binding product decisions, 4 open questions deferred to design.
✅ **Spec**: 3 delta specs (point-of-sale +4, pos-ui +2, recibo-ui +5 new requirements), 24 scenarios total, all grounded in proposal.
✅ **Design**: 7 architecture decisions, 6 product questions flagged (not resolved), all routing/wire decisions settled.
✅ **Tasks**: 15 implementation tasks across 5 phases, all checked and verified green.
✅ **Delivery**: 5 PRs merged to main (#116–#120), all code live, tests passing (420 api + 408 web unit).
✅ **Verification**: PASS verdict, 11/11 requirements, 24/24 scenarios compliant, 0 CRITICAL/WARNING findings.
✅ **Claims**: 25/25 confirmed, 0 refuted, documentation corrections merged (PR #121).
✅ **Specs promoted**: point-of-sale (merged), pos-ui (merged), recibo-ui (created new).
✅ **Backlog updated**: Item #8 marked complete; PROD-F noted deferred to #9.

No contradictions between intermediate snapshots (`verify-report`) and final state. All product decisions are live in main at the verified revision. This cycle is closed and ready for the next backlog item.

---

**Persisted to Engram as**: `sdd/recibo-interno/archive-report`
**Topic Key**: `sdd/recibo-interno/archive-report`
**Artifact Mode**: hybrid (filesystem + Engram)
**Archive Date**: 2026-08-31
