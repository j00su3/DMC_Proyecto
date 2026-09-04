# Exploration: dashboard-kpis (backlog #13)

## Current state

`docs/BACKLOG.md:48` is the *only* place the four KPIs are named together: "Pantalla de inicio con
KPI cards del design.md (quiebres, stock bajo, actividad reciente, alertas activas); chips de
estado; navegación por rol con 🔒". Cross-checking source docs:

- **`docs/PRD.md`** — zero matches for panel/dashboard/kpi/inicio (case-insensitive). Says nothing
  about this screen: no KPI list, no RBAC statement, no wireframe reference.
- **`docs/TECH-DESIGNv2.md`** — mentions "dashboard/KPIs" only twice, both in passing: once
  listing it among the SPA's rendered views (line 33), once in a traceability line (line 169):
  "Trazabilidad Design.md → datos: KPI cards y chips (quiebre/bajo) ← `stock_actual`/
  `stock_minimo`". This ties the quiebre/bajo KPIs to **Producto columns**, not to the `Alerta`
  table — see the design-decision fork below.
- **`docs/design.md`** (Design System, visual tokens) has a `### KPI cards` section (line 79-80):
  "Tarjeta blanca radio 14, label 12px muted 600, cifra 28px 800, detalle 12px. Estado crítico:
  `border-top: 3px solid #e04f3a` y cifra roja." Purely a visual style spec — not a content spec.
  Does not name which 4 KPIs exist, their exact wording, or RBAC.
- **Wireframe gap, confirmed**: `docs/design.md:111-115` states the dashboard wireframe
  (`UI Dashboard.dc.html`) is "Referenciados pero AUSENTES del repositorio (verificado el
  2026-08-25)". There is no dashboard wireframe/mockup in the repo at all — the same kind of gap
  that made #3.1/#4.1 flag "no hay wireframe aprobado."
- **Conclusion**: the exact 4-KPI list, card order, and wording exist ONLY in `BACKLOG.md`'s own
  scope line — no other document corroborates or contradicts it. Treat the backlog line as the
  sole source of truth pending an explicit product decision in `sdd-propose`.

## RBAC for this screen — not specified anywhere

Neither `PRD.md` nor `TECH-DESIGNv2.md` nor `design.md` states whether `deposito` sees the same 4
KPIs, a subset, or a row/actor-scoped variant (e.g. "actividad reciente" scoped to deposito's own
movimientos, mirroring #12's row-level pattern). Genuine open product decision for `sdd-propose` —
do not assume symmetry with #12 without an explicit call.

## `docs/REVISION-ADVERSARIAL.md` — no dashboard-specific marker

No `(C#)/(A#)/(S#)`-style marker targets this screen. Nothing blocks or specially informs #13.

## Reusable infrastructure

**`apps/api/src/alertas/repository.ts`** (`DrizzleAlertasRepo`):
- `countAbiertas()`: counts ALL open alerts regardless of `tipo` (`estado <> 'resuelta'`, i.e.
  `activa`+`vista` combined) — matches the existing nav badge exactly, but note it's not strictly
  `estado='activa'`. Whether the dashboard KPI wants that same combined semantics is an open
  question.
- `list(filtro, page, pageSize)` already accepts a `tipo` filter (widened in #12) and computes an
  exact `total` via a dedicated count query — `list({tipo:'quiebre'}, 1, 1).total` already gives an
  exact per-tipo open-alert count with **zero new backend code**, just an unconventional call shape
  (a tiny service-level wrapper would be cleaner).

**Data-source fork for quiebre/stock-bajo KPIs** (this is the propose/design decision):
1. **Alerta-table route (a)**: `AlertasRepo.list()` with `tipo` filter — reuses #10/#12 infra
   almost as-is, mutually-exclusive by construction (evaluator only creates one tipo per
   threshold-cross). Effort: Low.
2. **Producto-column route (b)**: per TECH-DESIGNv2's literal traceability text
   (`stock_actual`/`stock_minimo`). `ProductosRepo.bajoMinimo()` (#12) computes a UNION of
   quiebre+stock_bajo, can't distinguish them as-is — would need one or two new narrow count
   queries (e.g. `stockActual = 0` vs `stockActual > 0 AND stockActual <= stockMinimo`). Small but
   genuinely new backend work, and risks the D7/D11 page/count-predicate trap already documented
   three times in this codebase if not applied carefully. Effort: Low-Medium.

**Recommendation**: route (a) — lower-risk, reuses already-tested infra, and keeps this dashboard's
numbers consistent with what's already shown on the Alertas screen. Flag the TECH-DESIGNv2
traceability-note divergence explicitly rather than silently picking a side.

**`apps/api/src/movimientos/repository.ts`**: only `create`, `listByProducto` (needs
`productoId`), `resumenRotacion` (needs `productoId`), `listByPeriodo` (needs an explicit date
range). **None answer "most recent N movimientos across all products"** — confirmed no such query
exists. `movimientos_fecha_idx` (added in #12) already supports a plain `ORDER BY fecha DESC LIMIT
N` scan with no `productoId` predicate, so a new method (`listRecientes(limit, usuarioId?)`) would
be cheap to add — no new index/migration required.

**`apps/web/src/components/ui/AppShell.tsx`**: `NAV_ITEMS[0]` (`'Panel general'`) is confirmed
**still a destination-less placeholder today**, identical to how `'Reportes'` was one single
placeholder before #12 split it into four routed items. #13 is the item that would finally give it
a `to`. `locked`/`reason`/`badge` on `NavItem` are fully built (from #10's alert badge + #12's
encargado-only lock pattern) — adding `Panel general`'s route needs **no new nav-locking logic**.
The sidebar-level "navegación por rol con 🔒" requirement, if it means the sidebar entry itself, is
already fully solved. No document describes a separate in-page "quick links" section with its own
🔒-gated items — best reading is that the backlog bullet just refers to wiring the existing sidebar
item, but this is an inference, not a documented decision — confirm explicitly in `sdd-propose`.

**`apps/web/src/components/ui/StatusChip.tsx`**: confirmed existing, reusable as-is for the two
documented shapes. One caveat: `variant` only supports `'danger'|'warning'` today — a green "sin
alertas"/"OK" chip would need a small type widening (`'success'` variant), not a new component.

## Sizing signal

Mostly frontend, small-to-medium backend surface:
- "alertas activas" — reusable as-is (`countAbiertas()`).
- "quiebres"/"stock bajo" — reusable as-is via route (a), or small new count queries via route (b).
- "actividad reciente" — one small new `MovimientosRepo` method, reusing the existing
  `movimientos_fecha_idx` index, no migration.
- Chips de estado — fully reused, at most a trivial type widening.
- Sidebar nav — fully reused, just add `to` to the existing placeholder.
- No wireframe exists for card layout/copy — content decisions must be settled explicitly in
  `sdd-propose`.

Overall: comparable in size to a single #12-style report screen (one new screen + one small new
backend query + wiring), not a multi-PR backend-heavy effort, assuming route (a) is chosen.

## Open questions for the proposal phase

1. **KPI data source for quiebres/stock-bajo**: Alerta-table (route a, recommended) vs.
   Producto-column (route b, per TECH-DESIGNv2's literal traceability text).
2. **RBAC scope of this screen for deposito**: same 4 KPIs unfiltered, a subset, or row-scoped
   (mirroring #12's pattern for "actividad reciente")?
3. **Exact wording/order of the 4 KPI cards**, absent any approved wireframe.
4. **"Actividad reciente"**: what N (how many recent movimientos) and what fields per row?
5. **"Navegación por rol con 🔒"**: confirm this means wiring the existing sidebar entry only (no
   new in-page component), or whether a distinct in-page shortcuts section is also expected.
6. **"Alertas activas" semantics**: does it mean `countAbiertas()`'s existing `activa`+`vista`
   combined count, or strictly `estado='activa'`?

## Risks

- No approved wireframe — risk of building something needing product rework once one surfaces.
- PRD is silent on RBAC for this screen; picking a default without an explicit decision risks the
  "spec vs design contradiction" failure mode `CLAUDE.md` already warns about.
- The Alerta-vs-Producto data-source fork, if left implicit, could produce dashboard numbers that
  silently disagree with the equivalent counts on the Alertas screen or Reportes' "bajo mínimo"
  screen — a visible consistency bug if not decided deliberately.
- `countAbiertas()`'s semantics (`activa`+`vista` combined) may not match the intended "alertas
  activas" meaning; needs an explicit check since no doc defines it precisely.

## Ready for proposal

Yes, with the six open decisions above surfaced to the owner during `sdd-propose` before scope is
locked. No further code investigation needed — the gap is a documentation/wireframe gap, not a
missing-code gap.
