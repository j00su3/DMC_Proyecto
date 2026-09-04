# Tasks: Dashboard KPIs (Backlog #13)

**Change**: `dashboard-kpis` · **Artifact store**: hybrid (this file + Engram
`sdd/dashboard-kpis/tasks`) **Inputs**: `proposal.md` (decisions 1-6, ratified 2026-09-04),
`design.md` (D1-D6, File Changes, Testing Strategy — Threat Matrix is N/A), `specs/dashboard-ui/spec.md`
(7 requirements, 15 scenarios), `specs/app-layout/spec.md` (MODIFIED nav requirement),
`specs/inventory-movements/spec.md` (ADDED read requirement).

**Phase count: 3, not 2.** Unlike #11 (4 files, single PR), this change spans 12 files across two
independently-testable backend repo methods (D1, D2's correction), one aggregation+route layer that
depends on both, and a frontend layer that depends on the route contract existing — three genuine
dependency tiers, not artificial slicing. Strict TDD: every behavior task is RED → GREEN.

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | ~650-800 (2 repo methods + tests ~220, service+route+tests ~230, frontend 5 files+tests ~250, excl. generated contract diff) |
| 400-line budget risk | High (as one PR) / Low per split unit |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (backend) → PR 2 (frontend) |
| Delivery strategy | ask-on-risk (default; not overridden) |
| Chain strategy | stacked-to-main |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Rationale: no migration and no row-level auth (simpler than #12), but 12 touched files and two new
repo methods plus a new service/route push the whole change past 400 lines if reviewed as one PR.
PR 2 genuinely needs PR 1 merged (the route contract), so `stacked-to-main` (not a feature-branch
chain) fits: PR 1 merges to main first, PR 2 branches from post-merge main.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Phases 1+2: `countAbiertasPorTipo`, `listRecientes`, `dashboard/service.ts`, `routes/dashboard.ts`, `app.ts` | PR 1 (base = main) | `pnpm --filter api exec vitest run src/alertas/repository.test.ts src/movimientos/repository.test.ts src/dashboard/service.test.ts src/routes/dashboard.test.ts` | `pnpm test:integration` — real Postgres, both repo methods | Revert `dashboard/service.ts`, `routes/dashboard.ts`, `app.ts` registration line, and both new repo methods; nothing else consumes them |
| 2 | Phase 3: frontend screen, `KpiCard`, `ActividadRecienteList`, `AppShell`/`StatusChip` widening | PR 2 (base = main, post-PR-1) | `pnpm --filter web exec vitest run src/routes/index.test.tsx src/components/ui/AppShell.test.tsx src/components/ui/KpiCard.test.tsx` | N/A — frontend route test against MSW-mocked `GET /api/dashboard/resumen`, per repo convention | Revert `index.tsx` to its placeholder body, `AppShell.tsx`'s `to`, `StatusChip.tsx`'s widening, and the new `KpiCard`/`features/dashboard/*` files |

## Phase 1 — Repo methods (D1, D2's correction)

Independent of each other; both are additive, read-only, no migration.

- [x] 1.1 RED: `apps/api/src/alertas/repository.test.ts` — `countAbiertasPorTipo(tipo)`: counts
  only `estado <> 'resuelta'` rows matching `tipo` (spec "Quiebres counts only quiebre-tipo open
  alerts", "Stock bajo counts only stock_bajo-tipo open alerts"); returns `0`, not `undefined`,
  when none match (spec "Zero open alerts of a tipo shows zero").
- [x] 1.2 GREEN: `apps/api/src/alertas/repository.ts` — add `countAbiertasPorTipo(tipo):
  Promise<number>` mirroring `countAbiertas()`'s exact `estado <> 'resuelta'` predicate plus a
  `tipo` equality (D2's correction — a NEW method, not `list()` reuse).
- [x] 1.3 RED: `apps/api/src/movimientos/repository.integration.test.ts` — `listRecientes(limit)`:
  returns the `limit` most recent rows by `fecha DESC, id DESC`, unfiltered by actor or producto
  (spec "More than 10 movimientos exist", "Not scoped to a single actor"); returns `[]` when none
  exist (D6).
- [x] 1.4 GREEN: `apps/api/src/movimientos/repository.ts` — add `listRecientes(limit):
  Promise<Movimiento[]>` per D1: no `usuarioId` param, `ORDER BY fecha DESC, id DESC LIMIT N`,
  reuses `movimientos_fecha_idx`, no migration.
- [x] 1.5 Integration (real Postgres): both methods above against seeded data, confirming index-only
  scan behavior and the D6 zero-rows edge cases.

**Satisfies**: design D1, D2's correction. Spec (dashboard-ui) "Quiebres And Stock-Bajo Counts Are
Tipo-Specific", "Actividad Reciente Shows Exactly The 10 Most Recent" (data layer only). Spec
(inventory-movements) "Recent Movimientos Are Readable" (all 5 scenarios, repo layer).

## Phase 2 — Aggregation + route (D2, D3, D4)

Depends on: Phase 1.

- [x] 2.1 RED: `apps/api/src/dashboard/service.test.ts` (unit, fake repos) — `obtenerResumen`
  calls `countAbiertasPorTipo('quiebre')`, `countAbiertasPorTipo('stock_bajo')`,
  `countAbiertas()`, and `listRecientes(10)` via `Promise.all` (D2); composes the exact
  `dashboardResumenDto` shape (D3), including `productoNombre` resolved per row via the
  `reportes/service.ts` N+1 idiom (D1, D6's `activo=false` case — no special-casing).
- [x] 2.2 GREEN: `apps/api/src/dashboard/service.ts` — create `obtenerResumen(repos)` per D2/D3.
- [x] 2.3 RED: `apps/api/src/routes/dashboard.test.ts` — `GET /api/dashboard/resumen`: both roles
  200 with identical payload (spec "Deposito reaches the dashboard", "Deposito and encargado see
  identical counts"), no session 401, no querystring schema (D4).
- [x] 2.4 GREEN: `apps/api/src/routes/dashboard.ts` — one bare-GET route, `config: { roles:
  ['encargado','deposito'] }`, `ACTIVIDAD_RECIENTE_LIMIT = 10` route constant (D4), calls 2.2.
- [x] 2.5 GREEN: `apps/api/src/app.ts` — register `dashboardRoutes` at `/api`.

**Satisfies**: design D2, D3, D4. Spec (dashboard-ui) "Dashboard Reachable By Both Roles", "Quiebres
And Stock-Bajo Counts", "Alertas Activas Counts All Open Alerts", "Actividad Reciente" (route-level).

## Phase 3 — Frontend (D5)

Depends on: Phase 2 (route contract).

- [ ] 3.1 RED+GREEN: `apps/web/src/components/ui/StatusChip.tsx` — widen `variant` union to add
  `'success'` (CSS class already exists); test asserts the new variant renders.
- [ ] 3.2 RED+GREEN: `apps/web/src/components/ui/KpiCard.tsx` — presentational card
  (label/value/optional `variant`) per `docs/design.md` tokens.
- [ ] 3.3 RED+GREEN: `apps/web/src/features/dashboard/{queries.ts,useDashboardResumen.ts}` —
  zero-arg `dashboardResumenQueryOptions()`, thin `useQuery` wrapper mirroring `useConteoAlertas`.
- [ ] 3.4 RED+GREEN: `apps/web/src/features/dashboard/ActividadRecienteList.tsx` — columns
  producto nombre/tipo/fecha/usuario (spec "Each row shows the required fields"); empty state
  `<p>No hay movimientos recientes.</p>` (spec "No movimientos have ever been recorded").
- [ ] 3.5 RED+GREEN: `apps/web/src/routes/index.tsx` — replace placeholder body; add `loader`
  calling `queryClient.ensureQueryData(dashboardResumenQueryOptions()).catch(() => undefined)`;
  renders 4 cards left-to-right per spec "Cards render in the specified order"; `await
  router.load()` before render (`CLAUDE.md` rule).
- [ ] 3.6 RED+GREEN: `apps/web/src/components/ui/AppShell.tsx` — add `to: '/'` to `NAV_ITEMS[0]`
  (`Panel general`), no `locked`/`reason`; test asserts navigation + no lock icon for both roles
  (spec "Panel general navigates for both roles without a lock icon").
- [ ] 3.7 `pnpm contract` / `pnpm contract:check` — regenerate `openapi.json` and
  `apps/web/src/api/schema.d.ts` for the new route; stage regenerated artifacts before trusting
  `contract:check`.

**Satisfies**: design D5. Spec (dashboard-ui) "Four KPI Cards Render In Fixed Order", "Actividad
Reciente" (UI layer, all scenarios). Spec (app-layout) MODIFIED requirement, both new scenarios.

---

## Dependency Graph

```
Phase 1 (countAbiertasPorTipo, listRecientes)
        │
        ▼
Phase 2 (dashboard/service.ts, routes/dashboard.ts, app.ts)
        │
        ▼
Phase 3 (frontend: index.tsx, KpiCard, ActividadRecienteList, AppShell, StatusChip)
```

## Open Questions Carried Forward

- [ ] StatusChip usage (if any) for "Actividad reciente"/"Alertas activas" cards — no precedent,
  non-blocking, implementation-time UI-copy call (design.md).
