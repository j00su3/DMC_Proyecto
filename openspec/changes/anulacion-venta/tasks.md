# Tasks: Anulación de Venta (Backlog #9)

**Change**: `anulacion-venta` · **Artifact store**: hybrid (this file + Engram `sdd/anulacion-venta/tasks`)
**Inputs**: `proposal.md` (PD-1..PD-5), `design.md` (Decisions, File Changes, Interfaces),
`specs/point-of-sale/spec.md`, `specs/recibo-ui/spec.md`.

Strict TDD: every behavior task below is RED (failing test) → GREEN (implementation) → REFACTOR
(if needed). `motivoAnulacion` bound is RATIFIED: `trim().min(3).max(500)`, mirroring
`movimientos.ts`'s `MOTIVO_MIN_LENGTH`/`MOTIVO_MAX_LENGTH` (`apps/api/src/movimientos/service.ts:15`).

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~900–1400 (migration + 2 repo methods + service + route + error factory + 4 web files + tests across both apps) |
| 800-line budget risk | Medium |
| Chained PRs recommended | Yes |
| Suggested split | PR1 (backend: schema+repos+service+route) → PR2 (web: modal+hook+route wiring) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — owner decision needed before apply |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
800-line budget risk: Medium

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Backend anulación write path: schema+migration, `revertirStockPorAnulacion`, `marcarAnulada`/`revertirPagos`, `anularVenta` service, route, error factory, contract regen | PR 1 | `pnpm --filter api test ventas` | `pnpm test:integration` (real PG, rollback + concurrency + A8) | revert migration (`DROP` columns/CHECK), delete new repo/service methods, delete route handler, revert `errors.ts` |
| 2 | Web anulación UI: modal, schema, mutation hook, receipt-route wiring, error copy | PR 2 | `pnpm --filter web test features/recibo` | RTL + MSW route test, `await router.load()` | delete `AnularVentaModal.tsx`/`useAnularVenta.ts`/`schemas.ts` additions, revert `recibo.tsx` trigger, revert `errorMessages.ts` entry |

Backend and web are natural sequential slices (web depends on `pnpm contract`'s regenerated
types from PR1), each independently reviewable and each well under the 800-line budget alone.

---

## Phase 1 — Backend schema & migration (`point-of-sale`)

Sequential; everything downstream depends on this compiling.

- [x] 1.1 `apps/api/src/db/schema.ts`: add `anuladaPor` (FK `usuarios`, `onDelete: 'restrict'`,
  nullable), `anuladaEn` (nullable timestamp), `motivoAnulacion` (nullable text) to `ventas`; add
  CHECK `ventas_anulacion_datos_solo_anulada` tying their presence to `estado = 'anulada'`
  (mirrors `pagos_vuelto_solo_efectivo` idiom, `schema.ts`).
- [x] 1.2 `pnpm db:generate` — create the additive migration under `apps/api/drizzle/`; verify
  every existing row (`confirmada`, 3 NULLs) satisfies the new CHECK.

**Satisfies**: point-of-sale spec "Anulación Reversal Is Atomic..." (data shape),
"Numero Correlativo Is Immutable Across Anulación" (no touch to that column).

## Phase 2 — Backend repository methods (`point-of-sale`)

Depends on: Phase 1.

- [x] 2.1 RED: `apps/api/src/productos/repository.test.ts` — `revertirStockPorAnulacion` reverts
  stock by a positive `cantidad` even when `activo = false`; no `activo` predicate in the query.
- [x] 2.2 GREEN: `apps/api/src/productos/repository.ts` — add `revertirStockPorAnulacion(id,
  cantidad): Promise<number>` (A8-exempt, no `activo = true` guard, `cantidad` positive-only per
  design's anti-backdoor rationale).
- [x] 2.3 RED: `apps/api/src/ventas/repository.test.ts` — `marcarAnulada` returns the updated row
  when `estado = 'confirmada'`, returns `undefined` when not (already `anulada` or missing);
  `revertirPagos` moves every `registrado` pago to `revertido` and returns them.
- [x] 2.4 GREEN: `apps/api/src/ventas/repository.ts` — add `marcarAnulada(input: {ventaId,
  anuladaPor, motivoAnulacion}): Promise<Venta | undefined>` as a conditional UPDATE (`where id =
  :id and estado = 'confirmada'`, sets `anuladaEn` via SQL `now()`); add `revertirPagos(ventaId):
  Promise<Pago[]>` (`where estado = 'registrado'`); extend `Venta` type with the 3 new fields.
  Fix any existing `VentasRepo`/`ProductosRepo` test fakes broken by the new interface methods in
  this same task (mirrors #8's Task 1.2 precedent).

**Satisfies**: point-of-sale spec "Anulación Movements Are Exempt From The Activo/Stock Guards"
(A8), "Anulación On An Already-Anulada Venta Is Refused..." (undefined-return classification
seam), "Anulación Reversal Is Atomic..." (pagos revert).

## Phase 3 — Backend error factory & service (`point-of-sale`)

Depends on: Phase 2.

- [x] 3.1 `apps/api/src/lib/errors.ts`: add `saleAlreadyVoided()` → `AppError`,
  `SALE_ALREADY_VOIDED`, 409 (mirrors `SKU_ALREADY_IN_USE` naming family, no `details`).
- [x] 3.2 RED: `apps/api/src/ventas/service.test.ts` — fakes; `anularVenta` order (transition
  first, then per-item stock reversal + movimiento, then pagos revert); motivo persisted verbatim
  (spec scenario); missing/blank motivo refused before any repo call (`VALIDATION_ERROR`,
  `min(3).max(500)` after trim); `marcarAnulada` returns `undefined` + `findById` absent →
  `saleNotFound()` (404); `marcarAnulada` returns `undefined` + `findById` present →
  `saleAlreadyVoided()` (409, `rechazarVenta` classify-on-undefined precedent); every item and
  every pago reverses together, no partial-selection param exists on the function signature.
- [x] 3.3 GREEN: `apps/api/src/ventas/service.ts` — `anularVenta(uow, {ventaId, actorId,
  motivoAnulacion})`: one `uow.run` — `marcarAnulada` first (serialization point per design), then
  per-item loop (`revertirStockPorAnulacion` + `movimientos.create({tipo: 'anulacion', motivo:
  null, ventaId, cantidad: +qty})`), then `revertirPagos`. No `recordAudit` call (`ventas` is not
  an `AuditableEntidad`, per design decision). The payload-only motivo-bound guard runs directly
  in the service (throws `AppError('VALIDATION_ERROR', ..., 400)`, not via Zod) — this is a
  deviation from the tasks description's "Zod VALIDATION_ERROR" phrasing; see Deviations in the
  final report.

**Satisfies**: point-of-sale spec "Anulación Is Encargado-Only" (service precondition), "Motivo
Anulación Is Mandatory (PD-1)", "No Time Limit On Anulación (PD-2)" (no age check anywhere in the
function), "Anulación Reversal Is Atomic Across Stock, Ledger, Pagos, And Venta State", "Anulación
On An Already-Anulada Venta Is Refused With A Conflict Error", "Anulación Is Total, Not Partial
(v1)".

## Phase 4 — Backend route & contract (`point-of-sale`)

Depends on: Phase 3.

- [x] 4.1 RED: `apps/api/src/routes/ventas.test.ts` — `POST /api/ventas/:id/anular`: 401 no
  session; 403 `rol = deposito` (assert DB unchanged after refusal, per CLAUDE.md); 200 for
  `encargado` with valid body; 400 missing/blank/too-short/too-long `motivoAnulacion`; 404 unknown
  id; 409 already-`anulada` id (assert no second write, per spec's concurrent scenario intent).
- [x] 4.2 GREEN: `apps/api/src/routes/ventas.ts` — register `POST /ventas/:id/anular`, `config: {
  roles: ['encargado'] }` (first encargado-only route in this file), local `idParams`, body `{
  motivoAnulacion: z.string().trim().min(3).max(500) }`, response `{ 200: okVenta, 400/401/403/
  404/409: errorEnvelopeSchema }`; extend `ventaDto` with 3 new nullable fields
  (`anuladaPor`/`anuladaEn`/`motivoAnulacion`).
- [x] 4.3 `pnpm contract` — regenerate `openapi.json`/`schema.d.ts`, stage before `contract:check`.
  `contract:check` passes clean. Collateral: `apps/web/src/features/recibo/Recibo.test.tsx`'s
  fixture needed the 3 new nullable `ventaDto` fields to satisfy the widened generated type —
  `Recibo.tsx` itself is untouched (PD-4), this is a mechanical fixture fix only, not Phase 6/7
  work.

**Satisfies**: point-of-sale spec "Anulación Is Encargado-Only" (route gate).

## Phase 5 — Backend real-DB verification (`point-of-sale`)

Depends on: Phase 4.

- [x] 5.1 `apps/api/src/routes/ventas.integration.test.ts` — full atomic reversal on success
  (2 items, 1 pago: stock restored, 2 `anulacion` movimientos, pago `revertido`, venta `anulada`
  with all 3 fields set); a now-`activo = false` product still reverts stock; a failure injected
  (on `revertirPagos`, the final write) rolls back everything (no stock/pagos/movimientos/state
  change, venta stays `confirmada`); `numeroCorrelativo` unchanged before/after; 403 writes nothing
  (assert DB). Also added `apps/api/src/productos/repository.integration.test.ts`'s A8-exemption
  case (`activo` true/false both revert). Verified against a real local Docker Postgres container
  (`pnpm db:up` + `pnpm db:migrate` with an explicit `DATABASE_URL` env var, never `.env`).
- [x] 5.2 Concurrency test — two anulación requests on the same `confirmada` venta submitted at
  nearly the same time; assert exactly one succeeds (200) and the other gets 409, mirroring
  `aplicarDelta`'s race-guard test shape (ADR-0005 precedent). Passed against real Postgres.

**Satisfies**: point-of-sale spec "Anulación Reversal Is Atomic..." (both scenarios), "Anulación
Movements Are Exempt..." (A8 scenario), "Numero Correlativo Is Immutable...", "Anulación On An
Already-Anulada Venta..." (concurrent scenario).

**Phase 1–5 exit criteria**: `pnpm --filter api test`, `pnpm typecheck`, `pnpm contract:check`
green; `pnpm test:integration` green against Docker Postgres.

---

## Phase 6 — Web data layer (`recibo-ui`)

Depends on: Phase 4 (needs `schema.d.ts` types for the new route/dto fields).

- [ ] 6.1 RED+GREEN: `apps/web/src/features/recibo/schemas.ts` (extend or create) —
  `anularVentaFormSchema`: `motivoAnulacion: z.string().trim().min(3).max(500)`; tests for blank,
  whitespace-only, 2-char, 501-char, and a valid motivo.
- [ ] 6.2 RED+GREEN: `apps/web/src/features/recibo/useAnularVenta.ts` — mutation hook calling
  `POST /api/ventas/:id/anular`; `onSuccess` invalidates `reciboKeys.detail(id)` +
  `productosKeys.all` (design's Data Flow). Test: successful mutate invalidates both keys; server
  error surfaces as an `ApiError`.
- [ ] 6.3 `apps/web/src/features/recibo/errorMessages.ts` — add `SALE_ALREADY_VOIDED` copy
  mapping. RED test: code maps to the new copy; unchanged codes unaffected.

**Satisfies**: recibo-ui spec "Anulación Entry Point On The Venta/Receipt View" (mandatory motivo
input, data-layer half).

## Phase 7 — Web modal & route wiring (`recibo-ui`)

Depends on: Phase 6. This is the last slice — no downstream phase depends on it.

- [ ] 7.1 `apps/web/src/features/recibo/AnularVentaModal.tsx` + `.module.css` (new) — form with
  motivo textarea, submit disabled until valid per `anularVentaFormSchema`, no second
  confirmation step beyond the typed motivo (design's stated working assumption, `MovimientoModal`
  precedent). RED tests: submit blocked with no/blank motivo; valid motivo enables submit and
  calls the mutation.
- [ ] 7.2 `apps/web/src/routes/recibo.tsx` (modify) — render the anulación trigger only when
  `rol === 'encargado' && venta.estado === 'confirmada'`; host `AnularVentaModal`; map
  `SALE_ALREADY_VOIDED`/`VALIDATION_ERROR` through Phase 6.3's error messages. `Recibo.tsx` itself
  is NOT touched (PD-4) — the trigger and modal live only in the route component.
- [ ] 7.3 RED tests, route level (`await router.load()` first, per CLAUDE.md): `encargado` sees
  and can open the trigger on a `confirmada` venta; `deposito` sees no trigger; an `anulada` venta
  shows no trigger; submitting without a motivo does not fire the request; a successful anulación
  reflects `estado = 'anulada'` via `Recibo.tsx`'s existing plain-text field, no new banner/
  watermark/per-pago marker introduced.

**Satisfies**: recibo-ui spec "Anulación Entry Point On The Venta/Receipt View" (all 5 scenarios).

**Phase 6–7 exit criteria**: `pnpm --filter web test`, `pnpm typecheck`, `pnpm lint` green.

---

## Phase 8 — Cleanup

Depends on: Phases 1–7 all green.

- [ ] 8.1 `docs/BACKLOG.md` — flip row 9, deferred to `sdd-archive` per #6/#7 precedent (do not do
  this during apply).
- [ ] 8.2 Release checklist note: `pnpm db:migrate` must run against Neon before/with deploy, same
  manual-migration pattern as #6/#7/#8 (CLAUDE.md Deployment section).
- [ ] 8.3 Mutation-probe the atomicity rollback test (5.1), the A8-exemption query (2.1/2.2), and
  the concurrency guard (5.2) before trusting them — these are the load-bearing, easy-to-fake-green
  assertions in this cycle (CLAUDE.md: "a test you have never seen fail is not evidence").

---

## Dependency Graph

```
Phase 1 (schema/migration)
   │
   ▼
Phase 2 (repo methods, sequential 2.1→2.4)
   │
   ▼
Phase 3 (error factory + service, sequential 3.1→3.3)
   │
   ▼
Phase 4 (route + contract, sequential 4.1→4.3)
   │
   ├──▶ Phase 5 (integration verification, backend-only)
   │
   ▼
Phase 6 (web data layer, sequential 6.1→6.3) — needs Phase 4's regenerated types
   │
   ▼
Phase 7 (modal + route wiring, sequential 7.1→7.3)
   │
   ▼
Phase 8 (cleanup, after everything green)
```

No task in Phase 6/7 touches a file Phase 5 touches — Phase 5 (backend integration tests) may run
in parallel with Phase 6 once Phase 4 is merged, if desired.

## Open Questions Carried Forward (not blocking any task above)

- design.md Open Question 2 (exposing `anuladaPor`/`anuladaEn`/`motivoAnulacion` on `ventaDto`):
  resolved as widened-but-unused — Phase 4.2 adds the 3 fields to `ventaDto` (design's own File
  Changes table requires it for `marcarAnulada`'s return shape to round-trip), but no web task
  renders them (`Recibo.tsx` stays untouched, PD-4). Not a blocker.
- design.md Open Question 3 (no second "¿está seguro?" confirmation step): implemented as designed
  in Phase 7.1 — the typed mandatory motivo is treated as sufficient confirmation, matching
  `MovimientoModal`'s precedent.
