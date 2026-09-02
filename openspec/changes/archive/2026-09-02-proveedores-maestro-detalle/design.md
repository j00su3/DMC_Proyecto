# Design: Proveedores Maestro-Detalle (backlog #4.1)

## Technical Approach

One route (`/proveedores`) under `shellLayout`, rendering a two-pane CSS grid (`340px 1fr`,
`docs/design.md:93`) whose selection lives in a Zod-validated search param. One list query feeds
both panes; the detail pane derives its record from the already-fetched list rather than issuing a
second request. Write controls gate per component off `useRouteContext().usuario.rol`, exactly as
`productosDetalle.tsx` does. No backend change (PD-1).

## Architecture Decisions

### D1 — Route shape: single route with `?selected=`

| Option | Tradeoff |
|---|---|
| **Chosen**: one `proveedoresRoute` + `validateSearch` `?selected=` | Reuses the exact `.catch()`-never-throw idiom of `productos.tsx:24-31,43`; one route file added to the flat `routeTree.ts:29-48` |
| Rejected: layout route + `/proveedores/$id` child in an `Outlet` slot | Three route entries instead of one, and would be the **first** layout-route-with-slot in this codebase — `routeTree.ts` is entirely flat-under-`shellLayout` today |

**Rationale**: `validateSearch` has a strong precedent here and Outlet-slot nesting has none.
PD-2's not-found is also a pane state, not a route error — one component owns it without a child
error boundary. Deep-linking is satisfied identically (`?selected=<uuid>` is bookmarkable).

### D2 — Selection navigation uses `replace: true`

`productos.tsx:80` replaces (same screen, changes what is shown); `productos.tsx:118` pushes
(changes which records exist). Row selection is the first kind: the pane is already mounted and
only its subject changes. Pushing one history entry per row click would make Back walk selection
history instead of leaving the screen.

### D3 — Fresh query, detail derived from the list

- New `features/proveedores/queries.ts`: `proveedoresKeys` factory (shape of
  `features/productos/queries.ts:6-13`) + `proveedoresListQueryOptions()` fetching
  `/proveedores?page=1&pageSize=100` (100 is the server ceiling, `apps/api/src/lib/pagination.ts:5`).
- `useProveedoresActivos.ts` is **left untouched** — its `select` filters `activo` and its key is
  `['proveedores','activos']`. Extending it would make `features/productos` depend on this feature.
- **Every mutation here must invalidate `proveedoresActivosKeys.all` too**, or creating a supplier
  on this screen leaves `ProductoForm`'s dropdown stale.
- No `useProveedor(id)` hook: `proveedorDto` is byte-identical between the list and detail
  responses (`apps/api/src/routes/proveedores.ts:18-33`), so `GET /proveedores/:id` returns zero new
  information. Detail = `data.find(p => p.id === selected)`; a miss renders PD-2's "Proveedor no
  encontrado". Malformed uuid and non-existent id collapse to the same client path, independent of
  the server's 400-vs-404 split.

### D4 — Filter state is component `useState`, not a search param

`q` is a search param in `productos.tsx` because the loader participates in it (server-side
filter). Here the filter never reaches the server, so a URL surface with no data consequence would
be dead weight. Precedent for local input state: `reciboBuscar.tsx:33`. Matches case-insensitive
substring against `nombre` **and** `contacto` (null-safe) — mirroring the two-field server search
in `productos/repository.ts:115-120`.

### D5 — RBAC shape (PD-3)

`const isDeposito = usuario.rol === 'deposito'` (`productosDetalle.tsx:53,57`); action buttons take
`disabled={isDeposito}` plus a module-level lock-reason paragraph rendered as
`<span aria-hidden="true">🔒</span> {REASON}` (`productosDetalle.tsx:25-26,148-168`).
Divergence from `ProductoForm.tsx:107-120`'s per-field `disabled`: proveedores has **zero**
deposito write routes (`routes/proveedores.ts:86-89`), so `ProveedorForm` gets a `readonly` mode
rendering a `<dl>` instead of disabled inputs. "+ Nuevo proveedor" is hidden for deposito, matching
`productosDetalle.tsx:169-173` (hide a control the server refuses outright).

### D6 — Create form is local `isCreating` state (PD-5)

Not a `?selected=nuevo` sentinel — that would need a carve-out in the PD-2 not-found path. Pane
precedence: `isCreating` → create form; else `selected` → detail/not-found; else placeholder.
Precedent for screen-held transient state: `pos.tsx:38`, `productosDetalle.tsx:59`. On success,
clear the flag and `navigate({ search: { selected: newId }, replace: true })`
(`reciboBuscar.tsx:45-50` precedent).

## Data Flow

    URL ?selected ──► proveedoresRoute.useSearch()
                              │
    useProveedores() ─► full list ─► ProveedoresTable (filtered, local q)
             │                              │ onSelect(id) → navigate(replace)
             └──────► find(selected) ──► DetallePanel | NotFound | Placeholder
                                              │ mutations → invalidate
                                              └─► proveedoresKeys.all + proveedoresActivosKeys.all

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/web/src/routes/proveedores.tsx` | Create | Route + screen; `validateSearch`, loader `ensureQueryData().catch()` (`productos.tsx:45-53`) |
| `apps/web/src/routes/proveedores.module.css` | Create | `grid-template-columns: 340px 1fr` — same route-level module shape as `pos.module.css:1-6` |
| `apps/web/src/routes/routeTree.ts` | Modify | Register under `shellLayout`, never `encargadoLayout` |
| `apps/web/src/features/proveedores/queries.ts` | Create | Key factory + list query options |
| `.../useProveedores.ts` | Create | List hook |
| `.../useCrearProveedor.ts`, `useActualizarProveedor.ts`, `useEstadoProveedor.ts` | Create | Mutations; `useEstadoProducto.ts:15-30` shape, `POST /proveedores/:id/{deactivate,reactivate}` |
| `.../errorMessages.ts` | Create | `SUPPLIER_NOT_FOUND`, `SUPPLIER_NAME_IN_USE`, `VALIDATION_ERROR`, `FORBIDDEN` |
| `.../schemas.ts` | Create | react-hook-form values ↔ wire; empty `contacto` → `null` |
| `.../ProveedoresTable.tsx` | Create | Presentational, `onSelect` callback (`ProductosTable.tsx:32` boundary), `StatusChip activo` |
| `.../ProveedorDetallePanel.tsx`, `ProveedorForm.tsx` (+ `.module.css`) | Create | Detail/create/edit + readonly mode |
| `apps/web/src/components/ui/AppShell.tsx` | Modify | Line 20: `{ label: 'Proveedores', to: '/proveedores' }` |

## Interfaces / Contracts

```ts
const proveedoresSearchSchema = z.object({
  selected: z.string().uuid().optional().catch(undefined),
});
```

`.catch(undefined)` keeps the never-throw idiom. **Note**: a malformed id therefore normalises to
"nothing selected", so PD-2's not-found must be driven by a *well-formed but unresolvable* id;
non-uuid junk is not distinguishable from no selection under this schema. If PD-2 must also cover
non-uuid junk, use `z.string().optional().catch(undefined)` and validate shape in the pane instead.
Tasks must pick one explicitly.

```ts
// contacto: '' is NOT a third spelling of null (routes/proveedores.ts:46-47)
contacto: values.contacto.trim() === '' ? null : values.contacto.trim()
```

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `errorMessages`, filter predicate, form→wire mapping (empty contacto → `null`) | Pure-function tests, `errorMessages.test.ts` shape |
| Component | `ProveedoresTable` `onSelect`, `ProveedorForm` readonly vs edit, 🔒 reason visible for deposito | RTL + user-event |
| Route | Deep link resolves; unresolvable id shows not-found (not placeholder); deposito sees no write affordance; create selects the new row; nav entry reaches `/proveedores` | `proveedores.test.tsx`, **`await router.load()` before every render** (CLAUDE.md) |

Route-level coverage is mandatory here: this screen's whole risk is key/selection wiring, which
hook tests cannot see.

## Threat Matrix

N/A — every row targets shell, VCS, or executable-file boundaries. This change adds client-side SPA
routing only: no shell command, subprocess, VCS/PR automation, executable-file classification, or
process integration. The one untrusted input (`?selected`) is handled by D1's Zod schema and never
reaches an interpreter.

## Migration / Rollout

No migration required. Additive; revert by reverting the commit.

## Open Questions

- [x] **Ratified by owner, 2026-09-01**: past the 100-supplier `pageSize` ceiling, the list may
      silently truncate and a valid deep link past that ceiling could render a false "Proveedor no
      encontrado". Accepted as a known v1 limitation, not fixed — matches PD-1's own reasoning
      (this shop's supplier catalog won't realistically reach 100 for years); revisit only if it
      ever becomes real. The `GET /proveedores/:id` fallback contingency above is explicitly **not**
      built for v1.
- [x] **Ratified by owner, 2026-09-01**: non-uuid `?selected` junk stays normalised to "nothing
      selected" (D1's `.catch(undefined)` schema, unchanged) — PD-2's distinct not-found state
      applies only to a well-formed uuid that doesn't resolve to a real proveedor, not to malformed
      input. Rationale: malformed junk is almost always a hand-typed bad link, not a real "it existed
      and got deleted" case a user needs to be told about distinctly.
- [ ] Filter label copy ("Buscar por nombre o contacto") is user-visible; D4 chose the fields on
      backend-search precedent, but the wording is product's.
