# Exploration: Reportes (backlog #12)

## Current state

No `reportes` module exists yet (no `apps/api/src/reportes/`, no
`apps/web/src/features/reportes/`, no prior `openspec/changes/reportes/` artifacts). Depends on #6
(movimientos) and #7 (punto-de-venta), both archived on `main`.

Existing read infrastructure:

- **Stock actual**: `apps/api/src/productos/repository.ts:109` `ProductosRepo.list()` already
  returns paginated `Producto[]` with `stockActual`/`stockMinimo`. `GET /api/productos`
  (`apps/api/src/routes/productos.ts:124`) already allows `['encargado', 'deposito']`.
- **Bajo mínimo**: NOT a server-side query. `estadoStock()`
  (`apps/web/src/features/productos/format.ts`) is a pure frontend classifier applied to rows
  already fetched — `ListProductosOpts` (`productos/repository.ts:42`) only supports
  `soloActivos` today, no stock-threshold predicate.
- **Movimientos por período**: `apps/api/src/movimientos/repository.ts` —
  `MovimientosRepo.listByProducto(productoId, page, pageSize)` is scoped to ONE product, no
  date-range, no actor filter, no cross-producto listing. `resumenRotacion(productoId)` (from #11)
  is also per-product. A cross-producto, period-filtered, paginated method does not exist.
- **Discrepancias**: two independent surfaces, genuinely ambiguous which one the report reads:
  `movimientos.esDiscrepancia` (boolean column, CHECK-restricted to `tipo='ajuste'`) vs.
  `AlertasRepo` (`apps/api/src/alertas/repository.ts`) which already has `TipoAlerta='discrepancia'`
  and a working `list(filtro, page, pageSize)`, but `FiltroAlertas` only supports `{estado?}` today,
  not `{tipo?}`.
- **Pagination**: `apps/api/src/lib/pagination.ts` — `paginated(data, page, pageSize, total)` →
  `{data, page, pageSize, total}`. Directly reusable; every existing list route already uses it.
- **Empty states**: purely a frontend convention, not a backend contract — `{data: [], total: 0}`
  is already structurally distinct from an error envelope. Precedent: `AlertasTable.tsx:121-123`
  and `ProveedoresTable.tsx:124-126` both do `if (rows.length === 0) return <p>...</p>`.
- **RBAC precedent**: `apps/api/src/plugins/auth.ts:35-97` — default-deny, per-endpoint only, via
  `config.roles`. No existing route does row-level (`usuario_id = :actor`) filtering — this would
  be the first.

## The RBAC split — quoted verbatim

`docs/PRD.md:39-42` (matrix): `| Ver reportes | ✅ | 🔒 (operativos) |`

`docs/PRD.md:62-64`:
> **Reportes**: el personal de depósito ve reportes operativos (stock, bajo mínimo, sus propios
> movimientos); los reportes de gestión/valor y el de discrepancias globales quedan para el
> encargado.

`docs/TECH-DESIGNv2.md:341-348`:
> - [ ] El encargado ve reportes de stock actual, bajo mínimo, movimientos por período y
>   **discrepancias globales** (ajustes con `es_discrepancia = true`); el personal de depósito ve
>   solo reportes operativos (stock, bajo mínimo, sus propios movimientos) y **no** el de
>   discrepancias globales.
> - [ ] Un reporte sobre un período sin movimientos muestra un **estado vacío** explícito
>   (distinto de un error).

`docs/REVISION-ADVERSARIAL.md:468-491` (finding A6):
> La matriz del PRD da al depósito reportes operativos incluyendo "**sus propios** movimientos"...
> Eso es autorización a **nivel de fila**... **Resolución**: ADR-0007 aclara que el middleware de
> RBAC cubre autorización **por endpoint**, y que el filtrado por dueño ("mis movimientos") es
> responsabilidad de la capa de servicio/consulta (`WHERE usuario_id = :actor` explícito).

**Ambiguity resolved**: `PRD.md:62-64` (not just the backlog one-liner) answers it — deposito sees
all three: stock actual (unfiltered, same as encargado), bajo mínimo (unfiltered), and movimientos
filtered to `usuario_id = :actor`. Discrepancias globales is denied outright, not filtered. One
residual ambiguity: TECH-DESIGNv2 says encargado's movimientos report is "por período" but PRD's
deposito phrasing drops that qualifier — unclear if deposito's is the same period-filterable query
row-scoped, or a simpler own-history list.

## Affected areas

- `apps/api/src/productos/repository.ts` — needs a bajo-mínimo predicate/method.
- `apps/api/src/movimientos/repository.ts` — needs a new cross-producto, date-range, actor-optional
  method.
- `apps/api/src/alertas/repository.ts` — `FiltroAlertas` may need a `tipo` field, or bypassed in
  favor of a movimientos-based discrepancy query.
- `apps/api/src/plugins/auth.ts` / new `apps/api/src/reportes/` — first `WHERE usuario_id = :actor`
  service-layer filter in the codebase.
- `apps/web/src/features/reportes/` (new) — no wireframe exists, mirrors #3.1/#4.1's prior gap.

## Approaches

1. **4 separate report endpoints, each backed by a purpose-built repo query** — clean separation,
   matches the product's 4-report framing, easy per-role gating.
   - Pros: simple RBAC per route; each query stays small and testable.
   - Cons: some duplication between encargado/deposito variants of the same report.
   - Effort: Medium.
2. **Fewer endpoints with role-driven projections/filters baked into the service layer** (e.g. one
   movimientos-report endpoint that auto-scopes by actor when `role==='deposito'`) — less
   duplication, but the row-level filter becomes implicit, easier to get wrong.
   - Pros: less code, one query per concept.
   - Cons: authorization logic embedded in query-building is riskier to audit than route-level
     `config.roles`.
   - Effort: Medium.

**Recommendation**: Approach 1 (purpose-built endpoints per report, actor-scoping applied
explicitly in the service/query layer per A6's resolution) — matches every existing precedent in
this codebase (`proveedores.ts`, `usuarios.ts` per-route `config.roles`), keeps the novel row-level
filter isolated and easy to test/audit rather than hidden inside a shared branch.

## Open questions for the proposal phase

1. **Discrepancias data source**: `alertas` (tipo='discrepancia', has resolution state) vs.
   `movimientos.esDiscrepancia` (permanent historical record, no resolution state) — materially
   different semantics, unresolved in source docs.
2. **Deposito's movimientos report scope**: same period-filterable query as encargado's (just
   row-scoped), or a simpler own-history list without a date-range filter? PRD's phrasing for
   deposito drops the "por período" qualifier that TECH-DESIGNv2 uses for encargado.

## Risks

- Bajo-mínimo report must not be "fetch-all-then-filter-client-side" — breaks pagination
  correctness against the filtered set (mirrors the documented trap in `productos/repository.ts`
  about applying the same predicate to both page and count queries).
- Discrepancias data-source choice (alertas vs. movimientos) is unresolved in source docs and
  materially changes report semantics (alert resolution state vs. permanent historical record) —
  must be closed before spec/design.
- Row-level actor scoping (`usuario_id = :actor`) is unprecedented in this codebase; needs new test
  coverage patterns (assert deposito A never sees deposito B's data).
- No wireframe/mockup exists for reportes screens.
- Backlog line 47 is a compressed paraphrase; propose should cite `PRD.md:62-64` directly, not
  re-derive from it.

## Ready for proposal

Yes — RBAC split is resolved from source docs. Two open design questions (discrepancias data
source; deposito's movimientos-por-período scope) should be surfaced explicitly for the owner in
the proposal phase.
