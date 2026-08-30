# Design: movimientos-inventario (backlog #6)

## Authority and scope of this document

`proposal.md` settles PD-1…PD-5 and they are not reopened here. `docs/TECH-DESIGNv2.md` is the
design of record; ADR-0005 governs the atomic update, ADR-0006 the insufficient-stock policy,
ADR-0008 the alert seam, ADR-0012 the audit/ledger boundary. This document decides **how**.

`sdd-spec` runs in parallel and I cannot see its output. Where I had to take a position on
something that may belong to the spec, it is marked **[RECONCILE-n]** and repeated at the end.
The spec wins on every one of those.

Size note: the generic 800-word design budget is deliberately exceeded, on the orchestrator's
explicit instruction to match `archive/2026-08-30-productos-ledger-base/design.md`'s rigour and
decision numbering. That archived document is the project's actual convention for this artifact.

## Technical Approach

Three new pieces on top of a complete data model: a `movimientos` service that mirrors
`crearProducto`'s transaction shape verbatim, a routes plugin nested under the product resource,
and a 3-step modal built from `docs/design.md`'s tokens and the existing `Modal`/`TextField`
primitives. One migration adds the two CHECK constraints #5 punted here plus the `es_merma`
column PD-5 requires.

The one genuinely new mechanism is **failure classification**: `aplicarDelta` stays byte-for-byte
unchanged (D1 of #5 survives untouched) and a second read, on the rejection path only, decides
which of three domain errors to throw. Everything else is assembly of shipped patterns.

## Architecture Decisions

### D1 — Disambiguating `aplicarDelta`'s `undefined`: classify on the rejection path, never on the success path

**Choice.** `ProductosRepo.aplicarDelta` is **not modified**. Its signature, its single conditional
UPDATE, and its `number | undefined` return stay exactly as `productos/repository.ts:205-218`
ships them. On `undefined`, and only then, the service calls `txRepos.productos.findById(id)`
inside the same transaction and maps the result through a fixed precedence:

| Classification read | Domain error | Status |
|---|---|---|
| row is `undefined` | `productNotFound()` (already exists) | 404 |
| `activo === false` | `productInactive()` | 409 |
| otherwise | `insufficientStock(row.stockActual)` | 409 |

The helper is a `Promise<never>` in `movimientos/service.ts` — it always throws, so the caller's
control flow after it is unreachable and TypeScript narrows `nuevoStock` to `number`:

```ts
async function rechazarMovimiento(
  repos: Pick<Repos, 'productos'>,
  productoId: string,
): Promise<never> {
  const producto = await repos.productos.findById(productoId);
  if (!producto) throw productNotFound();
  if (!producto.activo) throw productInactive();
  throw insufficientStock(producto.stockActual);
}
```

**How #5's D1 survives.** It survives because nothing about it changes. The success path is one
statement, exactly as before: the conditional UPDATE both decides and writes, so two concurrent
callers still serialize on the row's own write and never on a `SELECT … FOR UPDATE` followed by a
plain `SET`. The second statement exists only on a path that is about to abort the transaction,
so it can neither widen the write window nor introduce a lock-ordering hazard — it takes no lock
at all.

**Concurrency, stated honestly.** The failed UPDATE takes no row lock (a row failing the qual is
not locked), so between it and the classification read another transaction can commit. Under READ
COMMITTED the failed UPDATE did wait out any in-flight writer and re-evaluated its qual against
the newest committed version, so the classification read is *at least* as fresh as the guard —
but it can be newer. Two anomalies are therefore possible and are **not** impossible, merely
unlikely:

1. **The reported number no longer explains the refusal.** A concurrent entrada lands in the
   window and the message says "hay 12" for a salida of 5. The user retries and succeeds. No
   distinct error code is added for this: the remedy is identical, and a code nobody can
   reproduce is worse than a message that reads oddly once.
2. **Inactive/insufficient misclassification.** `activo` flips in the window and the wrong one of
   the two 409s is returned.

Both require a concurrent write on the same product inside a sub-millisecond window, in a
single-shop deployment. Accepted, and named here so nobody later claims the race was closed.
ADR-0005's requirement — that N be read *inside the same transaction*, not from an earlier query
— is satisfied exactly; the number is advisory by construction, because the transaction rolls
back the moment it is produced.

**Alternatives rejected.**

| Option | Why rejected |
|---|---|
| Change `aplicarDelta` to return a discriminated result, using one data-modifying CTE: `WITH upd AS (UPDATE … RETURNING stock_actual) SELECT p.stock_actual, p.activo, upd.stock_actual FROM productos p LEFT JOIN upd ON true WHERE p.id = :id` | Strictly the best freshness — one statement, and the reported N is precisely the pre-image the guard rejected against. Rejected on blast radius, not correctness: it rewrites the one primitive #5 built, its only current call site (`productos/service.ts:96-108`), its integration tests, and its port docblock, in a cycle already forecast at 1000–1500 lines. It also arms a subtle trap — on the success path the new stock must come from `upd`, never from `p`, because the outer SELECT sees the pre-statement snapshot. Reconsider if #7's multi-item POS needs per-item reasons. |
| `findByIdForUpdate` instead of `findById` for the classification read | Waits out a concurrent writer, so the read is current and stays current. Worth nothing here: we abort microseconds later, so "stays current" buys nothing, and it puts a blocking lock acquisition on an error path for a number that is advisory anyway. |
| A pre-transaction `findById` guard before `uow.run` | Duplicates the UPDATE's own guard with a staler read, and would refuse on a value the UPDATE never evaluated. The conditional UPDATE is the authority (ADR-0005); a pre-read that disagrees with it is a second source of truth. |
| Catch the Postgres error and map it | Forbidden by construction: `DrizzleMovimientosRepo` deliberately does no error mapping (`movimientos/repository.ts:45-47`), and a CHECK violation must never be the mechanism by which a user-facing error is produced. |

### D2 — The #10 seam: a named tail inside `uow.run`, with both objects in scope

**Choice.** The transaction callback ends with a fixed four-step tail and an explicit marker:

```ts
return uow.run(async (txRepos) => {
  const nuevoStock = await txRepos.productos.aplicarDelta(productoId, delta);
  if (nuevoStock === undefined) await rechazarMovimiento(txRepos, productoId);

  const movimiento = await txRepos.movimientos.create({
    /* … */ stockResultante: nuevoStock, // verbatim, never recomputed
  });

  const producto = await txRepos.productos.findById(productoId);
  if (!producto) throw new Error('registrarMovimiento: producto vanished inside the transaction');

  // ── SEAM (backlog #10, ADR-0008) ──────────────────────────────────────
  // A future EvaluadorDeAlertas.evaluar(movimiento, producto) is invoked
  // HERE, wrapped in SAVEPOINT alertas / ROLLBACK TO SAVEPOINT alertas.
  // Both arguments are already in scope and the transaction is still open.
  // Do not add code between movimientos.create and this point.
  // ──────────────────────────────────────────────────────────────────────

  return { movimiento, producto };
});
```

The extra `findById` exists for the seam, and pays for itself twice: it is the only way to hand
#10 a real `Producto` (which is what ADR-0008's `evaluar(movimiento, producto)` takes, and where
`stock_minimo` lives), and it lets the response carry the updated product so the modal shows the
new stock without a second round-trip. #10 needs no further read: ADR-0008's crossing rule wants
`stock_previo`, which is `movimiento.stockResultante - movimiento.cantidad` — pure arithmetic on
the row already in scope.

**What #6 must not do**, each item being a thing that would force #10 to restructure the
transaction:

- **No early `return` and no `throw` after `movimientos.create`** other than the invariant guard
  above. An early exit means there is no point at which both objects are live.
- **No response mapping inside `uow.run`.** The callback returns the domain pair
  `{ movimiento, producto }`; `routes/movimientos.ts` maps it to a DTO afterwards. Building a DTO
  inside would put a transformation between the insert and the seam.
- **No post-commit re-read to build the response.** Every value the response needs is resolved
  inside the transaction. A re-read after commit would move the natural end of the transaction to
  before the point where the evaluator has to run.
- **No `try`/`catch` anywhere inside `uow.run`.** ADR-0008 is explicit that an application
  try/catch does not isolate the evaluator, because a failed statement aborts the whole Postgres
  transaction (`25P02`). Establishing a catch here now would look like the isolation mechanism and
  is not one.
- **No second `uow.run`, no nesting.** Exactly one invocation, mirroring `crearProducto`.
- **No `SAVEPOINT` plumbing in #6.** `UnitOfWork.run` hands the callback `Repos`, never the raw
  executor (`db/uow.ts:5-11`), so #10 must widen that port itself. #6 must not pre-widen `Repos`
  or leak `tx` "for #10" — an unused seam that guesses the wrong shape is worse than no seam.

### D3 — One migration: `es_merma` plus two CHECK constraints

**Schema change** (`apps/api/src/db/schema.ts`, `movimientos`), generated with `pnpm db:generate`,
never hand-written (#5 D5's rule):

```ts
esMerma: boolean('es_merma').notNull().default(false),   // beside esDiscrepancia
// …
check(
  'movimientos_merma_solo_salida',
  sql`${table.esMerma} = false OR ${table.tipo} = 'salida'::movimiento_tipo`,
),
check(
  'movimientos_ajuste_cantidad_no_cero',
  sql`${table.tipo} <> 'ajuste'::movimiento_tipo OR ${table.cantidad} <> 0`,
),
```

`movimientos_merma_solo_salida` is a deliberate structural mirror of
`movimientos_discrepancia_solo_ajuste` (`schema.ts:228-231`) — same `flag = false OR tipo = …`
spelling, same Spanish constraint-name family, so the two read as a pair.

**Expected `apps/api/drizzle/0005_*.sql`:**

```sql
ALTER TABLE "movimientos" ADD COLUMN "es_merma" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_merma_solo_salida" CHECK ("movimientos"."es_merma" = false OR "movimientos"."tipo" = 'salida'::movimiento_tipo);--> statement-breakpoint
ALTER TABLE "movimientos" ADD CONSTRAINT "movimientos_ajuste_cantidad_no_cero" CHECK ("movimientos"."tipo" <> 'ajuste'::movimiento_tipo OR "movimientos"."cantidad" <> 0);
```

**What can fail against existing Neon data:**

| Statement | Risk | Verdict |
|---|---|---|
| `ADD COLUMN … boolean DEFAULT false NOT NULL` | Table rewrite on a large table | None. Postgres 11+ stores a non-volatile default in the catalog; no rewrite, and no existing row can violate `NOT NULL` because the default supplies it. |
| `movimientos_merma_solo_salida` | Validated against every existing row | Cannot fail. Every pre-existing row now has `es_merma = false`, so the first disjunct is true unconditionally. |
| `movimientos_ajuste_cantidad_no_cero` | **Validated against every existing row — this one can fail (23514).** | The only writer today is `crearProducto`, which emits an `ajuste` solely when `stockInicial > 0` (`productos/service.ts:95`), so `cantidad = 0` should not exist. That is an inference about production data, not a proof. |

**Mandatory pre-flight against Neon, before `pnpm db:migrate`:**

```sql
SELECT count(*) FROM movimientos WHERE tipo = 'ajuste' AND cantidad = 0;  -- must be 0
```

If it is not 0 the ALTER aborts. Drizzle's migrator runs the file in one transaction, so a failure
rolls back the column too — nothing lands half-applied. Deciding what to do with such rows is a
product call, not something the migration may fix silently.

**Deployment.** Neon migrations are run by hand from the developer's machine (ADR-0010:71-72).
This change **deploys green and then 500s on every movement route until that command is run** —
release-checklist item, not an assumption.

**`NuevoMovimiento.esMerma` is required, not optional.** It mirrors `esDiscrepancia: boolean`,
which is already required (`movimientos/repository.ts:22`). The cost is a compile error at
`productos/service.ts:110-118` until `crearProducto` passes `esMerma: false`, plus one property in
each existing `NuevoMovimiento` test fixture. That cost is the point: every future writer (#7's
`venta`, #9's `anulacion`) is forced to state the flag rather than inherit a default. Note that
this makes the proposal's "no existing route or table is modified" slightly optimistic —
`crearProducto` and the `movimientos` table both change, additively.

**Rejected:** folding `cantidad <> 0` into the existing `movimientos_signo_tipo` CHECK by
tightening its `ajuste` arm. It requires DROP + ADD of a shipped constraint (a full revalidation
plus a window with no sign guard at all), and it merges two independent rules into one name, so a
rollback can no longer drop just the new one.

### D4 — `MovimientosRepo` gains exactly one method

```ts
export interface MovimientosRepo {
  create(input: NuevoMovimiento): Promise<Movimiento>;
  listByProducto(
    productoId: string,
    page: number,
    pageSize: number,
  ): Promise<{ rows: Movimiento[]; total: number }>;
}
```

`{ rows, total }` is `ProductosRepo.list`'s shape verbatim, so `lib/pagination.ts`'s `paginated()`
envelope applies with no adapter. Ordering is `desc(fecha), desc(id)` — the same
newest-first-with-id-tiebreak as `DrizzleProductosRepo.list` (`repository.ts:105`), and a
descending scan of `movimientos_producto_id_fecha_idx` serves it (btree indexes read either
direction). The predicate is `eq(productoId)` on both the page query and the `count(*)::int`
query; #5's D7 named applying it to only one as the most likely defect in a paginated list, and it
is the same defect here.

`listByProducto` takes `productoId` as a required first argument, never an optional filter. An
optional filter is exactly how a cross-product listing arrives by accident — omit the argument and
you have listed the whole ledger. #12 must add that deliberately.

**Cost, named:** #5 kept this port at one method because that is "what makes the forced-failure
fake in the Phase 6 atomicity test an honest full replacement" (`repository.ts:28-31`). Every
existing `MovimientosRepo` fake must now also implement `listByProducto`. The port is still narrow
enough for a fake to be a full replacement; the comment needs updating, not deleting.

### D5 — URL shape: everything nested under the product

| Method | Path | `config.roles` |
|---|---|---|
| `GET` | `/api/productos/:id/movimientos` | `['encargado','deposito']` |
| `POST` | `/api/productos/:id/movimientos/entrada` | `['encargado','deposito']` |
| `POST` | `/api/productos/:id/movimientos/salida` | `['encargado','deposito']` |
| `POST` | `/api/productos/:id/movimientos/ajuste` | `['encargado']` |

**Why nested over `GET /api/movimientos?productoId=X`.** The existing convention supports it and
does not support the alternative: every query parameter in the codebase today is a
pagination/search concern (`page`, `pageSize`, `q` — `lib/pagination.ts`, `routes/productos.ts:49`),
and the only sub-resource precedent is a path segment (`/productos/:id/deactivate`,
`routes/productos.ts:216-221`). A `?productoId=` filter would be the first foreign-key-as-query-param
in the project. It is also structurally weaker: an optional filter makes cross-product listing —
explicitly out of scope — reachable by omitting a parameter, whereas a nested path has no spelling
for it. The composite index serves either shape, so it does not decide this.

**Why three write routes instead of one `POST` with `tipo` in the body.** PD-1's RBAC rule then
becomes route configuration rather than a service branch: the `ajuste` refusal for a `deposito` is
a plain `FORBIDDEN` from the `preHandler` (`plugins/auth.ts:92-95`) before any handler runs, and
is provable by a route test against the config. This is the same reasoning that produced two
explicit routes for deactivate/reactivate. A single endpoint would force an in-service role check
and a second, different 403 code for the same class of refusal.

**File placement.** All four routes live in `apps/api/src/routes/movimientos.ts`, registered in
`app.ts` with `{ prefix: '/api' }` alongside `productosRoutes`. The path string names the resource;
the file names the domain, and the `movimientos` capability stays in one file. Fastify resolves
`/productos/:id` and `/productos/:id/movimientos` as distinct paths, so the split ownership of the
`/productos/*` namespace is legal — it is worth a comment in both files, since it is the only place
in the project where two plugins share a prefix segment.

### D6 — Error factories

| Factory | Code | Status | Thrown by |
|---|---|---|---|
| `insufficientStock(available: number)` | `INSUFFICIENT_STOCK` | 409 | D1 classification |
| `productInactive()` | `PRODUCT_INACTIVE` | 409 | D1 classification |
| `movementReasonRequired()` | `MOVEMENT_REASON_REQUIRED` | 400 | D8 guard, before `uow.run` |
| `productNotFound()` | `PRODUCT_NOT_FOUND` | 404 | D1 classification — **already exists**, reused |

409 for the first two follows the house reasoning used by `emailAlreadyInUse()`,
`supplierInactive()` and `lastActiveEncargado()`: the request is valid, the current state of the
collection conflicts, and the remedy changes that state. `PRODUCT_INACTIVE` is the deliberate
sibling of the shipped `SUPPLIER_INACTIVE`. 400 for the third because a conditionally-required
field is a request-validity problem, not a state conflict — `invalidCurrentPassword()` is the 400
precedent.

`insufficientStock` carries `details: { available }` — camelCase and ENGLISH, because the error
envelope is the English family; `accountLocked(retryAfter)`
(`lib/errors.ts:85-89`) being the precedent for a code-specific details payload. That is the
mechanism by which ADR-0006's "Stock insuficiente: hay N" reaches the screen: `ApiError.details`
already exists client-side (`apps/web/src/api/errors.ts:12-13`), so
`features/movimientos/errorMessages.ts` narrows it and interpolates. Both roles see it — it is an
ordinary error response, with no role branch anywhere on the path. **[RECONCILE-1]**: all three
wire codes are mine to propose and the spec's to ratify; the project's own history says settle
them at spec time.

### D7 — Service shape: positive magnitudes on the wire, signs computed in the service

One exported entry point, three thin wrappers, mirroring `crearProducto`'s ordering rules exactly.

| Route | Body | `delta` | `tipo` | `esMerma` | `esDiscrepancia` |
|---|---|---|---|---|---|
| entrada | `{ cantidad ≥ 1, motivo? }` | `+cantidad` | `entrada` | `false` | `false` |
| salida | `{ cantidad ≥ 1, esMerma, motivo? }` | `-cantidad` | `salida` | body | `false` |
| ajuste | `{ cantidad ≥ 1, direccion, esDiscrepancia, motivo? }` | `±cantidad` | `ajuste` | `false` | body |

`cantidad` on the wire is always a **positive magnitude**; the sign is a ledger encoding the
service owns, exactly as `crearProducto` turns `stockInicial` into a positive delta. The
`movimientos_signo_tipo` CHECK then verifies the service's arithmetic rather than the client's.
`ajuste` carries a separate `direccion: 'sumar' | 'restar'` because its sign is genuinely
bidirectional and `movimientos_signo_tipo` leaves it free — and because a magnitude of ≥ 1 makes
PD-4's zero **unrepresentable on the wire**, not merely rejected. The `cantidad` written to
`movimientos` is the signed delta, so `Σ(cantidad) = stock_actual` continues to hold.

Ordering, load-bearing, all before `uow.run`: (1) `requireActor`; (2) role gate — already spent by
`config.roles`, so nothing here; (3) the D8 motivo guard; (4) exactly one `uow.run`, whose body is
D2's tail. `stockResultante` is `aplicarDelta`'s return value, never recomputed. **No `recordAudit`
call exists anywhere in this service** — ADR-0012 rule 2, and `AuditableEntidad` has exactly three
keys, which is the compile gate that proves it.

**Rejected:** an absolute `stockContado` for `ajuste`, with the service computing
`delta = contado - stock_actual`. It needs a read-then-write, which is precisely the shape #5's D1
exists to prevent, or a second stock primitive that writes `stock_actual` outside `aplicarDelta` —
breaking "the only seam through which stock_actual ever changes"
(`productos/repository.ts:29-32`).

### D8 — The conditional motivo rule lives in the service, in one place

`motivo` is `z.string().trim().min(MOTIVO_MIN_LENGTH).max(500).optional()` on **all three** route
bodies — the route owns the *format*. Whether it is *required* is a single service guard, run
before `uow.run`:

```ts
if ((tipo === 'ajuste' || esMerma) && (motivo === undefined || motivo.length === 0)) {
  throw movementReasonRequired();
}
```

Keeping it in the service — rather than making `motivo` structurally required on the `ajuste`
body's Zod schema — puts PD-2's whole rule at one testable point. Split across a Zod shape and a
service branch it would produce two different codes (`VALIDATION_ERROR` for ajuste,
`MOVEMENT_REASON_REQUIRED` for merma) for one product rule. The `max(500)` bound is new: `motivo`
is unbounded `text`, and an unbounded free-text field reaching both a database column and a table
cell wants a ceiling.

`MOTIVO_MIN_LENGTH = 3`, trimmed. **[RECONCILE-2] — RESOLVED by the orchestrator: 3, not the 5
this design originally proposed.** 5 was justified by accepting `"merma"` and `"rotura"`, but it
also rejects **`"robo"`** — four characters, and one of the most ordinary merma reasons a shop
will ever type. A floor that refuses a legitimate reason is worse than one that admits a lazy
one. 3 still rejects `""`, `"x"`, `"ok"` and whitespace.

### D9 — The 3-step modal: steps 2 and 3, invented from tokens

`docs/design.md:82-83` gives radius 18, a header with a divider and a circular grey ✕, numbered
uppercase step labels, and a 12px muted centred audit note at the foot. Only step 1's label is
written down and the referenced wireframes are confirmed absent (`design.md:111-121`). The rest is
derived from what the request actually needs, the way the login screens were.

| Step | Label | Contents |
|---|---|---|
| 1 | `1 · TIPO DE MOVIMIENTO` | Four radio cards: **Entrada**, **Salida**, **Salida por merma**, **Ajuste**. `Ajuste` renders disabled with the 🔒 affordance for `deposito`. Continue disabled until one is chosen. |
| 2 | `2 · CANTIDAD` | Variant by choice. Entrada: "Cantidad a ingresar". Salida / merma: "Cantidad a retirar", with `Stock disponible: N` as a hint. Ajuste: a `Sumar / Restar` segmented control, "Unidades", and the `Marcar como discrepancia de inventario` checkbox (`TECH-DESIGNv2.md:137-140`). All variants show a live `Stock resultante: N` derived from the loaded product. |
| 3 | `3 · MOTIVO` | A `motivo` textarea, labelled `Motivo` when required and `Motivo (opcional)` when not; a read-only summary line (`Salida por merma · 3 unidades · stock resultante 9`); the primary `Registrar movimiento` button. |

The audit note sits at the foot of every step, 12px muted centred:
*"Este movimiento queda registrado con su usuario y la fecha. No puede editarse ni eliminarse."*
It is a statement of fact about the ledger, and it is the reason there is no delete affordance
anywhere in this feature.

**Mechanics.** One `useForm` for the whole modal, not one per step — react-hook-form + `zodResolver`,
matching `ProductoForm.tsx:50-57`. Step advancement is gated by
`await trigger(['cantidad'])` / `trigger(['motivo'])`; `trigger` returning `false` both blocks the
step and marks the field, which is the mechanism behind "the form refuses before submit". The
schema follows `productoFormSchema`'s precedent exactly — raw strings off the inputs, parsed once
at submit, one flat object with a `superRefine` for the cross-field rule:

```ts
const movimientoFormSchema = z
  .object({
    eleccion: z.enum(['entrada', 'salida', 'merma', 'ajuste']),
    cantidad: z.string().trim().regex(/^\d+$/, 'Ingrese una cantidad válida.')
      .refine((v) => Number(v) >= 1, 'La cantidad debe ser al menos 1.'),
    direccion: z.enum(['sumar', 'restar']),
    esDiscrepancia: z.boolean(),
    motivo: z.string().trim(),
  })
  .superRefine((v, ctx) => {
    if ((v.eleccion === 'ajuste' || v.eleccion === 'merma') && v.motivo.length < MOTIVO_MIN_LENGTH) {
      ctx.addIssue({ code: 'custom', path: ['motivo'], message: 'Ingrese un motivo (mínimo 5 caracteres).' });
    }
  });
```

- **PD-4 before submit** is `cantidad ≥ 1` on a magnitude field. Zero is not a value the form can
  hold for an ajuste, because direction and magnitude are separate controls. The CHECK is the
  backstop it is supposed to be, never the mechanism.
- **PD-2 before submit** is the `superRefine` above, keyed on the same `eleccion` the server keys
  its guard on. Both sides enforce it; the server is the boundary.
- The client-side max on a salida (`cantidad ≤ stockActual`) is an **affordance only** — the stock
  it compares against is a snapshot, so the server's `INSUFFICIENT_STOCK` remains authoritative and
  its `details.available` is what the message renders.

Built on the existing `Modal` (`components/ui/Modal.tsx`) with `closePolicy="casual"` — nothing
here is a one-time secret, so Escape and overlay dismissal are correct. Its focus trap, focus
restore and `aria-modal` come for free. The step header/divider/✕ and the numbered labels are new
CSS-module work in `features/movimientos/`, not new primitives.

### D10 — The trigger lives on the product detail route

`MovimientoModal` is opened from a `Registrar movimiento` primary button on
`apps/web/src/routes/productosDetalle.tsx`, next to the existing deactivate/reactivate controls.

**Why not a `ProductosTable` row action.** The table has no action column today, so a row action
means designing one; `docs/design.md:66` documents an outline row-action button ("Reponer") that
has never been implemented, so there is no pattern to copy either. More importantly the modal needs
`stockActual` and `stockMinimo` for its live preview and its disabled state, and the detail route
already holds the full product through `useProducto(id)` — the table row would have to pass a
partial. The detail route is also where every other product write already lives, which keeps the
role affordances in one place. A row action remains a natural later addition once the table gains
an action column (#12 or the dashboard work).

The button is hidden — not disabled — when `producto.activo === false`: an inactive product admits
no new movements (ADR-0005), so offering the control at all would be a promise the server refuses.
The history list renders on the same route, below the form, paginated with the existing
`Pagination` component.

## Data Flow

    POST /api/productos/:id/movimientos/salida   { cantidad: 5, esMerma: true, motivo: "rotura" }
      │
      ├─ preHandler  config.roles ['encargado','deposito']  ─── 403 FORBIDDEN
      │              (the ajuste route's ['encargado'] is where PD-1 is enforced)
      ├─ requireActor(request.user) → { id, rol }
      ├─ D8 guard: (ajuste || esMerma) && !motivo  → 400 MOVEMENT_REASON_REQUIRED
      │
      └─ uow.run(txRepos =>                       ── ONE TRANSACTION ──
            stock = productos.aplicarDelta(id, -5)          ← #5's D1, unchanged
            if stock === undefined:                          ← D1 classification, abort path only
                 productos.findById(id) → 404 PRODUCT_NOT_FOUND
                                        │ 409 PRODUCT_INACTIVE
                                        └ 409 INSUFFICIENT_STOCK { available }
            movimiento = movimientos.create({ tipo:'salida', cantidad:-5,
                            esMerma:true, esDiscrepancia:false, motivo:"rotura",
                            usuarioId: actor.id, stockResultante: stock })
            producto   = productos.findById(id)
            ── SEAM: #10's SAVEPOINT alertas goes exactly here ──
            return { movimiento, producto }
         )                                        ── both, or neither ──
      │
      └─ route maps to DTO (no reads, no logic)   201 { movimiento, producto }

## File Changes

| File | Action | Note |
|---|---|---|
| `apps/api/src/db/schema.ts` | Modify | `esMerma` column + two CHECKs (D3) |
| `apps/api/drizzle/0005_*.sql` + `meta/` | Create | generated, never hand-written |
| `apps/api/src/lib/errors.ts` | Modify | three factories (D6) |
| `apps/api/src/movimientos/repository.ts` | Modify | `esMerma` on both types, `listByProducto` (D4) |
| `apps/api/src/movimientos/service.ts` | **Create** | D1, D2, D7, D8 |
| `apps/api/src/routes/movimientos.ts` | **Create** | four routes (D5) |
| `apps/api/src/app.ts` | Modify | register the plugin with `{ prefix: '/api' }` |
| `apps/api/src/productos/service.ts` | Modify | `esMerma: false` at `:110-118` (D3's forcing function) |
| `apps/web/src/api/schema.d.ts` | Regenerate | `pnpm contract` — same slice as the routes |
| `apps/web/src/features/movimientos/*` | **Create** | `queries.ts`, `useMovimientos.ts`, `useRegistrarMovimiento.ts`, `schemas.ts`, `errorMessages.ts`, `MovimientoModal.tsx` (+ CSS module), `MovimientosTable.tsx` |
| `apps/web/src/routes/productosDetalle.tsx` | Modify | trigger + history list (D10) |
| `apps/api/src/plugins/repos.ts` | **No change** | already wires `movimientos` into every transaction |
| `apps/api/src/auditoria/*` | **No change** | ADR-0012 rule 2 — must stay untouched |
| `docs/BACKLOG.md:41` | Modify | on archive, per project convention |

## Interfaces / Contracts

```ts
// apps/api/src/movimientos/repository.ts
export interface NuevoMovimiento {
  productoId: string; tipo: Movimiento['tipo']; cantidad: number;
  motivo?: string | null; esDiscrepancia: boolean;
  esMerma: boolean;                       // required, mirroring esDiscrepancia (D3)
  usuarioId: string; ventaId?: string | null; stockResultante: number;
}

export interface MovimientosRepo {
  create(input: NuevoMovimiento): Promise<Movimiento>;
  listByProducto(productoId: string, page: number, pageSize: number):
    Promise<{ rows: Movimiento[]; total: number }>;
}

// apps/api/src/movimientos/service.ts
export type TipoOperacion = 'entrada' | 'salida' | 'ajuste';
export interface RegistrarMovimientoInput {
  productoId: string;
  operacion: TipoOperacion;
  cantidad: number;                        // positive magnitude, always (D7)
  direccion?: 'sumar' | 'restar';          // ajuste only
  esMerma: boolean;                        // salida only; false elsewhere
  esDiscrepancia: boolean;                 // ajuste only; false elsewhere
  motivo?: string;
  actor: { id: string; rol: 'encargado' | 'deposito' };
}
export function registrarMovimiento(
  uow: UnitOfWork, input: RegistrarMovimientoInput,
): Promise<{ movimiento: Movimiento; producto: Producto }>;
```

The service takes `uow` only — no `ReadRepos`. Unlike `crearProducto`, every guard it runs before
`uow.run` is a payload/role check that touches no database, so there is nothing to read outside the
transaction (D1's rationale).

**[RECONCILE-3]**: the wire field name for the merma flag. The proposal assigns it to `sdd-spec`.
This design uses `esMerma` throughout on the assumption of camelCase wire fields matching the
column name, exactly as `esDiscrepancia` does; if the spec names it otherwise, only the route DTO
and the form's `toRegistrarMovimientoInput` change — the column, the CHECK and the service are
unaffected.

## Testing Strategy

Strict TDD, RED before GREEN in every slice, including the schema slice — a CHECK that was never
seen to reject anything is not a tested CHECK.

| Layer | What | How |
|---|---|---|
| DB integration | `es_merma = true` refused on entrada/ajuste/venta/anulacion and accepted on salida; `ajuste` with `cantidad = 0` refused (23514); `db:generate` twice emits no second migration | `schema.integration.test.ts`, raw inserts |
| Repo integration | `listByProducto` filters **and** counts by product; ordering is newest-first; `create` persists `esMerma` | `movimientos/repository.integration.test.ts` |
| Service unit | classification precedence — missing → 404, inactive → 409 `PRODUCT_INACTIVE`, otherwise → 409 `INSUFFICIENT_STOCK` carrying the read stock; motivo guard fires for ajuste and for merma-salida, and **does not** fire for an ordinary salida or entrada; `stockResultante` equals `aplicarDelta`'s return; sign derivation per operation | fakes, mirroring `productos/service.test.ts` |
| Service unit (negative) | **no `recordAudit` call on any path** — assert the auditoria fake records zero calls | fakes |
| Route unit | the role matrix, and specifically that a `deposito` session gets `FORBIDDEN` on `…/ajuste`; `.strict()` bodies; positive-magnitude coercion | `app.inject` with injected fakes |
| API integration | atomicity: force `movimientos.create` to throw and assert `stock_actual` is unchanged, using a **real** `createUnitOfWork(db)` with one repo replaced (`proveedores.integration.test.ts:526-543`'s technique); a 403 on `…/ajuste` writes **no** row; `INSUFFICIENT_STOCK` reports the real stock; `Σ(cantidad) = stock_actual` after a mixed sequence | Docker `inventienda-postgres-1` |
| Web route | the modal opens from the detail route, walks all three steps, refuses a zero/empty quantity and a missing motivo on ajuste and merma, submits the right body per choice, renders `hay N` from `details.available`, and hides the trigger for an inactive product. **`await router.load()` before every render.** | full `routeTree` + `createMemoryHistory` |

The 403-writes-nothing test is not ceremony: the project's own notes record that "a 403 that still
writes is the failure mode a status-only assertion misses", and PD-1 is the first RBAC rule in this
codebase that gates a *stock write*.

## Threat Matrix

`N/A` for every row of `references/threat-matrix.md`. Routing here is in-application HTTP and SPA
routing only; no shell command, subprocess, VCS/PR automation, executable-file classification, or
process-integration boundary is introduced or modified. The authorization surface that is
introduced (PD-1's encargado-only `ajuste`) is covered as ordinary RBAC testing above, with the
server-side proof `TECH-DESIGNv2.md:238` requires.

## Migration / Rollout

One additive Drizzle migration (`0005_*`), generated not hand-written, gated by the double
`pnpm db:generate` check. No Postgres extension, no new environment variable. Rollback is a revert
of the commits plus `ALTER TABLE movimientos DROP CONSTRAINT …` twice and `DROP COLUMN es_merma` —
each object is independently droppable, which is why D3 keeps the two rules as two constraints.
The one manual production step is `pnpm db:migrate` against Neon, run before or immediately after
the deploy, with the D3 pre-flight query run first.

## Deliberately left for a later cycle

- **The alert evaluator itself (#10).** D2 leaves the insertion point and nothing else. No
  `EvaluadorDeAlertas` interface, no `SAVEPOINT` plumbing, no `UnitOfWork` widening.
- **`venta` and `anulacion` (#7, #9),** including ADR-0005's `activo = true` exemption for
  `anulacion`. `aplicarDelta` still applies the guard unconditionally; #9 owns the exemption.
- **Cross-product movement listing (#12),** which D4's required `productoId` argument and D5's
  nested path both make a deliberate future addition rather than an accident.
- **Grouping discrepancies by cause,** foreclosed by PD-3 and inherited knowingly.
- **A row-action trigger in `ProductosTable`** (D10) and the unimplemented "Reponer" outline
  button `docs/design.md:66` describes.
- **A `pg_trgm` index or any query tuning on the history read.** The composite index from #5
  serves it; revisit above ~200 ms.
- **Editing or deleting a movement.** Never — the ledger is append-only, which is what the modal's
  audit note tells the user.

## Open Questions

Spec-reconciliation items. **All four were resolved by the orchestrator on 2026-08-30**, after
both phases landed, by reading the cited sources rather than by preferring one agent's word.
`sdd-tasks` and `sdd-apply` implement the RESOLUTION line, not the original design position.

- [x] **[RECONCILE-1] — RESOLVED. Codes and statuses stand; the `details` key is `available`,
      not `disponible`.**
      The three wire codes and their statuses (409/409/400) are ratified as designed; they follow
      the shipped `SUPPLIER_INACTIVE` / `INVALID_CURRENT_PASSWORD` precedents.
      Where spec and design disagreed on the reason code, the DESIGN's `MOVEMENT_REASON_REQUIRED`
      wins over the spec's bare `REASON_REQUIRED`. The spec's own sibling codes are already
      context-prefixed (`ADJUSTMENT_RESERVED_FOR_ENCARGADO`, `ADJUSTMENT_QUANTITY_ZERO`), and
      backlog #9 will need its own anulación reason — two unrelated rules sharing one
      `REASON_REQUIRED` would be a collision waiting to happen.
      The payload key changes. The error envelope belongs to the ENGLISH family, and the only
      `details` key that exists in the codebase today — `retryAfter` on `ACCOUNT_LOCKED`
      (`apps/api/src/lib/errors.ts:85-89`) — is English camelCase. The design cited that exact
      precedent and then wrote Spanish. Spanish camelCase is for DOMAIN wire fields
      (`stockActual`, `stockMinimo`, `esDiscrepancia`), not for the error envelope.
      This matters more than a naming quibble: `AppError.details` is typed `z.unknown()`
      (`errors.ts:7`), so the shape never reaches `openapi.json` and `pnpm contract:check`
      cannot catch a drift. The convention is the only guard there is.
      → `insufficientStock(available: number)`, `details: { available }`.

- [x] **[RECONCILE-2] — RESOLVED. `MOTIVO_MIN_LENGTH = 3`, not 5. The `max(500)` ceiling stands.**
      The design justified 5 by saying it accepts `"merma"` and `"rotura"`. It also rejects
      **`"robo"`** — four characters, and one of the most ordinary merma reasons a shop will ever
      type. A validation floor that refuses a legitimate reason is worse than one that admits a
      lazy one.
      The spec's floor ("non-empty, non-whitespace") is safe but under-implements PD-3, which the
      owner chose as *free text **with a minimum length***. 3 satisfies PD-3, accepts `"robo"`,
      and still rejects `""`, `"x"`, `"ok"` and whitespace.
      The design's `max(500)` ceiling is kept and credited: `motivo` is unbounded `text`, and an
      unbounded free-text field that reaches both a column and a table cell wants a bound.

- [x] **[RECONCILE-3] — RESOLVED. `esMerma`.**
      Decided by `sdd-spec`, as the proposal assigned. It matches the project's Spanish-domain
      camelCase family (`stockActual`, `stockMinimo`, `esDiscrepancia`) — which is the correct
      family here, because unlike RECONCILE-1 this IS a domain wire field, not an error payload.

- [x] **[RECONCILE-4] — RESOLVED. It ships, and it was never a new product position.**
      The design flagged this as the one place it "took a product position it could not avoid".
      It did not. `docs/TECH-DESIGNv2.md:137-140` already ratifies it verbatim: *"al registrar un
      ajuste, **el usuario indica** si es una diferencia de inventario (conteo físico ≠ sistema) o
      una corrección operativa normal."* A9 is settled doctrine, not an open fork. The checkbox on
      step 2 ships as designed.

**Decisions I am least confident about**, stated rather than papered over:

1. **D1's choice of the two-statement classification over the CTE.** The CTE is more correct and I
   rejected it on blast radius in a budget-constrained cycle. If the reviewer values the
   pre-image guarantee over the smaller diff, that is a defensible reversal and the exact SQL is
   in D1.
2. **D7's signed-delta contract for `ajuste`.** It is the honest wire shape, but it moves one
   subtraction onto the encargado during a physical count. The `Stock resultante: N` preview is
   the mitigation; if the operator feedback says otherwise, the fix is UI-only (compute the delta
   from a counted quantity in the form) and carries a staleness cost the design deliberately
   refused.
3. **D5's split ownership of the `/productos/*` prefix** across two route plugins. Legal and, I
   think, correct — but it is the only place in the project where two plugins share a prefix
   segment, and a reviewer may prefer the history route to live in `routes/productos.ts`.
