# Design: Anulación de Venta (backlog #9)

## Technical Approach

Proposal Approach 1. One `uow.run` in `ventas/service.ts::anularVenta`, structured as
`confirmarVenta`'s mirror image: a state-transition guard first, then a per-item loop that
reverses stock and appends one `anulacion` movimiento, then a bulk `pagos` revert. Two new narrow
repository methods carry the two new invariants; nothing existing is modified except `ventaDto`
(additive fields) and the receipt **route** component. `Recibo.tsx` is untouched (PD-4).

## Architecture Decisions

### Decision: `POST /api/ventas/:id/anular` (action-style)
**Alternatives**: `PATCH /api/ventas/:id`.
**Rationale**: `routes/movimientos.ts` already ships action-style writes
(`POST /productos/:id/movimientos/entrada`). A `PATCH` on `ventas` would advertise a mutable
resource; `ventas` is append-only with exactly one legal transition. No path collision: the only
other 3-segment route is `GET /ventas/numero/:n`, a different verb and a different terminal
segment.

### Decision: The `confirmada -> anulada` UPDATE runs FIRST inside the transaction
**Alternatives**: reverse stock first, transition last.
**Rationale**: the conditional UPDATE (`where id = :id and estado = 'confirmada'`) is the
serialization point. Taking it first makes a concurrent second anulación block on that row and
then see 0 rows, exactly `aplicarDelta`'s race idiom (ADR-0005), instead of both transactions
doing full stock work before one loses.

### Decision: `revertirStockPorAnulacion(id, cantidad)` returns `Promise<number>`, never `undefined`
**Alternatives**: mirror `aplicarDelta`'s `number | undefined` plus a `rechazarVenta`-style
classifier.
**Rationale**: with `activo` unchecked (A8) and `cantidad` positive, the `>= 0` guard is moot, so
the only zero-row cause is a missing product — impossible behind the `items_venta` FK. Returning
`| undefined` would force a branch that can never fire. Zero rows throws via the `expectOneRow`
idiom. The parameter is named `cantidad`, positive-only: a decrement is **unrepresentable**
through this seam, which is the real anti-backdoor guarantee (proposal risk row 3).

### Decision: anulación `movimientos` rows carry `motivo: null`, linked by `ventaId`
**Alternatives**: copy `motivoAnulacion` onto every movimiento row.
**Rationale**: exact symmetry with the `tipo: 'venta'` rows `confirmarVenta` already writes
(null motivo, `ventaId` set). The venta row is the single home of the reason; duplicating text
across N rows invites drift.

### Decision: no `recordAudit` call
**Rationale**: `ventas` is deliberately not an `AuditableEntidad` (#7 D9), and
`recordAudit({ entidad: 'ventas' })` would not compile. The `anulacion` movimientos plus
`anuladaPor`/`anuladaEn`/`motivoAnulacion` are the audit trail.

### Decision: missing motivo is a Zod `VALIDATION_ERROR` (400), not a new error factory
**Rationale**: `motivoAnulacion` is *unconditionally* required, so it is wire shape.
`movementReasonRequired()` exists only because that field is conditionally required. One new
factory only: `saleAlreadyVoided()` → `SALE_ALREADY_VOIDED`, 409 (`SKU_ALREADY_IN_USE` naming
family).

### Decision: UI entry point on the receipt route, not the POS screen
**Rationale**: resolves `recibo-ui`'s ambiguity flag in favour of `recibo-ui` — no move to
`pos-ui` at archive. `/ventas/$id/recibo` already holds the venta id, `estado`, and `useRecibo`;
the POS screen holds a cart, not a confirmed venta.

## Data Flow

    recibo.tsx (route)  ──rol==='encargado' && estado==='confirmada'──→ AnularVentaModal
         │                                                                    │ motivo
         └────────────── useAnularVenta ──→ POST /ventas/:id/anular ←──────────┘
                              │
                              ▼   uow.run:
              ventas.marcarAnulada (guard) → per item: revertirStockPorAnulacion
              → movimientos.create(tipo:'anulacion') → ventas.revertirPagos
                              │
              onSuccess: invalidate reciboKeys.detail(id) + productosKeys.all

## File Changes

| File | Action | Description |
|---|---|---|
| `apps/api/src/db/schema.ts` | Modify | `ventas`: `anuladaPor` (FK usuarios, restrict, nullable), `anuladaEn`, `motivoAnulacion` + CHECK `ventas_anulacion_datos_solo_anulada` |
| `apps/api/drizzle/*` | Create | Additive migration (manual Neon step) |
| `apps/api/src/productos/repository.ts` | Modify | `revertirStockPorAnulacion` (A8-exempt) |
| `apps/api/src/ventas/repository.ts` | Modify | `marcarAnulada`, `revertirPagos`; `Venta` gains 3 fields |
| `apps/api/src/ventas/service.ts` | Modify | `anularVenta` |
| `apps/api/src/routes/ventas.ts` | Modify | `POST /ventas/:id/anular`, `roles: ['encargado']`; `ventaDto` +3 nullable fields |
| `apps/api/src/lib/errors.ts` | Modify | `saleAlreadyVoided()` |
| `apps/web/src/features/recibo/{schemas,useAnularVenta,AnularVentaModal}.ts(x)` + css | Create | Form schema, mutation, modal |
| `apps/web/src/features/recibo/errorMessages.ts` | Modify | `SALE_ALREADY_VOIDED` copy |
| `apps/web/src/routes/recibo.tsx` | Modify | Role/estado-gated trigger, modal host, server-error mapping |
| `apps/web/src/features/recibo/Recibo.tsx` | **Unchanged** | PD-4 |

## Interfaces / Contracts

```ts
// productos/repository.ts — cantidad is positive-only; no `activo` predicate (A8).
revertirStockPorAnulacion(id: string, cantidad: number): Promise<number>;

// ventas/repository.ts — undefined === guard rejected (not confirmada), never "row missing".
marcarAnulada(input: {
  ventaId: string; anuladaPor: string; motivoAnulacion: string;
}): Promise<Venta | undefined>;      // sets anuladaEn via SQL now()
revertirPagos(ventaId: string): Promise<Pago[]>;  // where estado = 'registrado'

// wire
POST /api/ventas/:id/anular   body: { motivoAnulacion: string }  → 200 okVenta
// 400 VALIDATION_ERROR | 401 | 403 | 404 SALE_NOT_FOUND | 409 SALE_ALREADY_VOIDED
```

Service classify-on-undefined (the `rechazarVenta` precedent): `marcarAnulada` returns
`undefined` → `findById` → absent = `saleNotFound()` (404), present = `saleAlreadyVoided()` (409).

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit (api) | `anularVenta` order, motivo persisted verbatim, 404/409 classification, total-only reversal | Fake repos, Vitest |
| Unit (web) | `anularVentaFormSchema` (blank/whitespace/length), `errorMessages` | Pure-function tests |
| Integration | Atomicity rollback on last-item failure; `activo=false` product still reverts; concurrent double anulación → exactly one 409; correlativo unchanged; **403 writes nothing** | Real Postgres + real `createUnitOfWork`, override only the failing dep; assert the DB after every refusal |
| Route (web) | `await router.load()`; trigger hidden for `deposito` and for `anulada`; submit blocked without motivo; view reflects `anulada` | RTL + MSW |

## Threat Matrix

N/A — no shell, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary. HTTP authorization is covered by the RBAC route tests above.

## Migration / Rollout

Additive migration; every existing row is `confirmada` with three NULLs and satisfies the new
CHECK. **Must be applied manually against Neon** (`pnpm db:migrate`) before deploy, or the route
500s. Run `pnpm contract` — `ventaDto`'s three new nullable fields regenerate
`apps/web/src/api/schema.d.ts`.

## Open Questions

- [x] `motivoAnulacion` length bounds: **ratified by owner 2026-09-01** — `trim().min(3).max(500)`,
      mirroring `movimientos`' `MOTIVO_MIN_LENGTH`/`MOTIVO_MAX_LENGTH`. This supersedes the spec's
      looser "not blank" wording; tasks/apply must implement the min(3)/max(500) bound.
- [x] Confirming that exposing `anuladaPor`/`anuladaEn`/`motivoAnulacion` on `ventaDto`
      (`point-of-sale` spec Open Question 4) is wanted; `Recibo.tsx` renders none of them (PD-4),
      so this only widens the contract. **Confirmed at archive — the fields were implemented and verified in apply/verify cycles.**
- [ ] Design treats the modal + mandatory typed motivo as sufficient confirmation (`recibo-ui`
      Open Question 2) — no second "¿está seguro?" step, matching `MovimientoModal`'s precedent.
