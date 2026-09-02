# Proposal: Proveedores Maestro-Detalle (backlog #4.1)

## Intent

Backend supplier CRUD (#4, archived) shipped with zero UI, by an explicit split recorded in
its own proposal. `AppShell.tsx`'s `NAV_ITEMS` already reserves an inert "Proveedores" entry
with no `to`, and `docs/design.md:93-95` names a 340px|1fr master-detail layout token for this
exact screen — but no wireframe (`UI Vistas.dc.html`) exists anywhere in the repo. This is
genuinely new UI pattern work: this codebase has zero master-detail-with-stateful-selection
precedent (confirmed by grep — see `exploration.md`), only separate-route list+detail pairs
(productos, usuarios).

Success for this change: both roles can browse the full supplier list (active and inactive)
and open a supplier's detail without leaving the list, encargado can create/edit/deactivate/
reactivate suppliers from the same screen, deposito gets a read-only view with the server's
403 as the real boundary, and a shared/bookmarked link to a specific supplier resolves
correctly or fails with a clear, distinct message — never silently reverting to "nothing
selected."

## Scope

### In Scope

- New `apps/web/src/routes/proveedores*.tsx` route(s), mounted under `shellLayout` (both roles
  read suppliers; `encargadoLayout` is reserved for encargado-only subtrees per this repo's
  routing rule).
- Wiring `to: '/proveedores'` onto `AppShell.tsx`'s existing inert "Proveedores" `NAV_ITEMS`
  entry.
- A master list pane fetching the **entire** supplier list in one unpaginated request
  (PD-1), filterable/searchable entirely client-side, showing both active and inactive
  suppliers (unlike `ProveedorSelector.tsx`, which filters to `activo` only).
- A detail pane that renders the selected supplier's fields, with role-gated write controls
  (PD-3), deactivate/reactivate (PD-4), and a create-new-supplier entry point (PD-5) — all
  living inside this one screen.
- A bookmarkable/shareable URL that reflects which supplier (if any) is selected (product
  constraint; mechanism deferred to design — see Deferred to Design below).
- A distinct error state for a selected supplier that does not resolve (PD-2).

### Out of Scope

- Any change to `apps/api/src/routes/proveedores.ts` or the promoted `supplier-management`
  spec — no new `q` param, no new endpoints, no pagination contract change (PD-1).
- Server-side or fuzzy search — filtering is a client-side substring match over the already-
  fetched full list.
- Bulk actions (multi-select deactivate/reactivate, bulk edit).
- Structured contact fields (phone/email/person) — `contacto` stays single free-text, per #4.
- Mobile-responsive layout — `docs/design.md:95` marks this screen's responsive behavior
  "pendiente de diseño" explicitly; this change targets desktop/tablet only, same punt POS
  already took.

## Product Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| PD-1 | The proveedores master list is **unpaginated** for v1 — fetch the full list in one request, filter/search entirely client-side. No backend changes to `GET /api/proveedores` (no new `q` param, `supplier-management`'s promoted spec stays untouched). | Owner-ratified. A small shop's supplier catalog won't realistically grow large enough to need pagination for years, and this eliminates the deep-link-to-a-page-not-loaded failure mode entirely — with no pages, that scenario cannot occur. |
| PD-2 | A selected supplier id that is malformed, or does not resolve to any row (active or inactive — baja lógica never physically deletes, so this is effectively "never existed" or "typo'd," not "was deleted"), renders a **distinct, visible error state in the detail pane** ("Proveedor no encontrado" or equivalent) — never silently falls back to the same blank placeholder shown when nothing is selected. | A stale or mistyped shared link must not look identical to "you haven't clicked anything yet" — that would read as the feature being broken with no explanation. |
| PD-3 | Deposito sees the **same detail pane**, in a fully read-only mode: fields render as display-only (no editable inputs), and every write affordance (edit, deactivate/reactivate, create-new) is either hidden or disabled with a visible 🔒-prefixed reason, mirroring `ProductoForm`'s field-gating pattern. The server's 403 remains the real boundary; this is UX only. | Mirrors this repo's existing per-component gating convention exactly (`CLAUDE.md`: "write controls gated per component"), and matches the backend RBAC split verbatim — deposito has zero write routes on `proveedores`, unlike productos where only one field (`stock_minimo`) is gated. |
| PD-4 | Deactivate/reactivate uses a **simple button, no confirmation modal or typed-field gate**. | Proveedor deactivation is baja lógica only (never destructive, always reversible, no cascading invariant) — same shape as `usuarios`' deactivate/reactivate buttons (`UsuariosTable`), not `AnularVentaModal`'s typed-motivo gate, which exists only for genuinely irreversible operations (stock/payment reversal). Adding a heavyweight confirmation here would overstate the actual risk. |
| PD-5 | "Create new proveedor" lives **inside this same screen**, reached via a "+ Nuevo proveedor" action in the master pane that opens a create form in the detail pane — not a separate full-page route like `productosNuevo.tsx`. Encargado-only; deposito never sees this action (per PD-3). | The entire point of a master-detail shape is that the list stays visible while the user works the detail pane; navigating away to a full page for creation would defeat that, unlike productos where list and detail are already separate routes with nothing to preserve. |

## Deferred to Design (explicitly not decided here)

1. **Route shape** — single route with a `?selected=` search param vs. two nested routes
   (`/proveedores` + `/proveedores/$id`) rendered into a shared `Outlet` slot. This is an
   architecture/router-mechanism call, not a product one. Product constraint design must
   satisfy: the URL must be bookmarkable/shareable and reflect which supplier is selected,
   regardless of which mechanism produces that URL.
2. **Push vs. replace history semantics** for selection changes — no existing precedent in
   this codebase favors either (`productos.tsx` uses `replace: true` for search changes but
   not pagination changes). Design phase decides.
3. **Reuse vs. fresh data-fetching for the master list** — whether to adapt
   `ProveedorSelector.tsx`/`useProveedoresActivos.ts` or build new. Flagged, not decided: that
   hook filters to `activo` only and caps at `pageSize: 100`, both wrong defaults for a master
   list that must show inactive suppliers and is now unpaginated (PD-1) — a fresh hook is
   likely needed regardless, but the reuse-vs-fresh call is implementation shape, not product.

## Capabilities

### New Capabilities

- `proveedores-ui`: master-detail supplier screen — list (unpaginated, client-filtered),
  detail pane (view/edit/deactivate/reactivate/create), role-gated write controls, mirroring
  the `usuarios-ui`/`productos-ui` naming precedent.

### Modified Capabilities

- None. `supplier-management` (backend) and `app-shell`/`app-layout` are consumed
  (`shellLayout`, `NAV_ITEMS`) but not changed.

## Approach

Mirror `productos.tsx`/`productosDetalle.tsx`'s `shellLayout` mounting and RBAC-per-component
pattern, but the actual split-view (list + detail both mounted, selection synced to the URL)
is new pattern work with no precedent to copy — design phase resolves the router mechanism
(see Deferred to Design). Fetch strategy for the master list follows PD-1: one call, no
pagination params, `activo` included.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `apps/web/src/routes/proveedores*.tsx` | New | Master-detail route(s), under `shellLayout` |
| `apps/web/src/features/proveedores/` | New | List/detail/form components, hooks, error messages |
| `apps/web/src/components/ui/AppShell.tsx` | Modified | `NAV_ITEMS`'s "Proveedores" entry gains `to: '/proveedores'` |
| `apps/web/src/features/productos/ProveedorSelector.tsx`, `useProveedoresActivos.ts` | Unmodified (candidate reuse only) | Existing dropdown hook; reuse-vs-fresh deferred to design (see above) |
| `apps/api/src/routes/proveedores.ts` | Unmodified | No backend contract changes (PD-1) |
| `openspec/specs/supplier-management/spec.md` | Unmodified | Promoted backend spec stays untouched |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Zero master-detail-with-selection precedent anywhere in the codebase | High (certain) | Do not size this at parity with prior UI fast-follows that copied an existing separate-route shape; design phase owns the router mechanism explicitly |
| PD-1's unpaginated fetch stops scaling if the supplier catalog grows unexpectedly large | Low | Explicit owner tradeoff, reversible later by reopening `supplier-management` for a `q` param if it ever becomes a real problem |
| `AppShell.tsx`'s `NAV_ITEMS` has no covering tests today | Medium | New coverage should not simply extend the untested pattern; add a route-level test per this repo's testing convention |

## Rollback Plan

Additive only: new route files, new `features/proveedores/` directory, one modified line in
`AppShell.tsx` (`to: '/proveedores'`). No schema, migration, or backend contract change.
Revert by reverting the commit(s); `NAV_ITEMS`'s entry reverts to its inert, destination-less
state.

## Dependencies

- #4 (`gestion-proveedores`, backend, archived) — provides the full CRUD API this change
  consumes unchanged.
- #2.1 (`app-shell-login`, archived) — provides `shellLayout.tsx`, `AppShell.tsx`, and typed
  routing this change mounts into.

## Success Criteria

- [ ] Both roles can view the full supplier list (active + inactive) and open any supplier's
      detail without a full-page navigation away from the list.
- [ ] Encargado can create, edit, deactivate, and reactivate a supplier from this screen;
      deposito sees the same detail pane read-only, with every write affordance hidden or
      disabled and a visible reason, and receives a 403 from the server if bypassed.
- [ ] A bookmarked/shared URL for a specific supplier reopens directly to that supplier's
      detail pane.
- [ ] A malformed or non-resolving selected-supplier id shows a distinct "not found" state,
      never the same blank placeholder as "nothing selected."
- [ ] Deactivate/reactivate is a single-click action with no confirmation modal.
- [ ] `NAV_ITEMS`'s "Proveedores" entry navigates to the new screen.

## Non-Goals (explicit)

- No backend/API contract changes of any kind (no `q` param, no new endpoints, no pagination
  shape change) — locked by PD-1.
- No server-side or fuzzy search — client-side substring match only, over the full list.
- No bulk actions (multi-select deactivate/reactivate, bulk edit).
- No structured contact fields (phone/email/person) — unchanged from #4.
- No mobile-responsive layout — explicitly punted by `docs/design.md:95`.
- No change to `supplier-management`'s promoted spec.

## Proposal question round

This phase settled the product-level decisions PD-1 through PD-5 above using existing
codebase precedent (usuarios' deactivate buttons, productos' field-gating, `AnularVentaModal`'s
irreversible-action gate) rather than open a live question round, since each had a clear
existing analog to reason from. The items genuinely without a clear analog — route shape,
push/replace semantics, and reuse-vs-fresh data-fetching — are recorded under "Deferred to
Design" rather than decided here, since they are architecture/implementation-shape calls, not
product ones.

If the owner wants to weigh in before design starts, the sharpest open point is **PD-5's
mechanism**: confirming that "+ Nuevo proveedor" opening a create form inside the detail pane
(rather than a separate route) is the right call, since it is the one PD here that diverges
from an existing sibling pattern (`productosNuevo.tsx`'s separate route) rather than extending
one.
