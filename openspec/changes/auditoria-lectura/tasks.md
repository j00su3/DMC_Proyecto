# Tasks: Audit Trail Read-Back Endpoint (`auditoria-lectura`, closes D-01)

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~550-700 (4 repo ports + service batching + route + 5 test files + contract regen) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending (ask owner) |

Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | `findManyByIds` on 4 repos + `AuditoriaRepo.list()`, repo-unit + integration tests | PR 1 | `pnpm --filter api test repository` | N/A — pure DB-layer unit/integration, no external scenario | Revert repo ports only; no callers exist yet |
| 2 | `auditoria/service.ts::listar` batching algorithm + unit tests | PR 2 | `pnpm --filter api test auditoria/service` | N/A — pure service-unit test suite | Revert `listar()`; repo layer (PR 1) unaffected |
| 3 | `GET /api/auditoria` route + `app.ts` registration + contract regen + route tests | PR 3 | `pnpm --filter api test routes/auditoria` | `pnpm contract:check` against real regenerated artifacts | Revert route file, `app.ts` registration, and regenerated contract files |

## Phase 1: Repository Layer — narrow read ports

- [x] 1.1 RED: `apps/api/src/usuarios/repository.test.ts` — `findManyByIds(ids)` returns only `{id, nombre}`, never `hashContrasena` (satisfies D3 projection).
- [x] 1.2 GREEN: add `findManyByIds` to `UsuariosRepo` port + Drizzle adapter in `apps/api/src/usuarios/repository.ts`.
- [x] 1.3 RED: `apps/api/src/proveedores/repository.test.ts` — `findManyByIds(ids)` returns `{id, nombre}`.
- [x] 1.4 GREEN: add `findManyByIds` to `ProveedoresRepo` in `apps/api/src/proveedores/repository.ts`.
- [x] 1.5 RED: `apps/api/src/productos/repository.test.ts` — `findManyByIds(ids)` returns `{id, nombre}`.
- [x] 1.6 GREEN: add `findManyByIds` to `ProductosRepo` in `apps/api/src/productos/repository.ts`.
- [x] 1.7 RED: `apps/api/src/alertas/repository.test.ts` — `findManyByIds(ids)` returns `{id, tipo, productoId}`.
- [x] 1.8 GREEN: add `findManyByIds` to `AlertasRepo` in `apps/api/src/alertas/repository.ts`.
- [x] 1.9 RED: `apps/api/src/auditoria/repository.test.ts` — `list()` builds one shared `and()` condition; assert the identical condition object reaches both the page query and the count query (D1's documented trap).
- [x] 1.10 GREEN: add `EntidadAuditoria`, `FiltroAuditoria`, `RegistroAuditoria`, `list(filtro, page, pageSize)` to `apps/api/src/auditoria/repository.ts`, ordering `desc(creadoEn), desc(id)`.
- [x] 1.11 Extend `apps/api/src/auditoria/repository.integration.test.ts` (real Postgres): filter by `entidad`+`entidadId`, by `usuarioId`, by both composed; `total` respects the filter; page-2 stability under identical `creado_en` (same-transaction rows).

## Phase 2: Service Layer — batched enrichment (`listar`)

- [x] 2.1 RED: `apps/api/src/auditoria/service.test.ts` — no-N+1 pin: a 4-row page and a 40-row page spanning all four `entidad` values produce the same `findManyByIds` call counts (1 each for `alertas`, `usuarios`, `proveedores`, `productos`).
- [x] 2.2 RED: same file — `productos` union: one `entidad='productos'` row + one `entidad='alertas'` row (different producto) issue exactly one `productos.findManyByIds` call containing both ids.
- [x] 2.3 RED: same file — empty bucket issues no query for that table (fake throws if called).
- [x] 2.4 RED: same file — three `alertas` label cases: full label `` `${tipo}: ${nombre}` ``, producto-missing ⇒ `tipo` alone, alerta-missing ⇒ `null`.
- [x] 2.5 RED: same file — unresolved `entidadId` (any table) ⇒ `entidadEtiqueta === null`, never `''`.
- [x] 2.6 GREEN: implement `ReadRepos`, `RegistroAuditoriaConEtiquetas`, and `listar()` in `apps/api/src/auditoria/service.ts` per D4's algorithm (bucket → alertas first → union productos → 3 parallel `Promise.all` batches → pure merge), bounded at ≤6 queries per request.

## Phase 3: Route + Wiring

- [ ] 3.1 RED: `apps/api/src/routes/auditoria.test.ts` — encargado `GET /api/auditoria` returns `200` with `{ data, page, pageSize, total }`.
- [ ] 3.2 RED: same file — deposito receives `403` with no `data` key in the body.
- [ ] 3.3 RED: same file — `entidadId` supplied without `entidad` ⇒ `400 VALIDATION_ERROR` (Zod `.refine`).
- [ ] 3.4 RED: same file — filters reach the repo composed: spy-recording fake `list()` receives `entidad`+`entidadId`+`usuarioId` together when all three are supplied.
- [ ] 3.5 RED: same file — response carries both raw ids and labels (`usuarioId` and `usuarioNombre`, `entidadId` and `entidadEtiqueta`), and snapshot fields pass through unfiltered.
- [ ] 3.6 GREEN: create `apps/api/src/routes/auditoria.ts` — `auditoriaQuerySchema` with the `entidadId`-requires-`entidad` refine (D2/D7), `roles: ['encargado']`, `requireActor`, `paginated()` envelope.
- [ ] 3.7 Register `auditoriaRoutes` in `apps/api/src/app.ts` after `authPlugin`, `prefix: '/api'`.

## Phase 4: Contract Regeneration

- [ ] 4.1 Run `pnpm contract` to regenerate `apps/api/openapi.json` and `apps/web/src/api/schema.d.ts`. **Verify, do not assume**: `datosPrevios`/`datosPosteriores` (`z.record(z.string(), z.unknown())`) are the first free-form JSONB fields in any route DTO in this repo — inspect the generated `schema.d.ts` type is actually usable, not just that generation didn't error.
- [ ] 4.2 Stage the regenerated artifacts (`contract:check` compares against the INDEX, not the working tree).

## Phase 5: Final Verification

- [ ] 5.1 Run `pnpm -r test`, `pnpm typecheck`, `pnpm lint`, `pnpm contract:check` and confirm all pass.
- [ ] 5.2 Mutation-probe every new test added in Phases 1-3 before trusting it (CLAUDE.md convention).
