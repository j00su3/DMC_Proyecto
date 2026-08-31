# Claims Report: punto-de-venta

**Verified revision:** `82b5be3562736e22596b14604d0989bfb9c1cea8`
**Verified on:** 2026-08-31
**Sources:** verify-report.md, tasks.md, PR #105, #106, #107, #108, #109, #110, #111, #112, #113, #114 (bodies and commits)

Note: `archive-report.md` does not exist yet for this cycle (sdd-archive has not run), so claims
were extracted only from `verify-report.md`, `tasks.md`'s `[x]` checkboxes, and the 10 merged PR
bodies/commits. `docs/SECURITY.md`, `docs/DRIFT.md` and `docs/DEPLOY-PLAN.md` were checked for
citations into files this cycle touched; none were found (`docs/DRIFT.md:474` mentions the prior
absence of `ventas`/`items_venta`/`pagos` in `schema.ts` only as documented, already-acknowledged
planned scope — not a line citation whose truth this cycle could invalidate — so it was not
extracted as a claim).

| # | Claim (verbatim) | Source | How it was proven | Verdict |
| --- | --- | --- | --- | --- |
| 1 | "pnpm -r test \| api: 30/30 files, 403/403 tests passed. web: 56/56 files, 375/375 tests passed." | verify-report.md:33 | ran `pnpm -r test` | CONFIRMED |
| 2 | "pnpm typecheck \| api + web: clean, Done for both." | verify-report.md:34 | ran `pnpm typecheck` | CONFIRMED |
| 3 | "pnpm lint (biome ci .) \| Clean, 274 files checked, no fixes applied." | verify-report.md:35 | ran `pnpm lint` | CONFIRMED |
| 4 | "pnpm contract:check \| Clean, regenerated openapi.json/schema.d.ts produced zero diff against the committed index." | verify-report.md:36 | ran `pnpm contract:check` | CONFIRMED |
| 5 | "pnpm db:up + pnpm test:integration \| ... 16/16 files, 144/144 tests passed." | verify-report.md:37 | ran `pnpm db:up` then `pnpm test:integration` | CONFIRMED |
| 6 | "Confirmed live: docs/BACKLOG.md row 7 still reads Pendiente in the backlog table." | verify-report.md:24-27 | read docs/BACKLOG.md:25-42 | CONFIRMED |
| 7 | Inverting the `<`/`>=` payment-sum guard in `service.ts` fails the `PAYMENT_BELOW_TOTAL` test; revert restores green | tasks.md:155-161 | mutated `service.ts:209`, ran `pnpm --filter api test ventas/service` (8/17 failed), reverted, re-ran (17/17) | CONFIRMED |
| 8 | Disabling `ordenarItems`'s `.sort()` fails the call-order assertion; revert restores green | tasks.md:162-167 | mutated, ran suite (15/17 failed), reverted, re-ran (17/17) | CONFIRMED |
| 9 | Removing `pagos_vuelto_solo_efectivo` CHECK makes `pnpm db:generate` emit a migration diff dropping it; revert restores zero diff | tasks.md:168-177 | mutated schema.ts, ran `db:generate` (diff produced), reverted, re-ran (zero diff) | CONFIRMED |
| 10 | Setting `CART_TTL_MS` to `Infinity` fails 1/82 web/features/pos tests (TTL-boundary test); revert restores 82/82 | tasks.md:178-190 | mutated storage.ts, ran suite (1/82 failed), reverted, re-ran (82/82) | CONFIRMED |
| 11 | "routes/ventas.ts lines 160,195: both POST /api/ventas and GET /api/ventas/catalogo declare config.roles = [encargado, deposito]." | verify-report.md:48 | read apps/api/src/routes/ventas.ts | CONFIRMED |
| 12 | "ventas/service.ts:210 paymentBelowTotal guard" | verify-report.md:49 | read apps/api/src/ventas/service.ts:209-210 | CONFIRMED |
| 13 | "db/schema.ts:367 CHECK pagos_vuelto_solo_efectivo" | verify-report.md:50 | read apps/api/src/db/schema.ts:367-368 | CONFIRMED |
| 14 | "db/schema.ts:364 unique index pagos_venta_id_medio_unique; service.ts:123 paymentMediumDuplicated app-level guard-first." | verify-report.md:51 | read schema.ts:364, service.ts:121-124 | CONFIRMED |
| 15 | "service.ts Pass A re-reads productos.precio per item before computing total" | verify-report.md:52 | read service.ts:137-177 | CONFIRMED |
| 16 | "service.ts:172 priceChanged(mismatches); web errorMessages.ts:46 maps PRICE_CHANGED" | verify-report.md:53 | read service.ts:172, errorMessages.ts:46 | CONFIRMED |
| 17 | "ventas.integration.test.ts:138 asserts zero new rows across all tables on last-item shortfall." | verify-report.md:54 | read ventas.integration.test.ts:138,234-237 | CONFIRMED |
| 18 | "db/schema.ts:272-306 sequence and unique index; ventas.integration.test.ts:138-272 explicitly asserts and documents the gap ... matching design.md D7." | verify-report.md:57-58 | read schema.ts:272-306, ventas.integration.test.ts:138-275 | CONFIRMED (cited end line 272 is a few lines short of the test's real closing brace at 275; substance accurate) |
| 19 | "productos/repository.ts:108-127 soloActivos opt plus CatalogoGrid.tsx and its test suite." | verify-report.md:59 | read productos/repository.ts:108-127; confirmed CatalogoGrid.tsx/.test.tsx exist | CONFIRMED |
| 20 | "All 6 D12/RECONCILE-1 wire codes ... confirmed present in apps/api/src/lib/errors.ts:267-335, wired into ventas/service.ts ..., and mapped ... in apps/web/src/features/pos/errorMessages.ts:46-60." | verify-report.md:61-66 | read errors.ts:265-339, service.ts, errorMessages.ts:46-60 | CONFIRMED |
| 21 | "/pos under shellLayout (not encargadoLayout) per routes/pos.tsx and routeTree.ts; route test covers deposito access." | verify-report.md:72 | read pos.tsx:22, routeTree.ts:33,37-41, pos.test.tsx | CONFIRMED |
| 22 | "Cart merges duplicate lines (PD-3) \| carrito.ts reducer and carrito.test.ts." | verify-report.md:73 | read carrito.ts:52-82 | CONFIRMED |
| 23 | "localStorage persistence per user/device \| storage.ts, versioned envelope inventienda.pos.carrito.v1.usuarioId." | verify-report.md:74 | read storage.ts:18 | CONFIRMED |
| 24 | "Corrupt data does not crash \| storage.ts try/catch plus Zod safeParse fallback to empty cart; storage.test.ts." | verify-report.md:75 | read storage.ts:36-71 | CONFIRMED |
| 25 | "Cart clears on confirm or explicit empty (PD-9) \| useConfirmarVenta and CarritoPanel.tsx empty-cart action; covered by hook and RTL tests." | verify-report.md:76 | read useConfirmarVenta.ts:38-41, CarritoPanel.tsx:50-57 | CONFIRMED |
| 26 | "Price mismatch requires explicit re-confirm (PD-6) \| useConfirmarVenta keeps sale open on PRICE_CHANGED; PR9 full-flow route test." | verify-report.md:78 | read useConfirmarVenta.ts, pos.test.tsx third test | CONFIRMED |
| 27 | "Multi-payment, one row per medio (PD-1/PD-7) \| PagoPanel.tsx and tests." | verify-report.md:79 | read PagoPanel.tsx:111-137 | CONFIRMED |
| 28 | "Vuelto shown only on cash entry (PD-2) \| PagoPanel.tsx and tests." | verify-report.md:80 | read PagoPanel.tsx:97-101,221-223 | CONFIRMED |
| 29 | "Fixed two-pane layout \| routes/pos.tsx grid ratio 1.2fr to 460px per design.md:93." | verify-report.md:81 | read pos.module.css:3, design.md:93, pos.tsx:16 | CONFIRMED |
| 30 | "PD-10 ... ventas/service.ts:198 cashlessPaymentMustMatchTotal(); comment at line 193 cites RECONCILE-1 and PD-10 explicitly." | verify-report.md:87 | read service.ts:193,197-198 | CONFIRMED |
| 31 | "PD-11 ... ventas/service.ts:116 duplicateSaleItem()." | verify-report.md:88 | read service.ts:114-117 | CONFIRMED |
| 32 | "PD-12 ... productos/repository.ts:125-127 orderBy asc(productos.nombre), asc(productos.id) on the soloActivos path." | verify-report.md:89 | read repository.ts:125-129 | CONFIRMED |
| 33 | "PD-13 ... carrito.ts:60,90 guard where requested quantity exceeds producto.stockActual; docblock cites PD-13 directly." | verify-report.md:90 | read carrito.ts:5-10,60,90 | CONFIRMED |
| 34 | "PD-14 ... storage.ts:10 CART_TTL_MS equals 4 hours in ms; savedAt rewritten on every write (line 80); TTL check at line 65." | verify-report.md:91 | read storage.ts:10,65,80 | CONFIRMED |
| 35 | "D1 ... apps/api/src/lib/dinero.ts and apps/web/src/lib/dinero.ts byte-identical twins, both test-vectored." | verify-report.md:98 | ran `diff` (empty); ran both dinero test suites (40/40 each) | CONFIRMED |
| 36 | "D6 ... subtotal CHECK items_venta_subtotal_igual_precio_por_cantidad at schema.ts:341-344." | verify-report.md:100 | read schema.ts:341-344 | CONFIRMED |
| 37 | "D8 ... FK movimientos.venta_id references ventas.id, onDelete restrict): schema presence confirmed." | verify-report.md:102 | read schema.ts:220-222 | CONFIRMED |
| 38 | "D9 (no FIELD_CLASSIFICATION key for ventas): consistent with the design File Changes list stating auditoria files are not modified; no contradicting evidence found." | verify-report.md:103 | read apps/api/src/auditoria/fields.ts:20-60 (no `ventas` key) | CONFIRMED |
| 39 | "D10 ... schema.ts having venta_estado and pago_estado enums without anulacion columns." | verify-report.md:104 | read schema.ts:261,263,297-299 | CONFIRMED |
| 40 | "D15 (cart price snapshot used as display and as precioUnitarioEsperado): consistent with carrito.ts fields present." | verify-report.md:109 | read carrito.ts, PagoPanel.tsx:149, CarritoPanel.tsx | CONFIRMED |
| 41 | "git show --stat 30b97d8 (the PR10 commit) shows only tasks.md changed (82 insertions, 2 deletions); no production file has a net diff from this commit." | verify-report.md:115-121 | ran `git show --stat 30b97d8` | CONFIRMED |
| 42 | "apps/web/src/lib/dinero.ts: byte-identical twin (verified with diff) ... Shared vector table, 40 test cases per workspace." | PR #105 body | ran `diff`; ran both dinero test suites (40/40 each) | CONFIRMED |
| 43 | "pnpm db:generate run twice. Second run: 'No schema changes, nothing to migrate'. pgSequence round-tripped cleanly ..." | PR #106 body | ran `pnpm --filter api db:generate` twice against current (unchanged since PR2) schema.ts | CONFIRMED (proxy: current schema unchanged since original PR, reproduces same outcome) |
| 44 | "ORDER BY nombre asc, id asc is applied only when soloActivos=true -- the admin GET /api/productos keeps its existing creadoEn desc order untouched." | PR #108 body | read repository.ts:125-129; grepped `soloActivos` in routes/productos.ts (no matches) | CONFIRMED |
| 45 | "17 new RTL tests (5 CatalogoGrid + 6 CarritoPanel + 6 PagoPanel; corrected 2026-08-31 per claims-gate finding — original PR description overcounted by one)." | PR #112 body (corrected) | ran each test file (5/5, 6/6, 6/6 = 17); PR #112 body edited via `gh pr edit` to state 17, re-read to confirm the edit landed | CONFIRMED |
| 46 | "pnpm -r test -- api 403/403, web 372/372" | PR #112 body | checked out PR #112's merge commit `05498d244c762c151a2332e0428fecb28c2b661a` in detached HEAD, ran `pnpm -r test`: api 403/403, web 372/372 — exact match; returned to `main` cleanly (`git status --short` clean except pre-existing untracked reports) | CONFIRMED |
| 47 | "routes/pos.test.tsx: full routeTree + createMemoryHistory, await router.load() before every render. 3 tests -- role gate; add->confirm->cart clears (PD-9) + productosKeys.all invalidated; PRICE_CHANGED blocks the sale until explicit reconfirm (PD-6)." | PR #113 body | read pos.test.tsx in full (3 `it(` blocks matching description) | CONFIRMED |
| 48 | "17 new unit tests against fakes, asserting aplicarDelta call order (producto_id ascending), not just the result." | PR #107 body | `git show --stat` on merge commit (service.test.ts new, 589 lines); counted 17 `it(` blocks incl. explicit call-order assertion | CONFIRMED |
| 49 | "routes/ventas.integration.test.ts (8 tests, real Postgres, real buildApp()/createUnitOfWork(db), failingUow technique matching the proveedores.integration.test.ts/movimientos.integration.test.ts precedent)." | PR #109 body | read ventas.integration.test.ts (8 `it(` blocks, failingUow construction, header cites the precedent) | CONFIRMED |
| 50 | "2.1 apps/api/src/lib/errors.ts: add D12 factories per RECONCILE-1 (codes/statuses above)" | tasks.md:64 | read tasks.md:64 (checkbox marked `[x]`) | CONFIRMED |

**Confirmed:** 50 · **Refuted:** 0 · **Unverifiable:** 0
**Accepted unverifiable:** 0 (none outstanding)

## Corrections applied (owner-directed, 2026-08-31)

Both open items from the initial pass were resolved the same day, on the owner's explicit
direction, before this report's final state:

### 45 — originally REFUTED: "18 new RTL tests."
PR #112's body (`feat(pos): PR8 - catalog, cart and payment panels UI`) originally claimed 18 new
tests across `CatalogoGrid.test.tsx`/`CarritoPanel.test.tsx`/`PagoPanel.test.tsx`; running each file
gave 5/6/6 = 17, confirmed both at current `HEAD` and at the PR's own merge commit via `git show`
(not later drift — the original count was wrong from the moment it was written). Owner chose to
correct the PR body rather than document the error and move on. Edited via `gh pr edit` to read
"17 new RTL tests (5 CatalogoGrid + 6 CarritoPanel + 6 PagoPanel; corrected 2026-08-31 per
claims-gate finding — original PR description overcounted by one)." Re-verified against the
corrected text: now CONFIRMED. No test file or test count changed — only the PR description.

### 46 — originally UNVERIFIABLE: "pnpm -r test -- api 403/403, web 372/372"
Owner chose to verify against the historical commit rather than accept unproven. Checked out PR
#112's merge commit (`05498d244c762c151a2332e0428fecb28c2b661a`) in detached HEAD, ran `pnpm -r
test`: **api 403/403, web 372/372** — exact match to the claim. Returned to `main` cleanly
afterward (`git checkout main`, working tree clean except the pre-existing untracked
`verify-report.md`/`claims-report.md`, neither of which existed at that historical commit). Now
CONFIRMED.

## Verdict

**PASS — gate is GREEN.** Zero REFUTED, zero un-accepted UNVERIFIABLE claims remain. `gh pr merge`
is unblocked for this cycle's closing work (`sdd-archive`).
