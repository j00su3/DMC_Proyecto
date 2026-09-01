```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:d25e658244d4bcd42a82a5bb73dbc9f8c14fefbe14d2bbd9beaeb1fbe15fa656
verdict: pass
blockers: 0
critical_findings: 0
requirements: 11/11
scenarios: 24/24
test_command: pnpm --filter api test && pnpm --filter web test
test_exit_code: 0
test_output_hash: sha256:8e11b8b1e86a6a1c87f461b3626b288e6c5504df76d80c8a599139f848251230
build_command: pnpm typecheck
build_exit_code: 0
build_output_hash: sha256:f64dde300fb1f3f58bfe4ad48f31f56d3d630ff1e082fb3d6dbce90fed62d08c
```

## Verification Report

**Change**: recibo-interno (Backlog #8)
**Version**: N/A - 3 spec deltas (point-of-sale, pos-ui, recibo-ui)
**Mode**: Standard (Strict TDD claimed by tasks.md/design.md; RED-first history not independently
re-derived, but every claimed test exists and passes at HEAD)
**Verified revision**: 32b9d7c (merge of PR #120, feat/recibo-pr5-exito, into main)
**Working tree**: clean at verification time (git status --short empty)
**Artifact mode**: hybrid (filesystem + Engram); full artifact set present (proposal, design, 3
spec deltas, tasks) - all dimensions verified.

### Completeness (tasks.md)

| Phase | Tasks | Status |
|---|---|---|
| 1 Backend read path (point-of-sale) | 1.1-1.5 | 5/5 [x] |
| 2 Frontend recibo data layer (recibo-ui) | 2.1-2.4 | 4/4 [x] |
| 3 Receipt route + print surface (recibo-ui) | 3.1-3.3 | 3/3 [x] |
| 4 Correlativo search route (recibo-ui) | 4.1 | 1/1 [x] |
| 5 POS success state (pos-ui) | 5.1-5.2 | 2/2 [x] |

15/15 tasks checked. Confirmed via direct read of tasks.md (grep '\[ \]' returns zero matches).
No unchecked task remains, unlike the prior cycle's deliberate one exception.

### Build & Tests Execution

**Build**: PASSED
```text
$ pnpm typecheck
apps/api typecheck: Done
apps/web typecheck: Done
```

**Tests**: PASSED - api 420/420 (30/30 files), web 408/408 (62/62 files)
```text
$ pnpm --filter api test
 Test Files  30 passed (30)
      Tests  420 passed (420)

$ pnpm --filter web test
 Test Files  62 passed (62)
      Tests  408 passed (408)
```
Web's 408/408 matches tasks.md's Phase 5 self-reported exit-criteria evidence exactly -
independently reproduced this session, not taken on faith. Api's count (30 files, 420 tests) is
higher than punto-de-venta's archived baseline (30 files/403 tests) because 17 new tests landed in
this cycle's Phase 1 (saleNotFound, getRecibo, route-shadowing, role-gate, 404, validation-error
tests) - consistent with Task 1.1-1.4's stated RED-test lists.

**Lint**: PASSED - biome ci ., 288 files checked, no fixes applied.

**Contract**: PASSED - pnpm contract:check (pnpm contract && git diff --exit-code) produced zero
diff against the committed openapi.json/schema.d.ts.

**Coverage**: Not configured in this repo (no coverage threshold gate exists); not applicable.

### Spec Compliance Matrix

#### point-of-sale (backend delta): 4 requirements, 9 scenarios

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Sale Detail Read Path | Encargado retrieves venta confirmed by different cajero | routes/ventas.test.ts role-gate 200 cases | COMPLIANT |
| Sale Detail Read Path | Deposito retrieves any venta by id | routes/ventas.test.ts:658+ role-gate describe block | COMPLIANT |
| Sale Detail Read Path | Nonexistent id returns not-found | routes/ventas.test.ts:748 SALE_NOT_FOUND for id | COMPLIANT |
| Sale Detail Read Path | Item name reflects product's current name | ventas/service.test.ts composes cajero + per-item current names | COMPLIANT |
| Estado Verbatim, No Derived State | Anulada reports estado as-is | ventas/service.test.ts "estado passes through verbatim (D2)" | COMPLIANT |
| Estado Verbatim, No Derived State | Confirmada reports estado as-is | same describe block, confirmada case | COMPLIANT |
| Lookup By Numero Correlativo | Lookup by existing correlativo succeeds regardless of cajero | routes/ventas.test.ts:658+ numero role-gate case | COMPLIANT |
| Lookup By Numero Correlativo | Lookup by nonexistent correlativo, generic not-found | routes/ventas.test.ts:770 SALE_NOT_FOUND for numeroCorrelativo | COMPLIANT |
| Detail Read Path Excludes Store Config | No store identity field in response | okRecibo DTO shape (routes/ventas.ts) has no store field; source-inspected | COMPLIANT |

#### pos-ui (delta): 2 requirements, 5 scenarios

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Cart Clears / Success State Follows | Successful confirmation clears the cart | pos.tsx route tests, existing useConfirmarVenta.onSuccess cart-clear (unchanged, PD-9) | COMPLIANT |
| Cart Clears / Success State Follows | Explicit empty action clears cart without confirming | pos.tsx route-level regression test (Task 5.2) | COMPLIANT |
| Cart Clears / Success State Follows | Success state persists until explicit dismissal | pos.tsx route test, no auto-dismiss/timeout assertion | COMPLIANT |
| Post-Confirmation Success State | Confirmation success shows link to receipt | pos.tsx route test, "Ver recibo" navigates to /ventas/$id/recibo | COMPLIANT |
| Post-Confirmation Success State | "Nueva venta" returns to fresh cart | pos.tsx route test, clears success state + PagoPanel local state (D5) | COMPLIANT |

#### recibo-ui (new capability): 5 requirements, 10 scenarios

| Requirement | Scenario | Test | Result |
|---|---|---|---|
| Printable Receipt Route | Valid id renders receipt | routes/recibo.test.tsx (Task 3.2), renders every PD-2 field | COMPLIANT |
| Printable Receipt Route | Nonexistent id shows generic not-found message | routes/recibo.test.tsx, SALE_NOT_FOUND to generic copy | COMPLIANT |
| Printable Receipt Route | Triggering print invokes native print dialog | routes/recibo.test.tsx, window.print spy on "Imprimir" click | COMPLIANT |
| Estado Plain Text, No Visual Flag | Anulada shows plain-text estado | Recibo.tsx markup has no banner/watermark; route test asserts it | COMPLIANT |
| Estado Plain Text, No Visual Flag | Confirmada shows plain-text estado, same treatment | same, confirmada case | COMPLIANT |
| Receipt Omits Store Identity | No store name/address element present | Recibo.tsx source-inspected: only correlativo/fecha/cajero/estado/items/importe/pagos | COMPLIANT |
| Correlativo Search | Existing correlativo navigates to its receipt | routes/reciboBuscar.test.tsx (Task 4.1), match navigates with replace: true | COMPLIANT |
| Correlativo Search | Nonexistent correlativo shows generic message | routes/reciboBuscar.test.tsx, SALE_NOT_FOUND inline, no navigation | COMPLIANT |
| Correlativo Search | No sales-list affordance offered | routes/reciboBuscar.test.tsx, asserts no list/browse control present | COMPLIANT |
| Receipt Access Is Audit-Style, Not Per-Cajero | Deposito views receipt confirmed by encargado | routes/recibo.test.tsx, deposito-session case (Task 3.2) | COMPLIANT |

**Compliance summary**: 24/24 scenarios compliant (11/11 requirements fully covered).

### Correctness (Static Evidence, cross-checked against passing tests above)

| Requirement/Decision | Status | Notes |
|---|---|---|
| PD-1 (success screen + search, no history screen) | Implemented | pos.tsx success state + /ventas/recibo search; no list/browse route exists anywhere in routes/ |
| PD-2 (field list, no store identity) | Implemented | Recibo.tsx field set matches exactly; no store field anywhere |
| PD-3 (window.print(), no PDF lib) | Implemented | Recibo.tsx:40 onClick calls window.print(); no new runtime dependency added |
| PD-4 (audit-style access) | Implemented | config: roles [encargado,deposito] on both routes, routes/ventas.ts:228,259,284 |
| PD-5 (single generic not-found) | Implemented | One SALE_NOT_FOUND code for both selectors (D2), one generic copy in errorMessages.ts |
| PD-6 (estado plain text, no visual flag) | Implemented | Recibo.tsx:58-61, dd venta.estado, no conditional styling |
| PD-7 (explicit "Nueva venta", no auto-dismiss) | Implemented | pos.tsx state only clears on button click |
| PD-8 (paper-agnostic, no @page size) | Implemented | Recibo.module.css:98-99, @page margin 12mm, no size |
| PD-9 (no auto-print on mount) | Implemented | window.print() only inside the button's onClick, nothing in an effect |
| PD-10 (success screen summary + two controls, no embed) | Implemented | pos.tsx:57,64, "Ver recibo" + "Nueva venta", no Recibo mount on /pos |
| PD-11 (no sidebar entry) | Implemented | AppShell.tsx NAV_ITEMS unchanged, no Ventas/Recibo entry added |
| PD-12 (every pagos row + vuelto on cash row) | Implemented | Recibo.tsx:90-100 maps every pagos row; vuelto shown only when medio is efectivo and nonzero |
| PROD-F (revertido printing) | Explicitly deferred, not resolved | Backend returns every pagos row unfiltered including estado, proven by ventas/service.test.ts:742-759 ("PROD-F, deferred"); presentation explicitly left to backlog #9. Not a gap. |

### Coherence (Design D1-D7)

| Decision | Followed? | Notes |
|---|---|---|
| D1, dedicated numero/:n endpoint, exact match, route-shadowing must be RED test | Yes | routes/ventas.test.ts:625-657 "Route-shadowing" describe block asserts GET /api/ventas/catalogo still resolves to the catalog handler after /ventas/:id registration; passes as part of the 420/420 api suite. Registration order matches D1's intent. |
| D2, SALE_NOT_FOUND, one code for both lookups, thrown by service | Yes | lib/errors.ts saleNotFound(); thrown at ventas/service.ts:313, never in the repository. |
| D3, search on dedicated landing route /ventas/recibo, replace:true navigation | Yes | routes/reciboBuscar.tsx present, sibling of posRoute. |
| D4, both routes under shellLayout, not encargadoLayout | Yes | routes/recibo.tsx:27 and routes/reciboBuscar.tsx:26 both getParentRoute returns shellLayout. |
| D5, no useConfirmarVenta.ts change, success state lifts to pos.tsx, onVentaConfirmada prop | Yes | PagoPanel.tsx onVentaConfirmada prop wired at pos.tsx:87; useConfirmarVenta.ts was touched in PR #120 (commit efbb2e2) only to export `ConfirmarVentaResponse`/`VentaConfirmada` types — no behavioral/runtime change, confirming D5's premise that the hook itself needed no logic change. |
| D6, chrome suppression at AppShell, @page margin only | Yes | AppShell.module.css:114-116 @media print hides .sidebar and .logoutButton; Recibo.module.css:98-99 @page margin 12mm, no size. |
| D7, per-item read, no repo join | Yes | VentasRepo.findItems/findPagos are join-free; ventas/service.ts getRecibo composes item names via per-item ProductosRepo.findById (N+1 accepted, matches confirmarVenta's existing pattern). |

No design deviation found that breaks a spec requirement.

### Cross-Phase / Tasks.md Reconciliation Checks

- RECONCILE-CHECK-1 (SALE_NOT_FOUND, no colliding code): confirmed - lib/errors.ts carries exactly
  one SALE_NOT_FOUND factory, no pre-existing collision.
- RECONCILE-CHECK-2 (cart-clear timing vs success-screen dismissal): confirmed resolved per D5 -
  useConfirmarVenta.ts untouched, mutation.data already exposed pre-cycle; pos.tsx layers the
  success state separately, consistent with the shipped code inspected above.

### Issues Found

**CRITICAL**: None.

**WARNING**: None.

**SUGGESTION**:
1. No claims-report.md exists yet for this cycle (openspec/changes/recibo-interno/). Per the prior
   cycle's (punto-de-venta) precedent and CLAUDE.md's claims-gate policy, this is normally an
   sdd-archive-time deliverable, not an sdd-verify one - flagged here so sdd-archive does not skip
   it. The PreToolUse hook will refuse gh pr merge on this cycle's future follow-on work without it,
   once the cycle reaches verify/archive state.
2. A small number of frontend route-level scenarios (print-dialog trigger, deposito-cross-cajero
   access, no-sales-list-affordance) were confirmed via source inspection of the route test files'
   describe/it structure and the full 408/408 green run, but individual assertion bodies were not
   quoted line-by-line the way Recibo.tsx's markup was. Low risk - the full web suite passed at HEAD
   and tasks.md's per-phase exit criteria (399 to 404 to 408) show the test count growing exactly
   with each phase's stated task list, with no unexplained skips.

### Verdict

PASS

- 0 CRITICAL, 0 WARNING, 2 SUGGESTION (both non-blocking, informational, targeted at sdd-archive).
- 15/15 tasks complete across all 5 phases; no unchecked task remains.
- All 11 spec requirements and 24 scenarios across the 3 deltas (point-of-sale, pos-ui, recibo-ui)
  traced to passing runtime tests and cross-checked by direct source inspection, not tasks.md claims
  alone.
- All 12 product decisions (PD-1..PD-12) confirmed implemented in shipped code at main HEAD
  32b9d7c. PROD-F confirmed explicitly and correctly deferred to backlog #9 - backend returns pagos
  unfiltered (proven by a passing dedicated test), no premature or half-resolved presentation logic
  exists.
- All 7 design decisions (D1-D7) traced to shipped code, including the critical route-shadowing RED
  test (D1), which exists, is registered in the correct order, and passes as part of the green api
  suite.
- Full test/typecheck/lint/contract suite reproduced independently this session: 420 api unit tests
  + 408 web unit tests, all green; typecheck clean for both workspaces; lint clean (288 files, biome
  ci); contract regeneration produces zero diff against the committed index.
- Working tree clean at the verified revision; all 5 PRs (#116-#120) confirmed merged into main via
  git log.

### Next Recommended

sdd-archive: produce claims-report.md per CLAUDE.md's claims-gate policy before any future
gh pr merge on this cycle's follow-on work, then move openspec/changes/recibo-interno/ to
openspec/changes/archive/<date>-recibo-interno/ and promote the recibo-ui capability's spec (and
the point-of-sale/pos-ui deltas) into openspec/specs/.
