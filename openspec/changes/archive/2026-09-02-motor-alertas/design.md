# Design: Motor de Alertas (backlog #10)

> Size note: this design deliberately exceeds the usual 800-word budget. The proposal deferred
> eight distinct architectural questions to design (SAVEPOINT mechanism, four call sites, port
> shape, evaluator math, routes, SPA polling, audit gate, migration); compressing them would push
> the decisions into tasks, where they would be made implicitly.

## Technical Approach

A new `alertas` domain (`apps/api/src/alertas/`: `repository.ts`, `evaluador.ts`, `service.ts`)
follows the three-layer shape of `apps/api/src/proveedores/`. `EvaluadorDeAlertas.evaluar` is a
pure-ish function over `(movimiento, stockMinimo)` that issues at most three repo calls; every
invocation is wrapped in a real Postgres `SAVEPOINT` so an evaluator failure — SQL or application
— rolls back only the alert side effect and the outer movement/sale still commits (C1, ADR-0008).

The savepoint is issued by a new narrow `TxControl` capability handed to the `uow.run` callback as
a **second argument**. Existing call sites ignore it and do not change shape.

## Architecture Decisions

### D1 — SAVEPOINT mechanism: raw `tx.execute` behind a `TxControl` port

| Option | Tradeoff | Decision |
|---|---|---|
| Drizzle nested `tx.transaction()` | Auto-names the savepoint (`sp1`), and **re-throws** the inner error by default — the exact opposite of C1 | Rejected |
| App-level `try/catch` only | Postgres `25P02`: once any statement errors, the whole tx is aborted; the later `COMMIT` becomes a `ROLLBACK`. This is the bug C1 exists to prevent | Rejected |
| Raw `SAVEPOINT` / `ROLLBACK TO SAVEPOINT` via `tx.execute` | 4 statements, literal `alertas` name, and `ROLLBACK TO SAVEPOINT` is the **only** statement Postgres accepts in the aborted state — it returns the tx to a usable state | **Chosen** |

### D2 — `TxControl` reaches services via `uow.run`'s second argument, not via `Repos`

`uow.ts`'s docblock is explicit that `work` receives repos and never the raw executor, so a service
cannot bypass the boundary. Putting savepoint control on `Repos` would also expose it to
`app.repos` (pool-bound, no transaction), where `SAVEPOINT` raises `25P01`. Handing `TxControl` as
`uow.run((repos, tx) => …)` makes it **structurally impossible** to obtain outside a transaction,
grants exactly one capability (not arbitrary SQL), and leaves all four existing `uow.run` callers
source-compatible.

```ts
// apps/api/src/db/uow.ts
export interface TxControl {
  /** Runs `work` inside `SAVEPOINT <name>`. On ANY failure: ROLLBACK TO, log,
   *  return `undefined` — the outer transaction stays committable (C1). */
  savepoint<T>(name: string, work: () => Promise<T>): Promise<T | undefined>;
}

export interface UnitOfWork {
  run<T>(work: (repos: Repos, tx: TxControl) => Promise<T>): Promise<T>;
}

function createTxControl(tx: DbExecutor, log: Logger): TxControl {
  return {
    async savepoint(name, work) {
      const sp = sql.identifier(name);            // never string-interpolated
      await tx.execute(sql`SAVEPOINT ${sp}`);     // control-statement failures
      try {                                       // propagate: the tx is dead
        const result = await work();
        await tx.execute(sql`RELEASE SAVEPOINT ${sp}`);
        return result;
      } catch (error) {
        await tx.execute(sql`ROLLBACK TO SAVEPOINT ${sp}`);
        await tx.execute(sql`RELEASE SAVEPOINT ${sp}`); // bounds the stack in loops
        log.error({ err: error, savepoint: name }, 'savepoint rolled back');
        return undefined;
      }
    },
  };
}

export function createUnitOfWork(db: Db, log: Logger = silentLogger): UnitOfWork {
  return { run: (work) => db.transaction((tx) => work(buildRepos(tx), createTxControl(tx, log))) };
}
```

`plugins/repos.ts` changes one line: `createUnitOfWork(getDb(), app.log)`.

Two consequences worth stating: (a) `RELEASE` after `ROLLBACK TO` is required, because
`ROLLBACK TO` leaves the savepoint defined and `confirmarVenta` re-enters this per item; (b) the
alert's own `recordAudit` lives inside the savepoint, so a failed audit write kills the alert with
it — the "no write without its audit row" invariant holds by construction.

### D3 — Call sites: per-movement evaluation, per-movement savepoint

| Call site | Placement | Notes |
|---|---|---|
| `movimientos/service.ts::registrarMovimiento` | At the existing SEAM (L132-137), after the `producto` re-read | The only site with a post-movement `producto` already in scope |
| `productos/service.ts::crearProducto` | After `movimientos.create` in the `stockInicial > 0` branch | Always upward from 0 → structurally a no-op today; wired per PD-2 |
| `ventas/service.ts::confirmarVenta` | Inside Pass B's loop, after each `movimientos.create` | One savepoint **per item** |
| `ventas/service.ts::anularVenta` | Inside the item loop, after each `movimientos.create` | Always upward → resolve-only path in practice |

**Per-item, not per-sale** (proposal open question 2): A10's dedup key is `producto_id + tipo`, and
a sale's items are guaranteed distinct products (`duplicateSaleItem` refuses duplicates), so
evaluation is inherently per-producto. A single sale-wide savepoint would discard items 1–2's
alerts because item 3's evaluator failed. The cost is 2 extra statements per item on the happy
path, negligible for a shop's basket size.

**Can an `anulacion` cross downward?** No. `revertirStockPorAnulacion` adds `item.cantidad`, which
is a strictly positive integer on every `items_venta` row, so stock strictly increases and
`esDiscrepancia` is hard-coded `false`. The evaluator nonetheless carries **no** `tipo === 'anulacion'`
special case: the generic crossing rule (downward → create, upward → resolve) already yields
resolve-only behaviour, and it stays correct if a future path ever emits a negative `anulacion`.

### D4 — Dedup enforced by a partial unique index, not a read-then-insert

```sql
CREATE UNIQUE INDEX alertas_producto_tipo_abierta_unique
  ON alertas (producto_id, tipo) WHERE estado <> 'resuelta';
```

The insert uses `ON CONFLICT (producto_id, tipo) WHERE estado <> 'resuelta' DO NOTHING`, returning
`undefined` when an open alert already exists. Chosen over a `SELECT`-then-`INSERT` pre-check for
the reason `proveedores/repository.ts` gives verbatim (a read-then-insert leaves a window a
concurrent insert can take) and over catching `23505`, because a raised `23505` would abort the
transaction into `25P02` and force a savepoint rollback that also discards the sibling
create/resolve work done for the same movement.

### D5 — `sugerencia_reposicion` in the pgEnum, excluded from the TypeScript union

PD-1 requires no enum migration when #11 lands. The pgEnum carries all four values from day one;
`TipoAlertaEvaluada = Exclude<TipoAlerta, 'sugerencia_reposicion'>` types the evaluator and
`create`, so no #10 code can emit it. Compile gate instead of a convention.

### D6 — Alert list resolves product names service-side (N+1), no repo join

Mirrors `getRecibo`'s accepted per-item `productos.findById` rather than introducing this
codebase's first repository join.

## Evaluator Logic (exact)

`stockResultante = movimiento.stockResultante` (verbatim from `aplicarDelta`, never recomputed);
`stockPrevio = movimiento.stockResultante - movimiento.cantidad` (`cantidad` is the signed delta).

The evaluator reads **only** `producto.stockMinimo` from the product — never `producto.stockActual`.
This is load-bearing: `confirmarVenta` passes its Pass-A snapshot, whose `stockActual` is stale by
Pass B, while `stockMinimo` is immutable within the sale transaction. Reading `stockActual` here
would be a silent correctness bug.

```
const quiebreCruzo = stockPrevio > 0 && stockResultante <= 0;

if (movimiento.esDiscrepancia)                                  -> create 'discrepancia'
if (quiebreCruzo)                                                -> create 'quiebre'
if (stockPrevio <= 0 && stockResultante >  0)                   -> autoResolve 'quiebre'
if (stockMinimo !== null && !quiebreCruzo) {
  // Owner-ratified 2026-09-02: when stockMinimo === 0, the quiebre crossing (stockResultante
  // <= 0) and the stock_bajo crossing (stockResultante <= stockMinimo) are the same event —
  // quiebre alone is correct; a redundant stock_bajo is suppressed by the !quiebreCruzo guard.
  if (stockPrevio >  stockMinimo && stockResultante <= stockMinimo) -> create 'stock_bajo'
  if (stockPrevio <= stockMinimo && stockResultante >  stockMinimo) -> autoResolve 'stock_bajo'
}
```

`stockResultante` can never be negative (`aplicarDelta` refuses it), so "crossing to 0" is exactly
`=== 0`; `<= 0` is written defensively. `stockMinimo IS NULL` never fires `stock_bajo` (documented
acceptance criterion). Auto-resolution leaves `resuelta_por` null (A10 rule 3).

### D7 — `stock_bajo` auto-resolves when `stockMinimo` is cleared (owner-ratified 2026-09-02)

Not a movimiento-triggered evaluation — a separate hook in `productos/service.ts::actualizarProducto`.
When the update changes `stockMinimo` from a non-null value to `null`, call
`repos.alertas.autoResolve(productoId, 'stock_bajo')` inside the same `uow.run` transaction, after
the product row itself is updated. No `SAVEPOINT` needed here: this path has no `stockActual`
staleness risk (single-row update, not a multi-item sale loop) and no evaluator SQL to isolate
from — it is one direct, already-safe repository call. `quiebre`/`discrepancia` alerts are
untouched (they never depended on `stockMinimo`).

## Interfaces / Contracts

```ts
// apps/api/src/alertas/repository.ts
export type TipoAlerta = 'stock_bajo' | 'quiebre' | 'discrepancia' | 'sugerencia_reposicion';
export type TipoAlertaEvaluada = Exclude<TipoAlerta, 'sugerencia_reposicion'>; // D5
export type EstadoAlerta = 'activa' | 'vista' | 'resuelta';

export interface Alerta {
  id: string; productoId: string; tipo: TipoAlerta; estado: EstadoAlerta;
  movimientoId: string | null; creadaEn: Date;
  resueltaEn: Date | null; resueltaPor: string | null;
}

export interface AlertasRepo {
  /** `undefined` => an open alert already existed (A10 rule 2, D4). */
  create(input: NuevaAlerta): Promise<Alerta | undefined>;
  /** One UPDATE, no prior read. `resuelta_por` stays null (A10 rule 3). */
  autoResolve(productoId: string, tipo: TipoAlertaEvaluada): Promise<Alerta | undefined>;
  /** encargado-only (A10 rule 4). `undefined` => no OPEN alert with that id. */
  manualResolve(id: string, resueltaPor: string): Promise<Alerta | undefined>;
  /**
   * Owner-ratified 2026-09-02: one UPDATE, `estado = 'vista' WHERE estado = 'activa'`, no id list
   * needed. Returns the count transitioned. Called once per Alertas screen mount, both roles.
   */
  marcarVistas(): Promise<number>;
  /** Classify-on-undefined (rechazarVenta precedent): 404 vs 409 vs wrong tipo. */
  findById(id: string): Promise<Alerta | undefined>;
  list(filtro: FiltroAlertas, page: number, pageSize: number): Promise<{ rows: Alerta[]; total: number }>;
  countAbiertas(): Promise<number>;
}
```

Registration: `Repos.alertas` in `plugins/repos.ts`, `alertas: new DrizzleAlertasRepo(executor)`
in `buildRepos` — identical to every other domain.

Evaluator call shape at every site:

```ts
await tx.savepoint('alertas', () =>
  evaluar(txRepos, { movimiento, stockMinimo: producto.stockMinimo, actorId }),
);
```

New error factories (`lib/errors.ts`, English codes per CLAUDE.md): `alertNotFound()` /
`ALERT_NOT_FOUND` (404), `alertAlreadyResolved()` / `ALERT_ALREADY_RESOLVED` (409),
`alertNotManuallyResolvable()` / `ALERT_NOT_MANUALLY_RESOLVABLE` (409).

## Routes (`apps/api/src/routes/alertas.ts`)

| Route | Roles | Notes |
|---|---|---|
| `GET /api/alertas` | `encargado`, `deposito` | Standard `{ data, page, pageSize, total }` envelope; `?estado=` filter |
| `GET /api/alertas/conteo` | `encargado`, `deposito` | `{ abiertas: number }` — dedicated, because the badge polls every 60s on every screen and must not pull rows over a cold-starting free-tier Render service |
| `POST /api/alertas/:id/resolver` | `encargado` | PD-3. Refuses `stock_bajo`/`quiebre` with `ALERT_NOT_MANUALLY_RESOLVABLE` |
| `POST /api/alertas/marcar-vistas` | `encargado`, `deposito` | Owner-ratified 2026-09-02. No body, no id — transitions every `activa` alert to `vista`. `{ marcadas: number }` |

## Data Flow

    route → service → uow.run((repos, tx) => …)
                          │
                          ├─ aplicarDelta ─→ movimientos.create      ← must commit
                          │
                          └─ tx.savepoint('alertas', …)
                                 └─ evaluar → alertas.create / autoResolve → recordAudit
                                        │
                                 failure ┴→ ROLLBACK TO SAVEPOINT → COMMIT still succeeds

## Audit Wiring (PD-5)

`entidadAuditoria` pgEnum gains `'alertas'`; `auditoria/fields.ts` gains the entry that actually
unlocks the compile gate (`AuditableEntidad = keyof typeof FIELD_CLASSIFICATION`):

```ts
alertas: {
  auditableFields: ['id','productoId','tipo','estado','movimientoId','creadaEn','resueltaEn','resueltaPor'],
  excludedFields: [],
  pseudonymizedFields: [],
},
```

`accion` reuses existing values: `'crear'` on creation, `'actualizar'` on resolution — no
`AuditAccion` change. `auditoria.usuario_id` is NOT NULL with an FK, so an **auto**-resolution
audits the actor of the triggering movement while the alert's own `resuelta_por` stays null; the
two fields answer different questions and are deliberately allowed to disagree.

## Frontend

| Path | Action | Description |
|---|---|---|
| `apps/web/src/features/alertas/queries.ts` | Create | Key factory + `alertasListQueryOptions()` / `alertasConteoQueryOptions()` |
| `apps/web/src/features/alertas/useAlertas.ts` | Create | List hook |
| `apps/web/src/features/alertas/useConteoAlertas.ts` | Create | Polling count hook |
| `apps/web/src/features/alertas/useResolverAlerta.ts` | Create | Mutation, invalidates `alertasKeys.all` |
| `apps/web/src/features/alertas/useMarcarVistas.ts` | Create | Owner-ratified 2026-09-02. Fires once on mount (route's own effect, not a user action); invalidates `alertasKeys.all` on success so `activa` rows re-render as `vista` |
| `apps/web/src/features/alertas/AlertasTable.tsx`, `errorMessages.ts` | Create | Presentational + code→message map |
| `apps/web/src/routes/alertas.tsx` | Create | Screen under `shellLayout` (PD-3), added to `routeTree.ts` |
| `apps/web/src/routes/shellLayout.tsx` | Modify | `ShellLayoutContainer` (the container) calls `useConteoAlertas()` and passes the number down |
| `apps/web/src/components/ui/AppShell.tsx` | Modify | New `{ label: 'Alertas', to: '/alertas' }` NAV item (no slot exists today — `Panel general`, `Movimientos`, `Reportes` are destination-less placeholders); new optional `alertasAbiertas?: number` prop for the badge |

`refetchInterval: 60_000` (PD-4) is **new to this codebase** — `refetchInterval` currently has zero
matches across `apps/web/src`. It lives on the query options object in `queries.ts`, not in the
hook, so it is assertable by a plain unit test without advancing 60 seconds of timers. `AppShell`
stays presentational (props only); the data hook goes in the container, preserving the split.
The resolve control is hidden for `deposito` as a **UX affordance only**, documented in its own
docblock per CLAUDE.md — the route's `config: { roles: ['encargado'] }` 403 is the boundary.

## Migration / Rollout

`apps/api/src/db/schema.ts` gains `alertaTipo`, `alertaEstado`, the `alertas` table (FKs:
`producto_id` → productos restrict, `movimiento_id` → movimientos restrict nullable, `resuelta_por`
→ usuarios restrict nullable), the partial unique index of D4, plus `'alertas'` on
`entidadAuditoria`. `pnpm db:generate` produces the SQL.

Two deployment notes:
1. **Per CLAUDE.md, this change deploys cleanly and then 500s on every route that touches `alertas`
   until someone runs `pnpm db:migrate` manually against Neon** (Render's free tier has no
   pre-deploy command, ADR-0010:71-72). The migration must be run before or immediately after the
   deploy, and the movimiento/venta paths themselves are affected, not just the new routes.
2. The `entidad_auditoria` enum grows by `ALTER TYPE … ADD VALUE 'alertas'`. This is legal inside
   drizzle-kit's migration transaction on PG12+ **only because no statement in the same migration
   uses the new value**. Do not combine it with a data backfill that inserts `'alertas'` rows.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Crossing math: create/resolve/no-op at every boundary, `stockMinimo` null, `stockMinimo` 0, exact-equality edge | Pure evaluator over fake repos |
| Unit | `queries.ts` exposes `refetchInterval === 60_000` | Assert the options object; no timer advancement |
| Integration | **C1 acceptance criterion**: inject a SQL error into the evaluator, assert the movimiento/venta row still exists after commit | Real `createUnitOfWork(db)`, override only `alertas.create` to run failing SQL (`proveedores.integration.test.ts` idiom). Assert the **database**, not the status code |
| Integration | One test per call site (PD-2), including `confirmarVenta` where item 2's evaluator fails and items 1 and 3 still get their alerts | Real Postgres |
| Integration | Dedup under concurrency: two movements crossing the same threshold produce one row | Partial unique index |
| Route | RBAC: `deposito` gets 403 on `POST /alertas/:id/resolver` **and no row changes** | `app.inject` + DB assertion |
| Web route | `await router.load()` before every render (CLAUDE.md); route-level, not just hook-level | RTL + real router |

Every test must be mutation-probed before it is trusted (CLAUDE.md).

## Threat Matrix

N/A — no routing-outside-Fastify, shell, subprocess, VCS/PR automation, executable-file
classification, or process-integration boundary. The one genuinely dangerous surface (raw SQL in
`TxControl`) takes no user input: the savepoint name is a module constant passed through
`sql.identifier`, never string interpolation.

## Open Questions

All four ratified by the owner, 2026-09-02 — binding, not reopened. Concrete mechanisms below.

- [x] **A product created with `stockInicial = 0` raises no alert.** Accepted as a known v1
  limitation — rare case, whoever creates a product already at zero stock knows it. No change:
  `crearProducto` still only evaluates when `stockInicial > 0`.
- [x] **`stockMinimo = 0` fires both `stock_bajo` and `quiebre` on the same crossing.** Resolved:
  suppress `stock_bajo` when `quiebre` also fires in the same evaluation — `quiebre` alone is
  correct and non-redundant. See the updated Evaluator Logic pseudocode below.
- [x] **Nothing transitions an alert into `vista`.** Resolved: build it now, not deferred. A
  dedicated `POST /api/alertas/marcar-vistas` transitions every currently `activa` alert to
  `vista` in one statement; the frontend calls it once when the Alertas screen mounts. See the
  Routes/Interfaces/Frontend updates below.
- [x] **An open `stock_bajo` becomes unresolvable if `stockMinimo` is later set to NULL.**
  Resolved: when `actualizarProducto` changes `stockMinimo` to `null`, auto-resolve any
  `activa`/`vista` `stock_bajo` alert for that product in the same transaction — there is no
  longer a threshold to violate. See D7 below.
