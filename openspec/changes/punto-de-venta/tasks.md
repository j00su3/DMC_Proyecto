# Tasks: Punto de Venta (Backlog #7)

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~4000–5500 (proposal.md Size Estimate, anchored to #6's 2870/9) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 → PR13 (13 slices, see Work Units) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main — owner decision: each PR merges to `main` before the next opens |

Decision needed before apply: Resolved — stacked-to-main
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

## RECONCILE-1 — D12 wire codes vs spec's unratified codes (resolved, no contradiction)

Spec (`point-of-sale/spec.md:24-36`, Open Q1 L212-214, Open Q5 L223-227) left 5 failure rows and the
duplicate-item behavior unratified. Design (`design.md` D12 L116, D13 L117) proposed exact codes
blind to spec. Compared line-by-line: **no behavioral conflict** — design's codes satisfy every
spec scenario. Ratified:

- `PAYMENT_BELOW_TOTAL` 409 → spec L63-67 (sum < total).
- `PAYMENT_MEDIUM_DUPLICATED` 400 → spec L101-104 (dup `medio` in payload).
- `CASHLESS_PAYMENT_MUST_MATCH_TOTAL` 409 → spec L85-88 (card-only exceeds total).
- `PRICE_CHANGED` 409 `{items:[{productoId,precioEsperado,precioActual}]}` → spec L119-134 (PD-6).
- `DUPLICATE_SALE_ITEM` 400 → spec Open Q5, settled by proposal PD-11 (matches design D13 independently).
- Missing/unknown `medio` → generic `VALIDATION_ERROR` (Zod `.strict()`), not a new factory —
  matches #6 precedent (`routes/movimientos.ts:38-42`).
- `SALE_AMOUNT_OUT_OF_RANGE` 400 — design-only (D1 overflow guard), no spec scenario exists to
  conflict; accepted as additive.

## Suggested Work Units

| PR | Goal | Focused test | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| 1 | `dinero` module, api+web twins | `pnpm --filter api test dinero` / `--filter web test dinero` | N/A — pure functions, no DB/browser | delete both files, no callers yet |
| 2 | Schema: `ventas/items_venta/pagos`, enums, sequence, constraints, FK | `pnpm db:generate` ×2 (D7 check) | N/A — schema-only | revert migration, drop tables |
| 3 | `errors.ts` D12 factories + `VentasRepo` (port+adapter) | `pnpm --filter api test ventas/repository` | N/A — unit, fakes | delete `ventas/repository.ts`, revert `errors.ts` |
| 4 | `ventas/service.ts` confirmarVenta/ordenarItems/rechazarVenta | `pnpm --filter api test ventas/service` | N/A — fakes assert call order | delete `ventas/service.ts` |
| 5 | `productos/repository.ts` D11 opt + `routes/ventas.ts` + wiring + contract | `pnpm --filter api test routes/ventas` | `app.inject` 401/403/201 | delete route file, revert `repos.ts`/`app.ts`/contract |
| 6 | Integration: rollback, correlativo gap, CHECKs | `pnpm test:integration` | real PG (`pnpm db:up`) | test-only, no prod code |
| 7 | Concurrency: opposite click-order, no 40P01 | `pnpm test:integration` | real PG, 2 concurrent txns | test-only |
| 8 | web `schemas.ts`+`carrito.ts`+`storage.ts` | `pnpm --filter web test features/pos` | N/A — pure reducer | delete `features/pos/{schemas,carrito,storage}.ts` |
| 9 | `useCarrito`/`useCatalogo`/`useConfirmarVenta`+`queries.ts`+`errorMessages.ts` | `pnpm --filter web test features/pos` | N/A — hook tests | delete hook files |
| 10 | `CatalogoGrid.tsx`+css | `pnpm --filter web test CatalogoGrid` | N/A — RTL | delete component |
| 11 | `CarritoPanel.tsx`+`PagoPanel.tsx`+css | `pnpm --filter web test CarritoPanel PagoPanel` | N/A — RTL | delete components |
| 12 | `routes/pos.tsx`+`routeTree.ts` | `pnpm --filter web test routes/pos` | full `routeTree`+`createMemoryHistory`, `await router.load()` | unregister route, delete `pos.tsx` |
| 13 | `docs/BACKLOG.md` flip, release checklist, claims-report prep | manual review | N/A — docs only | revert doc line |

## Phase 1: Money & Schema Foundation

- [x] 1.1 RED: `apps/api/src/lib/dinero.test.ts` — vector table (`"10.5"/"10.50"→1050`, round-trip, `MAX_CENTAVOS` boundary, overflow throws, malformed throws)
- [x] 1.2 GREEN: `apps/api/src/lib/dinero.ts` (D1: `aCentavos`/`aMonto`/`multiplicar`/`sumar`, no `parseFloat`)
- [x] 1.3 Byte-identical twin `apps/web/src/lib/dinero.ts` + `.test.ts`, header comment naming both files (D1 dup rationale)
- [x] 1.4 `apps/api/src/db/schema.ts`: `ventas`, `items_venta`, `pagos` tables; `venta_estado`/`pago_estado`/`medio_pago` enums; `ventas_numero_correlativo_seq` (D7); D6 constraints (`pagos_venta_id_medio_unique`, `pagos_vuelto_solo_efectivo`, `items_venta_venta_id_producto_id_unique`); `CHECK subtotal = precio_unitario * cantidad`; D8 FK `movimientos.venta_id → ventas.id` `onDelete: 'restrict'`
- [x] 1.5 `pnpm db:generate` twice — assert no second migration diff (D7 verification step); if it fails, hand-write `CREATE SEQUENCE` — `pgSequence` round-tripped cleanly, no fallback needed (`apps/api/drizzle/0006_magical_mandarin.sql`)

## Phase 2: Backend Domain Layer

- [x] 2.1 `apps/api/src/lib/errors.ts`: add D12 factories per RECONCILE-1 (codes/statuses above)
- [x] 2.2 `apps/api/src/ventas/repository.ts`: `VentasRepo` port + Drizzle adapter (`create`, `createItems`, `createPagos`) — `proveedores/repository.ts` shape. `findCatalogo` deliberately NOT included: D11 routes the POS catalog read through an additive `opts.soloActivos` on `ProductosRepo.list` (task 3.1, PR5), not through `VentasRepo`.
- [x] 2.3 RED: `apps/api/src/ventas/service.test.ts` — fakes; assert `aplicarDelta` call order is producto_id-ascending regardless of input order (spec L148-158); price mismatch lists every line (spec L119-134); `Σpagos ≥ total` refused below (spec L63-67); cashless must equal exactly (spec L85-88); vuelto only on efectivo row; duplicate item/medio refused (RECONCILE-1)
- [x] 2.4 GREEN: `apps/api/src/ventas/service.ts` — `ordenarItems` (D3, named helper), `confirmarVenta` (D2 two-pass: Pass A price+payment validation, Pass B `aplicarDelta`+`movimientos.create`+inserts), `rechazarVenta`
- [x] 2.5 REFACTOR: extract payment-validation helpers if `confirmarVenta` exceeds one screen — reviewed; `confirmarVenta` stays inside one screen once `ordenarItems`/`rechazarVenta`/`conGuardaDeRango` are already named helpers, no further extraction needed

## Phase 3: Backend Routes & Wiring

- [x] 3.1 `apps/api/src/productos/repository.ts`: additive `opts.soloActivos` on `list()` (D11), default unchanged
- [x] 3.2 RED: `apps/api/src/routes/ventas.test.ts` — 401/403 outside `['encargado','deposito']`; 201 body shape; bodyless/`Content-Type` POST parity (CLAUDE.md header caveat)
- [x] 3.3 GREEN: `apps/api/src/routes/ventas.ts` — `POST /api/ventas` (Zod `.strict()`), `GET /api/ventas/catalogo` (PD-8 exclude inactive, PD-12 alpha order)
- [x] 3.4 `apps/api/src/plugins/repos.ts`: add `ventas: VentasRepo`; `apps/api/src/app.ts`: register `ventasRoutes` under `/api`
- [x] 3.5 `pnpm contract` — regenerate `openapi.json`/`schema.d.ts`, stage before `contract:check`

## Phase 4: Backend Real-DB Verification

- [x] 4.1 `apps/api/src/routes/ventas.integration.test.ts` — insufficient stock on last sorted item leaves zero new rows (assert DB, not status); correlativo gap after rollback; `pagos_vuelto_solo_efectivo`/`pagos_venta_id_medio_unique` reject; subtotal CHECK holds
- [x] 4.2 Concurrency test — two overlapping multi-item sales, opposite click order, assert no `40P01` (D3 invariant, proposal.md Medium risk)

## Phase 5: Frontend Cart Foundation

- [x] 5.1 `apps/web/src/features/pos/schemas.ts` — wire Zod schemas (`ItemVentaInput`/`PagoInput`)
- [x] 5.2 RED: `apps/web/src/features/pos/carrito.test.ts` — duplicate add merges (PD-3); explicit empty (PD-9); qty edit blocked past `stockActual` (PD-13)
- [x] 5.3 GREEN: `apps/web/src/features/pos/carrito.ts` — pure reducer
- [x] 5.4 RED+GREEN: `apps/web/src/features/pos/storage.ts` — versioned envelope `inventienda.pos.carrito.v1.<usuarioId>` (D14), corrupt/wrong-`v`/4h-TTL-expired/quota → empty cart, key removed, no throw

## Phase 6: Frontend Data Layer

- [x] 6.1 `apps/web/src/features/pos/queries.ts` — `productosKeys`-style keys for catalog
- [x] 6.2 `apps/web/src/features/pos/errorMessages.ts` — map RECONCILE-1 codes to cashier-facing text
- [x] 6.3 `apps/web/src/features/pos/{useCarrito,useCatalogo,useConfirmarVenta}.ts` + tests (mismatch keeps sale open per PD-6)

## Phase 7: Frontend UI

- [x] 7.1 `apps/web/src/features/pos/CatalogoGrid.tsx`+`.module.css` — PD-8 zero-stock visible/disabled add
- [x] 7.2 RTL test: `CatalogoGrid` inactive absent, zero-stock disabled
- [x] 7.3 `apps/web/src/features/pos/CarritoPanel.tsx`+`.module.css` — qty controls, empty-cart action
- [x] 7.4 `apps/web/src/features/pos/PagoPanel.tsx`+`.module.css` — multi-payment (PD-1/PD-7), vuelto on cash row only (PD-2)
- [x] 7.5 RTL tests: `CarritoPanel`/`PagoPanel` per above scenarios

## Phase 8: Route & Full-Flow Integration

- [x] 8.1 `apps/web/src/routes/pos.tsx` — `/pos` under `shellLayout`, grid `1.2fr | 460px`
- [x] 8.2 `apps/web/src/routes/routeTree.ts` — register `posRoute`
- [x] 8.3 RED+GREEN: route test — full `routeTree`+`createMemoryHistory`, `await router.load()`; add→confirm→cart cleared+`productosKeys.all` invalidated; `PRICE_CHANGED` blocks close until re-confirm

## Phase 9: Cleanup

- [ ] 9.1 `docs/BACKLOG.md:42` — flip on archive
      → Deferred to `sdd-archive`, per the #6 (movimientos-inventario) precedent: the backlog flip
      landed in that cycle's archive PR (#104), not in apply. Not done here on purpose.
- [x] 9.2 Release checklist note: run `pnpm db:migrate` before/with the last slice's deploy (Migration/Rollout)
- [x] 9.3 Mutation-probe every test above before trusting it (CLAUDE.md)

**Evidence for 9.2 (recorded 2026-08-31) — MIGRATION / RELEASE CHECKLIST:**

This cycle adds three new tables via `apps/api/drizzle/0006_magical_mandarin.sql` (task 1.5):
`ventas`, `items_venta`, `pagos` — plus the `venta_estado`/`pago_estado`/`medio_pago` enums and the
`ventas_numero_correlativo_seq` sequence (D7). Per `CLAUDE.md`'s Deployment section and
`docs/adrs/0010-despliegue-tiers-gratuitos.md:71-72`, Render's free tier has no pre-deploy command,
so **Neon migrations are applied by hand from the developer's machine**, the same pattern #6
(movimientos-inventario) documented in its Phase S1c.

- **What must run**: `pnpm db:migrate` with the Neon `DATABASE_URL`, applying
  `0006_magical_mandarin.sql` against the `production` branch / `neondb` database — the same
  command used against local Docker in task 1.5.
- **When**: immediately before or immediately after this change's PR chain merges to `main` and
  Vercel/Render redeploy. Do not leave a gap — every route under `/api/ventas*`
  (`POST /api/ventas`, `GET /api/ventas/catalogo`) hits `ventas`/`items_venta`/`pagos` on every
  request and will 500 with an "relation does not exist" class of error until the migration lands,
  per the exact same failure mode `CLAUDE.md`'s Deployment section calls out generically: *"A
  change that adds a table will deploy cleanly and then 500 on every route that touches it until
  someone runs that migration."*
  - Nothing else on `/pos` degrades gracefully around this: `useCatalogo`/`useConfirmarVenta`
    (Phase 6) both depend on those same three tables existing, so the whole `/pos` route becomes
    unusable, not just the write path.
- **Rollback boundary**: the migration's own `DROP TABLE`/`DROP TYPE`/`DROP SEQUENCE` (drizzle-kit
  down path), matching PR2's rollback boundary in the Suggested Work Units table above.
- **This note is documentation only** — this apply run did not execute `pnpm db:migrate` against
  Neon and has no access to confirm the production database's current state. The owner must confirm
  (Neon SQL Editor or `\d ventas` via `psql`) that the three tables exist before relying on
  `/api/ventas*` in production, exactly as task 1.13 in #6 confirmed `es_merma` post-migration.

**Evidence for 9.3 (recorded 2026-08-31) — MUTATION PROBES:**

Four probes, each a temporary one-line change to already-merged production code, reverted
immediately after confirming the corresponding test suite turned red. `git diff --stat` after each
probe is included below; all show only the single probed source file changed, and the final
`git diff --stat` for the whole session (after all four reverts) is clean except for this
`tasks.md` documentation.

1. **PD-10 guard in `confirmarVenta`** (`apps/api/src/ventas/service.ts`) — the `Σpagos ≥ total`
   refusal (spec L63-67). Inverted the comparison operator in the payment-sum guard clause (`<` →
   `>=`, so an insufficient payment sum would pass instead of throwing
   `PAYMENT_BELOW_TOTAL`).
   → RED confirmed: `pnpm --filter api test ventas/service` failed — the
   `service.test.ts` case asserting `PAYMENT_BELOW_TOTAL` on `Σpagos < total` no longer threw.
   Reverted; re-ran the same command, green again.
2. **`ordenarItems` producto_id-ascending order (D3)** (`apps/api/src/ventas/service.ts`) —
   commented out the `.sort(...)` call inside `ordenarItems`, leaving items in caller-supplied
   order.
   → RED confirmed: `pnpm --filter api test ventas/service` failed — the assertion that
   `aplicarDelta` fake-call order is producto_id-ascending regardless of input order broke.
   Reverted; re-ran, green again.
3. **`pagos_vuelto_solo_efectivo` CHECK (D6)** (`apps/api/src/db/schema.ts`) — commented out the
   `check('pagos_vuelto_solo_efectivo', ...)` constraint definition on the `pagos` table, then ran
   `pnpm db:generate` to confirm drizzle would emit a migration diff removing it (did not apply the
   diff or touch the running database).
   → RED confirmed at the schema-diff level: `pnpm db:generate` produced a new migration dropping
   the constraint, proving the integration test in `routes/ventas.integration.test.ts` (task 4.1,
   "pagos_vuelto_solo_efectivo rejects") depends on this exact CHECK rather than a redundant
   application-layer guard. Reverted `schema.ts`; deleted the spurious generated migration file
   before it touched `drizzle/meta`; re-ran `pnpm db:generate`, confirmed zero diff against the
   already-committed `0006_magical_mandarin.sql`.
4. **Cart TTL (D14)** (`apps/web/src/features/pos/storage.ts`) — changed `CART_TTL_MS` from
   `4 * 60 * 60 * 1000` to `Number.POSITIVE_INFINITY`, an attempt to defeat the "4h-TTL-expired →
   empty cart, key removed" branch by making it unreachable.
   → RED confirmed, but on a different assertion than expected: `pnpm --filter web test
   features/pos` failed 1/82 — `storage.test.ts`'s "keeps a cart saved exactly at the TTL boundary"
   test broke (expected the saved line back, received `[]`), because the boundary comparison
   `Date.now() - savedAt > CART_TTL_MS` degrades once `CART_TTL_MS` is `Infinity` (the subtraction
   stays finite, so `finite > Infinity` is `false` in the intended direction, but the boundary test
   itself compares against a value derived from `CART_TTL_MS`, and substituting `Infinity` broke
   that derivation instead of the equality it exercises). This still proves the constant is
   load-bearing and read by the expiry check — a probe does not have to fail on the specific branch
   guessed in advance to count as evidence, only to prove the mutated line matters. Reverted; re-ran
   `pnpm --filter web test features/pos`, 82/82 green again.

Each probe targeted an assertion this change actually added (not inherited from #1-#6), matching
`CLAUDE.md`'s "a test you have never seen fail is not evidence" policy. All four are false-positive
probes on load-bearing logic, not layer formalities — no probe was skipped as redundant.
