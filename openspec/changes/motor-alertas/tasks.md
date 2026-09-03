# Tasks: Motor de Alertas (backlog #10)

**Change**: `motor-alertas` · **Artifact store**: hybrid (this file + Engram `sdd/motor-alertas/tasks`)
**Inputs**: `proposal.md` (PD-1..PD-5), `design.md` (D1-D7, Evaluator Logic, Interfaces, Routes,
Audit Wiring, Frontend, Migration), `specs/alertas/spec.md`, `specs/alertas-ui/spec.md`. All four
formerly-open design questions are owner-ratified 2026-09-02 and binding (D7, evaluator's
`quiebreCruzo` guard, `POST /api/alertas/marcar-vistas`) — not re-decided here.

Strict TDD: every behavior task is RED (failing test) → GREEN (implementation).

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~2600-3300 (new table+migration, `TxControl`, new 3-layer `alertas` domain, 5 call-site diffs, 4 routes, 5 web hooks + 2 components + route wiring, unit+integration+route+web tests) |
| 800-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR1 (foundation: schema/TxControl/AlertasRepo/errors/audit) → PR2 (evaluator + all 4 call sites + C1 proof) → PR3 (service/routes/contract) → PR4 (web) |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main (resolved 2026-09-02) |

Decision needed before apply: No — resolved: stacked-to-main
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
800-line budget risk: High

Rationale: this is the largest change in the project to date per the orchestrator's own framing —
a new table, a new cross-cutting `TxControl`/`SAVEPOINT` capability threaded through `uow.ts`, four
real call-site integrations each needing its own real-Postgres proof (C1), a new 4-route backend
surface, and a full new frontend screen with polling. No single work unit below is estimated near
800 lines alone, but the whole change is 3-4x that.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Foundation: schema/migration, `TxControl` in `uow.ts`, `AlertasRepo` port+adapter, `repos.ts` wiring, error factories, `auditoria/fields.ts` entry | PR 1 | `pnpm --filter api exec vitest run src/alertas/repository.test.ts src/db/uow.test.ts` | N/A — pure unit/repo tests, no route yet | Revert migration, delete `alertas/repository.ts`, revert `uow.ts`/`repos.ts`/`errors.ts`/`auditoria/fields.ts` diffs |
| 2 | Evaluator + wiring into all 4 call sites (`movimientos/service.ts`, `productos/service.ts::crearProducto`+`actualizarProducto`, `ventas/service.ts::confirmarVenta`+`anularVenta`) + C1 injected-error proof | PR 2 | `pnpm --filter api exec vitest run src/alertas/evaluador.test.ts src/movimientos/service.test.ts src/productos/service.test.ts src/ventas/service.test.ts` | `pnpm test:integration` (real PG, Docker) — C1 rollback proof, per-call-site proof, dedup-under-concurrency | Revert the 4 call-site diffs and `alertas/evaluador.ts`; PR1's port/schema stays valid unconsumed |
| 3 | `alertas/service.ts` (list/count/resolve/marcarVistas orchestration) + `routes/alertas.ts` (4 routes) + contract regen | PR 3 | `pnpm --filter api exec vitest run src/alertas/service.test.ts src/routes/alertas.test.ts` | `pnpm test:integration` (RBAC + DB-state-after-403 assertions) | Revert `alertas/service.ts`, delete `routes/alertas.ts`, revert `openapi.json`/`schema.d.ts` regen |
| 4 | Web: data layer (queries/hooks), `AlertasTable`, `routes/alertas.tsx`, `shellLayout.tsx`/`AppShell.tsx` nav+badge wiring | PR 4 | `pnpm --filter web exec vitest run src/features/alertas src/routes/alertas.test.tsx` | RTL + MSW route test, `await router.load()` | Revert `features/alertas/*`, `routes/alertas.tsx`, `routeTree.ts` entry, `shellLayout.tsx`/`AppShell.tsx` diffs; PR1-3 stay valid unconsumed |

---

## Phase 1 — Foundation (`alertas`)

Sequential; everything downstream depends on this compiling.

- [x] 1.1 `apps/api/src/db/schema.ts`: add `alertaTipo` pgEnum (`stock_bajo`, `quiebre`,
  `discrepancia`, `sugerencia_reposicion` — D5, all 4 values from day one) and `alertaEstado`
  pgEnum (`activa`, `vista`, `resuelta`); add `alertas` table (`producto_id` FK restrict,
  `movimiento_id` FK restrict nullable, `resuelta_por` FK `usuarios` restrict nullable,
  timestamps); add the partial unique index `alertas_producto_tipo_abierta_unique` (D4); add
  `'alertas'` to `entidadAuditoria` pgEnum.
- [x] 1.2 `pnpm db:generate` — additive migration; verify `ALTER TYPE … ADD VALUE 'alertas'` is the
  only enum-growth statement and no same-migration statement consumes the new value (design's
  Migration/Rollout note 2).
- [x] 1.3 RED: `apps/api/src/db/uow.test.ts` — `savepoint()` runs `work` and returns its result on
  success; on failure it runs `ROLLBACK TO SAVEPOINT` then `RELEASE SAVEPOINT` and returns
  `undefined`, never re-throwing; the savepoint name is passed through `sql.identifier`, never
  string-interpolated.
- [x] 1.4 GREEN: `apps/api/src/db/uow.ts` — add `TxControl` interface + `createTxControl` (D1/D2
  exact code in design.md); change `UnitOfWork.run`'s callback signature to
  `(repos: Repos, tx: TxControl) => Promise<T>`. Fix any existing `uow.run` caller broken by the
  added second callback parameter in this same task (mirrors #9's Task 1.2 precedent).
- [x] 1.5 `apps/api/src/plugins/repos.ts` — one-line change: `createUnitOfWork(getDb(), app.log)`.
- [x] 1.6 RED: `apps/api/src/alertas/repository.test.ts` — `create` returns `undefined` on conflict
  (dedup, D4); `autoResolve` sets `estado='resuelta'`, `resuelta_por=null`; `manualResolve` sets
  `resuelta_por`; `marcarVistas` transitions every `activa` row and returns the count; `list`
  respects `FiltroAlertas`/pagination; `countAbiertas` counts non-`resuelta` rows.
- [x] 1.7 GREEN: `apps/api/src/alertas/repository.ts` — `AlertasRepo` port + `DrizzleAlertasRepo`
  adapter (exact interface from design.md Interfaces/Contracts); register `alertas` on `Repos` in
  `plugins/repos.ts` and `buildRepos`.
- [x] 1.8 `apps/api/src/lib/errors.ts` — add `alertNotFound()`/`ALERT_NOT_FOUND` (404),
  `alertAlreadyResolved()`/`ALERT_ALREADY_RESOLVED` (409),
  `alertNotManuallyResolvable()`/`ALERT_NOT_MANUALLY_RESOLVABLE` (409).
- [x] 1.9 `apps/api/src/auditoria/fields.ts` — add the `alertas` `FIELD_CLASSIFICATION` entry
  (exact field list from design.md Audit Wiring) to unlock the `AuditableEntidad` compile gate.

**Satisfies**: alertas spec "Alertas Table Schema", "De-Duplication Per Producto And Tipo".

## Phase 2 — Evaluator & call-site wiring (`alertas`)

Depends on: Phase 1.

- [x] 2.1 RED: `apps/api/src/alertas/evaluador.test.ts` — pure evaluator over fake repos: downward
  crossing creates `stock_bajo`/`quiebre`; upward crossing auto-resolves; `stockMinimo=null` never
  fires `stock_bajo`; `stockMinimo=0` fires `quiebre` only, not a redundant `stock_bajo`
  (`quiebreCruzo` guard); `esDiscrepancia=true` creates `discrepancia` regardless of stock math;
  exact-equality boundary cases at `stockResultante === stockMinimo` and `=== 0`.
- [x] 2.2 GREEN: `apps/api/src/alertas/evaluador.ts` — `EvaluadorDeAlertas.evaluar` implementing
  the exact pseudocode in design.md Evaluator Logic; reads only `producto.stockMinimo`, never
  `stockActual`.
- [x] 2.3 `apps/api/src/alertas/service.ts` — internal `registrarSiCorresponde` helper wrapping
  `tx.savepoint('alertas', () => evaluar(...))` per design's exact call shape, for call sites to
  invoke.
- [x] 2.4 RED+GREEN: `apps/api/src/movimientos/service.ts::registrarMovimiento` — invoke the
  evaluator at the existing SEAM (L132-137) after the post-movement `producto` re-read; test
  asserts the evaluator call happens with the re-read product's `stockMinimo`.
- [x] 2.5 RED+GREEN: `apps/api/src/productos/service.ts::crearProducto` — invoke the evaluator
  after `movimientos.create` in the `stockInicial > 0` branch; test asserts no call when
  `stockInicial === 0` (known v1 limitation, documented).
- [x] 2.6 RED+GREEN: `apps/api/src/productos/service.ts::actualizarProducto` (D7) — when the
  update changes `stockMinimo` from non-null to `null`, call `repos.alertas.autoResolve(productoId,
  'stock_bajo')` inside the same `uow.run`, after the product row updates; no `SAVEPOINT` (D7's
  own-safety rationale). Test: non-null→non-null and null→non-null changes do NOT trigger
  auto-resolve.
- [x] 2.7 RED+GREEN: `apps/api/src/ventas/service.ts::confirmarVenta` — invoke the evaluator inside
  Pass B's loop, per item, after each `movimientos.create` (one savepoint per item, D3); test
  asserts item 2's evaluator failure does not block items 1/3 from getting their alerts.
- [x] 2.8 RED+GREEN: `apps/api/src/ventas/service.ts::anularVenta` — invoke the evaluator inside
  the item loop, per item, after each `movimientos.create`; no `tipo === 'anulacion'` special case
  (D3's generic-crossing-rule rationale).
- [x] 2.9 Integration (real Postgres): `apps/api/src/alertas/service.integration.test.ts` — **C1
  acceptance criterion**: inject a SQL error into `alertas.create`, assert the triggering
  movimiento/venta row still exists and commits (per call site, per design's Testing Strategy).
- [x] 2.10 Integration (real Postgres): dedup-under-concurrency — two movements crossing the same
  threshold concurrently produce exactly one alert row (partial unique index, D4).

**Satisfies**: alertas spec "Threshold-Crossing Creation On Downward Edge Only", "Auto-Resolution On
Stock Recovery", "Discrepancia Creation From Flagged Ajuste", "Evaluator Failure Never Rolls Back
The Movement", "Evaluation Triggered At Every Movimiento-Creation Call Site".

**Phase 1-2 exit criteria**: `pnpm --filter api test`, `pnpm typecheck` green; `pnpm test:integration`
green against Docker Postgres.

## Phase 3 — Service orchestration & routes (`alertas`)

Depends on: Phase 2.

- [x] 3.1 RED: `apps/api/src/alertas/service.test.ts` — `listar`/`contarAbiertas` pass through to
  the repo; `resolver` refuses `stock_bajo`/`quiebre` with `alertNotManuallyResolvable()`;
  classify-on-undefined for `resolver` (404 vs 409, `rechazarVenta` precedent); `marcarVistas`
  calls `recordAudit` per resolved alert only when a manual resolve occurs (PD-5 — creation/manual
  resolution audited, not the bulk `marcarVistas` UPDATE, which has no single actor-attributable
  row).
- [x] 3.2 GREEN: `apps/api/src/alertas/service.ts` — `listar`, `contarAbiertas`,
  `resolver(uow, {id, actorId})` (manual resolve, `recordAudit` inside `uow.run`),
  `marcarVistas(uow)`.
- [x] 3.3 RED: `apps/api/src/routes/alertas.test.ts` — `GET /api/alertas` (401/200, `?estado=`
  filter, both roles); `GET /api/alertas/conteo` (both roles); `POST /api/alertas/:id/resolver`
  (401/403 `deposito` with DB-unchanged assertion/200 `encargado`/404/409 already-resolved/409
  non-manually-resolvable type); `POST /api/alertas/marcar-vistas` (both roles, 200 with
  `{marcadas}`).
- [x] 3.4 GREEN: `apps/api/src/routes/alertas.ts` — register all 4 routes with `config: {roles:
  [...]}` per design.md Routes table; standard `{data,page,pageSize,total}` envelope for the list
  route.
- [x] 3.5 `pnpm contract` — regenerate `openapi.json`/`schema.d.ts`; stage before `contract:check`;
  fix any collateral fixture widened by the new types (mirrors #9's Recibo fixture precedent).

**Satisfies**: alertas spec "Manual Resolution Restricted To Encargado", "Both Roles Can View
Alerts", "Alert Create And Resolve Are Audited".

**Phase 3 exit criteria**: `pnpm --filter api test`, `pnpm typecheck`, `pnpm contract:check` green.

## Phase 4 — Frontend (`alertas-ui`)

Depends on: Phase 3 (needs `schema.d.ts` types for the new routes).

- [x] 4.1 RED+GREEN: `apps/web/src/features/alertas/queries.ts` — `alertasKeys` factory,
  `alertasListQueryOptions()`, `alertasConteoQueryOptions()` with `refetchInterval: 60_000` on the
  count options object (PD-4); test asserts the options object's `refetchInterval === 60_000`
  without advancing timers.
- [x] 4.2 RED+GREEN: `useAlertas.ts` (list hook), `useConteoAlertas.ts` (polling count hook).
- [x] 4.3 RED+GREEN: `useResolverAlerta.ts` — mutation invalidating `alertasKeys.all`.
- [x] 4.4 RED+GREEN: `useMarcarVistas.ts` — fires once on mount (route effect, not a user action);
  invalidates `alertasKeys.all` on success.
- [x] 4.5 RED+GREEN: `AlertasTable.tsx` + `errorMessages.ts` — presentational table; resolve
  control hidden for `deposito` (documented UX-affordance-only docblock per CLAUDE.md); code→message
  map for `ALERT_NOT_FOUND`/`ALERT_ALREADY_RESOLVED`/`ALERT_NOT_MANUALLY_RESOLVABLE`.
- [x] 4.6 RED+GREEN: `apps/web/src/routes/alertas.tsx` — screen under `shellLayout`; register in
  `routeTree.ts`; calls `useMarcarVistas()` on mount.
- [x] 4.7 `apps/web/src/routes/shellLayout.tsx` (modify) — `ShellLayoutContainer` calls
  `useConteoAlertas()`, passes the count down.
- [x] 4.8 `apps/web/src/components/ui/AppShell.tsx` (modify) — add `{label: 'Alertas', to:
  '/alertas'}` nav item; add optional `alertasAbiertas?: number` badge prop.
- [x] 4.9 RED tests, route level (`await router.load()` first, per CLAUDE.md): `deposito` reaches
  `/alertas` and sees the list, not a refusal; `deposito` sees no resolve control on a
  `discrepancia` row; `encargado` resolving updates the list to `resuelta`; badge issues a new
  request after 60s (fake timers at the route level, not just hook level).

**Satisfies**: alertas-ui spec "Role Gate — Alert Screen Reachable By Both Roles", "Alert Count
Polled Every 60 Seconds", "Manual Resolve Control Restricted To Encargado".

**Phase 4 exit criteria**: `pnpm --filter web test`, `pnpm typecheck`, `pnpm lint` green.

## Phase 5 — Cleanup

Depends on: Phases 1-4 all green.

- [ ] 5.1 `docs/BACKLOG.md` — flip backlog #10's row, deferred to `sdd-archive` (do not do this
  during apply, per #9's precedent).
- [ ] 5.2 Release checklist note: `pnpm db:migrate` must run against Neon before/with deploy
  (manual-migration pattern, CLAUDE.md Deployment) — the new table 500s every `alertas`-touching
  route, and the movimiento/venta paths themselves, until migrated.
- [ ] 5.3 Mutation-probe the C1 injected-error test (2.9), the dedup-under-concurrency test (2.10),
  and the `savepoint()` rollback path (1.3) against real Docker Postgres — these are the
  load-bearing correctness proofs for this change.

---

## Dependency Graph

```
Phase 1 (schema/TxControl/AlertasRepo/errors/audit)
   │
   ▼
Phase 2 (evaluator + 4 call sites, sequential 2.4→2.8; C1 proof 2.9-2.10)
   │
   ▼
Phase 3 (service + routes + contract)
   │
   ▼
Phase 4 (web, sequential 4.1→4.9) — needs Phase 3's regenerated types
   │
   ▼
Phase 5 (cleanup, after everything green)
```

## Open Questions Carried Forward

None — all four proposal open questions were ratified by the owner (2026-09-02) and are already
binding in design.md (D7, evaluator `quiebreCruzo` guard, `marcar-vistas` route). No task above
reopens them.
