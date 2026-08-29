# Tasks: Gestión de Proveedores (backlog #4)

Seven work units in dependency order, refining `design.md`'s five seams (S1–S5) after checking
each against the 400-line review budget and one real compile-order gap the design's own File
Changes table left unresolved.

`design.md` forecasts a **floor** of ~1715 authored lines across S1–S5 (~575 source / ~1140
tests), states the realistic band is **~1700–2400** given the #3/#3.1 calibration history, and
flags S3 (~400, at budget) and S5 (~645, over budget) by name. This document re-derives the
forecast rather than copying it, splits both flagged seams, and lands at **~2060** — inside the
stated band, weighted toward its upper half because integration-test scenario count (not file
count) is what the last two cycles under-priced.

## Correction to the design's own seam order (found while sequencing, not re-litigated)

`proveedores/repository.ts`'s `create`/`update` MUST throw `supplierNameInUse()` directly on a
caught `23505`, mirroring `usuarios/repository.ts:293-294,315-316` exactly (`import {
emailAlreadyInUse } from '../lib/errors.js'` → `if (isUniqueViolation(error)) throw
emailAlreadyInUse()`). Verified by reading that file. `design.md`'s File Changes table places
both new error factories in S4 ("Service + error factories"), but the repository (S3 in the
design's numbering) cannot compile without `supplierNameInUse()` already existing — S3 as designed
would not build before S4 exists. This breakdown resolves it by moving **only**
`supplierNameInUse()` (D12) into the repository slice below (S3a), where its actual caller lives.
`supplierNotFound()` stays where the design and the data flow put it — thrown by the **service**
when `findByIdForUpdate` returns `undefined` (D7), not by the repository — so it ships in S4
unchanged. This is a compile-order fix, not a reopening of D12 or D13.

## Slicing

- **S1** — `isUniqueViolation` extraction. Unchanged from design, under budget as one slice.
- **S2** — schema, migration, audit classification. Unchanged from design, under budget as one
  slice.
- **S3 splits** into **S3a** (repository + its integration suite + the one relocated error
  factory, ~430) and **S3b** (`Repos` widening + the five-file stub churn, ~150) — the design's own
  weak split ("wiring + stubs \| repository + integration suite"), reordered so the repository
  that `Repos` depends on lands first.
- **S4** stays one slice (~350) — service + `supplierNotFound()` only, now that
  `supplierNameInUse()` moved to S3a. Still no route, so `openapi.json` and
  `apps/web/src/api/schema.d.ts` stay byte-identical and `pnpm contract:check` is green through
  S1–S4.
- **S5 splits** into **S5a** (routes + the 6×role unit matrix, ~400) and **S5b** (the real-session
  integration suite + contract regeneration, ~380) — the design's own suggested seam. This is the
  only slice pair that changes observable API surface; S5b is where `contract:check` first stops
  being a no-op assertion.

Chain order: **S1 → S2 → S3a → S3b → S4 → S5a → S5b**. See Review Workload Forecast at the end for
the full numbers and the proposed chain shape.

Threat Matrix: every row is N/A per `design.md` (no doc-classification, VCS, shell/subprocess, or
PR-automation boundary is touched anywhere in this change) — no dedicated RED task is required for
it. The one real security boundary (D6's read/write role split) has dedicated RED tests in S5a and
S5b, not prose.

## Phase 1: S1 — `isUniqueViolation` Extraction

No spec requirement is independently satisfied by this slice alone; it is infrastructure every
later write-path slice consumes (D4).

- [x] 1.1 RED `apps/api/src/lib/db-errors.test.ts` (new) — against code that does not exist yet:
      `{ code: '23505' }` → true; `{ cause: { code: '23505' } }` → true (the Drizzle-wrapping
      case); a 23505 at depth 4 → true, at depth 6 → false (assert the bound, not the sentence);
      a self-referencing `cause` chain terminates instead of hanging; `{ code: '23503' }`, `null`,
      `'string'`, `undefined` → false
- [x] 1.2 GREEN `apps/api/src/lib/db-errors.ts` (new) — `isUniqueViolation()` moved **verbatim**
      with its comment block from `usuarios/repository.ts:111-132`, exported
- [x] 1.3 GREEN `apps/api/src/usuarios/repository.ts` — delete the private copy (`:111-132`), add
      `import { isUniqueViolation } from '../lib/db-errors.js'`. No other line changes
- [x] 1.4 Confirm `apps/api/src/usuarios/repository.integration.test.ts:136-170` passes
      **unmodified** — the regression proof that the relocation is behaviour-neutral. If this file
      needs an edit, the move stopped being a move
- [x] 1.5 Verify: `pnpm --filter api test`, `pnpm typecheck`, `pnpm lint`

## Phase 2: S2 — Schema, Migration, Audit Classification

Prerequisite for every later slice; no route requirement is independently satisfied yet.

- [x] 2.1 RED `apps/api/src/db/schema.integration.test.ts` (new, Docker PG) — against a database
      with no `proveedores` table: creating `'Distribuidora Norte'` then `'distribuidora norte'`
      raises `23505`; `'DISTRIBUIDORA NORTE'` also raises it; the surviving row reads back as
      exactly `'Distribuidora Norte'`; a row with `activo = false` still blocks the duplicate;
      the accented pair (`'Ñandú'` vs `'ñandú'`) is asserted against whatever the database
      actually does (measured 2026-08-28: it folds, per the design's Open Questions — the test
      pins that fact, it does not assume it)
- [x] 2.2 GREEN `apps/api/src/db/schema.ts` — add the `proveedores` table (`id`, `nombre: text`
      not `varchar`, `contacto: text` nullable, `activo: boolean default true`, `creadoEn`) with
      `uniqueIndex('proveedores_nombre_lower_unique').on(sql\`lower(${table.nombre})\`)`, per the
      design's Interfaces section (D1). The index name is mandatory — an unnamed expression index
      makes `drizzle-kit` exit 1
- [x] 2.3 GREEN generate and apply the migration: `pnpm db:generate` → `apps/api/drizzle/0003_*.sql`
      + `meta/0003_snapshot.json`; `pnpm db:migrate`; re-run 2.1 → green
- [x] 2.4 Verify the D1 round-trip claim: run `pnpm db:generate` a second time and assert it emits
      **no** new migration file — the cheap proof that the expression index does not re-diff
- [x] 2.5 RED `apps/api/src/auditoria/fields.test.ts` (extend) — against `FIELD_CLASSIFICATION`
      with only a `usuarios` key: assert a `proveedores` key exists whose `auditableFields`
      exactly matches every column name from `getTableColumns(proveedores)`, failing by column
      name when one is missing or extra (mirrors the existing `usuarios` assertion, D5)
- [x] 2.6 GREEN `apps/api/src/auditoria/fields.ts` — add `proveedores: { auditableFields: ['id',
      'nombre', 'contacto', 'activo', 'creadoEn'], excludedFields: [] }`. This is also what makes
      `recordAudit({ entidad: 'proveedores' })` compile (`AuditableEntidad = keyof typeof
      FIELD_CLASSIFICATION`) — confirm with a `tsc --noEmit` check that a throwaway
      `recordAudit({ entidad: 'proveedores', ... })` call type-checks
- [x] 2.7 Verify: `pnpm --filter api test`, `pnpm --filter api test:integration`, `pnpm typecheck`,
      `pnpm lint`, `pnpm contract:check` (still byte-identical — no route touched)

## Phase 3: S3a — Repository + Integration Suite + `supplierNameInUse()`

Satisfies spec (at the repository layer, proven against real Postgres, not yet reachable over
HTTP): **Case-Insensitive Name Uniqueness With Original-Casing Storage** (constraint half),
**List Suppliers (Paginated)**, **Get Supplier by Id** (lookup half), **Logical Deactivation**
(persistence half), **Reactivation** (persistence half). Depends on S1 (`isUniqueViolation`), S2
(table + index exist).

- [ ] 3a.1 RED `apps/api/src/lib/errors.test.ts` (extend) — `supplierNameInUse()` → 409
      `SUPPLIER_NAME_IN_USE`, no `details`, `toErrorEnvelope` maps it (D12). This is the one
      factory moved out of the design's S4 grouping — see the correction note above
- [ ] 3a.2 GREEN `apps/api/src/lib/errors.ts` (extend) — add `supplierNameInUse()`, matching
      `emailAlreadyInUse()`'s shape exactly
- [ ] 3a.3 RED `apps/api/src/proveedores/repository.integration.test.ts` (new, Docker PG) — against
      code that does not exist: `list(page, pageSize)` paginates and returns the correct `total`
      on an **out-of-range page** (the D9 windowed-count trap, asserted as a value); ordering
      (`desc(creadoEn), desc(id)`) stays stable across pages when `creadoEn` ties (D9);
      `findByIdForUpdate` returns the row and holds `FOR UPDATE`; `create` and `update` surface
      `SUPPLIER_NAME_IN_USE` (not a raw pg error) on a duplicate name, case-insensitively (D13);
      `setActivo(false)` leaves the row present and readable, never deletes (D8); `update` with
      `contacto: null` clears an existing value (D11)
- [ ] 3a.4 GREEN `apps/api/src/proveedores/repository.ts` (new) — `Proveedor`, `NuevoProveedor`,
      `CambiosProveedor`, `ProveedoresRepo`, `DrizzleProveedoresRepo` per the design's Interfaces
      section. `create`/`update` catch and `import { isUniqueViolation } from '../lib/db-errors.js'`
      then `throw supplierNameInUse()` on a hit, mirroring `usuarios/repository.ts:293-294,
      315-316` exactly. No `findByNombre` method exists on the port, deliberately (D2). No
      set-lock or predicate-lock method exists, deliberately (D7, D8)
- [ ] 3a.5 Verify: `pnpm --filter api test`, `pnpm --filter api test:integration`, `pnpm typecheck`,
      `pnpm lint`

## Phase 4: S3b — `Repos` Widening + Stub Churn

No spec requirement alone; this is the wiring that makes S3a's repository reachable by the
service layer in S4. Depends on S3a.

- [ ] 3b.1 RED `apps/api/src/plugins/repos.test.ts` (extend) — `buildRepos` returns a `proveedores`
      member bound to the given executor; the injected-fakes case includes it. Fails today because
      `Repos` has no `proveedores` key
- [ ] 3b.2 GREEN `apps/api/src/plugins/repos.ts` — widen the `Repos` interface with `proveedores:
      ProveedoresRepo`; `buildRepos` constructs `new DrizzleProveedoresRepo(executor)`
- [ ] 3b.3 GREEN fix the five test files this widening breaks by name, verified file-by-file in
      `design.md`'s File Changes table:
      `apps/api/src/app.test.ts:33-71` (its `usuarios`-only stub uses `satisfies Repos`, so it
      fails on the missing key — add a `proveedores` fake),
      `apps/api/src/plugins/auth.test.ts:25-37`,
      `apps/api/src/routes/auth.test.ts:27-52`,
      `apps/api/src/routes/usuarios.test.ts:44-…`,
      `apps/api/src/plugins/repos.test.ts:22-28,65-70,82-88`.
      Do **not** touch `usuarios/service.test.ts:127` (`as unknown as Repos`) or
      `auth/service.test.ts` (its own local two-key `Repos` interface) — both are unaffected by
      design, and touching either is a signal this task went wrong
- [ ] 3b.4 Verify: `pnpm --filter api test`, `pnpm typecheck`, `pnpm lint`, `pnpm contract:check`
      (still byte-identical — no route touched)

## Phase 5: S4 — Service + `supplierNotFound()`

Satisfies spec (at the service layer): **Supplier Creation**, **Case-Insensitive Name Uniqueness**
(comparison-in-SQL-only half, D2), **List Suppliers**, **Get Supplier by Id** (404 half), **Update
Supplier Profile** (diff/no-op half), **Logical Deactivation** (no-op half), **Reactivation**
(no-op half), **Audit Obligation Per Mutation** (call-site half). Depends on S3b (`app.repos` /
`app.uow` carry `proveedores`).

- [ ] 4.1 RED `apps/api/src/lib/errors.test.ts` (extend) — `supplierNotFound()` → 404
      `SUPPLIER_NOT_FOUND`, no `details`, `toErrorEnvelope` maps it (D12)
- [ ] 4.2 GREEN `apps/api/src/lib/errors.ts` (extend) — add `supplierNotFound()`
- [ ] 4.3 RED `apps/api/src/proveedores/service.test.ts` (new, fake repos + `{ run: (work) =>
      work(stubs) }`) — against code that does not exist: an empty diff on update/deactivate/
      reactivate makes **no** repo write and **no** `recordAudit` call, returns 200 with the
      current DTO (D10); `findByIdForUpdate` returning `undefined` throws `supplierNotFound()`
      **before** any write (D7); every mutation's repo calls occur inside a single `uow.run`
      call; a `crear` audit call carries `datosPrevios: null`; an `actualizar` audit call carries
      only the changed fields, both directions; **the D8 negative** — deactivating the only active
      supplier succeeds and records `baja_logica`, with no guard consulted and no lock-set method
      existing on the port to consult
- [ ] 4.4 GREEN `apps/api/src/proveedores/service.ts` (new) — `listProveedores`, `getProveedor`,
      `createProveedor`, `updateProveedor`, `setProveedorActivo`. No `toLowerCase()` anywhere in
      this file — folding stays in SQL only (D2). Every mutation wrapped in one `app.uow.run`
      paired with `recordAudit({ entidad: 'proveedores', ... })`
- [ ] 4.5 Verify: `pnpm --filter api test`, `pnpm typecheck`, `pnpm lint`, `pnpm contract:check`
      (still byte-identical — no route touched)

## Phase 6: S5a — Routes + Role Matrix

Satisfies spec: **Role Gate — Read/Write Split** (unit half), **Supplier Creation** (HTTP shape),
**Case-Insensitive Name Uniqueness** (409-over-HTTP shape), **List Suppliers**, **Get Supplier by
Id** (HTTP shape), **Update Supplier Profile** (including the `.strict()` rejection of `activo`),
**Logical Deactivation**, **Reactivation** (HTTP shapes). Depends on S4.

- [ ] 5a.1 RED `apps/api/src/routes/proveedores.test.ts` (new, `buildApp({ repos, uow,
      cookieSecret })` + `inject`) — against code that does not exist: the full 6×role matrix —
      `deposito` → 200 on both GETs, 403 `FORBIDDEN` on all four writes; unauthenticated → 401 on
      all six; a flagged (`debeCambiarPassword`) user → 403 `PASSWORD_CHANGE_REQUIRED` on all six
      (D6, inherited hook ordering); `PATCH` with an `activo` key → 400 `VALIDATION_ERROR`;
      `PATCH` with `{}` → 400 (`.refine(keys.length > 0)`); `nombre: '   '` → 400 after trimming
      (D3); `contacto: null` accepted, `contacto: ''` rejected (D11)
- [ ] 5a.2 GREEN `apps/api/src/routes/proveedores.ts` (new) — six routes: `GET /api/proveedores`,
      `GET /api/proveedores/:id` with `config: { roles: ['encargado', 'deposito'] }`;
      `POST /api/proveedores`, `PATCH /api/proveedores/:id`,
      `POST /api/proveedores/:id/deactivate`, `POST /api/proveedores/:id/reactivate` with
      `config: { roles: ['encargado'] }` (D6). `nombre`/`contacto` trimmed at the Zod boundary
      (D3); `PATCH` body is `.strict()` and `.refine(keys.length > 0)` (D11); every route declares
      each reachable status in its Zod `response` map
- [ ] 5a.3 GREEN `apps/api/src/app.ts` — `app.register(proveedoresRoutes, { prefix: '/api' })`,
      registered **after** `authPlugin`, alongside the other route plugins (D6 — registering before
      the auth hook silently drops coverage)
- [ ] 5a.4 Verify: `pnpm --filter api test`, `pnpm typecheck`, `pnpm lint`

## Phase 7: S5b — Real-Session Integration Suite + Contract

Satisfies spec: **Role Gate** (integration half, real `deposito` session), **Audit Obligation Per
Mutation** (end-to-end proof), **Atomic Rollback on Audit Failure**. Completes the HTTP-shape
requirements S5a proved with stubs. Depends on S5a.

- [ ] 5b.1 RED `apps/api/src/routes/proveedores.integration.test.ts` (new, real app + Docker PG,
      no stubs) — against code with no reachable route (S5a's routes exist, this file is new): a
      real `deposito` session's write attempt is refused *and* the table and `auditoria` are
      unchanged afterward (D6, the genuine authorization-boundary proof, not a stubbed one);
      exactly one `auditoria` row per mutation with `entidad = 'proveedores'` and the right verb;
      a duplicate name differing only in case returns 409 through the full HTTP layer and the
      existing row's casing is unchanged; a deactivated supplier is still `200` on
      `GET /api/proveedores/:id` with `activo = false` (D8); a forced audit-insert failure leaves
      the target row unchanged and returns `500 { error: { code: "AUDIT_WRITE_FAILED" } }`
- [ ] 5b.2 GREEN whatever S5a wiring gap the integration suite exposes (expected: none, since S5a
      already proves the same matrix against fakes — this slice is the real-Postgres proof, not
      new production code)
- [ ] 5b.3 GREEN regenerate the contract: `pnpm contract` (or the project's equivalent) →
      `apps/api/openapi.json`, `apps/web/src/api/schema.d.ts` pick up the six new paths and every
      declared status. This is also the proof that Zod `.trim()` (D3) survives
      `jsonSchemaTransform` — if `contract:check` fails here, the documented fallback is
      `.min(1).refine(v => v.trim().length > 0)` plus a service-level `trim()`, not dropping the
      rule
- [ ] 5b.4 Verify: `pnpm --filter api test`, `pnpm --filter api test:integration`, `pnpm typecheck`,
      `pnpm lint`, `pnpm contract:check` (now asserts real content, not byte-identity)

## Phase 8: Bookkeeping

- [ ] 8.1 Confirm no `.env*` file is touched and no new environment variable is introduced by any
      slice — `DATABASE_URL` already exists and is the only input (per design's Migration/Rollout
      section); no manual user step is needed before any PR merges
- [ ] 8.2 Before merging each PR except the last in a stacked chain, `gh pr edit <next-pr-number>
      --base main` — GitHub does not auto-retarget a stacked PR when its base merges (precedent:
      `gestion-usuarios` #36→#37→#38, `pantalla-usuarios`); delete a merged branch only after
      confirming the retarget landed
- [ ] 8.3 After the last slice merges, confirm the two Open Questions the design left unresolved
      (wire-code language consistency, `isUniqueViolation`'s non-discriminating 23505 mapping) are
      still recorded as open questions in the archived design, not silently dropped

## Requirement Coverage Map

| Requirement | Slice(s) |
|---|---|
| Role Gate — Read/Write Split | S5a (unit matrix) + S5b (real-session proof) |
| Supplier Creation | S3a (repo `create`) + S4 (`createProveedor`) + S5a/S5b (HTTP) |
| Case-Insensitive Name Uniqueness With Original-Casing Storage | S1 (`isUniqueViolation`) + S2 (index + collation proof) + S3a (repo mapping) + S4 (no TS folding) + S5b (HTTP 409 + casing intact) |
| List Suppliers (Paginated) | S3a (repo `list`) + S4 (`listProveedores`) + S5a (route) |
| Get Supplier by Id | S3a (repo `findById`) + S4 (`getProveedor`) + S5a (route) |
| Update Supplier Profile | S3a (repo `update`) + S4 (diff/no-op) + S5a (`.strict()` rejection of `activo`) |
| Logical Deactivation Preserves References and History | S3a (repo `setActivo`) + S4 (no-op case) + S5a/S5b (route + real-DB proof) |
| Reactivation | S3a (repo `setActivo`) + S4 (no-op case) + S5a/S5b (route + real-DB proof) |
| Audit Obligation Per Mutation | S2 (`FIELD_CLASSIFICATION` — the compile gate) + S4 (`recordAudit` call sites) + S5b (real-session one-row-per-mutation proof) |
| Atomic Rollback on Audit Failure | S5b (only provable against real Postgres) |

No requirement is left without a covering slice.

## Review Workload Forecast

Estimated changed lines (authored additions + deletions; `openapi.json`,
`apps/web/src/api/schema.d.ts`, and `drizzle/meta/0003_snapshot.json` excluded as generated; the
migration `.sql` **is** counted): **~2060**

| Slice | Source | Tests | Total | Over 400? |
|---|---|---|---|---|
| S1 — `isUniqueViolation` extraction | ~50 | ~100 | ~150 | No |
| S2 — schema, migration, audit classification | ~55 | ~175 | ~230 | No |
| S3a — repository + integration suite + `supplierNameInUse()` | ~170 | ~260 | ~430 | **Yes, marginal** |
| S3b — `Repos` widening + stub churn | ~40 | ~110 | ~150 | No |
| S4 — service + `supplierNotFound()` | ~130 | ~220 | ~350 | No |
| S5a — routes + role matrix | ~155 | ~245 | ~400 | At the line |
| S5b — real-session integration suite + contract | ~30 | ~350 | ~380 | No |
| **Chain total** | **~630** | **~1460** | **~2060** | **Yes** |

This lands inside the design's own stated ~1700–2400 band, above its ~1715 floor, because
integration-test scenario count — not file count — is what the #3/#3.1 cycle under-priced by
17–165%, and S2/S3a/S5b are the three integration-heavy slices here. S3a is the one slice that
lands slightly over budget alone (~430): its two components (the repository's five-scenario
integration suite, and the one relocated error factory) are already the smallest honest split —
peeling the factory into its own micro-PR ahead of S3a would save only ~30 lines against a real
review-focus cost (a one-file, near-zero-context PR). If S3a drifts further during apply past
~450, that factory addition (3a.1/3a.2) is the first candidate to move into a standalone
`size:exception`-free PR immediately before it.

Chained PRs recommended: **Yes**
400-line budget risk: **High**
Decision needed before apply: **Yes**
Chain strategy: **pending**

```
Decision needed before apply: Yes
Chained PRs recommended: Yes
Chain strategy: pending
400-line budget risk: High
```

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| S1 | `isUniqueViolation` relocated, behaviour-neutral | PR1 | `pnpm --filter api test -- db-errors` | `pnpm --filter api test -- usuarios/repository.integration` (unmodified, must stay green) | revert `lib/db-errors.ts`, revert the one-line edit in `usuarios/repository.ts` |
| S2 | `proveedores` table + index + audit classification | PR2 | `pnpm --filter api test -- auditoria/fields` | `pnpm --filter api test:integration -- db/schema` (Docker PG) | revert `db/schema.ts`, the new migration files, `auditoria/fields.ts`'s new entry; `usuarios` untouched |
| S3a | `ProveedoresRepo` port + adapter, proven against real Postgres | PR3 | `pnpm --filter api test -- proveedores/repository` | `pnpm --filter api test:integration -- proveedores/repository` (Docker PG) | revert `proveedores/repository.ts`, `lib/errors.ts`'s `supplierNameInUse()`; nothing yet depends on either |
| S3b | `Repos` widened, five stub files fixed | PR4 | `pnpm --filter api test -- plugins/repos app.test auth.test routes/auth routes/usuarios` | N/A — wiring only, no new runtime path | revert `plugins/repos.ts` and the five stub-file edits; S3a's repository stays usable standalone |
| S4 | Service layer, no route yet | PR5 | `pnpm --filter api test -- proveedores/service lib/errors` | N/A — `contract:check` byte-identity check stands in for a runtime proof at this seam | revert `proveedores/service.ts`, `lib/errors.ts`'s `supplierNotFound()` |
| S5a | Six routes live, proven against fakes | PR6 | `pnpm --filter api test -- routes/proveedores` | `pnpm --filter api test -- app.test` (route registration order) | revert `routes/proveedores.ts` and the one registration line in `app.ts`; S4's service stays usable standalone |
| S5b | Real-session proof + contract regeneration, feature complete | PR7 | `pnpm --filter api test:integration -- routes/proveedores` | `pnpm contract:check` (now asserts real content) | revert `routes/proveedores.integration.test.ts` and the regenerated contract artifacts; S5a's routes stay live and correct without this proof, just unverified against real Postgres |

Seven PRs is a smaller jump from `gestion-usuarios`' and `pantalla-usuarios`' precedent than either
of those cycles' own slice counts, because this change has no lockout machinery, no temporary
passwords, and no cross-row concurrency guard to slice around — its complexity is spread evenly
across "one new integration-proven layer per PR." Two alternative shapes for the owner to weigh
against the seven-PR default:

- **Three-PR shape** (mirrors both prior cycles' accepted pattern): **PR-A = S1+S2** (~380,
  foundation), **PR-B = S3a+S3b+S4** (~930, the whole backend minus HTTP — would need
  `size:exception`, and is the shape most likely to bury the S3a repository review under wiring
  churn), **PR-C = S5a+S5b** (~780, feature complete — would need `size:exception`).
- **Five-PR shape**: **PR1 = S1+S2** (~380), **PR2 = S3a** (~430, `size:exception` or split
  further per the note above), **PR3 = S3b+S4** (~500, `size:exception`), **PR4 = S5a** (~400),
  **PR5 = S5b** (~380).

The orchestrator should present the seven-PR `ask-on-risk`-compliant default alongside these two
`size:exception` alternatives and let the owner pick, per this session's cached `delivery_strategy:
ask-on-risk`.

---

## Accepted Delivery Decision (2026-08-28)

The backlog owner reviewed all three proposed shapes with their line counts and **chose five PRs**.

- `delivery_strategy`: **`exception-ok`** — `size:exception` granted for the two PRs over budget.
- `chain_strategy`: **`stacked-to-main`**, as in the previous two cycles. Each PR targets the
  previous branch and is retargeted to `main` as its base merges. This repository has
  `deleteBranchOnMerge: false` and GitHub does **not** auto-retarget a stacked PR when its base
  merges — `gh pr edit <n> --base main`, a rebase, and a full re-verification are required at each
  step.

| PR | Slices | Est. lines | Over 400? |
|---|---|---|---|
| PR1 | S1 + S2 | ~380 | No |
| PR2 | S3a | ~430 | Yes — `size:exception` |
| PR3 | S3b + S4 | ~500 | Yes — `size:exception` |
| PR4 | S5a | ~400 | At the line |
| PR5 | S5b | ~380 | No |

Why five rather than three or seven: the seven-PR shape respects the budget most faithfully but
costs seven manual rebase-and-reverify cycles. The three-PR shape was rejected on evidence rather
than taste — this phase has underestimated by 17% to 165% on every prior cycle, always because
integration-test weight is not in its model, so a PR forecast at ~810 could realistically land near
1400. That is what happened to `pantalla-usuarios` PR-B, forecast at 1280 and shipped at 1884. Five
PRs keeps every unit inside the range where a forecast miss still leaves something a person can
review in one sitting.

**Ledger caps carry the correction from the start.** PR1 also ships the five planning artifacts —
1350 lines of markdown, well over its ~380 of implementation — and the runtime ledger counts raw
diff lines, artifacts and bookkeeping included. Its cap is set at **2400**, not at the
implementation estimate. Later PRs add no new artifacts, so their caps cover implementation, tests
and the `tasks.md` checkbox ticks only, with the same generous factor applied rather than
discovered at settle time.

**Verification gate for every PR, without exception**: `pnpm -r test`, `pnpm typecheck`,
`pnpm lint`, `pnpm contract:check`, and `pnpm test:integration`.
