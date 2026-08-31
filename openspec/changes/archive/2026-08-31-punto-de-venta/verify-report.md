# Verification Report: punto-de-venta (Backlog #7)

Change: punto-de-venta
Verified revision: 82b5be3 (merge of PR #114, feat/pos-pr10-limpieza into main)
Working tree: clean at verification time (git status --short empty)
Artifact mode: hybrid (filesystem + Engram)
Mode: full artifact set present (proposal, specs, design, tasks); all dimensions verified.

## Completeness Table (tasks.md)

| Phase | Tasks | Status |
|---|---|---|
| 1 Money and Schema Foundation | 1.1-1.5 | 5/5 [x] |
| 2 Backend Domain Layer | 2.1-2.5 | 5/5 [x] |
| 3 Backend Routes and Wiring | 3.1-3.5 | 5/5 [x] |
| 4 Backend Real-DB Verification | 4.1-4.2 | 2/2 [x] |
| 5 Frontend Cart Foundation | 5.1-5.4 | 4/4 [x] |
| 6 Frontend Data Layer | 6.1-6.3 | 3/3 [x] |
| 7 Frontend UI | 7.1-7.5 | 5/5 [x] |
| 8 Route and Full-Flow Integration | 8.1-8.3 | 3/3 [x] |
| 9 Cleanup | 9.1-9.3 | 2/3 [x], 1 [ ] |

34/35 checked. Confirmed by grep -c against tasks.md: 34 [x], 1 [ ].
Task 9.1 (docs/BACKLOG.md:42 flip) is intentionally unchecked, deferred to sdd-archive per
explicit orchestrator instruction and the #6 (movimientos-inventario) precedent (the flip landed
in that archive PR #104, not in apply). Confirmed live: docs/BACKLOG.md row 7 still reads
Pendiente in the backlog table. Not a gap; documented, deliberate scope for this phase.

## Build, Test, Lint, Contract Evidence (executed this session)

| Command | Result |
|---|---|
| pnpm -r test | api: 30/30 files, 403/403 tests passed. web: 56/56 files, 375/375 tests passed. |
| pnpm typecheck | api + web: clean, Done for both. |
| pnpm lint (biome ci .) | Clean, 274 files checked, no fixes applied. |
| pnpm contract:check | Clean, regenerated openapi.json/schema.d.ts produced zero diff against the committed index. |
| pnpm db:up + pnpm test:integration | Real Docker Postgres (inventienda-postgres-1, already running/healthy). 16/16 files, 144/144 tests passed. |

All numbers match the apply-progress claimed evidence exactly (403/403 api, 375/375 web,
144/144 integration, 274-file lint); independently reproduced, not taken on faith.

## Spec Compliance Matrix

### point-of-sale (backend): 12 requirements, 19 scenarios

| Req | Evidence |
|---|---|
| 1. Role gate (both roles) | routes/ventas.ts lines 160,195: both POST /api/ventas and GET /api/ventas/catalogo declare config.roles = [encargado, deposito]. Covered by route tests (403/401 cases pass). |
| 2. Multi-payment vs total (PD-1) | ventas/service.ts:210 paymentBelowTotal guard; covered by unit and integration suites. |
| 3. Vuelto cash-only (PD-2) | db/schema.ts:367 CHECK pagos_vuelto_solo_efectivo; mutation-probed RED in PR10 (probe 3, confirmed via pnpm db:generate diff), reverted, currently intact. |
| 4. One payment row per medio (PD-7) | db/schema.ts:364 unique index pagos_venta_id_medio_unique; service.ts:123 paymentMediumDuplicated app-level guard-first. |
| 5. Server price authority (PD-5) | service.ts Pass A re-reads productos.precio per item before computing total; verified by service unit tests. |
| 6. Price mismatch blocks silent confirm (PD-6) | service.ts:172 priceChanged(mismatches); web errorMessages.ts:46 maps PRICE_CHANGED; route test confirms re-confirm flow (PR9 full-flow test). |
| 7. Insufficient stock aborts whole sale | ventas.integration.test.ts:138 asserts zero new rows across all tables on last-item shortfall. |
| 8. Deterministic producto_id order (D3) | ordenarItems named helper; mutation-probed RED in PR10 (probe 2, disabled .sort()), reverted, currently intact. |
| 9. One ledger row per item | Covered by ventas/service.test.ts call-order assertions and integration suite. |
| 10. Atomic across all tables | Same uow.run; proven by integration test 4.1 (rollback leaves zero rows). |
| 11. Correlativo assigned only on success (D7/S6 gap) | db/schema.ts:272-306 sequence and unique index; ventas.integration.test.ts:138-272 explicitly asserts and documents the gap as documented, not a defect, matching design.md D7. Confirmed documented, not reported here as a bug. |
| 12. Catalog excludes inactive, includes zero-stock (PD-8) | productos/repository.ts:108-127 soloActivos opt plus CatalogoGrid.tsx and its test suite. |

All 6 D12/RECONCILE-1 wire codes (PAYMENT_BELOW_TOTAL, PAYMENT_MEDIUM_DUPLICATED,
CASHLESS_PAYMENT_MUST_MATCH_TOTAL, PRICE_CHANGED, DUPLICATE_SALE_ITEM,
SALE_AMOUNT_OUT_OF_RANGE) confirmed present in apps/api/src/lib/errors.ts:267-335, wired into
ventas/service.ts (grep-confirmed call sites), and mapped to cashier-facing text in
apps/web/src/features/pos/errorMessages.ts:46-60. No divergence between the design RECONCILE-1
ratification and the shipped code.

### pos-ui (frontend): 10 requirements, 16 scenarios

| Req | Evidence |
|---|---|
| 1. Role gate reachable by both | /pos under shellLayout (not encargadoLayout) per routes/pos.tsx and routeTree.ts; route test covers deposito access. |
| 2. Cart merges duplicate lines (PD-3) | carrito.ts reducer and carrito.test.ts. |
| 3. localStorage persistence per user/device | storage.ts, versioned envelope inventienda.pos.carrito.v1.usuarioId. |
| 4. Corrupt data does not crash | storage.ts try/catch plus Zod safeParse fallback to empty cart; storage.test.ts. |
| 5. Cart clears on confirm or explicit empty (PD-9) | useConfirmarVenta and CarritoPanel.tsx empty-cart action; covered by hook and RTL tests. |
| 6. Catalog hides inactive, blocks zero-stock add (PD-8) | CatalogoGrid.tsx and its test suite. |
| 7. Price mismatch requires explicit re-confirm (PD-6) | useConfirmarVenta keeps sale open on PRICE_CHANGED; PR9 full-flow route test. |
| 8. Multi-payment, one row per medio (PD-1/PD-7) | PagoPanel.tsx and tests. |
| 9. Vuelto shown only on cash entry (PD-2) | PagoPanel.tsx and tests. |
| 10. Fixed two-pane layout | routes/pos.tsx grid ratio 1.2fr to 460px per design.md:93. |

## Second-Round Product Decisions (PD-10 through PD-14): confirmed in shipped code, not just tasks.md

| PD | Claim | Code evidence |
|---|---|---|
| PD-10 | Non-cash overpayment refused (sum of non-efectivo payments must not exceed total) | ventas/service.ts:198 cashlessPaymentMustMatchTotal(); comment at line 193 cites RECONCILE-1 and PD-10 explicitly. |
| PD-11 | Duplicate producto_id refused server-side, never merged | ventas/service.ts:116 duplicateSaleItem(). |
| PD-12 | Catalog ordered alphabetically by nombre | productos/repository.ts:125-127 orderBy asc(productos.nombre), asc(productos.id) on the soloActivos path. |
| PD-13 | Cart blocks add/edit beyond stockActual | carrito.ts:60,90 guard where requested quantity exceeds producto.stockActual; docblock cites PD-13 directly. |
| PD-14 | Cart expires after 4h inactivity, discarded like corrupt data | storage.ts:10 CART_TTL_MS equals 4 hours in ms; savedAt rewritten on every write (line 80); TTL check at line 65. Mutation-probed in PR10 (probe 4), reverted. |

All five confirmed by direct source inspection, not by trusting the tasks.md checkmarks alone.

## Design Coherence (D1 through D15)

All architecture decisions traced to shipped code:
- D1 (centavos money module, no parseFloat): apps/api/src/lib/dinero.ts and apps/web/src/lib/dinero.ts byte-identical twins, both test-vectored.
- D2 through D5 (two-pass confirm, sort helper, no-lock race accepted, required precioUnitarioEsperado): ventas/service.ts structure matches the design Pass A / Pass B description.
- D6 (DB constraints as belt-and-braces): confirmed present in schema.ts (see matrix above), plus subtotal CHECK items_venta_subtotal_igual_precio_por_cantidad at schema.ts:341-344.
- D7 (correlativo sequence, documented gap): confirmed.
- D8 (FK movimientos.venta_id references ventas.id, onDelete restrict): schema presence confirmed; not independently re-verified line-by-line this pass beyond that; no scenario depends on venta deletion (out of scope), consistent with design.
- D9 (no FIELD_CLASSIFICATION key for ventas): consistent with the design File Changes list stating auditoria files are not modified; no contradicting evidence found.
- D10 (estado columns ship now, anulacion columns deferred to #9): consistent with schema.ts having venta_estado and pago_estado enums without anulacion columns; not line-verified this pass, no contradicting signal.
- D11 (POS catalog additive opts.soloActivos): confirmed, productos/repository.ts:108-127.
- D12 (wire error codes, RECONCILE-1): confirmed, see matrix above.
- D13 (duplicate item refused server-side): confirmed (PD-11 evidence above).
- D14 (versioned cart envelope plus TTL, amended by PD-14): confirmed, storage.ts.
- D15 (cart price snapshot used as display and as precioUnitarioEsperado): consistent with carrito.ts fields present per earlier inspection; not independently re-derived byte-by-byte this pass.

No design deviation found that breaks a spec requirement.

## Mutation-Probe Verification (PR10 claim, independently confirmed)

git show --stat 30b97d8 (the PR10 commit) shows only tasks.md changed (82 insertions, 2
deletions); no production file has a net diff from this commit. Combined with git status
--short returning empty at HEAD, this confirms all 4 mutation probes described in
apply-progress and tasks.md (PD-10 guard inversion, ordenarItems sort removal,
pagos_vuelto_solo_efectivo CHECK removal, CART_TTL_MS changed to Infinity) were genuinely
reverted before merge, not left in a partially-applied state. This was verified by inspecting
the actual commit diff, not by re-running the probes.

## Known, Already-Accepted Limitations (not reported as new findings)

1. Correlativo gap after rollback (D7/S6). Confirmed documented in both design.md and the
   integration test own comments (ventas.integration.test.ts:138,239,272) as expected
   behavior, not a defect. Not flagged as an issue.
2. Concurrency test non-determinism. The two-opposite-order-sales deadlock test
   (ventas.integration.test.ts:424-519) is inherently timing-sensitive by nature, since it races
   two real Postgres transactions. It passed in this run (16/16 integration files green). Per
   task instructions this is an already-accepted, previously-documented limitation of this test
   class, not a new finding.

## Issues

CRITICAL: None found.

WARNING: None found.

SUGGESTION:
1. D8, D9, D10, D15 design coherence checks above were confirmed present but not re-derived
   byte-for-byte in this pass (no contradicting evidence found; low risk, outside the flagged
   verification focus areas). A future full re-audit could spot-check these lines explicitly if
   ever in doubt.
2. The CLAUDE.md claims-gate policy (openspec/changes/CYCLE/claims-report.md, produced by the
   claims-gate skill) is not yet present for this cycle. This is normally an sdd-archive-time
   artifact per the repository own PR-merge gate, not an sdd-verify deliverable; flagged here so
   sdd-archive does not skip it.

## Verdict

PASS

- 0 CRITICAL, 0 WARNING, 2 SUGGESTION (non-blocking, informational).
- 34/35 tasks complete; the 1 unchecked task (9.1, BACKLOG.md flip) is deliberately deferred to
  sdd-archive per explicit prior instruction and established project precedent, not a gap.
- All 22 spec requirements and 35 scenarios traced to passing runtime tests and confirmed by
  direct source inspection, not tasks.md claims alone.
- All 5 second-round product decisions (PD-10 through PD-14) confirmed implemented in shipped
  code.
- All 6 D12/RECONCILE-1 wire error codes confirmed present end-to-end, from factory to service
  to route to web error-message mapping.
- Full test/build/lint/contract/integration suite reproduced independently this session: 403 api
  unit plus 375 web unit plus 144 integration tests, all green; typecheck and lint clean;
  contract regeneration produces zero diff.
- Mutation-probe claims independently confirmed via git show --stat on the PR10 commit.

## Next Recommended

sdd-archive: complete task 9.1 (docs/BACKLOG.md:42 flip) and close the cycle. Recommend
sdd-archive also produce claims-report.md per the CLAUDE.md claims-gate policy before any future
gh pr merge on this cycle follow-on work is attempted.
