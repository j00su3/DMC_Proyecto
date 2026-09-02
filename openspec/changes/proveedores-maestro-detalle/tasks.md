# Tasks: Proveedores Maestro-Detalle (backlog #4.1)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1150-1300 (impl ~800, tests ~450) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 (data layer) → PR 2 (components) → PR 3 (route wiring) |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending — user must pick before apply |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

Rationale: genuinely new master-detail-with-selection pattern (no codebase precedent, per
proposal's own Risks table), plus a mandatory route-level test file covering 5+ scenarios
(`proveedores.test.tsx`) that alone is expected to run 200+ lines.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Data layer: keys, list query, mutations, error/schema mapping — no UI | PR 1 | `pnpm --filter @inventienda/web exec vitest run src/features/proveedores/errorMessages.test.ts src/features/proveedores/schemas.test.ts src/features/proveedores/useProveedores.test.ts src/features/proveedores/useCrearProveedor.test.ts src/features/proveedores/useActualizarProveedor.test.ts src/features/proveedores/useEstadoProveedor.test.ts` | N/A — pure hooks/mappers, no route to load | Delete `features/proveedores/{queries,useProveedores,useCrearProveedor,useActualizarProveedor,useEstadoProveedor,errorMessages,schemas}.ts` and their tests; nothing else references them yet |
| 2 | Presentational components: table, form (edit/readonly), detail panel | PR 2 | `pnpm --filter @inventienda/web exec vitest run src/features/proveedores/ProveedoresTable.test.tsx src/features/proveedores/ProveedorForm.test.tsx src/features/proveedores/ProveedorDetallePanel.test.tsx` | N/A — RTL component tests, no route mounted yet | Delete `features/proveedores/{ProveedoresTable,ProveedorForm,ProveedorDetallePanel}.tsx(+.module.css)` and their tests; PR 1 hooks stay valid standalone |
| 3 | Route wiring: `/proveedores` screen, nav entry, integration | PR 3 | `pnpm --filter @inventienda/web exec vitest run src/routes/proveedores.test.tsx` | `pnpm --filter @inventienda/web dev` then navigate to `/proveedores` as encargado and deposito | Revert `routes/proveedores.tsx`, `routes/proveedores.module.css`, the `routeTree.ts` registration line, and the one `AppShell.tsx` `to:` line — PR 1/2 units stay valid unconsumed |

## Phase 1: Data Layer & Pure Logic

- [x] 1.1 RED: `errorMessages.test.ts` — asserts mapping for `SUPPLIER_NOT_FOUND`, `SUPPLIER_NAME_IN_USE`, `VALIDATION_ERROR`, `FORBIDDEN`
- [x] 1.2 GREEN: create `features/proveedores/errorMessages.ts` implementing the mapping
- [x] 1.3 RED: `schemas.test.ts` — form values → wire, empty `contacto` → `null` (never `''`)
- [x] 1.4 GREEN: create `features/proveedores/schemas.ts` (react-hook-form values ↔ wire mapping)
- [x] 1.5 RED: `useProveedores.test.ts` — loading/success list state
- [x] 1.6 GREEN: create `features/proveedores/queries.ts` (`proveedoresKeys` factory + `proveedoresListQueryOptions()` fetching `/proveedores?page=1&pageSize=100`) and `useProveedores.ts`
- [x] 1.7 RED: `useCrearProveedor.test.ts`, `useActualizarProveedor.test.ts`, `useEstadoProveedor.test.ts` — each asserts invalidation of both `proveedoresKeys.all` **and** `proveedoresActivosKeys.all`
- [x] 1.8 GREEN: create the three mutation hooks mirroring `useEstadoProducto.ts:15-30`; deactivate/reactivate call `POST /proveedores/:id/{deactivate,reactivate}`

## Phase 2: Presentational Components

- [x] 2.1 RED: `ProveedoresTable.test.tsx` — `onSelect` callback fires with id, `StatusChip activo` renders, filter predicate matches `nombre`/`contacto` case-insensitively (null-safe `contacto`)
- [x] 2.2 GREEN: create `ProveedoresTable.tsx` — local `q` `useState`, input label **"Buscar por nombre o contacto"** (chosen copy — mirrors `productos.tsx:105`'s "Buscar por nombre o SKU" tone for this app)
- [x] 2.3 RED: `ProveedorForm.test.tsx` — edit-mode submit updates values; readonly mode renders a `<dl>` with zero editable inputs
- [x] 2.4 GREEN: create `ProveedorForm.tsx` + `.module.css` with edit/readonly modes
- [x] 2.5 RED: `ProveedorDetallePanel.test.tsx` — 🔒-prefixed reason visible for deposito on each disabled control; deactivate/reactivate is one button, no modal; create-new only for encargado
- [x] 2.6 GREEN: create `ProveedorDetallePanel.tsx` wiring `ProveedorForm` + action buttons, `isDeposito` gate (`productosDetalle.tsx:53,57` pattern)

## Phase 3: Route Wiring & Integration

- [ ] 3.1 RED: `routes/proveedores.test.tsx` — deep link with valid `?selected=<uuid>` resolves that supplier's detail (`await router.load()` before render)
- [ ] 3.2 RED (same file): well-formed but unresolvable uuid shows PD-2 not-found, not the placeholder; no `?selected` shows placeholder; deposito sees no write affordance; successful create selects the new row; `AppShell` nav entry reaches `/proveedores`
- [ ] 3.3 GREEN: create `routes/proveedores.tsx` — `validateSearch` = `z.object({ selected: z.string().uuid().optional().catch(undefined) })`, loader `ensureQueryData().catch()`, pane precedence `isCreating` → `selected` → placeholder, `navigate({ search, replace: true })` on select/create-success
- [ ] 3.4 GREEN: create `routes/proveedores.module.css` (`grid-template-columns: 340px 1fr`)
- [ ] 3.5 GREEN: register `proveedoresRoute` in `routeTree.ts` under `shellLayout` (never `encargadoLayout`)
- [ ] 3.6 GREEN: modify `AppShell.tsx` line 20 — `{ label: 'Proveedores', to: '/proveedores' }`
- [ ] 3.7 Verify: `pnpm -r test`, `pnpm typecheck`, `pnpm lint`; confirm `ProveedorSelector.tsx`/`useProveedoresActivos.ts` remain byte-unchanged

## Phase 4: Cleanup

- [ ] 4.1 Remove unused imports/dead code across new `features/proveedores/*` files
- [ ] 4.2 Update `docs/BACKLOG.md` marking #4.1 status per this repo's SDD workflow convention
