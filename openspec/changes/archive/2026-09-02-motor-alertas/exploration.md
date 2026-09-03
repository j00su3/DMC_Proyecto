# Exploration: motor-alertas (backlog #10)

## Current State

No alert infrastructure exists yet — confirmed by reading `apps/api/src/db/schema.ts` in full: no
`alertas` table, no alert-related enum. This is greenfield.

`apps/api/src/movimientos/service.ts` (`registrarMovimiento`, lines 132-137) already carries an
explicit SEAM comment marking exactly where `EvaluadorDeAlertas.evaluar(movimiento, producto)`
must be invoked inside `SAVEPOINT alertas` / `ROLLBACK TO SAVEPOINT alertas` — pre-written by
whoever built backlog #6, naming backlog #10 and ADR-0008 directly.

However, movimientos are created in **four** places, and only one has that SEAM marker:

1. `movimientos/service.ts::registrarMovimiento` — has the SEAM comment.
2. `productos/service.ts::crearProducto` (stock inicial, resolves C2) — creates a movimiento
   directly, no SEAM comment.
3. `ventas/service.ts::confirmarVenta` (line ~241, **loops over N line items** in one transaction)
   — no SEAM comment.
4. `ventas/service.ts::anularVenta` (line ~355, loops over items, `tipo: 'anulacion'`) — no SEAM
   comment.

`confirmarVenta`'s multi-item loop is a genuine open design question C1/A10 don't address (their
language assumes "the movement", singular).

## C1 (quoted verbatim, `docs/REVISION-ADVERSARIAL.md:64-70`)

> se eligió el `SAVEPOINT` — antes de invocar el evaluador se emite `SAVEPOINT alertas`; ante
> cualquier fallo (SQL o de aplicación) se ejecuta `ROLLBACK TO SAVEPOINT alertas`, se loguea y la
> transacción del movimiento confirma igual. La alternativa post-commit se descartó porque el
> savepoint cuesta una línea y conserva la atomicidad alerta+movimiento cuando el evaluador
> funciona. ADR-0008 ahora explica por qué el try/catch solo no alcanza (`25P02`), y el criterio de
> aceptación exige un test que inyecte un error SQL en el evaluador y verifique que la venta
> confirma.

Root cause: any SQL error inside a Postgres transaction aborts the *whole* transaction (`25P02`);
a plain app-level try/catch cannot stop the later COMMIT from rolling back the movement/sale too.

## A9 (quoted, `docs/REVISION-ADVERSARIAL.md:142-158`)

> se agregó la columna **`Movimiento.es_discrepancia`** (`boolean`, default `false`, con `CHECK`
> que la restringe a `tipo = ajuste`)... Solo los ajustes con el flag generan alerta de
> discrepancia y alimentan el reporte de discrepancias.

This column **already exists** end-to-end (schema, `Movimiento` interface,
`RegistrarMovimientoInput.esDiscrepancia`). Backlog #10's job here is pure evaluator logic — read
the flag, emit `Alerta.tipo='discrepancia'` — no data-model work needed.

## A10 (quoted, `docs/REVISION-ADVERSARIAL.md:160-182`, consistent with TECH-DESIGNv2.md:190-206
and ADR-0008:28-43)

> (1) **creación por cruce** — `stock_bajo`/`quiebre` se crean solo cuando el movimiento cruza el
> umbral hacia abajo...; (2) **de-duplicación** — no se crea alerta si existe una del mismo
> producto+tipo en `activa` o `vista`... solo `resuelta` habilita re-disparo; (3) **resolución
> automática** — `stock_bajo`/`quiebre` por el propio evaluador, incluida la reposición por
> anulación de venta (`resuelta_por` nulo); (4) **resolución manual** — `discrepancia` y
> `sugerencia_reposicion` las resuelve el encargado.

Exact crossing math (TECH-DESIGNv2.md:192-194): `stock_bajo` created only when
`stock_previo > stock_minimo AND stock_resultante <= stock_minimo`; `quiebre` on crossing to 0. A
product with `stock_minimo IS NULL` (nullable column) never fires `stock_bajo` (documented
acceptance criterion).

## Scope split with backlog #11 — important finding

`docs/BACKLOG.md:45-46`: #10 depends only on #6/#7; **#11 ("Sugerencia de reposición") is a
separate later item depending on #10**, owning the entire S7 heuristic (30-day average, 14-day
coverage, 7-day minimum history). ADR-0008/TECH-DESIGNv2.md describe `sugerencia_reposicion` as
part of `ReglasUmbral` in one breath, but the backlog table splits it out. This means #10's
evaluator should very likely emit `stock_bajo`/`quiebre`/`discrepancia` only —
`sugerencia_reposicion` creation logic belongs to #11. Not stated explicitly anywhere except the
backlog dependency column; needs an explicit decision in propose.

## SAVEPOINT vs. current UnitOfWork — concrete gap

```ts
// apps/api/src/db/uow.ts
export interface UnitOfWork {
  run<T>(work: (repos: Repos) => Promise<T>): Promise<T>;
}
export function createUnitOfWork(db: Db): UnitOfWork {
  return { run<T>(work) { return db.transaction((tx) => work(buildRepos(tx))); } };
}
```

Single top-level `db.transaction()`, no nested-transaction/savepoint method exposed. Driver
confirmed: `drizzle-orm/node-postgres` over a `pg` `Pool` (`apps/api/src/db/client.ts`). Drizzle's
node-postgres driver *can* nest `tx.transaction()` → compiles to `SAVEPOINT`/`ROLLBACK TO
SAVEPOINT`, but (a) it auto-generates savepoint names rather than accepting the literal `alertas`
name the docs use, and (b) its default nested-transaction behavior **re-throws** on inner failure
rather than swallowing it — the opposite of what C1 needs. This is the single largest open
technical question: raw `tx.execute(sql\`SAVEPOINT alertas\`)` / `ROLLBACK TO SAVEPOINT` pair vs.
Drizzle's own nested-transaction abstraction. `UnitOfWork.run()` itself likely doesn't need to
change — the SAVEPOINT logic lives inside the callback, probably through a new `AlertasRepo`
registered in `apps/api/src/plugins/repos.ts::buildRepos`, mirroring every other domain's
port+adapter shape.

## Threshold source

`productos` table: `stockActual` (integer, not null, default 0), `stockMinimo` (integer, nullable,
already gated by A7's `campo_reservado_encargado` 403 for `deposito` — no new permission work
needed on this axis). "Cruce de umbral" compares the new movimiento's `stockResultante` against
`stockMinimo`.

## Frontend polling

`refetchInterval` returns **zero matches** across `apps/web/src` — no existing interval-polling
pattern anywhere. All features use plain `useQuery`/`useMutation` with a `queries.ts`
query-key-factory sibling file (e.g. `features/movimientos/useMovimientos.ts` + `queries.ts`).
Backlog #10's "polling del conteo en la SPA" is genuinely new for this codebase. S9's resolution
commits TanStack Query to owning it, but no interval value is specified anywhere.

## openspec state

`openspec/specs/` and `openspec/changes/` had no prior entry for this capability — greenfield SDD
cycle.

## Four alert-creation triggers

1. **Threshold crossing** (`stock_bajo`/`quiebre`) on downward-crossing edge only.
2. **Auto-resolution** of `stock_bajo`/`quiebre`, same evaluator/transaction, `resuelta_por =
   null`, fires on any movement (including `anulacion`) that restores stock above
   threshold/0.
3. **Manual resolution** of `discrepancia` (and, once #11 exists, `sugerencia_reposicion`) —
   `resuelta_por` = encargado id; needs a new mutation endpoint (none exists).
4. **Discrepancy from marked ajustes** — `esDiscrepancia = true` on an `ajuste` row (column already
   exists) → `Alerta.tipo='discrepancia'`.

## De-duplication rule (exact)

No new alert if one already exists for the same `producto_id` + `tipo` in state `activa` OR
`vista` (viewed but not resolved still blocks). Only `estado = 'resuelta'` re-opens the door.

## Open Questions for Proposal

1. Exact SAVEPOINT mechanism against Drizzle/node-postgres (raw SQL vs. nested `.transaction()`,
   which re-throws by default).
2. Confirm all four movimiento-creation call sites are in scope, not just the one with the
   existing SEAM comment; decide `confirmarVenta`'s per-item vs. whole-venta SAVEPOINT
   granularity.
3. Whether `sugerencia_reposicion` is in scope for #10 at all, or fully deferred to #11.
4. SPA polling interval value — unspecified in any doc.
5. Route/RBAC shape for viewing alerts and resolving `discrepancia` manually — nothing exists yet.
6. New `AlertasRepo` port+adapter placement in `plugins/repos.ts`.
7. Whether alert create/resolve calls `recordAudit` — would require a
   `apps/api/src/auditoria/fields.ts` `alertas` entry per CLAUDE.md's documented compile gate.

## Risks

- SAVEPOINT semantics under Drizzle/node-postgres are unverified against C1's exact "swallow SQL
  error, keep outer transaction alive" requirement — getting this wrong reproduces the exact bug
  C1 exists to prevent.
- Three of four movimiento-creation call sites have no SEAM marker; a proposal scoped only from
  the one commented seam would under-scope the change.
- `confirmarVenta`'s multi-item-per-transaction shape is unaddressed by the docs.

## Ready for Proposal

Yes — with the caveat that question 2 (call-site scope) and question 1 (SAVEPOINT mechanism)
should be explicitly resolved as decisions in the proposal, not left implicit, since both directly
affect whether the implementation actually satisfies C1's acceptance criterion.
