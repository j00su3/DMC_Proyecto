# Exploration: movimientos-inventario (backlog #6)

**Date**: 2026-08-30
**Change**: `movimientos-inventario`
**Artifact store**: hybrid — this file plus Engram topic `sdd/movimientos-inventario/explore`
**Phase**: explore (no code written, no source file modified)

> Persistence note: the `sdd-explore` agent had no Write tool in its runtime, so it
> persisted only to Engram. This file was materialized by the orchestrator from that
> topic, after independently re-reading and confirming every `file:line` claim below.

## Current State

Backlog item #5 (`productos-ledger-base`, archived 2026-08-30) already built most of the
plumbing this change needs. The schema, the conditional-UPDATE primitive, the repo port and
the UoW wiring all exist today. **#6 is a service + routes + UI slice on top of an
already-complete data model, not a schema-first slice.**

### Schema — complete; no migration expected for the core scope

- `apps/api/src/db/schema.ts:152-158` — `movimientoTipo` pgEnum already ships all five
  values: `entrada | salida | ajuste | venta | anulacion`. There is no `merma` value and
  none is planned (see Risks).
- `apps/api/src/db/schema.ts:190-233` — `movimientos` with exactly two CHECK constraints:
  - `movimientos_signo_tipo` — `entrada > 0`, `salida`/`venta` `< 0`, `anulacion > 0`,
    `ajuste` unconstrained.
  - `movimientos_discrepancia_solo_ajuste` — `es_discrepancia` may be true only on `ajuste`.
- A third CHECK for a mandatory `motivo` was **deliberately dropped** during #5. The
  schema's own comment says so verbatim: *"#6 owns the motivo rule."* Cross-checked in
  `openspec/changes/archive/2026-08-30-productos-ledger-base/design.md:167-172,524-528`.
- No `cantidad <> 0` CHECK either — also explicitly left to #6
  (`archive/.../design.md:162-165,529-530`); `ajuste` is deliberately unconstrained per
  `docs/TECH-DESIGNv2.md:125`.
- `apps/api/drizzle/0004_legal_shinobi_shaw.sql` created both tables and is already applied
  to Neon. **#6 likely needs zero new migrations** unless the motivo / zero-quantity
  decisions below add a CHECK.
- `movimientos_producto_id_fecha_idx` (`schema.ts:214-218`) — composite index on
  `(producto_id, fecha)`, added in #5 specifically to serve #6's history
  (`archive/.../design.md:139`). It fixes the query pattern, not the URL shape.

### `aplicarDelta` — D1 of #5, unmodified, already satisfies #6's core requirement

`apps/api/src/productos/repository.ts:202-218`

```ts
async aplicarDelta(id: string, delta: number): Promise<number | undefined> {
  const rows = await this.db.update(productos)
    .set({ stockActual: sql`${productos.stockActual} + ${delta}` })
    .where(and(
      eq(productos.id, id),
      eq(productos.activo, true),
      sql`${productos.stockActual} + ${delta} >= 0`,
    ))
    .returning({ stockActual: productos.stockActual });
  return rows[0]?.stockActual;
}
```

Exactly one conditional UPDATE — that is what makes two concurrent calls serialize on the
row's own write instead of a `SELECT ... FOR UPDATE` followed by a plain `SET`. It is
already backlog #6's `stock >= :n AND activo = true` requirement, built.

It returns the new `stock_actual` on success and `undefined` when the guard rejected. **The
rejection causes are indistinguishable from the return value alone** — unknown id, inactive
product, and a result that would go negative all collapse to `undefined`. See Risks.

ADR-0005's 2026-08-13 exemption (`anulacion` movements skip `activo = true`) is not
implemented here, correctly: `anulacion` and `venta` belong to #7/#9, outside this scope
(`openspec/specs/product-management/spec.md:10,127`).

### `MovimientosRepo` — `create` only, deliberately narrow

`apps/api/src/movimientos/repository.ts:32-34` exposes exactly one method today:
`create(input: NuevoMovimiento): Promise<Movimiento>`. Its comment states the intent:
*"No other method exists on this port yet — #6 extends it. This narrow port is what makes
the forced-failure fake in the Phase 6 atomicity test an honest full replacement."*

`DrizzleMovimientosRepo.create` (lines 51-66) does **no domain-error mapping** — a CHECK
violation surfaces as a raw Postgres error, proven by
`apps/api/src/movimientos/repository.integration.test.ts:100-114`
(`rejects.toMatchObject({ cause: { code: '23514' } })`).

Consequence for #6: it must validate its own invariants (motivo, insufficient stock)
**before** calling `create`, never by catching a CHECK violation and mapping it to a domain
error.

### `crearProducto` — the transactional pattern #6 must mirror

`apps/api/src/productos/service.ts:67-134`. Its docblock names six load-bearing ordering
rules; the ones that bind #6:

1. Field and role guards run **before** `uow.run` opens, and are key-presence checks
   (`Object.hasOwn`), not `!== undefined`.
2. Everything else happens inside exactly one `uow.run` invocation.
3. `stockResultante` comes from `aplicarDelta`'s return value and is **never recomputed**
   (lines 96-118).
4. `recordAudit` is the last statement inside `uow.run`, and it audits `productos` — never
   the movement itself.

`apps/api/src/plugins/repos.ts:28-51` already wires `movimientos: DrizzleMovimientosRepo`
into both `app.repos` and every `uow.run` transaction. `txRepos.movimientos` is available
today with no plumbing change.

### Audit boundary — `movimientos` must not go through `recordAudit` at all

`apps/api/src/auditoria/service.ts:10` — `AuditableEntidad = keyof typeof
FIELD_CLASSIFICATION` is the real compile gate. The `entidadAuditoria` pgEnum in
`schema.ts` is a red herring: it constrains the database column, not what compiles.

`apps/api/src/auditoria/fields.ts:20-59` — `FIELD_CLASSIFICATION` has exactly three keys:
`usuarios`, `proveedores`, `productos`. **No `movimientos` key exists, and #6 must not add
one.** ADR-0012 rule 2: *"Sin doble escritura. Un movimiento ya se audita a sí mismo…
Nunca se escribe una fila de auditoria por un movimiento."* A movement's own row
(`usuarioId`, `fecha`, `motivo`, `stockResultante`) IS its audit trail.

Today `recordAudit({ entidad: 'movimientos', ... })` would not compile. The boundary is
enforced by the compiler, exactly as ADR-0012 rule 3 intends.

### RBAC precedent — none specific to movimientos

`apps/api/src/routes/productos.ts` uses per-route `config: { roles: [...] }`, enforced by a
`preHandler` hook in `apps/api/src/plugins/auth.ts:92-95`. Both roles read/create/update
productos; only `stockMinimo` is field-gated to `encargado`; deactivate/reactivate are
`encargado`-only.

**`apps/api/src/routes/movimientos.ts` does not exist.** #6 creates it from scratch.

### Frontend — no movement UI scaffold exists

- `apps/web/src/features/movimientos/` does not exist.
- `apps/web/src/features/productos/ProductosTable.tsx` has no action column;
  deactivate/reactivate live on `apps/web/src/routes/productosDetalle.tsx`.
- `docs/design.md:66` documents a row-action outline button ("Reponer") that has no
  implementation yet.

`docs/design.md:82-83` — the "3-step modal" is **styling tokens only**: radius 18, header
with divider and a circular grey ✕, numbered steps with uppercase labels
("1 · Tipo de movimiento"), a 12px muted centred audit note at the foot. Only step 1's
label is named. Steps 2 and 3 have no documented fields anywhere. The wireframes design.md
references are confirmed absent from the repo (design.md's own note, lines 111-121,
verified 2026-08-25). Not a new gap, but it means the design phase must invent the concrete
field layout for steps 2-3 from tokens alone.

## Affected Areas

| Path | Change |
| --- | --- |
| `apps/api/src/movimientos/repository.ts` | Extend the port with a history/list method; `create` unchanged |
| `apps/api/src/movimientos/service.ts` | **NEW** — motivo validation, `es_discrepancia` marking, disambiguating `aplicarDelta`'s `undefined` |
| `apps/api/src/routes/movimientos.ts` | **NEW** — RBAC config, Zod DTOs, paginated history, register in `app.ts` |
| `apps/api/src/lib/errors.ts` | Add insufficient-stock and motivo-required factories (no wire code is pre-ratified) |
| `apps/api/src/plugins/repos.ts` | No change expected — already wired |
| `apps/web/src/features/movimientos/` | **NEW** — 3-step modal, hooks, schemas, tests |
| `apps/web/.../ProductosTable.tsx` or `routes/productosDetalle.tsx` | Add the modal trigger |
| `docs/BACKLOG.md:41` | Flip to done on archive, per project convention |

## Transaction Shape (derived from `crearProducto`, not invented)

1. Pre-transaction guards (RBAC per movement type, payload shape) run **before** `uow.run`.
2. A single `uow.run(async (txRepos) => { ... })`.
3. `const nuevoStock = await txRepos.productos.aplicarDelta(productoId, signedDelta)`.
4. If `nuevoStock === undefined`, throw a domain error — but the service must first
   determine *why* (inactive vs. insufficient), which `aplicarDelta` alone cannot tell it.
5. `await txRepos.movimientos.create({ ..., stockResultante: nuevoStock })` — taken
   verbatim from step 3, never recomputed, mirroring `service.ts:110-118` exactly.
6. **No `recordAudit` call** for the movement (ADR-0012 rule 2).
7. Return the movement and/or the updated product shape.

### Seam for #10 (alert engine — do not build here)

ADR-0008 requires the evaluator to run inside the **same** transaction as the movement,
wrapped in `SAVEPOINT alertas` immediately before invocation, with `ROLLBACK TO SAVEPOINT`
on any failure so the movement always commits regardless of evaluator errors.

#6 must leave one identifiable point — right after step 5 succeeds, still inside `uow.run`,
with the finished `Movimiento` and the updated `Producto` both in scope — where a future
`SAVEPOINT`-guarded evaluator call can be inserted without restructuring the transaction.
Concretely: nothing after step 5 may return early or close the transaction before a natural
"evaluate alerts here" point exists.

## Open Questions Needing a Product Decision

1. **RBAC per movement type.** ADR-0005's context implies `deposito` registers
   entradas/salidas. But `ajuste` sets `es_discrepancia` and feeds the encargado-only
   discrepancy report (#12 restricts `deposito` from global discrepancies). Should `ajuste`
   — or only `ajuste` with `es_discrepancia = true` — be encargado-only? No code or doc
   answers this for movimientos.
2. **Merma's validation trigger.** Confirmed NOT a separate `tipo`. Is `motivo` mandatory
   for every `salida`, or only when the operator marks it as a merma? The backlog phrase is
   "motivo obligatorio en ajustes y mermas", not "en salidas" — narrower than every salida.
3. **Motivo's validation shape.** Free text (min-length only) vs. a closed list of reasons?
   `motivo` is plain `text` and its CHECK was deliberately dropped for #6 to own.
4. **History endpoint shape.** `GET /api/movimientos?productoId=X` vs.
   `GET /api/productos/:id/movimientos`. The composite index fixes the query pattern, not
   the resource shape, and not whether cross-product listing (relevant to #12) is in scope.
   *Orchestrator note: treated as a design-phase decision, not a product fork.*
5. **`cantidad <> 0` on ajuste.** Explicitly punted by #5 to #6. Does a zero-quantity
   "counted, no discrepancy" ajuste need to be representable?

## Risks and Traps

- **Backlog text vs. schema mismatch on "merma."** `docs/BACKLOG.md:41` reads as if
  `ajuste` and `merma` were parallel `tipo` values. They are not: the enum has no `merma`,
  `docs/TECH-DESIGNv2.md:126` says "obligatorio en ajustes y **salidas de merma**", and
  `archive/.../design.md:168` settles it — *"Merma is a reason, not a `tipo`."* Flag this in
  the proposal so nobody proposes a migration adding an enum value that was already
  rejected.
- **`aplicarDelta`'s `undefined` return is ambiguous.** ADR-0005 requires the
  insufficient-stock message to name the available quantity ("hay N"), read inside the same
  transaction — and no current code path reads that N atomically. #6 must design this.
- **No domain-error mapping in `MovimientosRepo.create`,** deliberately. Domain errors must
  be thrown before `create`, never derived from a caught CHECK violation.
- **No error factory exists** for insufficient stock or a movement-specific inactive-product
  refusal. No wire code is pre-ratified in any doc; this is a spec-time decision, not reuse.
- **`docs/design.md`'s 3-step modal is tokens only** and its wireframes are confirmed
  absent. The design phase has no hidden source of truth to fall back on.
- **`routes/movimientos.ts` and `features/movimientos/` do not exist.** #6 is the first
  slice to touch these paths — nothing to extend, unlike most prior backlog items.

## Size Estimate (against the 800-line review budget)

| Area | Estimate |
| --- | --- |
| `movimientos/service.ts` (new) | ~120-180 |
| `movimientos/repository.ts` extension | ~30-60 |
| `routes/movimientos.ts` (new) | ~150-220 |
| `lib/errors.ts` additions | ~20-30 |
| API unit + integration tests | ~250-400 |
| **Backend subtotal** | **~570-890** |
| Frontend: 3-step modal, schemas, hooks, trigger, tests | ~400-600 |
| **Total** | **~1000-1500 changed lines** |

This exceeds the single-PR 800-line budget cached for this session. Under `ask-on-risk`,
the review workload guard should flag it after `sdd-tasks`; the likely split is a backend
slice and a frontend slice, mirroring how #5 was chained.

## Ready for Proposal

Yes — after questions 1, 2, 3 and 5 are answered by the user. They are genuine product
forks, not implementation details a proposal should silently resolve. Question 4 is an API
design decision and belongs to `sdd-design`.
