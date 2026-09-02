# Exploration: proveedores-maestro-detalle (backlog #4.1)

## Current State

**Backend (#4, archived, complete — no changes needed)**: `apps/api/src/proveedores/` has full CRUD —
`service.ts` (`listProveedores`, `getProveedor`, `createProveedor`, `updateProveedor`,
`setProveedorActivo`, all through `UnitOfWork` + `recordAudit`), `repository.ts` (Drizzle adapter,
`findByIdForUpdate` row lock, never a physical DELETE), `apps/api/src/routes/proveedores.ts` (6
routes). DTO: `{ id, nombre, contacto, activo, creadoEn }`. RBAC via `config.roles`:
`GET /proveedores` + `GET /proveedores/:id` = `['encargado','deposito']`; `POST/PATCH/deactivate/
reactivate` = `['encargado']` only. `openspec/specs/supplier-management/spec.md` is the promoted
spec and states verbatim "Backend only — no UI of any kind in this change" and "Filtering or search
by name or active status is out of scope for this endpoint" — there is **no `q` param** on
`GET /api/proveedores`, unlike productos.

**Frontend: zero proveedores UI exists.** No `apps/web/src/routes/proveedores*.tsx`, no
`apps/web/src/features/proveedores/` folder. The only proveedores-adjacent frontend code is
`apps/web/src/features/productos/ProveedorSelector.tsx` + `useProveedoresActivos.ts` — a dropdown
for `ProductoForm`'s supplier field, filtered to `activo` only, capped at `pageSize: 100`. Not
reusable as-is for a full master list (needs inactive suppliers visible too, for baja-lógica
history).

`apps/web/src/components/ui/AppShell.tsx`'s `NAV_ITEMS` already lists `{ label: 'Proveedores' }`
with **no `to`** — renders as an inert marker (not locked, just destination-less) via `NavItem`,
same as `Panel general`, `Movimientos`, `Reportes`. Wiring `to: '/proveedores'` is part of this
change's scope.

## Citation correction

The backlog text cites `design.md:94-95`; an earlier reference to `docs/TECH-DESIGNv2.md:94-95` was
wrong — those are two separate files, and `TECH-DESIGNv2.md:94-95` is unrelated content (Usuario
entity fields). The correct citation is `docs/design.md:93-95`:

```
POS: grilla 1.2fr | 460px (catálogo | carrito fijo a la derecha).
Vistas maestro-detalle (Proveedores): 340px | 1fr.
Objetivo responsive: colapsar sidebar a iconos en tablet; POS apilado en móvil (pendiente de diseño).
```

That is the **entire** design spec for this screen: a two-column layout token (340px list pane |
1fr detail pane) plus an explicit responsive-design punt. `docs/design.md:111-115` separately lists
`UI Vistas.dc.html` ("las 7 vistas restantes en la dirección elegida") as **referenced but ABSENT**
from the repo (verified 2026-08-25/2026-09-01, zero `*.dc.html` matches anywhere) — confirming
literally no wireframe exists for this screen.

## Affected Areas

- `apps/web/src/components/ui/AppShell.tsx` — `NAV_ITEMS`'s "Proveedores" entry needs a `to`;
  currently flagged with no covering tests.
- `apps/web/src/routes/shellLayout.tsx` — new route(s) must mount here, never under
  `encargadoLayout.tsx` (that subtree is usuarios-only, encargado-only reads).
- `apps/web/src/features/productos/ProveedorSelector.tsx`, `useProveedoresActivos.ts` — precedent
  code that may or may not be reusable (filters to `activo`, caps at 100).
- `apps/web/src/routes/productos.tsx` / `productosDetalle.tsx`,
  `apps/web/src/features/productos/ProductosTable.tsx` — closest reusable pattern for
  table/pagination/per-component RBAC gating, but structurally a separate-route pattern, not a
  split-view.
- `apps/api/src/routes/proveedores.ts` — likely untouched, unless a search/filter decision reopens
  it.

## Frontend precedent — confirmed NO master-detail-with-stateful-selection exists anywhere

Grepped `apps/web/src` for `seleccionado|selectedId|activeId` (case-insensitive): **zero hits**.
Closest analogs are **separate-route** list+detail pairs, not a split-view:

- `routes/productos.tsx` (`/inventario`, under `shellLayout`) + `routes/productosDetalle.tsx`
  (`/inventario/$id`, also under `shellLayout` — both roles read products). List uses
  `validateSearch` with `page`/`q` as bookmarkable Zod-validated search params (`.catch()` pattern,
  never throws on malformed `?page`). `ProductosTable`'s `onView` callback navigates to a **whole
  new route**, not an in-page selection.
- `routes/usuarios.tsx` + `routes/usuariosDetalle.tsx` — same separate-route shape, but nested
  under `encargadoLayout` since only encargado reads usuarios.

This is structurally different from "one screen, master list + detail pane both mounted, selection
state syncs to a URL search param." The backlog's "genuinely new, no precedent" claim is verified
true.

## RBAC / component-gating requirement

Per this repo's `CLAUDE.md`: "Route guards are for encargado-only subtrees... Screens both roles
can read (proveedores, productos) go under `shellLayout`, never `encargadoLayout`, with write
controls gated per component." Since GET routes allow `deposito`, this feature MUST mount under
`shellLayout` (mirroring `productosDetalle.tsx`), never `encargadoLayout` (usuarios-only). The
productos precedent for per-component gating: `isDeposito = usuario.rol === 'deposito'`, then
`disabled={isDeposito}` on write buttons plus a visible 🔒-prefixed reason paragraph — server 403
remains the real boundary, client disable is UX only.

## #2.1 resolved

`#2.1` = "App shell + login" (already archived, 2026-08-26). Provides the infrastructure 4.1
depends on: TanStack Router install with typed routes and public/protected guards, login screen per
design.md tokens, session context + logout, react-hook-form + zod resolver forms, forced-password-
change flow. `shellLayout.tsx` and `AppShell.tsx` (with `NAV_ITEMS`) are its deliverables.

## What "master-detail with stateful selection AND deep-linking" concretely means

Given the existing `validateSearch` pattern, the natural mechanism is: **one route** (e.g.
`/proveedores`) with a search param (e.g. `?selected=<id>`) alongside `?page` (and maybe `?q`),
rather than the existing two-route split. Master pane always renders the paginated list; detail
pane conditionally renders based on `selected`. Clicking a row calls
`navigate({ search: { ...current, selected: id } })` — push vs. replace is an open decision
(`productos.tsx`'s search-change uses `replace: true`, its pagination change does not — no existing
precedent for which one selection-in-a-master-detail should use).

## Approaches

1. **Single route, `?selected=` search param, split-view component** — mirrors existing
   `validateSearch` idiom exactly, one URL is the whole state, easiest to deep-link.
   - Pros: consistent with codebase's existing search-param convention; simplest mental model; one
     `loader`.
   - Cons: must hand-roll the "selected item not on the loaded master page" problem (see risk
     below); no TanStack Router precedent in this repo for a route rendering two independent
     data-fetches into sibling panes.
   - Effort: Medium

2. **Two nested routes (`/proveedores` list + `/proveedores/$id` child) rendered together via a
   layout route with an `Outlet` slot inside the master pane** — reuses TanStack Router's native
   nested-route mechanism for the "detail" concern, list state stays a sibling concern.
   - Pros: leans on router-native deep-linking (`$id` is inherently a bookmarkable URL) instead of
     hand-rolled search-param logic; matches this codebase's existing convention of route = URL =
     data boundary.
   - Cons: still separate-route under the hood, so "stateful selection" (list survives full
     re-navigation without unmount/remount, no flash) needs deliberate care — TanStack Router's
     default behavior on nested-route navigation would need verification during design.
   - Effort: Medium-High

## Recommendation

Do not decide route shape in this phase — both approaches are viable and the choice has real UX
consequences (approach 1 risks list/detail pane desync on deep-link entry; approach 2 risks
list-state loss on navigation). This is exactly the kind of decision the design phase should make
explicitly, informed by a concrete answer to the "deep-link to a page you don't know" risk below.
The proposal phase should record the decision as a scoped question, not resolve it prematurely.

## Open Questions for Propose Phase

1. One route with `?selected=` vs. two nested routes rendering into a shared slot.
2. Push vs. replace semantics for selection changes.
3. **Deep-link entry-point risk**: if `?selected=<id>` (or `/proveedores/<id>`) is the entry URL and
   that supplier is not on the master list's default page (page 1), the detail pane shows an item
   invisible in the currently-rendered master rows. There is no existing "find the page containing
   X" backend capability. Needs an explicit product decision — e.g., always default the master list
   to page 1 regardless of the mismatch, or add backend support (likely out of scope for a
   frontend-only fast-follow).
4. What happens when the selected/`:id` supplier is a 404/deleted/malformed-uuid — needs an
   explicit error/empty state distinct from "nothing selected yet."
5. No `q` search param exists on `GET /api/proveedores` (confirmed in `supplier-management/spec.md`).
   A search box needs either client-side filtering (small dataset — backlog says 4 seeded suppliers
   today) or a backend spec delta reopening the already-archived, backend-only #4 change's
   contract.
6. Whether `ProveedorSelector.tsx`/`useProveedoresActivos.ts` should be reused or left alone — the
   existing hook filters to `activo` only and caps at 100, the wrong default for a master list that
   must also show inactive suppliers.

## Risks

- Zero master-detail-with-selection precedent anywhere in the codebase — this is genuinely new
  pattern work; do not size/estimate it at parity with prior UI fast-follows (pantalla-usuarios,
  productos-ui) that copied an existing separate-route shape.
- Deep-link-into-unknown-page problem has no established solution in this codebase; needs an
  explicit product decision before spec/design, or it will surface later as an ambiguous scenario
  during apply/verify.
- Backend has no search/filter param; adding one would reopen an already-archived, "backend only"
  spec (`supplier-management`).
- `AppShell.tsx`'s `NAV_ITEMS` array has no covering tests today — new coverage should not simply
  extend the same untested pattern.

## Ready for Proposal

Yes. Backend is stable and closed; scope is purely new frontend surface. The open questions above
(route shape, push/replace, deep-link-into-unknown-page, search scope) should be resolved as
explicit decisions in the proposal, not left implicit.
