# Exploration: Gestión de Proveedores (backlog #4)

Phase: `sdd-explore` · Change: `gestion-proveedores` · Date: 2026-08-28
Artifact store: hybrid (Engram topic `sdd/gestion-proveedores/explore`)
Base: `main` at `16d984b`

## Purpose

Backlog #4 asks for encargado CRUD over suppliers, read-only access for `deposito`, logical
deactivation that preserves references and history, and a master-detail view. It arrives right
after #3 (user-management backend) and #3.1 (its UI), so the central question is not *how* to
build it but *how much is already built*.

## Current State

### Backend: the house pattern is established and reusable

`apps/api/src/usuarios/` plus `apps/api/src/routes/usuarios.ts` set a three-layer shape:
`routes/*.ts` (Fastify + Zod, `config: { roles: [...] }` per route) → `*/service.ts` (business
rules, `UnitOfWork` for writes) → `*/repository.ts` (a port plus its Drizzle adapter).
`UnitOfWork.run()` (`apps/api/src/db/uow.ts`) binds every repo in one transaction, and
`recordAudit()` runs inside it.

Reusable as-is, verified by reading each:

- `apps/api/src/lib/pagination.ts` — the `{ data, page, pageSize, total }` envelope
- `apps/api/src/lib/errors.ts` — the `{ error: { code, message, details? } }` envelope
- `apps/api/src/plugins/auth.ts` — per-route RBAC via `config.roles`

**The audit trail needs no migration.** `apps/api/src/db/schema.ts:61-73` already declares
`entidadAuditoria` as `['usuarios', 'proveedores', 'productos']` and `accionAuditoria` as
`['crear', 'actualizar', 'baja_logica', 'reactivar', 'cambiar_password']`. Every verb #4 needs
already exists.

**Corrected 2026-08-28**: this is only half true, and the half that is false matters. The Postgres
enum accepts the value, but the TypeScript gate is
`AuditableEntidad = keyof typeof FIELD_CLASSIFICATION` (`apps/api/src/auditoria/service.ts:8`),
and `apps/api/src/auditoria/fields.ts` classifies only `usuarios`. `recordAudit` with
`entidad: 'proveedores'` does not compile today. The change must add a `proveedores` entry to
that map and extend its exhaustiveness test. Checking the enum proved the database would accept
the value, not that the application would build.

Not reusable without work: `isUniqueViolation()` (`apps/api/src/usuarios/repository.ts:120-132`)
walks `error.cause` to depth 5 because Drizzle wraps pg errors in `DrizzleQueryError`. It is
usuarios-local. If suppliers need a unique column it must be extracted or duplicated — and
extracting it is the better answer, since the next entity will need it too.

### Frontend: the primitives exist, the layout does not

Reusable with zero changes, verified by reading each: `DataTable`, `Pagination`, `Modal`,
`StatusChip`, `AppShell`, `NavItem`. `NAV_ITEMS` in `AppShell.tsx` already lists
`{ label: 'Proveedores' }` as an inert marker; it needs only `to: '/proveedores'`.

The `apps/web/src/features/usuarios/` slice is a directly reusable structural template —
`queries.ts` (query-key factory), `use*.ts` hooks, `errorMessages.ts`, `schemas.ts`,
`format.ts`, presentational components. `formatFecha` is reusable verbatim.

**No master-detail, split-pane or selection-state component exists anywhere in the codebase.**
That is the one genuinely new piece of UI, and it is the cost driver.

**`encargadoLayout` does not fit this screen.** It guards a whole subtree, which is right for
Usuarios (encargado-only) and wrong for Proveedores, which `deposito` may read. The proveedores
routes must sit outside it, under `shellLayout`, with write controls gated at component level.
The server's 403 stays the real boundary — the same disclaimer already written into
`encargadoLayout.tsx`.

## The supplier-deactivation policy is settled — but not where you would look

`docs/PRD.md:179` lists *«Proveedor eliminado con productos aún asociados a él»* under **casos
borde a resolver** — as an open question, not a decision. Reading only the PRD would suggest
this is unresolved.

It is resolved, in `docs/TECH-DESIGN.md:69-71`:

> **Proveedor** — `id`, `nombre`, `contacto`, `activo`. Un producto referencia a un proveedor.
> Caso borde "proveedor eliminado con productos asociados": baja lógica (`activo = false`), no
> borrado físico, para no romper referencias ni historial.

And `docs/TECH-DESIGN.md:209-214` already carries acceptance criteria for this exact backlog item:

> - El encargado da de alta/edita proveedores; el personal de depósito solo los consulta (para
>   asociarlos a movimientos), recibiendo 403 al intentar crear/editar.
> - Eliminar un proveedor con productos asociados es una **baja lógica**; los productos
>   conservan la referencia y el historial no se rompe.

**There is no last-active-encargado analogue here.** The usuarios guard exists because removing
the last active encargado locks everyone out of administration — a system-wide invariant.
Deactivating the last supplier breaks nothing: products keep their FK, history keeps its rows,
and the shop keeps working. The absence is a real finding, not an oversight to design around.

## Findings against the investigation questions

### 1. Scope boundary

#3's backlog letter described backend only, which is what justified splitting #3.1 off. **#4's
letter names both the CRUD and the master-detail view in one line**, so splitting here diverges
from a literal reading and must be raised with the owner rather than decided silently.

The review-budget argument nevertheless points the same way as before, and now with real
calibration data rather than estimates:

| Shipped cycle | Actual authored lines |
| --- | --- |
| #3 `gestion-usuarios` — backend only, *including* lockout, temp passwords and the FOR UPDATE guard | ~2110 |
| #3.1 `pantalla-usuarios` — UI only, *without* master-detail | ~2705 |

#4's backend should land lighter than #3's, since it has no lockout, no temporary passwords and
no cross-row guard. Its UI should land heavier in one respect — the master-detail layout has no
precedent at all.

### 2. Master-detail

`docs/design.md:94` documents `Vistas maestro-detalle (Proveedores): 340px | 1fr`, scoped to
Proveedores by name. The archived `pantalla-usuarios` proposal declined this pattern for Usuarios
citing this exact line, so nothing is being contradicted — this is the view the design document
always meant it for.

`docs/design.md:95` admits the responsive story is unfinished: collapsing the sidebar on tablet
and stacking POS on mobile are «pendiente de diseño». Selection state, deep-linking a selected
supplier, and what the detail pane shows when nothing is selected are all undesigned.

### 3. Logical deactivation

Settled by `docs/TECH-DESIGN.md` as quoted above. Note that backlog **#5 (Productos) depends on
#4**, so products will carry a `proveedor_id` FK. Whatever #4 ships has to keep that reference
valid — which is exactly why the policy is deactivation rather than deletion.

### 4. Read-only for `deposito`

Backend: trivial. `config.roles` is per route, so `GET` takes `['encargado', 'deposito']` and the
writes take `['encargado']`, in one route file.

Frontend: this is the structural break from #3.1. `encargadoLayout` guards a subtree; a screen
both roles can see does not fit it. Routes go under `shellLayout` instead, and write affordances
are gated per control. Following the precedent this project already set, those gates are UX
affordances and must be documented as such — the server's 403 is the boundary, and a hidden
button is not access control.

### 5. Data model

`docs/TECH-DESIGN.md:69` names `id`, `nombre`, `contacto`, `activo`. One new table, one migration,
zero audit-enum changes.

Open, unresolved by any document: whether `nombre` is unique, and what shape `contacto` takes —
a single free-text field, or structured columns.

### 6. Testing

Vitest 4.1.10, RTL, `vi.stubGlobal('fetch', ...)`, integration tests against Docker Postgres
excluded from the default run. Strict TDD active.

Two rules this project learned the hard way and must carry into #4:

- **Every route test awaits `router.load()` before rendering.** A test that leans on `findBy`'s
  one-second retry to cover routing plus a guard fetch plus a query passes alone and fails under
  full-suite load.
- **Hook-level proof is not screen-level proof.** The #3.1 cycle shipped two defects behind fully
  green hook tests — one of them live in production since #2.1 — and both were caught only by
  router-level render tests.

### 7. Size forecast — low confidence, stated as such

Backend ~1000–1500 lines; UI ~1400–2200, the spread driven almost entirely by master-detail
having no precedent. Combined **~2400–3600 authored lines**, six to nine times the 400-line
budget, whether it ships as one change or two.

Treat this as a floor. On the previous cycle `sdd-tasks` underestimated by 17% to 165%, every
time because router-level integration tests are not in its estimation model.

## Risks

| Risk | Impact |
| --- | --- |
| Master-detail has zero in-repo precedent | Highest-uncertainty item; most likely place to under-plan router-test weight again |
| #4's letter names CRUD and UI in one item | Splitting diverges from a literal reading; needs the owner's explicit confirmation |
| `isUniqueViolation` is usuarios-local | Extract it if suppliers need a unique column; the next entity will want it too |
| `nombre` uniqueness and `contacto` shape undecided | No document settles either; must be answered before spec and design |
| Reading the PRD alone misleads | It files supplier deletion as an open edge case; `TECH-DESIGN.md` is where the decision lives |

## Ready For Proposal

Yes. The backend patterns, the reusable primitives, the settled deactivation policy and the
absence of a master-detail precedent are all verified against the files. Two product questions —
the scope split, and `nombre`/`contacto` — belong to the proposal round.
