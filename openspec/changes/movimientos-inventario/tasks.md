# Tasks: Movimientos de Inventario (backlog #6)

Size note: like `design.md`, this document deliberately exceeds the generic word budget, on the same
rigor precedent as `archive/2026-08-30-productos-ledger-base/tasks.md`.

## RECONCILE resolutions — implement these, not the original design/spec positions

Resolved by the orchestrator 2026-08-30, all four `[x] RESOLVED` in `design.md`'s Open Questions:

1. `insufficientStock(available: number)` — `details: { available }`, ENGLISH key, not `disponible`.
2. `MOTIVO_MIN_LENGTH = 3`, trimmed, `max(500)`.
3. Wire field `esMerma` (matches `esDiscrepancia`'s Spanish-domain camelCase family).
4. `es_discrepancia` checkbox on the ajuste step ships (already ratified by `TECH-DESIGNv2.md:137-140`).
5. Reason code is `MOVEMENT_REASON_REQUIRED`, not bare `REASON_REQUIRED`.

## Confirmed current state (read from disk before writing this document)

- `productNotFound()` already exists in `apps/api/src/lib/errors.ts:189-191` — reuse, do not recreate.
- `Repos` (`apps/api/src/plugins/repos.ts:28-35`) already carries `productos`/`movimientos` bound
  through `buildRepos` — no widening task needed here, unlike #5.
- `MovimientosRepo` (`apps/api/src/movimientos/repository.ts:32-34`) has exactly one method,
  `create`. `NuevoMovimiento.esMerma` does not exist yet.
- `crearProducto` (`apps/api/src/productos/service.ts:67-134`) calls `txRepos.movimientos.create`
  at `:110-118` without `esMerma` — this call site will not compile once `esMerma` becomes required.
- `AuditableEntidad = keyof typeof FIELD_CLASSIFICATION` (`apps/api/src/auditoria/service.ts:10`,
  keys confirmed: `usuarios`, `proveedores`, `productos`) has exactly three keys. **No task below
  adds a fourth.**

## Hard constraints, restated as gates every phase must respect

- No `recordAudit` call anywhere in `movimientos/service.ts` — proven by a fake-repo test asserting
  the auditoria fake records zero calls (S3), and independently by a real-Postgres row-count test
  (S5).
- Exactly one `uow.run` per `registrarMovimiento` call, mirroring `crearProducto`'s shape. No
  `try`/`catch` inside it (ADR-0008). `stockResultante` is `aplicarDelta`'s return value, verbatim.
- `aplicarDelta` (`productos/repository.ts:205-218`) is not touched by any task below.
- Domain errors (`movementReasonRequired`, `insufficientStock`, `productInactive`) are thrown before
  `MovimientosRepo.create`, never derived from a caught CHECK violation.

---

## Phase S1 — Schema, Error Factories, Neon Pre-Flight (foundation)

No spec requirement independently satisfied yet — the CHECKs are proven at the database, unreachable
by any endpoint until S3/S4. Depends on nothing beyond #5's shipped schema.

**Forecast: ~130 prod / ~260 test ≈ 390 raw diff. Under budget.**

- [x] 1.1 RED `apps/api/src/db/schema.integration.test.ts` (extend, Docker PG) — direct insert
      `es_merma = true` with `tipo = 'entrada'`/`'ajuste'` → CHECK `movimientos_merma_solo_salida`
      rejects; `es_merma = true` with `tipo = 'salida'` → accepted; `tipo = 'ajuste'`,
      `cantidad = 0` → CHECK `movimientos_ajuste_cantidad_no_cero` rejects (23514); `tipo = 'ajuste'`,
      `cantidad <> 0` → accepted; `pnpm db:generate` run twice emits no second migration file.
- [x] 1.2 GREEN `apps/api/src/db/schema.ts` (modify, `movimientos` table) — add
      `esMerma: boolean('es_merma').notNull().default(false)` beside `esDiscrepancia`; add
      `check('movimientos_merma_solo_salida', ...)` and `check('movimientos_ajuste_cantidad_no_cero',
      ...)` exactly as `design.md` D3 specifies.
- [x] 1.3 GREEN generate the migration: `pnpm db:generate` → `apps/api/drizzle/0005_*.sql` +
      `meta/0005_snapshot.json`. Confirm the emitted SQL matches D3's three statements
      (`ADD COLUMN`, two `ADD CONSTRAINT`).
- [x] 1.4 **Mandatory pre-flight, own step, not a footnote**: before applying anywhere, run
      `SELECT count(*) FROM movimientos WHERE tipo = 'ajuste' AND cantidad = 0;` against the target
      database. Must return `0` or the migration is expected to abort (Postgres 23514).
- [x] 1.5 GREEN apply the migration to local Docker Postgres: `pnpm db:migrate`; re-run 1.1 → green.
- [x] 1.6 Verify round-trip: `pnpm db:generate` a second time emits no new migration file.
- [x] 1.7 RED `apps/api/src/lib/errors.test.ts` (extend) — against factories that do not exist:
      `insufficientStock(5)` → 409 `INSUFFICIENT_STOCK`, `details: { available: 5 }` (English key,
      per RECONCILE-1); `productInactive()` → 409 `PRODUCT_INACTIVE`; `movementReasonRequired()` →
      400 `MOVEMENT_REASON_REQUIRED` (per RECONCILE-5, not bare `REASON_REQUIRED`); all three map
      through `toErrorEnvelope`.
- [x] 1.8 GREEN `apps/api/src/lib/errors.ts` (extend) — add the three factories from 1.7, matching
      the shape of `supplierInactive()`/`accountLocked()` (the `details` precedent) exactly.
- [x] 1.9 Verify S1: `pnpm --filter api test`, `pnpm --filter api test:integration`, `pnpm typecheck`,
      `pnpm lint`, `pnpm contract:check` (byte-identical — no route touched).

## Phase S1c — Neon Deploy Gate (owner action, not code)

Timed immediately before the PR carrying S1 merges, per the same convention #5's tasks.md used.
**Deployment reality**: migrations are applied manually from a PowerShell session; `DATABASE_URL` is
not persisted on that machine and must be set per session.

**COMPLETED 2026-08-30.** Evidence recorded per task below. `main` is at `64c5123`.

- [x] 1.10 Confirm the migration is additive-with-risk in the PR description: new column + two new
      CHECKs on an existing table, no `NOT NULL` retrofit without a default. Flag explicitly that,
      unlike #5's migration, `movimientos_ajuste_cantidad_no_cero` **can fail** against existing data
      (D3) — this is the one migration in this project's history so far that is not risk-free additive.
      → PR #90's body carries the "MIGRATION — do not merge before applying it to Neon" section.
- [x] 1.11 Owner sets `DATABASE_URL` for the session (never pasted into chat/issue/log/this doc), runs
      the 1.4 pre-flight query against Neon directly, confirms `0`, then runs `pnpm db:migrate`.
      → Pre-flight returned `0` in the Neon SQL Editor (branch `production`, database `neondb`).
      `pnpm db:migrate` reported `[✓] migrations applied successfully!`. The `pg-connection-string`
      SSL notice in that output is a deprecation warning about future `sslmode` semantics, not an
      error.
- [x] 1.12 If the pre-flight is nonzero: STOP. Do not run the migration. Escalate to the owner as a
      product decision (what to do with the offending rows), never silently fixed by the migration.
      → Not triggered: the pre-flight returned `0`, so this branch never applied.
- [x] 1.13 Confirm in the Neon console `movimientos` now has `es_merma` and both new constraints.
      → Five rows returned as expected: `COLUMNA es_merma`, `movimientos_ajuste_cantidad_no_cero`,
      `movimientos_discrepancia_solo_ajuste`, `movimientos_merma_solo_salida`,
      `movimientos_signo_tipo`.
- [x] 1.14 Confirm the currently-deployed (old) API is still healthy: `curl -sS
      https://dmc-proyecto.vercel.app/api/health` → `{"status":"ok",...,"db":"up"}`.
      → `{"status":"ok","uptime":182.03,"db":"up"}`, HTTP 200. This is the proof the migration is
      backward compatible: `es_merma` carries `DEFAULT false`, so the code deployed at the time kept
      inserting without knowing the column existed.
- [x] 1.15 Only then merge the PR carrying S1.
      → PR #90 merged (CI `CLEAN`, both `test` checks green). Merged `main` re-verified: api unit
      293/293, api integration 125/125 on real Docker Postgres, web 194/194, `typecheck` / `lint` /
      `contract:check` all exit 0, deployed API `{"status":"ok","db":"up"}`.

## Phase S2 — `MovimientosRepo` Extension + Forced Ripple

Satisfies spec (partially): **Merma Salida Is Persisted Distinctly** (repo half). Depends on S1
(schema). This is the phase that pays D3's deliberate forcing-function cost.

**Forecast: ~90 prod / ~190 test ≈ 280 raw diff. Under budget.**

- [x] 2.1 RED `apps/api/src/movimientos/repository.integration.test.ts` (extend) — `create` persists
      `esMerma` verbatim; `listByProducto(productoId, page, pageSize)` filters **and** counts by
      product (assert `total` directly, not `rows.length` — the D7 trap from #5); ordering is
      `desc(fecha), desc(id)`, newest first; a second product's rows never leak into the first's page.
- [x] 2.2 GREEN `apps/api/src/movimientos/repository.ts` (modify) — `Movimiento.esMerma: boolean`;
      `NuevoMovimiento.esMerma: boolean` **required** (mirrors `esDiscrepancia`, per D3); `create`
      writes `esMerma`; add `listByProducto` to `MovimientosRepo` port and `DrizzleMovimientosRepo`,
      per D4's exact signature (`{ rows, total }`, same shape as `ProductosRepo.list`).
- [x] 2.3 GREEN fix the compile break at `apps/api/src/productos/service.ts:110-118`
      (`crearProducto`'s `movimientos.create` call) — add `esMerma: false`.
- [x] 2.4 GREEN fix every existing `NuevoMovimiento` fixture/fake broken by the required field: search
      `esDiscrepancia:` across `apps/api/src/**/*.test.ts` for co-located `NuevoMovimiento` literals
      (expected: `productos/service.test.ts`, `movimientos/repository.integration.test.ts`,
      `routes/productos.integration.test.ts` if any build one directly) and add `esMerma: false` to
      each. Confirm the actual break list against `pnpm typecheck` output before committing — do not
      assume the predicted list is complete (#5's task 3.5 already found the prediction incomplete
      once).
- [x] 2.5 Verify S2: `pnpm --filter api test`, `pnpm --filter api test:integration`, `pnpm typecheck`,
      `pnpm lint`.

## Phase S3 — `movimientos/service.ts` (the core logic: D1, D2, D7, D8)

Satisfies spec: **Role Gate** (encargado-registers-ajuste half only — deposito-refused half is S4's
route config), **Motivo Mandatory Only On Ajuste And Merma Salidas**, **Motivo Is Free Text**,
**Zero-Quantity Ajuste Is Not Representable** (service half), **A Movement Against An Inactive
Product Is Refused**, **Salida Below Zero Names Available Quantity**, **Stock And Ledger Write
Atomicity**, **No Audit Row Is Ever Written**. Depends on S2 (`listByProducto`/`esMerma` unused here
but the port must compile) and S1 (error factories).

**Forecast: ~150 prod / ~260 test ≈ 410 raw diff. Marginally over — this is the densest single
piece of logic in the change (D1's classification + D7's sign derivation + D8's guard); peeling a
sub-unit out costs more reviewer context than it saves, mirroring `productos-ledger-base`'s own S3a
call. Flag for `size:exception` if it drifts further during apply.**

- [x] 3.1 RED `apps/api/src/movimientos/service.test.ts` (new, fake repos + `{ run: (work) =>
      work(stubs) }`, mirroring `productos/service.test.ts`) — classification precedence: `aplicarDelta`
      returns `undefined`, `productos.findById` returns `undefined` → `productNotFound()` (404), never
      calls `movimientos.create`; returns `{ activo: false }` → `productInactive()` (409); returns an
      active row → `insufficientStock(row.stockActual)` (409), carrying the read stock, not a
      recomputed value.
- [x] 3.2 RED (same file, extend) — motivo guard: fires for `ajuste` with blank/undefined `motivo`;
      fires for a merma `salida` (`esMerma: true`) with blank/undefined `motivo`; does **not** fire for
      an ordinary `entrada`; does **not** fire for a non-merma `salida`; a 3-character trimmed `motivo`
      (`"robo"` is 4, also assert `"abc"` at exactly 3) is accepted; a 2-character motivo is refused.
- [x] 3.3 RED (same file, extend) — sign derivation: `entrada` produces `delta = +cantidad`; `salida`
      (ordinary or merma) produces `delta = -cantidad`; `ajuste` with `direccion: 'sumar'` produces
      `+cantidad`, `'restar'` produces `-cantidad`; `stockResultante` on the created movement equals
      `aplicarDelta`'s stub return value verbatim, never independently recomputed by the test's own
      math nor by the service.
- [x] 3.4 RED (same file, extend) — **the audit-absence proof**: a spy/fake on `auditoria.record` (or
      equivalent) records **zero calls** across every successful `entrada`/`salida`/`ajuste` path
      exercised in this file.
- [x] 3.5 RED (same file, extend) — transaction shape: exactly one `uow.run` invocation per call
      (spy-count it); `movimientos.create` is called with `esMerma`/`esDiscrepancia` set per D7's
      table (`entrada`: both `false`; `salida`: `esMerma` from input, `esDiscrepancia: false`;
      `ajuste`: `esMerma: false`, `esDiscrepancia` from input).
- [x] 3.6 GREEN `apps/api/src/movimientos/service.ts` (**new**) — `rechazarMovimiento` helper
      (`Promise<never>`, D1's exact precedence table); `TipoOperacion`, `RegistrarMovimientoInput`,
      `registrarMovimiento(uow, input)` per D7's interface (positive-magnitude `cantidad`, sign
      derived in-service); D8's motivo guard, run before `uow.run`; the D2 transaction tail
      (`aplicarDelta` → classify-on-`undefined` → `movimientos.create` with verbatim
      `stockResultante` → `productos.findById` for the response → **explicit comment marking the #10
      SAVEPOINT seam, no code after it** → `return { movimiento, producto }`). No `try`/`catch`
      anywhere inside the callback. No `recordAudit` call anywhere in this file.
- [x] 3.7 Verify S3: `pnpm --filter api test`, `pnpm typecheck`, `pnpm lint`.

## Phase S4 — Routes + App Registration + Contract

Satisfies spec at the HTTP shape: **Role Gate** (deposito-refused-on-ajuste half, plain `FORBIDDEN`
via `config.roles`), **Zero-Quantity Ajuste** (HTTP 400), **Merma Salida Persisted Distinctly** (HTTP
shape), **Movement History Is Readable Per Product, Paginated, By Both Roles**. Depends on S3.

**Forecast: ~180 prod / ~230 test ≈ 410 raw diff. Marginally over, same reasoning as S3 — four
routes plus their Zod shapes plus the role matrix is not cleanly sub-divisible without duplicating
setup. Flag for `size:exception` if it drifts further.**

- [x] 4.1 RED `apps/api/src/routes/movimientos.test.ts` (new, `app.inject` with injected fakes) —
      unauthenticated → 401 on all four routes; `deposito` → 201 on entrada/salida, **403
      `FORBIDDEN`** on ajuste (corrected 2026-08-30 from `ADJUSTMENT_RESERVED_FOR_ENCARGADO`, which
      `config.roles` never emits — see the spec's correction note), table/stock unchanged (assert
      via the fake, not just status); `encargado` → 201 on all three; `.strict()` body rejection on
      an unknown key —
      **and specifically that `esMerma` on the entrada body, and `esDiscrepancia` on the
      entrada/salida bodies, are rejected as unknown keys.** That rejection is what actually enforces
      D7's literal columns (`entrada`: both `false`; `salida`: `esDiscrepancia: false`; `ajuste`:
      `esMerma: false`): `registrarMovimiento` passes both flags through unchanged by design, so the
      route body shape is the only thing standing between a contradicting combination and a raw
      Postgres `23514` from `movimientos_merma_solo_salida` — which S3's hard constraint forbids as a
      mechanism for user-facing errors. Assert it, do not assume it;
      `cantidad` coerced/validated as a positive integer ≥ 1 (D7 — magnitude only, zero unrepresentable
      on the wire); `GET .../movimientos?page&pageSize` returns `{ data, page, pageSize, total }` with
      `tipo`, `cantidad`, `stockResultante`, `motivo`, `esMerma`, `fecha`, `usuarioId` per row.
      → **DISCREPANCY (reported, not silently resolved)**: `apps/api/src/plugins/auth.ts:92-95` throws
      a plain `forbidden()` (code `FORBIDDEN`) for every `config.roles` refusal — there is no
      per-route code override mechanism. `routes/productos.test.ts`'s existing
      deactivate/reactivate suite already proves this (asserts `'FORBIDDEN'`, not a bespoke code).
      The test asserts the ACTUAL mechanism (`403 FORBIDDEN`), not the spec's
      `ADJUSTMENT_RESERVED_FOR_ENCARGADO` — see the code comment at the RBAC test in
      `movimientos.test.ts` for the full reasoning. A second, smaller discrepancy: the spec's
      `cantidad = 0` → `400 ADJUSTMENT_QUANTITY_ZERO` scenario is likewise unreachable as written —
      D7's wire shape (`z.number().int().min(1)`) makes zero a `VALIDATION_ERROR` from Zod, before any
      handler-level code could distinguish it. Tests assert `VALIDATION_ERROR`, matching the actual
      mechanism.
- [x] 4.2 GREEN `apps/api/src/routes/movimientos.ts` (**new**) — four routes per D5's exact table
      (`GET /api/productos/:id/movimientos`, `POST .../entrada`, `POST .../salida`,
      `POST .../ajuste`), each `config: { roles: [...] }` per D5 (ajuste is `['encargado']` only —
      this is where PD-1's server-side boundary actually lives); `motivo` Zod shape
      `z.string().trim().min(3).max(500).optional()` on all three write bodies (RECONCILE-2's `3`, not
      `5`); route bodies map straight to `RegistrarMovimientoInput`, no business logic in the route.
- [x] 4.3 GREEN `apps/api/src/app.ts` (modify) — register `movimientosRoutes` with `{ prefix: '/api'
      }`, after `authPlugin`, alongside `productosRoutes` (note in both files: this is the only place
      two plugins share the `/productos/*` prefix segment, per D5).
- [x] 4.4 GREEN regenerate the contract: `pnpm contract` → `apps/api/openapi.json`,
      `apps/web/src/api/schema.d.ts` pick up all four `movimientos` paths.
- [x] 4.5 Verify S4: `pnpm --filter api test`, `pnpm typecheck`, `pnpm lint`, `pnpm contract:check`
      (now asserts real content). All green — see apply-progress for exact counts.

## Phase S5 — API Integration: Atomicity + Audit-Absence + Real-Session RBAC (mandatory, not droppable)

Satisfies spec: **Stock And Ledger Write Atomicity** (both scenarios), **No Audit Row Is Ever
Written** (real-database proof, not just the fake-spy proof from S3.4), **Role Gate** (real-session
403-writes-nothing proof — CLAUDE.md: "a 403 that still writes is the failure mode a status-only
assertion misses"). Depends on S4 (needs live routes).

**Forecast: 0 prod / ~200 test ≈ 200 raw diff. Under budget.**

- [x] 5.1 RED `apps/api/src/routes/movimientos.integration.test.ts` (new, real app + Docker PG,
      `failingUow` technique from `proveedores.integration.test.ts:526-543` — a real
      `createUnitOfWork(db)` with `movimientos` replaced by a thrower):
      1. **Ledger fails.** `movimientos.create` throws ⇒ `stock_actual` unchanged, zero new
         `movimientos` rows.
      2. **403 writes nothing.** `deposito` session against `.../ajuste` ⇒ 403, `stock_actual`
         unchanged, zero new `movimientos` rows.
      3. **INSUFFICIENT_STOCK reports the real stock**, read inside the transaction.
      4. **`Σ(cantidad) = stock_actual`** after a mixed entrada/salida/ajuste sequence against one
         seeded product.
      5. **No `auditoria` row for any movement** — `count(*) from auditoria` before and after a
         successful entrada/salida/ajuste is identical, for all three types.
      6. **Merma persists distinctly** — a merma salida's row has `es_merma = true`, an ordinary
         salida on the same product has `es_merma = false`, both readable via
         `GET .../movimientos`.
- [x] 5.2 GREEN whatever wiring gap 5.1 exposes (expected: none — S3/S4 already implement this path;
      this is the real-Postgres proof).
      → Confirmed: zero wiring gaps. All 6 proofs passed on the first run against S3/S4's existing
      production code, no production file touched.
- [x] 5.3 Mutate at least one assertion (e.g. temporarily expect `auditoria` count to increase) and
      confirm it fails for the right reason, then revert — proving the audit-absence test is not
      vacuous, per CLAUDE.md's mutation-probing rule.
      → Flipped proof 5's entrada assertion to `expect(await countRows('auditoria')).toBe(before +
      1)`. Failed with `AssertionError: expected +0 to be 1` — the real auditoria table stayed at 0
      rows, proving the assertion was exercising real Postgres state, not a tautology. Reverted;
      `git diff --exit-code` on the file exits 0 (clean).
- [x] 5.4 Verify S5: `pnpm --filter api test:integration`, `pnpm typecheck`, `pnpm lint`.
      → All exit 0. Integration: 135/135 passing (129 baseline + 6 new), 15 files. typecheck: api +
      web both "Done". lint (biome ci .): 225 files checked, no fixes applied.

## Phase S6 — Web: Feature Scaffolding (queries, hooks, schemas, error messages)

Prepares the contract-driven wiring the modal (S7) and the trigger/history (S8) both need. Depends
on S4 (`schema.d.ts` must carry the `movimientos` paths).

**Forecast: ~120 prod / ~90 test ≈ 210 raw diff. Under budget.**

- [x] 6.1 RED `apps/web/src/features/movimientos/errorMessages.test.ts` (new, mirrors
      `productos/errorMessages.test.ts`) — each of `FORBIDDEN`, `MOVEMENT_REASON_REQUIRED`,
      `VALIDATION_ERROR`, `PRODUCT_NOT_FOUND`, `PRODUCT_INACTIVE`, `INSUFFICIENT_STOCK` renders a
      distinct message; `INSUFFICIENT_STOCK`'s message interpolates `details.available` (the
      "hay N" mechanism, ADR-0006).
      **Corrected 2026-08-30**: was `ADJUSTMENT_RESERVED_FOR_ENCARGADO` and
      `ADJUSTMENT_QUANTITY_ZERO`. Neither code is ever emitted — S4 proved the ajuste refusal is a
      plain `FORBIDDEN` from `config.roles` (`plugins/auth.ts:92-95`, no per-route override) and
      that `cantidad: 0` fails Zod's `min(1)` before any handler runs, yielding `VALIDATION_ERROR`.
      Mapping the original two would have shipped dead branches while the codes users actually
      receive fell through to the generic fallback — the exact failure this correction exists to
      prevent. See both spec correction notes.
- [x] 6.2 GREEN `apps/web/src/features/movimientos/errorMessages.ts` (new) — switch on the six codes,
      narrowing `ApiError.details` (`apps/web/src/api/errors.ts:12-13`) for `INSUFFICIENT_STOCK` only.
- [x] 6.3 GREEN `apps/web/src/features/movimientos/queries.ts` (new) — key factory,
      `movimientosListQueryOptions(productoId, page)`, mirroring `features/productos/queries.ts`'s
      invalidate-never-`setQueryData` rule.
- [x] 6.4 GREEN `apps/web/src/features/movimientos/useMovimientos.ts`,
      `useRegistrarMovimiento.ts` (new) — the latter has three thin wrappers
      (`entrada`/`salida`/`ajuste`) or one mutation parameterized by `operacion`, matching whichever
      shape `routes/movimientos.ts` (S4) actually exposes.
      → Implemented as three thin wrappers (`entrada`/`salida`/`ajuste`), one per distinct request
      body shape in `routes/movimientos.ts` (D7's table). All three invalidate
      `movimientosKeys.lists()` and `productosKeys.detail(productoId)` on success.
- [x] 6.5 GREEN `apps/web/src/features/movimientos/schemas.ts` (new) — `movimientoFormSchema` per D9's
      exact shape (`eleccion`, `cantidad`, `direccion`, `esDiscrepancia`, `motivo`, `superRefine`
      keyed on `eleccion === 'ajuste' || eleccion === 'merma'` and `MOTIVO_MIN_LENGTH = 3`).
- [x] 6.6 Verify S6: `pnpm --filter web test`, `pnpm typecheck`, `pnpm lint`.
      → All exit 0. web: 212/212 passing (194 baseline + 18 new). typecheck: api + web both "Done".
      lint (biome ci .): 232 files checked, no fixes applied. `pnpm contract:check`: byte-identical
      (no route touched, no schema.d.ts drift).

## Phase S7a — Web: Modal Step 1 (choice cards, role hiding, shell wiring)

Satisfies spec (movimientos-ui): **Step 1 Offers Four Operator-Facing Choices Mapped To Three Wire
Types**, **Ajuste Option Hidden For Deposito Is UX Convenience, Not Access Control**. Depends on S6.

**Forecast: ~150 prod / ~150 test ≈ 300 raw diff. Under budget.**

- [x] 7.1 RED `apps/web/src/features/movimientos/MovimientoModal.test.tsx` (new, RTL + user-event) —
      step 1 renders exactly four choices for `encargado`, three for `deposito` (Ajuste absent or
      disabled with 🔒, per D9); selecting "Salida por merma" and completing the flow (stubbed steps
      2-3) produces `tipo: 'salida', esMerma: true` on submit; selecting "Ajuste" produces `tipo:
      'ajuste'` with no merma indicator; Continue is disabled until a choice is made.
      → 10 tests: 6 component-level (RTL + user-event) + 4 pure-function unit tests on the exported
      `toWireSubmission` mapper. Confirmed RED first — `npx vitest run
      MovimientoModal.test.tsx` failed with "Failed to resolve import ./MovimientoModal.js" before
      the production file existed.
- [x] 7.2 GREEN `apps/web/src/features/movimientos/MovimientoModal.tsx` (new) + CSS module — step 1
      only in this slice: header/divider/✕/numbered-label chrome per `docs/design.md` tokens (radius
      18, 12px muted centred audit note), four radio cards, `useForm` + `zodResolver(schemas.ts)`,
      built on `components/ui/Modal.tsx` with `closePolicy="casual"`. Steps 2-3 render a generic
      cantidad/motivo placeholder in this slice (not D9's full per-choice variant UI — that is S7b),
      just enough to drive the flow to submit and prove the step-1→wire mapping end to end. Also adds
      `position: relative` to `Modal.module.css`'s `.modal` so the new circular ✕ close button can
      anchor to it (Modal.tsx itself untouched — no second modal primitive written).
      **Deviation from task wording, documented not silently taken**: `MovimientoModal` is
      presentational — it takes `onSubmit: (submission) => void` and does not call
      `useRegistrarMovimiento` itself, matching `ProductoForm.tsx`'s "route-module boundary"
      precedent; S8 wires the real mutation call at the route.
- [x] 7.3 Verify S7a: `pnpm --filter web test`, `pnpm typecheck`, `pnpm lint`.
      → All exit 0. web: 226/226 passing (216 baseline + 10 new). typecheck: api + web both "Done".
      lint (biome ci .): 236 files checked, no fixes applied (one `biome format --write` pass was
      needed mid-session for two long-line wraps; final run is clean). `pnpm contract:check`:
      byte-identical, exit 0 (no route touched, no schema.d.ts drift).
      **Mutation-probe evidence (required and performed)**: (1) deposito role hiding — changed
      `const disabled = isAjuste && isDeposito` to `const disabled = false && isAjuste &&
      isDeposito`; the "renders Ajuste disabled..." test failed with `expected element not to be
      disabled` against the real rendered radio. Reverted. (2) merma→wire mapping — changed
      `esMerma: values.eleccion === 'merma'` to `esMerma: false` in `toWireSubmission`; both the
      component-flow test and the pure-function unit test for `merma` failed with a clear diff
      (`esMerma: true` expected, `false` received). Reverted; `git diff --exit-code` on the file
      exits 0 (clean) after each revert.

## Phase S7b — Web: Modal Steps 2-3 (validation, discrepancy checkbox, submit, error surfacing)

Satisfies spec (movimientos-ui): **Step 2 Refuses To Progress When Motivo Or Quantity Rules Are
Violated**, **Step 3 Confirms And Submits, Surfacing Server Refusals To Either Role**. Depends on
S7a (extends the same modal/form).

**Forecast: ~180 prod / ~200 test ≈ 380 raw diff. Under budget.**

- [x] 7.4 RED `MovimientoModal.test.tsx` (extend) — Ajuste with quantity `0` refused before submit, no
      request sent; merma salida with blank `motivo` refused before submit; ordinary salida with blank
      `motivo` allowed to progress; the `es_discrepancia` checkbox is present and functional on the
      ajuste step (RECONCILE-4); step 3 renders a summary line and the `Registrar movimiento` button;
      given a `serverError` message containing `"5"`, the modal renders it and does **not** close;
      a successful submit calls `onSubmit` with the wire payload.
      → 13 new tests (7 component-level RTL + 6 pure-function: `computeStockResultante` ×4,
      `buildSummaryLine` ×2) added; 2 existing S7a flow tests updated for the new per-choice field
      labels (`Cantidad a retirar`, `Unidades`).
      Confirmed RED first: 15 of 23 tests in the file failed (`computeStockResultante is not a
      function`, `buildSummaryLine is not a function`, missing labels/text) before any production
      code changed.
- [x] 7.5 GREEN `MovimientoModal.tsx` (extend) — steps 2 and 3 per D9's table (quantity field variant
      by choice with `Stock disponible`/`Stock resultante` preview; `Sumar/Restar` segmented control
      + discrepancy checkbox for ajuste; motivo textarea labelled per requirement; summary line;
      `trigger(['cantidad'])`/`trigger(['motivo'])` step gating); accept a `serverError?: string`
      prop and render it without closing the modal.
      → Implemented via two new exported pure functions (`computeStockResultante`,
      `buildSummaryLine`) plus per-`eleccion` JSX branches in steps 2/3. `trigger(['cantidad'])` (already
      present from S7a) continues to gate step 2→3 advancement — the same mechanism now also blocks a
      zero-quantity ajuste, since `cantidad` shares one registered field across all variants. The
      `motivo` gate is enforced by `handleSubmit`'s existing `zodResolver` validation at step 3's
      final submit (the schema's `superRefine` already keys on `eleccion`), which is functionally
      equivalent to an explicit `trigger(['motivo'])` call and requires no additional code — verified
      by the mutation probe below. `stockActual` added as an optional prop (default `0`) so S7a's
      existing call sites keep compiling; S8 wires the real `producto.stockActual`. `serverError`
      renders via the existing `FormError` component, placed above the form, visible regardless of
      step. All 23 tests in the file pass after implementation.
      **Mutation-probe evidence (required, two probes)**:
      (1) *Zero-quantity refusal* — changed `schemas.ts`'s `.refine((v) => Number(v) >= 1, ...)` to
      `>= 0`. Result: "Ajuste with quantity 0 is refused before submit" failed —
      `screen.getByLabelText('Unidades')` threw (`TestingLibraryElementError`, element not found)
      because the wizard had advanced past step 2 to step 3 instead of staying blocked. Reverted;
      `git diff --exit-code` on `schemas.ts` exits 0 (clean).
      (2) *Conditional motivo gate* — changed the `superRefine`'s condition from
      `v.eleccion === 'ajuste' || v.eleccion === 'merma'` to `v.eleccion === 'ajuste' ||
      v.eleccion === 'ajuste'` (silently dropping the merma branch). Result: "a merma salida with
      blank motivo is refused before submit" failed — `screen.findByText('Ingrese un motivo (mínimo
      3 caracteres).')` timed out (the error never rendered) and the assertion trace showed the
      wizard had reached the final actions with `Registrar movimiento` still clickable, i.e.
      `onSubmit` would have fired. Reverted; `git diff --exit-code` on `schemas.ts` exits 0 (clean).
      Neither probe is decorative — both proved load-bearing under mutation.

> **Ownership resolved 2026-08-30.** As originally written, 7.4 and 7.5 had the modal own
> `useRegistrarMovimiento` and map its own server errors. That contradicts this codebase: the
> precedent is **presentational**. `features/productos/ProductoForm.tsx` takes only `isPending`
> and form-level errors, while the route module `routes/productosNuevo.tsx` owns
> `useCrearProducto` and `productosErrorMessage`. S7a already followed that precedent, and
> breaking it here would leave two different ownership patterns for the same kind of form in the
> same application.
>
> So the modal takes a `serverError?: string` prop carrying an already-mapped message and stays a
> pure component. The end-to-end proof — a real `409 INSUFFICIENT_STOCK { details: { available: 5 } }`
> becoming the text a user reads, with the modal still open — moves to **S8's route test**, where
> `useRegistrarMovimiento` and `movimientosErrorMessage` actually live. Neither half is dropped:
> each lands in the slice that owns the code it exercises.
- [x] 7.6 Verify S7b: `pnpm --filter web test`, `pnpm typecheck`, `pnpm lint`.
      → All exit 0. web: 239/239 passing (226 baseline + 13 new). typecheck: api + web both "Done".
      lint (biome ci .): 236 files checked, no fixes applied (one `biome check --write` pass was
      needed mid-session to fix import ordering in the extended test file; final run is clean).
      `pnpm contract:check`: byte-identical, exit 0 (no route touched, no schema.d.ts drift).
      Authored diff: 3 files, 398 insertions / 18 deletions (416 raw lines) — under the session's
      800-line budget (forecast was ~380).

## Phase S8 — Web: Trigger + History List on `productosDetalle`

Satisfies spec (movimientos-ui): **The Modal Is Triggered From The Product Screen, Available To Both
Roles When The Product Is Active**; (inventory-movements, UI half) **Movement History Is Readable
Per Product, Paginated**. Depends on S6 (queries) and S7b (modal complete).

**Forecast: ~140 prod / ~150 test ≈ 290 raw diff. Under budget.**

- [x] 8.1 RED `apps/web/src/routes/productosDetalle.test.tsx` (extend, full `routeTree` +
      `createMemoryHistory`, `await router.load()` before render per house rule) — `Registrar
      movimiento` trigger present and enabled for an active product, both roles; absent or disabled
      for an inactive product; opening it and completing a successful flow closes the modal and the
      displayed `stock_actual` reflects the response's updated product; the history list below the
      form renders rows from `GET .../movimientos`, paginated, and a merma row is visually
      distinguishable from an ordinary salida.
      **Added 2026-08-30 — required, not optional**: after a successful registration, assert the
      history list **gains the new row without a manual reload**. `useRegistrarMovimiento`
      refreshes it by invalidating `movimientosKeys.lists()`, and TanStack Query matches
      invalidations by key PREFIX, so a `list()` key that stops nesting under `lists()` is never
      matched: every registration succeeds, the ledger is written correctly, and the table on
      screen silently keeps showing stale rows with no error anywhere. That exact mutation was run
      against S6 on 2026-08-30 and the entire web suite stayed green, `typecheck` passed, and only
      the formatter complained — about line length. `features/movimientos/queries.test.ts` now
      guards the key's shape, but shape is not behaviour: this assertion is the half that proves
      the screen actually updates. CLAUDE.md's "route-level coverage, not just hook-level" names
      this exact failure, and it has already shipped twice in this project.
      → 8 new tests (all 8 route-level + the file's existing 5 unaffected): active-product trigger
      shown/enabled for both roles; inactive-product trigger hidden; full entrada flow closes the
      modal and updates `Stock actual`; paginated history render; merma badge distinguishes a
      merma row from an ordinary salida; the owed "gains the new row without reload" assertion; the
      owed end-to-end 409 `INSUFFICIENT_STOCK` → readable-text-without-closing assertion. Confirmed
      RED first: all 7 new tests failed (missing trigger/history/modal wiring in
      `productosDetalle.tsx`) before any production code changed; the 6 pre-existing tests stayed
      green throughout.
- [x] 8.2 GREEN `apps/web/src/features/movimientos/MovimientosTable.tsx` (new) — renders `tipo`,
      `cantidad`, `stockResultante`, `motivo`, a merma badge/chip, `fecha`, `usuarioId`.
      → Presentational, built on `DataTable` + `StatusChip` (`ProductosTable.tsx` precedent) — no
      new chip component. `esMerma` renders a `StatusChip variant="warning" label="Merma"` beside
      the type label.
- [x] 8.3 GREEN `apps/web/src/routes/productosDetalle.tsx` (modify) — add the trigger button (hidden,
      not disabled, when `producto.activo === false`, per D10) and the paginated
      `MovimientosTable` below the existing form, using `useMovimientos` (S6) and the existing
      `Pagination` component.
      → Route module owns `useRegistrarMovimiento` and `movimientosErrorMessage` (matching
      `productosNuevo.tsx`'s `useCrearProducto`/`productosErrorMessage` ownership precedent, per
      the task's own header note). Added a `Stock actual: N` paragraph (previously not rendered
      anywhere on this route) so the "updated stock without reload" assertion has something visible
      to check. Movement-history pagination is local `useState`, not a route search param — no
      existing precedent makes it bookmarkable, and the task doesn't require it. All three
      `useRegistrarMovimiento` wrappers share one visible error/pending surface, since the modal is
      gated to exactly one choice per open (only one wrapper can ever be in flight).
- [x] 8.4 Verify S8: `pnpm --filter web test`, `pnpm typecheck`, `pnpm lint`.
      → All exit 0. web: 247/247 passing (239 baseline + 8 new). typecheck: api + web both "Done".
      lint (biome ci .): 237 files checked, no fixes applied (one `biome check --write` pass was
      needed mid-session for line-wrap formatting in the extended test file; final run is clean).
      `pnpm contract:check`: byte-identical, exit 0 (no route touched, no `schema.d.ts` drift).
      **Mutation-probe evidence (required, two probes, both performed)**:
      (1) *List-key prefix nesting* (the task's own named risk) — temporarily changed
      `movimientosKeys.list` in `queries.ts` from `[...movimientosKeys.lists(), productoId,
      {page}]` to `[...movimientosKeys.all, 'listX', productoId, {page}]`, breaking the prefix
      match `invalidateQueries({queryKey: movimientosKeys.lists()})` relies on. First run of the
      "gains the new row" test still PASSED under this mutation — investigated rather than
      accepted: the test's own fetch stub returned the *live* `rows` array reference in the
      `GET .../movimientos` JSON body instead of a snapshot, so a later POST's `rows.unshift(...)`
      silently mutated already-cached React Query data by reference, and an unrelated re-render
      (triggered by the `productosKeys.detail(id)` invalidation, which *does* match) picked up the
      mutated array — a decorative pass caused by a test-harness bug, not evidence the assertion
      was sound. Fixed the stub to return `data: [...rows]` (a snapshot), re-ran under the same
      mutation: the test now correctly FAILED (`tbody` empty, no new row), confirming the fetch log
      showed zero second `GET .../movimientos` calls — the invalidation genuinely did not match.
      Reverted `queries.ts`; `git diff --exit-code` on the file exits 0 (clean) — confirmed via
      `git diff --stat` showing no changes before the final GREEN run.
      (2) *Error-mapping wiring* — temporarily replaced `productosDetalle.tsx`'s
      `movimientosErrorMessage(registrarError)` call with the literal string `'PROBE_BROKEN_MAPPING'`.
      Result: "surfaces a 409 INSUFFICIENT_STOCK server error as readable text" failed —
      `screen.findByText('Stock insuficiente: hay 5 disponibles.')` timed out, proving the
      assertion exercises the real `useRegistrarMovimiento` → `movimientosErrorMessage` wiring, not
      a hardcoded string. Reverted; `git diff` confirmed clean before the final GREEN run.
      Neither probe is decorative — probe 1 caught and fixed a real test-harness defect (a false
      GREEN) before it could ship as a false proof; probe 2 confirmed the second owed assertion is
      load-bearing.

## Phase 9 — Bookkeeping

- [x] 9.1 Confirm no `.env*` file was touched or referenced by any task above, and no new environment
      variable was introduced.
- [x] 9.2 If PRs are chained/stacked, retarget each PR to `main` as its predecessor merges
      (`gh pr edit <n> --base main`) — GitHub does not auto-retarget.
- [x] 9.3 Update `docs/BACKLOG.md:41` marking backlog #6 complete, per project convention.
      → Flipped to `✅ Hecho` with the two clarifications the cycle produced: merma is a `motivo`
      on a `salida` persisted via `es_merma`, never a `tipo`; and the ajuste refusal for
      `deposito` is a plain `403 FORBIDDEN` from `config.roles`, not a dedicated code.

**Evidence for 9.1 and 9.2 (recorded 2026-08-30):**
- 9.1 → `git log --name-only 5d7d37d..431fe3b` lists no `.env*` path, and the diff of `apps/`
  introduces no new `process.env.*` read. No environment variable was added by this cycle.
- 9.2 → Not needed. Every one of the ten PRs (#90-#99) was branched from a freshly-merged `main`
  and targeted `main` directly, so no PR ever had another PR's branch as its base. That also means
  the `--delete-branch` hazard that closed PR #59 in backlog #5 was never armed here.
- [x] 9.4 Confirm the claims-gate report
      (`openspec/changes/movimientos-inventario/claims-report.md`) is produced before this cycle
      reaches verify/archive, per `CLAUDE.md`'s claims gate section.
      → Produced 2026-08-30 against `7d0dedb`. 36 claims extracted verbatim from this file's 55
      ticked boxes, the PR #90-#100 bodies, `CLAUDE.md` and `docs/TECH-DESIGNv2.md`, then handed
      cold to a verifier that received the statements and nothing else — no report, no rationale,
      no indication of which were expected to hold. Seven were settled by mutation; all seven
      observed failure counts matched the claimed ones exactly. Working tree clean afterwards.
      **Three claims came back REFUTED**, each re-verified independently before being written
      down: (1) `AuditableEntidad` is at `auditoria/service.ts:10`, not `:8` — the stale citation
      sat in this file AND in `CLAUDE.md:95`, where it is load-bearing; (2) the cycle's own
      RECONCILE-2 (`max(500)`) reached the API but never the web form schema, so a 501-character
      motivo passed the browser, was submitted, and came back as a bare `VALIDATION_ERROR` naming
      no limit — every gate was green over that gap; (3) PR #99's body miscounted S8's new tests
      (7 vs the actual 8) and contradicted its own total. All three corrected; the `max(500)` gap
      was closed as its own TDD slice (RED → GREEN → off-by-one mutation failing exactly 2 tests
      → revert). Web suite 247 → 250.

## Requirement Coverage Map

| Requirement | Slice(s) |
|---|---|
| Role Gate — Entrada/Salida Both Roles, Ajuste Encargado-Only | S3 (partial) + S4 (route config) + S5 (real-session 403-writes-nothing) |
| Motivo Mandatory Only On Ajuste And Merma Salidas | S3 (guard) + S4 (Zod format) |
| Motivo Is Free Text With No Closed Reason List | S3 |
| Zero-Quantity Ajuste Is Not Representable | S1 (CHECK) + S4 (wire — magnitude ≥ 1) + S7b (form) |
| Merma Salida Is Persisted Distinctly | S1 (CHECK) + S2 (repo) + S3 (service) + S5 (real-DB proof) |
| Movement Against Inactive Product Refused | S3 (D1 classification) + S5 (real-DB) |
| Salida Below Zero Names Available Quantity | S1 (factory) + S3 (D1) + S5 (real stock) + S6/S7b (UI surfacing) |
| Stock And Ledger Write Atomicity | S3 (D2 shape) + S5 (forced-failure proof) |
| No Audit Row Is Ever Written | S3 (fake-spy proof) + S5 (real-DB row-count proof) |
| Movement History Readable, Paginated, Both Roles | S2 (`listByProducto`) + S4 (route) + S8 (UI) |
| **movimientos-ui**: Step 1 Four Choices → Three Wire Types | S7a |
| **movimientos-ui**: Ajuste Hidden For Deposito (UX only) | S7a |
| **movimientos-ui**: Step 2 Refuses Invalid Motivo/Quantity | S7b |
| **movimientos-ui**: Step 3 Confirms, Surfaces Server Refusals | S7b |
| **movimientos-ui**: Trigger On Product Screen, Active-Only | S8 |

No requirement is left without a covering slice.

## Review Workload Forecast

| Slice | Prod | Test | Total | 400-line budget | 800-line session budget |
|---|---|---|---|---|---|
| S1 — schema + error factories | ~130 | ~260 | ~390 | Under | Under |
| S1c — Neon deploy gate | 0 (owner action) | 0 | 0 | — | — |
| S2 — `MovimientosRepo` + ripple | ~90 | ~190 | ~280 | Under | Under |
| S3 — `movimientos/service.ts` | ~150 | ~260 | ~410 | Marginally over | Under |
| S4 — routes + app + contract | ~180 | ~230 | ~410 | Marginally over | Under |
| S5 — API integration atomicity/audit | 0 | ~200 | ~200 | Under | Under |
| S6 — web scaffolding | ~120 | ~90 | ~210 | Under | Under |
| S7a — modal step 1 | ~150 | ~150 | ~300 | Under | Under |
| S7b — modal steps 2-3 | ~180 | ~200 | ~380 | Under | Under |
| S8 — trigger + history | ~140 | ~150 | ~290 | Under | Under |
| **Chain total** | **~1140** | **~1730** | **~2870** | — | — |

**400-line budget risk: High.** Two of nine code slices (S3, S4) individually sit marginally over
the project's standing 400-line PR budget from `CLAUDE.md`; total chain is ~2870 raw diff lines
across 8 code-bearing slices, well above any single-PR budget. This matches the proposal's own risk
line ("Exceeds 800-line budget (est. 1000-1500)") — the actual estimate, once D3's forced ripple
(S2) and the two marginally-dense logic slices (S3, S4) are counted, is closer to **~2870**, not
1000-1500. Report this honestly rather than compressing the estimate to fit either budget.

**Against this session's cached `review_budget_lines: 800`:** every individual slice above clears
800 comfortably (largest is S4 at ~410). If slices are chained/stacked as planned, no single PR
approaches 800. The 800-line session budget is not at risk **per PR**; it is the ~2870-line **total**
that requires chaining — a single-PR delivery would blow both the 400-line project default and the
800-line session ceiling by a wide margin.

Chained PRs recommended: Yes
Chain strategy: stacked-to-main (resolved by the orchestrator; S6 = PR 6, S7a = PR 7 of the chain)
400-line budget risk: High
Decision needed before apply: Yes

**Rationale for `Decision needed before apply: Yes`**: session `delivery_strategy` is `ask-on-risk`,
and total risk is High — per `sdd-phase-common.md` §E, the orchestrator must ask before apply.

### Suggested Work Units / PR Slicing

Backend chain (S1 → S1c → S2 → S3 → S4 → S5), then web chain (S6 → S7a → S7b → S8). Web depends on
S4's regenerated contract, so it cannot start earlier regardless of chain strategy chosen.

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| S1 | Schema + error factories | PR 1 | `pnpm --filter api test:integration -- schema.integration` | N/A — no route reachable yet | Drop 2 CHECKs + `es_merma` column; revert `errors.ts` additions |
| S1c | Neon migrate (owner) | N/A | N/A | Manual: `pnpm db:migrate` against Neon, gated by 1.4's pre-flight | Two `DROP CONSTRAINT` + one `DROP COLUMN`, independently droppable |
| S2 | `MovimientosRepo` + ripple | PR 2 | `pnpm --filter api test:integration -- movimientos/repository` | N/A — no route yet | Revert repo/service changes; `esMerma` becomes optional again |
| S3 | `movimientos/service.ts` | PR 3 | `pnpm --filter api test -- movimientos/service` | N/A — service unit only | Delete the new file; nothing else references it yet |
| S4 | Routes + contract | PR 4 | `pnpm --filter api test -- routes/movimientos` | `pnpm contract:check` | Unregister plugin in `app.ts`; delete route file; revert contract regen |
| S5 | API integration proof | PR 5 | `pnpm --filter api test:integration -- routes/movimientos.integration` | Docker `inventienda-postgres-1`, real `createUnitOfWork` | Delete the integration test file only — no production code |
| S6 | Web scaffolding | PR 6 | `pnpm --filter web test -- movimientos/errorMessages` | N/A — pure functions/hooks | Delete `features/movimientos/*` scaffolding files |
| S7a | Modal step 1 | PR 7 | `pnpm --filter web test -- MovimientoModal` | RTL + user-event, no browser needed | Delete `MovimientoModal.tsx` + CSS module |
| S7b | Modal steps 2-3 | PR 8 | `pnpm --filter web test -- MovimientoModal` | RTL + user-event | Revert to S7a's placeholder steps |
| S8 | Trigger + history | PR 9 | `pnpm --filter web test -- productosDetalle` | Full `routeTree` + `createMemoryHistory` | Remove trigger button + `MovimientosTable` from `productosDetalle.tsx` |

Chain strategy is deliberately left `pending` — ask the user whether to run this as **Stacked PRs to
main** (each of the 9 lands independently as it's ready) or a **Feature Branch Chain** (a tracker
branch accumulates S1→S8, only the tracker merges to main). Given the mid-chain contract dependency
(S4 gates the entire web half) and the hard Neon deploy gate between S1 and S2, a Feature Branch
Chain may better contain the "deploys green then 500s until migrated" window than 9 independently
merging stacked PRs would — but this is the user's call per the chained-pr skill's decision gate.
