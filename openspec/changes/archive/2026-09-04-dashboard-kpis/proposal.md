# Proposal: Dashboard KPIs (Backlog #13)

## Intent

`docs/BACKLOG.md:48` is the only source naming this screen: a home/dashboard with 4 KPI cards
(quiebres, stock bajo, actividad reciente, alertas activas), status chips, and role-aware nav. The
`Panel general` sidebar entry has been a destination-less placeholder since #6/#10 landed. No PRD
text, wireframe, or RBAC statement exists for this screen (confirmed in exploration.md) — this
proposal makes the interpretive calls a wireframe would normally settle, explicitly, for owner
ratification.

## Scope

### In Scope
- New dashboard screen (`shellLayout`, both roles) rendering 4 KPI cards + `StatusChip`.
- `MovimientosRepo.listRecientes(limit, usuarioId?)` — plain `ORDER BY fecha DESC LIMIT N` reusing
  `movimientos_fecha_idx`, no migration.
- Thin service wrapper over `AlertasRepo.list({tipo}, 1, 1).total` for per-tipo alert counts (if
  cleaner than calling `.list()` directly from the route).
- Wiring `Panel general`'s `to` route (existing `NavItem`/`locked`/`badge` infra, no new logic).
- `StatusChip` `variant` widened to include `'success'` if an "OK/sin alertas" state is needed.

### Out of Scope
- Charts/graphs or any visualization beyond counts + chips.
- CSV/export from this screen.
- Any change to how alertas are created, resolved, or evaluated (owned by #10).
- The Producto-column KPI route (`stock_actual`/`stock_minimo` counts) — deferred unless Decision 1
  is overridden.
- A separate in-page "quick links" component distinct from the sidebar nav entry.

## Scoping Decisions (ratified by the owner, 2026-09-04)

All 6 decisions below were confirmed as proposed, one at a time:

1. **Data source for quiebres/stock-bajo** — Confirmed: Alerta-table route (a):
   `AlertasRepo.list({tipo: 'quiebre'|'stock_bajo'}, 1, 1).total`. Reuses tested #10/#12 infra,
   mutually exclusive by construction, keeps numbers consistent with the Alertas/Reportes screens.
   **Divergence to flag**: `TECH-DESIGNv2.md:169`'s traceability note ties these KPIs to
   `stock_actual`/`stock_minimo` (route b) instead — this proposal picks (a) over that literal text
   for the reasons above, not by ignoring it.
2. **RBAC for `deposito`** — Confirmed: deposito sees the SAME 4 KPIs, unfiltered. Mirrors #12's
   treatment of stock actual/bajo-mínimo as unfiltered-for-both.
3. **Card wording/order** (no wireframe exists) — Confirmed, left-to-right: "Quiebres" →
   "Stock bajo" → "Actividad reciente" → "Alertas activas". Literal, matching the backlog's own
   naming.
4. **"Actividad reciente" shape** — Confirmed: N=10 most recent movimientos, columns: producto
   nombre, tipo, fecha, usuario — reusing #12's report row pattern.
5. **"Navegación por rol con 🔒"** — Confirmed: this means wiring the existing `Panel general`
   sidebar entry only; the `locked`/`reason`/`badge` infra is already fully built and needs no new
   in-page shortcuts component.
6. **"Alertas activas" semantics** — Confirmed: reuse `countAbiertas()`'s existing `activa`+`vista`
   combined "not yet resolved" meaning, matching the nav badge exactly.

## Capabilities

### New Capabilities
- `dashboard-ui`: the home/dashboard screen — 4 KPI cards, `StatusChip` states, actividad-reciente
  list, wired to `Panel general`.

### Modified Capabilities
- `app-layout`: `Panel general` `NavItem` gains a `to` route (was destination-less placeholder,
  same pattern as pre-#12 `Reportes`).
- `alertas-ui` / `alertas` (spec name TBD by sdd-spec): no behavior change to alert lifecycle;
  read-only reuse of `list()`/`countAbiertas()` — list here only if sdd-spec finds a requirement-
  level addition (e.g. a documented per-tipo count contract). Otherwise: None.
- `inventory-movements`: adds `listRecientes(limit, usuarioId?)` read capability.

## Approach

Reuse `AlertasRepo.list()`/`countAbiertas()` as-is (route a) for 2 of 4 KPIs with zero new backend
surface beyond a thin wrapper. Add one new `MovimientosRepo` method for "actividad reciente" reusing
the existing fecha index. Wire the existing, fully-built nav-lock/badge machinery to the new route.
No new visualization component — `StatusChip` covers all card states, with a possible `'success'`
variant widening.

## Affected Areas

| Area | Impact | Description |
|------|--------|--------------|
| `apps/web/src/routes/*` (new dashboard route) | New | Screen wired to `Panel general` |
| `apps/web/src/components/ui/AppShell.tsx` | Modified | Add `to` for `Panel general` `NavItem` |
| `apps/web/src/components/ui/StatusChip.tsx` | Modified (maybe) | Widen `variant` to add `'success'` |
| `apps/api/src/movimientos/repository.ts` | New method | `listRecientes(limit, usuarioId?)` |
| `apps/api/src/alertas/repository.ts` | Reused as-is | `list()`, `countAbiertas()` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| No approved wireframe — screen shape may need rework once one surfaces | Medium | Card wording/order flagged as an explicit, owner-confirmable decision (3) |
| Decision 1 (data source) contradicts `TECH-DESIGNv2.md:169`'s literal traceability text | Medium | Divergence named explicitly; owner can override before spec/design lock |
| RBAC decision (2) picked without a PRD anchor, unlike #12 | Low-Medium | Flagged as recommendation, not silent assumption |
| `countAbiertas()` semantics may not match intended "alertas activas" meaning | Low | Decision 6 makes the choice explicit and traceable to the nav badge |

## Rollback Plan

Revert the dashboard route and `Panel general`'s `to` (reverts to destination-less placeholder,
prior behavior). `listRecientes()` is additive/read-only — safe to leave or remove without data
impact. No migration, no schema change.

## Dependencies

- #6 (productos) — satisfied, archived.
- #10 (motor de alertas) — satisfied, archived.

## Success Criteria

- [ ] `Panel general` navigates to a working dashboard for both roles.
- [ ] All 4 KPI cards render live counts/data using only reused or newly-added read paths (no new
      writes).
- [ ] Decisions 1–6 above are ratified (confirmed or overridden) before `sdd-spec`/`sdd-design`.
