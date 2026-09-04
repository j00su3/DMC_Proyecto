# Design: Reportes (backlog #12)

## Technical Approach

Four read-only endpoints under `apps/api/src/routes/reportes.ts`, each with its own
`config.roles`, backed by a new `reportes/service.ts` orchestration layer and additive
widenings to the existing `ProductosRepo` / `MovimientosRepo` / `AlertasRepo` ports — no new
table, no new repo class. Stock actual reuses `ProductosRepo.list()` unmodified. The other
three need new query surface, designed below as D1–D6. Row-level actor scoping for
deposito's movimientos view lives in `reportes/service.ts` only, per ADR-0007/finding A6 —
never in `plugins/auth.ts`.

## Architecture Decisions

### D1 — `ProductosRepo.bajoMinimo`: new dedicated method, not a `list()` opt

| Option | Tradeoff |
|---|---|
| Thread `bajoMinimo?: boolean` into `ListProductosOpts` | Reuses `list()`'s pagination, but forces its `if/else` `whereCondition` branch (today: search XOR `soloActivos`) into a generic multi-predicate `and()` — touches a method already used by `GET /api/productos` and the POS catalog read, raising blast radius for an unrelated report feature. |
| **New `bajoMinimo(page, pageSize): Promise<{rows, total}>` method** (chosen) | Isolated, single-predicate, zero risk to `list()`'s existing callers; mirrors the file's own precedent of one query per concern (`aplicarDelta` vs `revertirStockPorAnulacion`). |

Predicate (both page and count query, per the file's own D7/D11 trap comment):
`stockActual <= stockMinimo AND stockMinimo IS NOT NULL`. `<=` is inclusive of
exactly-at-threshold — matches proposal.md's ratified text verbatim. Order:
`asc(stockActual), asc(id)` (most-depleted first, deterministic tie-break) — an
implementation default, not a ratified requirement; noted in Open Questions.

### D2 — `MovimientosRepo.listByPeriodo`: bare rows, new index required

**Row shape**: returns bare `Movimiento[]` (same shape as `listByProducto`), **not** a
joined view. `productoNombre` resolution happens in `reportes/service.ts` via a per-row
`ProductosRepo.findById` lookup — this is not a new pattern, it is `alertas/service.ts`'s
existing D6 idiom (`listar()`, lines 62-79: "an N+1 per-row lookup, not a repository join —
same idiom as `ventas/service.ts::getRecibo`"). Reusing it keeps `MovimientosRepo`'s port
"deliberately narrow" (its own doc comment) and avoids introducing a second joined-DTO shape
into a codebase that has exactly one convention for this already.

**Signature**:
```ts
listByPeriodo(
  filtro: { fechaDesde: Date; fechaHastaExclusiva: Date; usuarioId?: string },
  page: number,
  pageSize: number,
): Promise<{ rows: Movimiento[]; total: number }>
```
Predicate: `and(gte(fecha, fechaDesde), lt(fecha, fechaHastaExclusiva), usuarioId ? eq(usuarioId, ...) : undefined)` — applied identically to page and count query (extends the D7/D11/D9 precedent to a third repo). Order: `desc(fecha), desc(id)`, matching `listByProducto`.

**Index — migration required**: `schema.ts`'s only movimientos index is
`movimientos_producto_id_fecha_idx` on `(productoId, fecha)`, leading column `productoId`.
This cross-producto query has no `productoId` predicate, so that index cannot serve it as an
index-condition scan. **A new index `movimientos_fecha_idx` on `(fecha)` is needed** — serves
encargado's path directly (range scan + `ORDER BY fecha DESC`) and deposito's actor-filtered
path via range scan + `Filter` on `usuarioId` (acceptable at this project's declared
single-shop scale; a compound `(usuarioId, fecha)` index is a future optimization, not
justified now — YAGNI). **This requires a new Drizzle migration**; per `CLAUDE.md`, Neon
migrations run manually (`pnpm db:migrate`) and are not part of the Render deploy — flag as a
manual post-merge step, same as every prior schema change in this project.

### D3 — Actor-scoping: service-layer only, no client-supplied actor field

```ts
// reportes/service.ts
export interface ReadRepos {
  movimientos: Pick<MovimientosRepo, 'listByPeriodo'>;
  productos: Pick<ProductosRepo, 'findById' | 'list'>;
  alertas: AlertasRepo;
}

export interface ListarMovimientosPeriodoInput {
  fechaDesde: Date;
  fechaHasta: Date; // calendar-day inclusive; converted to fechaHastaExclusiva below
  page: number;
  pageSize: number;
  actor: { id: string; rol: 'encargado' | 'deposito' };
}

export async function listarMovimientosPeriodo(
  repos: ReadRepos,
  input: ListarMovimientosPeriodoInput,
): Promise<{ rows: MovimientoConProducto[]; total: number }> {
  const usuarioId = input.actor.rol === 'deposito' ? input.actor.id : undefined;
  const fechaHastaExclusiva = addDays(input.fechaHasta, 1); // half-open interval
  const { rows, total } = await repos.movimientos.listByPeriodo(
    { fechaDesde: input.fechaDesde, fechaHastaExclusiva, usuarioId },
    input.page, input.pageSize,
  );
  // D6-style per-row productoNombre resolution — mirrors alertas/service.ts::listar
  ...
}
```
`input.actor` is populated only from `requireActor(request.user)` (session-derived — same
helper `productos/service.ts` and `routes/movimientos.ts` already import and use). The route's
Zod querystring schema (D5) has **no `usuarioId`/`actor` field at all** — there is nothing for
a client to supply and nothing to "ignore"; the wire contract structurally cannot carry it.
This mirrors finding A6's resolution verbatim: RBAC middleware (`config.roles`) stays
per-endpoint only (both roles get `200` from the same route); the row-level `WHERE usuario_id`
decision is one `if` inside this service function, never inside `plugins/auth.ts`.

### D4 — `AlertasRepo.list()` widening for discrepancias globales

`FiltroAlertas` gains one additive field, mirroring `estado?`:
```ts
export interface FiltroAlertas {
  estado?: EstadoAlerta;
  tipo?: TipoAlerta;
}
```
`list()`'s condition changes from a single ternary to a composed `and()` of both optional
predicates — `and()` already tolerates `undefined` members elsewhere in this codebase
(`productos/repository.ts:126`), so this is a direct extension, not a new pattern:
```ts
const condition = and(
  filtro.estado ? eq(alertas.estado, filtro.estado) : undefined,
  filtro.tipo ? eq(alertas.tipo, filtro.tipo) : undefined,
);
```
Applied identically to the page and count query (extends the file's own D9 comment).
`GET /api/reportes/discrepancias` calls the **existing** `alertas/service.ts::listar(repos, { filtro: { tipo: 'discrepancia' }, page, pageSize })` directly — it already resolves `productoNombre` per row (D6) and needs zero new service code, only the repo-level `tipo` field.

### D5 — Routes and Zod schemas

`routes/reportes.ts`, four routes, mirroring `productos.ts`/`movimientos.ts`'s
`config.roles` shape:

| Route | Roles | Query schema |
|---|---|---|
| `GET /api/reportes/stock-actual` | `['encargado','deposito']` | `pageQuerySchema` — calls `productosService.listProductos` unmodified |
| `GET /api/reportes/bajo-minimo` | `['encargado','deposito']` | `pageQuerySchema` — calls new `productosService.listBajoMinimo` (thin wrapper over D1) |
| `GET /api/reportes/movimientos` | `['encargado','deposito']` | `pageQuerySchema.extend({ fechaDesde, fechaHasta })` (below) |
| `GET /api/reportes/discrepancias` | `['encargado']` | `pageQuerySchema` |

```ts
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD');
const movimientosPeriodoQuerySchema = pageQuerySchema
  .extend({ fechaDesde: isoDateSchema, fechaHasta: isoDateSchema })
  .refine((v) => v.fechaDesde <= v.fechaHasta, {
    message: 'fechaDesde must be <= fechaHasta',
    path: ['fechaDesde'],
  });
```
String comparison is valid for `YYYY-MM-DD` lexicographic order. A refine failure surfaces
through Fastify's existing schema-validation-error mapping (`lib/errors.ts:353-398`) as a
`400 VALIDATION_ERROR` — no new error factory (D6 below justifies this choice).
`fechaHasta` is calendar-day **inclusive**; the service converts it to a half-open
`[fechaDesde, fechaHasta + 1 day)` interval (D2/D3) before it ever reaches the repo, since
`movimientos.fecha` is `timestamptz` and a bare date string parses to that day's midnight.

## Data Flow

    GET /api/reportes/movimientos?fechaDesde&fechaHasta&page&pageSize
         │ (Zod: shape + fechaDesde<=fechaHasta)
         ▼
    routes/reportes.ts ──requireActor(request.user)──▶ reportes/service.ts
                                                          │ rol==='deposito'? force usuarioId=actor.id : undefined
                                                          ▼
                                          MovimientosRepo.listByPeriodo (D2)
                                                          │ rows: Movimiento[]
                                                          ▼
                                    per-row ProductosRepo.findById (D6 idiom)
                                                          │
                                                          ▼
                                            paginated({...rows, productoNombre})

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/src/productos/repository.ts` | Modify | Add `bajoMinimo(page, pageSize)` (D1) |
| `apps/api/src/productos/service.ts` | Modify | Add `listBajoMinimo` thin wrapper |
| `apps/api/src/movimientos/repository.ts` | Modify | Add `listByPeriodo` (D2) |
| `apps/api/src/db/schema.ts` | Modify | Add `movimientos_fecha_idx` on `(fecha)` |
| new Drizzle migration | Create | `drizzle-kit generate` output for the index; manual `pnpm db:migrate` against Neon post-merge |
| `apps/api/src/alertas/repository.ts` | Modify | `FiltroAlertas.tipo`, widen `list()` condition (D4) |
| `apps/api/src/reportes/service.ts` | Create | Orchestrates all 4 reports; owns actor-scoping (D3) |
| `apps/api/src/routes/reportes.ts` | Create | 4 routes, `config.roles` per route (D5) |
| `apps/api/src/app.ts` | Modify | Register `reportesRoutes` |
| `apps/web/src/features/reportes/` | Create | Basic tables, empty state per screen (proposal.md scope; frontend architecture not detailed here — out of this task's D-numbered ask) |

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | D1/D2/D4 predicates apply to both page and count query | Fake `DbExecutor`/query-builder assertions, mirroring existing repo tests |
| Unit | D3 actor-scoping: deposito never reaches repo without forced `usuarioId` | `reportes/service.test.ts`, assert repo call args per role |
| Integration | Deposito A never sees deposito B's movimientos | Real Postgres, two seeded actors — required per proposal.md, first row-level filter in this codebase |
| Integration | Empty-range report returns `{data:[], total:0}`, not an error | `routes/reportes.integration.test.ts` |
| Route | 403 for deposito on `/discrepancias`; malformed date range → 400 `VALIDATION_ERROR` | `routes/reportes.test.ts` |

## Threat / Edge-Case Matrix

| Case | Resolution | Rationale |
|---|---|---|
| Deposito supplies a different/absent actor to bypass row-scoping | Structurally impossible — Zod schema has no `usuarioId` field; service always uses `requireActor(request.user).id`, ignoring nothing because there is nothing to ignore | D3 |
| Empty-result report (zero rows) | Returns `paginated([], page, pageSize, 0)` — normal 200, same envelope as any other empty list | No special-case; `{data:[],total:0}` already distinct from the error envelope per `CLAUDE.md` |
| Malformed date range (`fechaDesde > fechaHasta`) | **400 `VALIDATION_ERROR`**, via Zod `.refine()` | Treated as a malformed request shape, not a query result — consistent with existing wire-shape validation precedent (`ventas/service.ts:305-332`); avoids masking a client bug as a misleadingly "successful" empty report |
| `page=0` / negative `pageSize` | Already rejected — `pageQuerySchema`'s `min(1)` on both fields | Reused as-is; reportes needs no additional pagination validation |

`N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary.`

## Migration / Rollout

One new index migration (D2), no data backfill, no feature flag. Additive-only changes to
three existing ports — no existing route or caller changes behavior. Must run
`pnpm db:migrate` against Neon manually post-merge per `CLAUDE.md`'s deployment note, or the
new report routes will 500 until it runs (only the movimientos-por-período route is affected;
the other three need no schema change).

## Open Questions

- [ ] `bajoMinimo`'s default order (`asc(stockActual)`, most-depleted first) is an
      implementation default, not called out in proposal.md's ratified scope — confirm with
      product owner during spec/UI review, or leave as-is if no objection surfaces.
- [ ] Stock-actual report route omits `q` (search) even though `ProductosRepo.list()`
      supports it — chosen as the minimal reading of "reuse as-is, no new query"; flag if the
      report is expected to support search.
