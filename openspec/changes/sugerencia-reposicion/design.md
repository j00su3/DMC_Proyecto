# Design: Sugerencia de Reposición (backlog #11)

> Size note: like #10's design.md, this deliberately exceeds the usual 800-word budget. The
> movimientos-aggregate shape, the two boundary interpretations of S7's `< 14`/`< 7` thresholds, and
> the `anularVenta` exclusion mechanism are exactly the kind of decisions the proposal deferred here
> rather than leaving implicit for tasks.

## Technical Approach

Reuse #10's `alertas` domain end to end. The only new pieces: one aggregate query on
`MovimientosRepo`, one new branch in `EvaluadorDeAlertas.evaluar`, and widening the two compile
gates #10 deliberately left excluding `sugerencia_reposicion` (its own D5). No new table, no new
transaction mechanism, no new call sites beyond what's already wired for #10 (three of the four
existing `registrarSiCorresponde` call sites evaluate the new rule; `anularVenta`'s existing call
stays, but skips this one rule — D3 below).

## Architecture Decisions

### D1 — `TipoAlertaEvaluada` collapses to `= TipoAlerta`, no `Exclude<>`

| Option | Tradeoff | Decision |
|---|---|---|
| `Exclude<TipoAlerta, never>` | Compiles identically to `TipoAlerta` but keeps a vacuous exclusion that implies a phantom gate | Rejected |
| `TipoAlertaEvaluada = TipoAlerta` | Reads as "nothing held back anymore" — accurate, since #11 was the only value #10's D5 ever excluded | **Chosen** |

`repository.ts`'s `TipoAlertaEvaluada` type alias name is kept (used across `repository.ts`,
`service.ts`, `evaluador.ts`) to avoid a 3-file rename for a type that is now identical to
`TipoAlerta` — only its definition changes.

### D2 — `TIPOS_MANUALMENTE_RESOLVIBLES` gains `sugerencia_reposicion`, unchanged mechanism

`service.ts:90-92` becomes `['discrepancia', 'sugerencia_reposicion']`. `quiebre`/`stock_bajo` stay
excluded (auto-resolve only, D7 from #10). `sugerencia_reposicion` never auto-resolves either — it
mirrors `discrepancia`'s precedent exactly: `evaluador.ts` only ever calls `crearYAuditar` for it,
never `autoResolverYAuditar`. Coverage recovering above 14 days does not silently close the alert;
the `encargado` must resolve it, same as `discrepancia`.

### D3 — `anularVenta`'s exclusion lives inside `evaluar()`, keyed on `movimiento.tipo`

The proposal ratifies excluding `anularVenta` from S7 evaluation while `movimientos/service.ts`,
`crearProducto`, and `confirmarVenta` all evaluate it. `registrarSiCorresponde` is a single generic
wrapper called identically at all four sites — adding a per-call-site flag would touch every caller
signature for a rule that is otherwise fully internal to the evaluator.

| Option | Tradeoff | Decision |
|---|---|---|
| Boolean flag threaded through `registrarSiCorresponde`/`RegistrarSiCorrespondeParams` | Touches all 4 call sites' call shape for a single rule's exclusion | Rejected |
| `evaluar()` checks `movimiento.tipo !== 'anulacion'` before the new branch | `EvaluadorMovimiento` gains one field (`tipo`) already present on every full `Movimiento` row every call site already passes in; zero call-site changes | **Chosen** |

`EvaluadorMovimiento` (`evaluador.ts`) gains `tipo: Movimiento['tipo']`. Every call site already
passes the full repo-returned `Movimiento` row (structural subtyping satisfies the wider interface
with no cast). `quiebre`/`stock_bajo`/`discrepancia` are untouched by this guard — they still run on
`anulacion` movimientos exactly as #10 built them.

### D4 — Boundary interpretation of S7's `< 14` / `< 7` (ADR-0008)

Stated explicitly per the task instructions, since S7 exists precisely to prevent this ambiguity
recurring at the implementation layer:

- `cobertura_dias < 14`: **strict**, no epsilon/rounding. `cobertura_dias === 14.0` does not suggest.
- `diasHistoria < 7`: **strict** ("menos de 7 días" = strictly less than). `diasHistoria === 7`
  evaluates (falls in the ratified "entre 7 y 30" bracket).
- Divisor for `promedio_diario` = `min(diasHistoria, 30)`. This is smooth at both ends: at
  `diasHistoria = 7` it divides by 7 (the literal "días disponibles" reading); at `diasHistoria = 30`
  it divides by 30, identical to every product with *more* than 30 days of history — no discontinuity
  at the 30-day boundary, and no separate "exactly 30" branch is needed.
- `diasHistoria` = whole days elapsed since the producto's first-ever movimiento (`MIN(fecha)`
  across ALL `movimientos` rows for that producto, unbounded — not limited to the 30-day window),
  computed as `floor(extract(epoch from (now() - MIN(fecha))) / 86400)`. Using Postgres `now()`
  (transaction-start time, stable across every statement in the tx) rather than a JS `Date.now()`
  call inside the evaluator keeps the "now" reference transaction-consistent and avoids threading a
  clock dependency into the otherwise repo-data-driven evaluator.

### D5 — `MovimientosRepo.resumenRotacion`: one query, conditional aggregation, existing index

```ts
export interface ResumenRotacion {
  unidadesSalida30d: number; // sum of |cantidad| where tipo IN ('venta','salida'), last 30 days
  diasHistoria: number;      // whole days since MIN(fecha) across ALL movimientos for the producto
}

export interface MovimientosRepo {
  create(input: NuevoMovimiento): Promise<Movimiento>;
  listByProducto(...): ...;
  resumenRotacion(productoId: string): Promise<ResumenRotacion>; // new
}
```

```sql
select
  coalesce(sum(case when tipo in ('venta','salida') and fecha >= now() - interval '30 days'
                     then -cantidad else 0 end), 0)::int as unidades_salida_30d,
  floor(extract(epoch from (now() - min(fecha))) / 86400)::int as dias_historia
from movimientos
where producto_id = $1
```

- **Exactly `venta`+`salida`, nothing else** — read verbatim off `movimientoTipo` (`schema.ts:154-160`):
  `entrada`/`ajuste`/`anulacion` never count toward `promedio_diario`, even an `ajuste` with a
  negative `direccion` that reduces stock. This is S7's literal text, not a design choice to
  re-litigate; `cantidad` for `venta`/`salida` is always negative per the `movimientos_signo_tipo`
  CHECK, so `-cantidad` yields a positive unit count without an `abs()`.
- **Existing index is sufficient**: `movimientos_producto_id_fecha_idx` on `(productoId, fecha)`
  (`schema.ts:227-230`) serves both the `producto_id` equality predicate and the `fecha` range
  filter inside the `CASE`. No new index, no migration (holds the proposal's "no schema change"
  scope).
- **One query, not two**: an unbounded `MIN(fecha)` plus a bounded `SUM` could be two statements (the
  `MIN` could in principle use an index-only scan), but ADR-0008 itself names this "shouldn't weigh
  at a single-shop's volume" — one round trip is simpler and correct at that scale.
- `COALESCE`/zero-row defensiveness: `registrarSiCorresponde` only ever runs after this producto's
  own triggering movimiento has already been inserted in the SAME transaction, so at least one row
  always exists when this query runs — `diasHistoria` is `0` (not `NULL`/`NaN`) for a brand-new
  producto's very first movimiento, correctly failing the `>= 7` gate.

### D6 — Evaluator reads `movimiento.stockResultante`, never a fresh `producto.stockActual`

Same correctness rule #10's design.md states for `stockMinimo`: `confirmarVenta`'s Pass-A snapshot
is stale on `stockActual` by Pass B. `EvaluadorMovimiento.stockResultante` already carries
`aplicarDelta`'s return value verbatim — reused as-is for `cobertura_dias`'s numerator. No new field,
no new staleness bug class introduced by #11.

### D7 — `EvaluadorRepos` widens by one `Pick`, no call-site changes

```ts
export interface EvaluadorRepos {
  alertas: AlertasRepo;
  auditoria: AuditoriaRepo;
  movimientos: Pick<MovimientosRepo, 'resumenRotacion'>; // new
}
```

All four call sites already pass the full transaction-bound `txRepos: Repos` object (which contains
`movimientos`) to `registrarSiCorresponde`/`evaluar` — structural typing satisfies the widened
interface with zero call-site edits. `resumenRotacion` runs against the same tx executor as every
other repo call inside `evaluar()`, so it inherits `tx.savepoint('alertas', …)`'s isolation for free
(D1/D2 from #10): a SQL error in this new query rolls back only the alert side effect, never the
outer movimiento/venta write (C1).

## Evaluator Logic (new branch, appended to #10's existing branches)

```
if (movimiento.tipo !== 'anulacion') {
  const { unidadesSalida30d, diasHistoria } = await repos.movimientos.resumenRotacion(movimiento.productoId);
  if (diasHistoria >= 7) {
    const divisor = Math.min(diasHistoria, 30);
    const promedioDiario = unidadesSalida30d / divisor;
    if (promedioDiario > 0) {
      const coberturaDias = movimiento.stockResultante / promedioDiario;
      if (coberturaDias < 14) -> create 'sugerencia_reposicion'
    }
  }
}
```

Independent branch, same as every other tipo in #10's evaluator — a single movimiento can fire
`sugerencia_reposicion` alongside `quiebre`/`stock_bajo`/`discrepancia` in the same call.

## Concurrency / Transaction Shape

`aplicarDelta`'s conditional `UPDATE ... WHERE` already takes a row lock on the producto row
(`productos/repository.ts`), so two concurrent movimientos for the SAME producto serialize there
before either reaches `registrarSiCorresponde` — the second transaction's `resumenRotacion` read
runs only after the first has committed (or rolled back), under READ COMMITTED. This is existing
infrastructure, not new for #11; `resumenRotacion` inherits the same consistency guarantee every
other evaluator read already relies on. Dedup across the resulting `crearYAuditar` calls is the
existing partial unique index (D4, #10) — unchanged.

## Interfaces / Contracts (diff against #10)

```ts
// alertas/repository.ts
export type TipoAlertaEvaluada = TipoAlerta; // was Exclude<TipoAlerta, 'sugerencia_reposicion'>

// alertas/service.ts
const TIPOS_MANUALMENTE_RESOLVIBLES: readonly TipoAlertaEvaluada[] =
  ['discrepancia', 'sugerencia_reposicion'];

// alertas/evaluador.ts
export interface EvaluadorMovimiento {
  id: string;
  productoId: string;
  cantidad: number;
  stockResultante: number;
  esDiscrepancia: boolean;
  tipo: Movimiento['tipo']; // new — D3's anularVenta guard
}
export interface EvaluadorRepos {
  alertas: AlertasRepo;
  auditoria: AuditoriaRepo;
  movimientos: Pick<MovimientosRepo, 'resumenRotacion'>; // new — D7
}

// movimientos/repository.ts
export interface ResumenRotacion { unidadesSalida30d: number; diasHistoria: number; }
export interface MovimientosRepo {
  create(...): ...;
  listByProducto(...): ...;
  resumenRotacion(productoId: string): Promise<ResumenRotacion>; // new — D5
}
```

No route, schema, or migration change: the pgEnum, dedup index, and `alertas.movimientoId` FK are
already correct for a fourth tipo (#10 built them generically).

## Threat / Edge-Case Matrix

| Case | Behavior | Why |
|---|---|---|
| `stockInicial = 0` product creation | No evaluation at all (inherited #10 limitation) | `crearProducto` only calls `registrarSiCorresponde` inside `if (input.stockInicial > 0)` — unchanged by #11, same as `quiebre`/`stock_bajo` already accept |
| Concurrent movimientos, same producto | Serialized by `aplicarDelta`'s row lock before either reaches the evaluator; dedup by the D4 partial unique index | Existing #10 infrastructure, not new |
| Producto "deleted" mid-window | Impossible: `movimientos.producto_id` FK is `onDelete: 'restrict'`; deactivation is `productos.activo`, never a hard delete | `productos/repository.ts` has no delete path, only `setActivo` |
| Evaluation against an inactive producto | Cannot happen: every call site that reaches `registrarSiCorresponde` has already passed an `activo` guard (`aplicarDelta`/`findById` + `productInactive()`) before the movimiento was created | Structural — same guarantee #10's other three rules already rely on |
| `ajuste` with `direccion: 'restar'` reduces stock | Affects `cobertura_dias`'s numerator (`stockResultante`) but never `promedio_diario`'s denominator | S7's literal "venta+salida" text (D5) — asymmetry by design, not a bug |
| `anularVenta` | `registrarSiCorresponde` still runs (existing #10 call site, untouched) but the new branch no-ops via the `movimiento.tipo !== 'anulacion'` guard | D3 — ratified exclusion, mechanism only |
| `promedio_diario = 0` (history exists, zero venta/salida units) | Never suggests | `if (promedioDiario > 0)` guard, D5's evaluator branch |
| `diasHistoria` exactly 7 / exactly 30 | Evaluates; divisor is 7 / 30 respectively, no discontinuity | D4 |

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Boundary math: `diasHistoria` 6/7/29/30/31, `promedioDiario = 0`, `coberturaDias` exactly 14 | Pure `evaluar()` over fake `EvaluadorRepos` (mirrors #10's `evaluador.test.ts`) |
| Unit | `anulacion` movimiento never triggers `resumenRotacion` at all | Fake repo asserts `resumenRotacion` not called |
| Unit | `TIPOS_MANUALMENTE_RESOLVIBLES` includes `sugerencia_reposicion`; `quiebre`/`stock_bajo` still refused | `resolver()` unit/integration mirroring #10's precedent |
| Integration | `resumenRotacion` against real Postgres: 30-day window boundary, `tipo` filter excludes `entrada`/`ajuste`/`anulacion` | Real `createUnitOfWork(db)`, seeded movimientos across the 30-day line |
| Integration | Full call-site test per site (movimientos, crearProducto, confirmarVenta) producing exactly one open alert; `anularVenta` producing none | Real Postgres, mirrors #10's per-call-site suite |
| Route | `resolver()` succeeds for `sugerencia_reposicion` without 409 | `app.inject`, encargado role |

Every test mutation-probed before trusted (CLAUDE.md).

## Threat Matrix (routing/shell/process)

N/A — no routing-outside-Fastify, shell, subprocess, VCS/PR automation, executable-file
classification, or process-integration boundary. `resumenRotacion`'s SQL takes no user-controlled
identifiers or string interpolation (Drizzle query builder + parameterized `productoId`).

## Migration / Rollout

No migration required — pgEnum, dedup index, and `alertas.movimientoId` FK already accept a fourth
tipo (#10 built them generically, confirmed by reading `db/schema.ts:396-446`). Pure code change:
two compile-gate widenings, one new repo method, one new evaluator branch, one new interface field.
Rollback is a pure code revert (proposal's Rollback Plan, unchanged by this design).

## Open Questions

None blocking. All decisions above are architecture-level implementations of ratified proposal
scope; no product/requirement behavior was decided here.
