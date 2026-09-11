# Design: Audit Trail Read-Back Endpoint (`auditoria-lectura`, closes D-01)

## Technical Approach

One new read path across the existing three layers: `AuditoriaRepo.list()` (new port method,
`and()`-composed optional predicates over the two live indexes) → `auditoria/service.ts::listar`
(new read wrapper that batch-resolves labels) → `routes/auditoria.ts` (`GET /api/auditoria`,
`roles: ['encargado']`, `paginated()` envelope). No `UnitOfWork` (read-only), no migration
(`auditoria_entidad_entidad_id_creado_en_idx` and `auditoria_usuario_id_creado_en_idx` already
exist — `schema.ts:127-135`, proven live by `auditoria/repository.integration.test.ts:39-49`).

**Correction to the proposal's premise.** The proposal states the batched design avoids "the N+1
trap `reportes/service.ts`'s `productoNombre` enrichment already had to dodge". Read at the
source, that enrichment did **not** dodge it: `reportes/service.ts:58-65` and
`alertas/service.ts:72-78` both `await repos.productos.findById()` once per row, and
`alertas/service.ts:45-46` documents the idiom verbatim as "an N+1 per-row lookup, not a
repository join". `inArray` appears nowhere in `apps/api/src`. So D3/D4 below introduce a **new**
batched pattern that deliberately departs from the house idiom, rather than reusing one. The
ratified "never a per-row query" constraint is what justifies the departure.

## Architecture Decisions

### D1 — `AuditoriaRepo.list()`: one `and()`-composed condition, reused by page and count

Follows `alertas/repository.ts::list` (lines 165-189) exactly, widened from two optional
predicates to three.

```ts
// repository.ts — read row type comes from the pgEnum, NOT from AuditableEntidad
export type EntidadAuditoria = (typeof entidadAuditoria.enumValues)[number];

export interface FiltroAuditoria {
  entidad?: EntidadAuditoria;
  entidadId?: string;
  usuarioId?: string;
}

export interface RegistroAuditoria {
  id: string; entidad: EntidadAuditoria; entidadId: string;
  accion: AuditAccion; usuarioId: string;
  datosPrevios: Record<string, unknown> | null;
  datosPosteriores: Record<string, unknown>;
  creadoEn: Date;
}

list(filtro: FiltroAuditoria, page: number, pageSize: number):
  Promise<{ rows: RegistroAuditoria[]; total: number }>;

// adapter
const condition = and(
  filtro.entidad   ? eq(auditoria.entidad,   filtro.entidad)   : undefined,
  filtro.entidadId ? eq(auditoria.entidadId, filtro.entidadId) : undefined,
  filtro.usuarioId ? eq(auditoria.usuarioId, filtro.usuarioId) : undefined,
);
// page query: .where(condition).orderBy(desc(creadoEn), desc(id)).limit().offset()
// count query: .where(condition)  ← the SAME object, never re-derived
```

The count query reuses the identical `condition` binding — this codebase's documented trap
(`alertas/repository.ts:159-164`, `proveedores/repository.ts` D9): applying a filter to only one
of the two queries is the single most likely defect here.

`desc(creadoEn), desc(id)` is not stylistic: `creado_en` defaults to `now()`, which is the
*transaction* timestamp, so every audit row written inside one `uow.run` shares the value
**exactly**. Without the `id` tiebreaker, OFFSET pagination over those ties can drop or duplicate
a row across pages.

**Read row type is `EntidadAuditoria` (pgEnum), not `AuditableEntidad`.** They are equal today
(all four pgEnum values have a `FIELD_CLASSIFICATION` entry), but `AuditableEntidad` is the
*write-side* compile gate (CLAUDE.md). A read path must be able to return any row Postgres
already stores; binding it to the write gate would make a stored row unrepresentable if the map
ever narrows.

### D2 — `entidadId` requires `entidad` (400, Zod `.refine`)

| Option | Tradeoff |
|---|---|
| Accept bare `entidadId` | `auditoria_entidad_entidad_id_creado_en_idx` leads with `entidad`, so this degrades to a seq scan; and `entidad_id` carries no FK (ADR-0011), so a uuid is not table-unique by construction. |
| **Require `entidad` whenever `entidadId` is present** (chosen) | Keeps every filtered query index-served; matches the proposal's "`entidad`+`entidadId`" filter *group*. Surfaces as `400 VALIDATION_ERROR` through the existing mapping — no new error factory, same mechanism as `movimientosPeriodoQuerySchema`'s refine (`routes/reportes.ts:36-41`). |

`entidad` alone stays valid (leading index column). All three filters compose with AND (ratified).

### D3 — Enrichment in the service, over four narrow `findManyByIds` port additions

| Option | Tradeoff |
|---|---|
| Polymorphic join inside `AuditoriaRepo` | One SQL round trip, but `auditoria/repository.ts` would SELECT from four tables it does not own — no repo in this codebase reads another domain's table. |
| **Service composes over per-domain batched lookups** (chosen) | Mirrors `reportes/service.ts`'s cross-repo composition at the service layer; each table stays owned by its own repo; fakeable in route tests without a database. |

Four additive port methods, each a single `inArray` SELECT returning a **narrow projection**, not
the full row:

```ts
UsuariosRepo.findManyByIds(ids: string[]):    Promise<Pick<Usuario, 'id' | 'nombre'>[]>
ProveedoresRepo.findManyByIds(ids: string[]): Promise<Pick<Proveedor, 'id' | 'nombre'>[]>
ProductosRepo.findManyByIds(ids: string[]):   Promise<Pick<Producto, 'id' | 'nombre'>[]>
AlertasRepo.findManyByIds(ids: string[]):     Promise<Pick<Alerta, 'id' | 'tipo' | 'productoId'>[]>
```

The projection is load-bearing for `usuarios`: a full-row lookup would pull `hashContrasena` into
the audit **read** path. The DTO would drop it, but it would still have been read — the narrow
select means it never leaves the database.

**Empty-set guard**: the service MUST skip the call entirely when a bucket is empty. Do not rely
on Drizzle's empty-`inArray` behaviour (version-dependent); the guard is also what makes D4's
query bound true.

### D4 — Batching algorithm (`auditoria/service.ts::listar`)

```ts
export interface ReadRepos {
  auditoria:   Pick<AuditoriaRepo, 'list'>;
  usuarios:    Pick<UsuariosRepo, 'findManyByIds'>;
  proveedores: Pick<ProveedoresRepo, 'findManyByIds'>;
  productos:   Pick<ProductosRepo, 'findManyByIds'>;
  alertas:     Pick<AlertasRepo, 'findManyByIds'>;
}

export interface RegistroAuditoriaConEtiquetas extends RegistroAuditoria {
  usuarioNombre: string | null;   // actor label; raw usuarioId kept
  entidadEtiqueta: string | null; // subject label; raw entidad/entidadId kept
}
```

1. **Bucket (no I/O)** — one pass over the page: `porEntidad[row.entidad].add(row.entidadId)` for
   the four buckets, plus `actores.add(row.usuarioId)`.
2. **`alertas` first** — `alertas.findManyByIds([...porEntidad.alertas])` yields each alerta's
   `tipo` + `productoId`. Sequenced before step 3 because its labels feed the *same* productos
   batch.
3. **`productoIds` = `porEntidad.productos` ∪ `alertasRefs.map(a => a.productoId)`** — one union'd
   set, so an `alertas` row and a `productos` row on the same page cost one productos query, not two.
4. **Three independent batches in parallel** (`Promise.all`): `usuarios.findManyByIds(actores ∪
   porEntidad.usuarios)` — one query covering both actor and subject ids —
   `proveedores.findManyByIds(porEntidad.proveedores)`, `productos.findManyByIds(productoIds)`.
5. **Maps**: `Map<id, nombre>` per table + `Map<id, AlertaRef>`.
6. **Merge (pure, no I/O)**: `rows.map(...)` reading only those Maps.

**Query bound: ≤ 6 per request** — 2 repository queries (page + count) + ≤ 4 label batches — and
**independent of `pageSize`**. A 100-row page spanning all four `entidad` values costs the same 6
as a 4-row page spanning them.

### D5 — `entidad = 'alertas'` label: `` `${tipo}: ${productoNombre}` ``

Verified against `schema.ts:415-453`: `alertas.producto_id` is `uuid(...).notNull()` with an FK to
`productos` (`onDelete: 'restrict'`), and `ProductosRepo` exposes `setActivo` but **no delete**
(`productos/repository.ts:84`, "never DELETE"). So the referenced producto row always exists — the
proposal's suggested path is sound and needs no null-`producto_id` branch.

Label: `stock_bajo: Café 500g`. Two-level fallback, explicit, no hidden placeholder:

| Case | Label |
|---|---|
| alerta + producto resolved | `` `${a.tipo}: ${nombre}` `` |
| alerta resolved, producto missing (only reachable if an FK is ever dropped) | `a.tipo` alone |
| alerta row itself not found | `null` (D6) |

The raw `tipo` enum token is used, not a Spanish display string: every other DTO in this API
returns raw enum tokens (`routes/reportes.ts:89`), and presentation formatting belongs to the SPA
(out of scope). Separator is ASCII `": "` — keeps test literals and the `openapi.json` golden free
of any encoding question on Windows.

### D6 — Unresolved referent ⇒ `null`, not `''`

`auditoria.entidad_id` deliberately carries **no** FK (ADR-0011), so "referent not found" is a
real path, not dead code. `''` (the existing `producto?.nombre ?? ''` idiom) is indistinguishable
from a genuinely empty name and silently asserts a label that was never resolved; `null` is
honest, and the SPA's `?? '—'` idiom (`ProductosTable.tsx:44`) already renders it. Raw ids are
always present, so nothing is lost. `usuarioNombre` is typed nullable too even though
`auditoria.usuario_id` has an FK with `onDelete: 'restrict'` (always resolvable) — a uniform
nullable pair beats a type that would have to be defended by a fallback string.

### D7 — Route `GET /api/auditoria`

```ts
const entidadSchema = z.enum(['usuarios', 'proveedores', 'productos', 'alertas']);

const auditoriaQuerySchema = pageQuerySchema
  .extend({
    entidad: entidadSchema.optional(),
    entidadId: z.string().uuid().optional(),
    usuarioId: z.string().uuid().optional(),
  })
  .refine((v) => v.entidadId === undefined || v.entidad !== undefined, {
    message: 'entidadId requires entidad',
    path: ['entidadId'],
  });
```

`config: { roles: ['encargado'] }`, `requireActor(request.user)` (every `reportes` route does),
responses `200: paginatedAuditoria`, `400/401/403: errorEnvelopeSchema`. Row DTO = the eight
stored columns + `usuarioNombre` + `entidadEtiqueta`; snapshots project stored JSONB verbatim
(`z.record(z.string(), z.unknown())`, nullable on `datosPrevios`) — write-time filtering and
pseudonymization already made it safe to read back (`auditoria/service.ts:108-144`), so this route
adds no filtering logic of its own. Registered in `app.ts` after `authPlugin` with
`prefix: '/api'`.

## Data Flow

    GET /api/auditoria?entidad&entidadId&usuarioId&page&pageSize
         │ Zod: shape + "entidadId requires entidad" (D2)
         ▼
    routes/auditoria.ts ──requireActor──▶ auditoria/service.ts::listar
                                             │
                                             ├─▶ AuditoriaRepo.list  (page query + count query,
                                             │                        same condition — D1)
                                             │        rows: RegistroAuditoria[]
                                             │
                                             ├─ bucket by entidad (no I/O) ────────── D4.1
                                             ├─▶ AlertasRepo.findManyByIds ────────── D4.2
                                             │        tipo + productoId
                                             ├─ productoIds = productos ∪ alerta.productoId  D4.3
                                             └─▶ Promise.all([ usuarios.findManyByIds(actores ∪ subjects),
                                                               proveedores.findManyByIds,
                                                               productos.findManyByIds ])   D4.4
                                                        │ Maps → pure merge (D4.6)
                                                        ▼
                                 paginated([...row, usuarioNombre, entidadEtiqueta], page, pageSize, total)

    ≤ 6 queries total, flat in pageSize.

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/src/auditoria/repository.ts` | Modify | `EntidadAuditoria`, `FiltroAuditoria`, `RegistroAuditoria`, `list()` (D1) |
| `apps/api/src/auditoria/service.ts` | Modify | `ReadRepos`, `RegistroAuditoriaConEtiquetas`, `listar()` (D3–D6) |
| `apps/api/src/usuarios/repository.ts` | Modify | `findManyByIds` (narrow projection, D3) |
| `apps/api/src/proveedores/repository.ts` | Modify | `findManyByIds` (D3) |
| `apps/api/src/productos/repository.ts` | Modify | `findManyByIds` (D3) |
| `apps/api/src/alertas/repository.ts` | Modify | `findManyByIds` → `{id, tipo, productoId}` (D3) |
| `apps/api/src/routes/auditoria.ts` | Create | `GET /api/auditoria` (D7) |
| `apps/api/src/app.ts` | Modify | Register `auditoriaRoutes`, `prefix: '/api'` |
| `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts` | Regenerate | `pnpm contract`, staged before `contract:check` |

No `db/schema.ts` change, no migration, no `fields.ts` change (write path untouched).

## Testing Strategy

| Layer | What to test | Approach |
|---|---|---|
| Route | encargado `200`; **deposito `403` with no `data` key in the body** | `buildApp()` + `app.inject()` + fake repos, mirroring `routes/reportes.test.ts:78-115` |
| Route | `entidadId` without `entidad` ⇒ `400 VALIDATION_ERROR` (D2) | `app.inject` with querystring only |
| Route | filters reach the repo composed (AND): assert the `FiltroAuditoria` the fake `list()` received carries all three keys | spy-recording fake |
| Route | response carries **both** raw ids and labels (enrichment is additive) | assert `usuarioId` *and* `usuarioNombre`, `entidadId` *and* `entidadEtiqueta` |
| Unit (service) | **No N+1**: a page of 4 rows and a page of 40 rows spanning all four `entidad` values produce the *same* `findManyByIds` call counts (`alertas` 1, `usuarios` 1, `proveedores` 1, `productos` 1) | counting fakes; assert call count **and** that each call received a deduped id array |
| Unit (service) | `productos` batch is unioned: a page with one `entidad='productos'` row and one `entidad='alertas'` row pointing at a *different* producto issues **one** `productos.findManyByIds` containing both ids | counting fake, assert the argument array |
| Unit (service) | Empty bucket issues **no** query for that table (D3 guard) | fake throws if called |
| Unit (service) | `alertas` label (D5): full label; producto-missing ⇒ `tipo` alone; alerta-missing ⇒ `null` | three cases over the pure merge |
| Unit (service) | Unresolved `entidadId` ⇒ `entidadEtiqueta === null`, never `''` (D6) | fake returns `[]` |
| Unit (repo) | Each optional predicate reaches **both** the page query and the count query (D1) | extend the existing repo unit-test style |
| Integration | Extend `auditoria/repository.integration.test.ts`: real rows, filter by `entidad`+`entidadId`, by `usuarioId`, and by both composed; `total` respects the filter; page-2 stability under identical `creado_en` (same-transaction rows) | real Postgres, `getDb()`, `truncate` in `beforeEach` as the file already does |
| Integration | `EXPLAIN` (or index-hit assertion) confirms each filtered query uses its intended index | optional but cheap; the two index names are already asserted at lines 39-49 |

Every test above must be mutation-probed before it is trusted (CLAUDE.md).

## Threat Matrix

N/A — no routing-engine, shell, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary. The only security surface is RBAC, covered by the `roles: ['encargado']`
route test above.

## Migration / Rollout

No migration required — both indexes exist and are proven live. Additive-only port widenings; no
existing route or caller changes behaviour. Rollback is a pure code revert with no data cleanup.

## Open Questions

- [ ] **Product-behaviour flag (parallel-spec rule).** The wire field names `usuarioNombre` /
      `entidadEtiqueta` and the `alertas` label text `` `${tipo}: ${nombre}` `` (D5) are what the
      encargado actually reads — that is product behaviour surfacing inside design. They are
      recorded here as defaults; if the parallel spec phase names them differently, **the spec
      wins** and this design is amended, not the other way round.
- [ ] `datosPrevios`/`datosPosteriores` are the first free-form JSONB fields in any route DTO in
      this repo — how `z.record(z.string(), z.unknown())` renders through
      `fastify-type-provider-zod` into `openapi.json` and then `schema.d.ts` has no precedent here.
      Verify with `pnpm contract` during apply; do not assume the generated web type is usable.
- [ ] Default order `desc(creadoEn), desc(id)` is an implementation default (D1's rationale is
      correctness of pagination, not a ratified product requirement).
