# Design: Dashboard KPIs (Backlog #13)

## Technical Approach

One new read-only aggregation layer (`apps/api/src/dashboard/service.ts`, no new table) fans out
to existing `AlertasRepo`/`MovimientosRepo` ports plus one new narrow method on each, exposed
through a single `GET /api/dashboard/resumen` route. The frontend reuses the existing `/` route
(already registered under `shellLayout`, currently a placeholder) and wires `Panel general`'s nav
`to`. No new tables, migrations, or write paths.

## Architecture Decisions

### D1 — `MovimientosRepo.listRecientes`

| Aspect | Choice | Rationale |
|---|---|---|
| Signature | `listRecientes(limit: number): Promise<Movimiento[]>` | No `usuarioId` — decision 2 is unfiltered for both roles; no pagination envelope — fixed top-N, not a paged list. |
| Row shape | Bare `Movimiento[]`; `productoNombre` resolved in the service via the same N+1 idiom as `reportes/service.ts::listarMovimientosPeriodo` (D6, #12) | Reusing the established idiom keeps `MovimientosRepo`'s port "deliberately narrow" (repository.ts's own docblock) — a join would couple the repo to `productos`, breaking that precedent for a screen that only ever needs N=10 rows. |
| Query | `ORDER BY fecha DESC, id DESC LIMIT 10`, no predicate | Reuses `movimientos_fecha_idx` (#12) — an index-only scan already serves `ORDER BY fecha DESC LIMIT N`; `id DESC` is the same tie-break convention used by `listByProducto`/`listByPeriodo`. **No new index/migration.** |

### D2 — KPI aggregation shape (and a correction to the literal proposal snippet)

**Choice**: one `dashboard/service.ts::obtenerResumen(repos)` making 4 calls via `Promise.all`
(3 counts + 1 list), not a single combined SQL query.

**Correction, flagged explicitly**: proposal.md's literal call, `AlertasRepo.list({tipo:'quiebre'},
1, 1).total`, has no `estado` predicate — it would count every alert ever created with that
`tipo`, including long-resolved ones (mirrors how `listDiscrepancias` deliberately uses the same
bare-`tipo` call for an audit-trail *report*, per `reportes/service.ts`). A *KPI* card must mean
"currently open," matching decision 6's `countAbiertas()` semantics. Fix: a new
`AlertasRepo.countAbiertasPorTipo(tipo)` mirroring `countAbiertas()`'s exact `estado <> 'resuelta'`
predicate plus a `tipo` equality — not a reuse of `list()`. This does not change the ratified data
source (route a, Alerta-table) or decision 6's semantics; it makes decisions 1 and 6 consistent
with each other. **This is an architecture-level correctness fix, not a new product decision** —
flagged for owner visibility, not reopened.

**Alternatives considered**: one UNION-based combined query — rejected, no natural join key across
`alertas`/`movimientos`, and `reportes/service.ts` already establishes "multiple functions, no
combined query" as this project's precedent for multi-metric screens. At single-shop scale, 4 tiny
indexed queries per dashboard mount carry no meaningful cost.

### D3 — Route/response shape

One route, `GET /api/dashboard/resumen` (mirrors `/alertas/conteo`'s bare-GET sub-resource
naming), returning all 4 pieces in one payload — unlike #12's reportes (4 independently paginated
screens), this dashboard always fetches all 4 together for one screen.

```ts
const movimientoRecienteDto = z.object({
  id: z.string(), productoId: z.string(), productoNombre: z.string(),
  tipo: z.enum(['entrada','salida','ajuste','venta','anulacion']),
  fecha: z.date(), usuarioId: z.string(),
});
const dashboardResumenDto = z.object({
  quiebres: z.number().int(), stockBajo: z.number().int(),
  alertasActivas: z.number().int(),
  actividadReciente: z.array(movimientoRecienteDto),
});
```

`usuarioId` (not a resolved name) — matches `MovimientosPeriodoTable`'s existing precedent, which
also shows the raw id, not a resolved usuario nombre. No new `UsuariosRepo` dependency needed.

### D4 — RBAC

`config: { roles: ['encargado', 'deposito'] }`, **no querystring schema at all** — a bare GET,
matching `/alertas/conteo` exactly. No `requireActor()` call (no actor-scoping, per decision 2).
N=10 is a route-level constant (`ACTIVIDAD_RECIENTE_LIMIT`), never a client query param — confirmed
against decision 4, not made configurable.

### D5 — Frontend

- **Reuse `apps/web/src/routes/index.tsx`** (already registered at `path: '/'` under `shellLayout`
  in `routeTree.ts`) — replace its placeholder body, not a new route file. Add a `loader` calling
  `queryClient.ensureQueryData(dashboardResumenQueryOptions()).catch(() => undefined)`, mirroring
  `reportesMovimientos.tsx`'s swallow-then-`isError` pattern.
- **`AppShell.tsx`**: add `to: '/'` to `NAV_ITEMS[0]` (`Panel general`). No `locked`/`reason` —
  decision 2 is unfiltered for both roles, matching Inventario's "never locked" precedent.
- New `apps/web/src/features/dashboard/{queries.ts,useDashboardResumen.ts}` — zero-arg
  `dashboardResumenQueryOptions()`, thin `useQuery` wrapper (mirrors `useConteoAlertas`).
- New presentational `apps/web/src/components/ui/KpiCard.tsx` (label/value/optional `variant`) per
  `docs/design.md`'s "KPI cards" tokens (14px radius, 28px/800 cifra, red border+text when
  `variant='danger'`).
- New `apps/web/src/features/dashboard/ActividadRecienteList.tsx` — empty state
  `<p>No hay movimientos recientes.</p>`, matching `MovimientosPeriodoTable`'s exact inline
  empty-state convention (no shared `EmptyState` component exists in this codebase).
- **`StatusChip.tsx`**: widen `variant` union to `'danger' | 'warning' | 'success'` (the `.success`
  CSS class already exists, used today for `Activo`). Quiebres card uses `danger` when count > 0
  else `success`; Stock bajo uses `warning`/`success` — this reuses the *already-established*
  quiebre=danger/bajo=warning mapping from `StatusChip.tsx`'s own docblock (productos-ledger-base's
  derived stock chips), not a new convention. **Flagged, not resolved**: whether "Actividad
  reciente" or "Alertas activas" cards get any chip at all, and exact label copy, has no precedent
  and is not in proposal.md's ratified decisions — left as an optional `variant` prop, non-blocking.

### D6 — Edge cases

| Case | Behavior | Why |
|---|---|---|
| Zero movimientos ever | `listRecientes` returns `[]`; UI shows the empty-state `<p>` | No error path — an empty result is not a failure. |
| Zero open alerts of a tipo | `countAbiertasPorTipo` returns `0` (not `undefined`) | Same `?? 0` fallback pattern as `countAbiertas()`. |
| Movimiento references a deactivated producto (`activo=false`) | Still shows correctly — `ProductosRepo.findById` has **no `activo` filter** (confirmed in `productos/repository.ts`) | Same behavior already relied on by `reportes/service.ts`'s identical N+1 idiom; no special-casing needed. |

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/src/movimientos/repository.ts` | Modify | Add `listRecientes(limit)`. |
| `apps/api/src/alertas/repository.ts` | Modify | Add `countAbiertasPorTipo(tipo)`. |
| `apps/api/src/dashboard/service.ts` | Create | `obtenerResumen(repos)`. |
| `apps/api/src/routes/dashboard.ts` | Create | `GET /dashboard/resumen`. |
| `apps/api/src/plugins/repos.ts` | No change | Existing `Repos` shape already exposes both repos. |
| `apps/api/src/app.ts` | Modify | Register `dashboardRoutes` at `/api`. |
| `apps/web/src/routes/index.tsx` | Modify | Replace placeholder with the dashboard screen + loader. |
| `apps/web/src/components/ui/AppShell.tsx` | Modify | Add `to: '/'` for `Panel general`. |
| `apps/web/src/components/ui/StatusChip.tsx` | Modify | Widen `variant` to add `'success'`. |
| `apps/web/src/components/ui/KpiCard.tsx` | Create | Presentational KPI card. |
| `apps/web/src/features/dashboard/*` | Create | `queries.ts`, `useDashboardResumen.ts`, `ActividadRecienteList.tsx`. |

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `obtenerResumen` composes 4 calls correctly; `countAbiertasPorTipo` predicate | Fake repos, per existing service test style. |
| Integration | `listRecientes`/`countAbiertasPorTipo` against real Postgres | Follows `reportes.integration.test.ts` pattern. |
| Route | `GET /dashboard/resumen` — both roles 200, no session 401 | Mirrors `reportes.test.ts`. |
| E2E/Route (web) | `index.test.tsx` — loader + `isError`, `AppShell.test.tsx` — nav link present, unlocked, both roles | `await router.load()` before render (CLAUDE.md rule). |

## Threat Matrix

N/A — no routing/shell/subprocess/VCS/executable-classification boundary; a plain authenticated
read route.

## Migration / Rollout

No migration required. `listRecientes`/`countAbiertasPorTipo` are additive/read-only; reverting the
dashboard route and `Panel general`'s `to` restores the prior placeholder with no data impact.

## Open Questions

- [ ] Exact StatusChip usage (if any) for "Actividad reciente"/"Alertas activas" cards — no
      precedent, non-blocking, left as an implementation-time UI-copy call.
- [ ] `countAbiertasPorTipo` is a new backend method beyond exploration.md's "zero new backend
      code" sizing signal — small, low-risk, needed for correctness; flagged for owner visibility.
