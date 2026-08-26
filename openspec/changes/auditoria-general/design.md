# Design: Sistema de Auditoría General (backlog #2.2)

## Technical Approach

Four seams in dependency order, each independently mergeable. Decision ids are cited as
`auditoria-general D1..D16`; `app-shell-login/design.md` and `auth-sesiones/design.md` own their own
D-numbers.

1. **S1 — Transaction seam** (`apps/api/src/db/`, `src/plugins/repos.ts`). `DbExecutor` type,
   `buildRepos(executor)` factory, `UnitOfWork` port + `app.uow` decorator. Touches no domain table
   and no route file. Ships with a real-Postgres rollback test, so the pattern is proven before
   anything depends on it.
2. **S2a — Table + field classification** (`src/db/schema.ts`, `drizzle/0002_*`,
   `src/auditoria/fields.ts`). The `auditoria` table, its migration, and the per-entity
   auditable/excluded classification plus its exhaustiveness test. No service yet.
3. **S2b — Repository + service** (`src/auditoria/`, `src/lib/errors.ts`, `src/plugins/repos.ts`).
   `AuditoriaRepo`, `recordAudit`, `AUDIT_WRITE_FAILED`, wiring into `Repos`.
4. **S3 — Reference implementation** (`src/auth/service.ts`, `src/routes/auth.ts`).
   `changePassword` becomes transactional and writes its audit row. This is the template #3 and #4
   copy; it is deliberately last so the copied shape is the finished one.

S2a needs S1 only for the migration to coexist; S2b needs S1 + S2a; S3 needs all three.
**No route file changes anywhere in the chain** (S3 edits one call expression inside an existing
handler, no schema), so `openapi.json` and `schema.d.ts` stay byte-identical and `pnpm contract:check`
is green in every slice (D16).

**Naming rule inherited from the codebase:** table names, column names and pgEnum *values* are
Spanish (`hash_contrasena`, `rol_usuario` → `'encargado'`); TypeScript identifiers, filenames and
comments are English (`repository.ts`, `updatePassword`). This design follows both.

## Architecture Decisions

| # | Decision | Alternatives rejected | Rationale |
|---|---|---|---|
| D1 | Transactions thread through a `buildRepos(executor)` factory in `plugins/repos.ts`, exposed to services as a one-method `UnitOfWork` port (`run(work: (repos: Repos) => Promise<T>)`) decorated as `app.uow` | (a) `tx?` parameter on every repo method; (b) `repo.withExecutor(tx)` clone method; (c) services importing `getDb()` and calling `db.transaction` directly | Verified: `rg "\.transaction\(" apps/api/src` returns nothing, and both repo classes bind their connection at construction (`constructor(private readonly db: Db)`, every method uses `this.db`). A repo built from `getDb()` but used inside a `db.transaction(tx => …)` callback would execute **outside** the transaction and the rollback would silently not revert it — a failure with no error message. The factory makes that unreachable by construction: inside `run`, the only repos in scope are the ones bound to `tx`. (a) spreads an optional parameter through every current and future method signature and is opt-in, so forgetting it reproduces exactly the silent bug. (b) is the same defect one level up — you can still hold the un-cloned repo. (c) would put a Drizzle import into `auth/service.ts`, which today imports zero `db/` modules |
| D2 | `export type DbExecutor = Db \| Parameters<Parameters<Db['transaction']>[0]>[0];` in `db/client.ts`; repo constructors take `DbExecutor` instead of `Db` | Import `NodePgTransaction` and spell the generics out | Verified `NodePgTransaction<TFullSchema, TSchema>` exists in `drizzle-orm/node-postgres/session.d.ts`, but naming it means restating the schema generics at every use and re-editing them on a Drizzle upgrade. Deriving from `Db['transaction']` keeps one source of truth. `select/insert/update/delete/execute` all exist on both arms, so the two constructor lines are the entire repo change |
| D3 | `verifyPassword` and `hashPassword` run **outside** the transaction; only the three writes are inside | One transaction wrapping the whole function | argon2 hashing is deliberately slow (hundreds of ms). Holding a Postgres transaction and a pooled connection open across it, per password change, for no atomicity benefit — the hash depends on nothing in the database — is pure contention |
| D4 | `changePassword(uow, input)` replaces `changePassword(repos, input)`. `login`/`logout`/`resolveSession` keep `Repos` unchanged | Add `transaction` to the `Repos` interface; pass both `repos` and `uow` | Only mutations need atomicity; reads do not, and widening `Repos` would force every existing stub in `service.test.ts` / `routes/auth.test.ts` to grow a member the tested path never calls. The route change is one token: `changePassword(app.uow, {…})`. Test fakes are two lines: `{ run: (work) => work(stubRepos) }` |
| D5 | A failed audit write surfaces as `AUDIT_WRITE_FAILED`, HTTP **500**, via a new `auditWriteFailed(cause)` factory in `lib/errors.ts`. The auditoría service wraps anything thrown by its repo; `db.transaction` rethrows after rollback, so the `AppError` reaches `toErrorEnvelope` unchanged | Let the raw `pg` error fall through to `INTERNAL_ERROR`; swallow and return 200 | Swallowing contradicts the settled atomicity decision — the business write must not survive. 500 is correct: the caller did nothing wrong and the operation did not happen, so a 4xx would tell the SPA to fix input that is fine. A distinct code (not generic `INTERNAL_ERROR`) is the one signal that separates "the feature is broken" from "the trail is broken" in logs and support, and both need different responses |
| D6 | Snapshots store **only the changed fields**, same key set on both sides — not full rows | Full before/after row pair | ADR-0012 rule 4 exists because a naive full-row snapshot copies `hash_contrasena` on every change. A diff never contains an untouched column, so the denylist becomes the second line of defence instead of the only one. There is also no retention policy (settled), so full rows duplicate every row twice per edit forever. Reconstructing state at time *T* is the only thing full rows buy, and ADR-0012 frames `auditoria` as low-frequency suspicion-driven metadata, not event sourcing. Exception: on `crear` the changed fields *are* the whole row |
| D7 | `datos_previos` is `jsonb` **NULL** on `crear` and non-null everywhere else, enforced by a DB CHECK: `(accion = 'crear') = (datos_previos IS NULL)`. `datos_posteriores` is `NOT NULL` | `{}` on creation; nullable both sides with no constraint | `{}` is indistinguishable from "a row whose auditable fields were all empty"; NULL says "no prior state existed" and nothing else. The CHECK makes the invariant unforgeable rather than a convention. Note the deliberate non-symmetry: on `cambiar_password` **`{}` is a legitimate value** for both sides, because the only mutated columns are `hash_contrasena` (excluded) and `debe_cambiar_password` (unchanged when the user was not flagged). That row's value is *who changed a password when*, not the values — non-repudiation of the act. The CHECK is written against `accion`, so it permits that |
| D8 | On `crear`, `entidad_id` is the id returned by the business `INSERT … RETURNING id`, read inside the same transaction | Generate the uuid in the application before insert | Keeps `defaultRandom()` (ADR-0011) as the single generator. Ordering falls out for free: the business write runs first, the audit write consumes its result, both roll back together. This ordering is part of the S3 template |
| D9 | The `entidad_auditoria` pgEnum ships all three values now (`usuarios`, `proveedores`, `productos`); the **service surface** is narrower and grows by adding a classification entry | Ship `usuarios` only and `ALTER TYPE … ADD VALUE` in #4/#5 | Two reasons. ADR-0012's stated purpose is to take these decisions once with all three entities in view. And `ALTER TYPE … ADD VALUE` cannot be used by a statement in the same transaction that added it — drizzle-kit runs migrations in a transaction, so #4 would need two migrations or a hand-edit for an enum widening that costs nothing today. Meanwhile `recordAudit`'s `entidad` is typed `keyof typeof FIELD_CLASSIFICATION`, which in v1 is `'usuarios'` alone: `entidad: 'proveedores'` does not compile until #4 classifies its columns (D11). The forward-declared values are not untested — because `entidad_id` carries no FK, the integration suite inserts one row per enum value with a random uuid and asserts all three are accepted |
| D10 | `accion_auditoria` = `crear`, `actualizar`, `baja_logica`, `reactivar`, `cambiar_password` | Fold `baja_logica`/`reactivar` into `actualizar`; fold `cambiar_password` into `actualizar` | The user settled deactivation and reactivation as distinct auditable actions, and a distinct value means "who deactivated this user" is an indexed equality filter rather than a jsonb probe. `cambiar_password` is separate because it is the exact case #2.2 exists for (#3's temporary-password window) and because it is the one action whose snapshots are structurally near-empty by design (D7) — merging it into `actualizar` would make an empty `actualizar` diff look like a bug |
| D11 | The **runtime filter stays a denylist** (ADR-0012 rule 4, untouched). Exhaustiveness becomes a build-time check: `src/auditoria/fields.ts` classifies every column as auditable **or** excluded, and a unit test asserts the union equals `Object.keys(getTableColumns(table))`, failing **by column name** on anything unclassified | Convert to an allowlist (reopens the ADR); denylist alone; a code-comment convention | Verified `getTableColumns` is exported from `drizzle-orm` (`utils.d.ts:37`, re-exported at `index.d.ts:13`) and `usuarios` has exactly ten columns. A denylist fails open: whoever adds `token_recuperacion` in a later item is not thinking about auditing, and the column lands in the trail silently. This turns that into a red test naming the column, **without changing what the ADR mandated at runtime** — `auditableFields` is consumed by nothing but the test; `excludedFields` is what the service applies. Fail-closed twice over: the classification map is also the compile-time gate of D9, so an unclassified *entity* cannot be audited either |
| D12 | Classification is **per entity**, with `hash_contrasena` denied globally as a floor | One global list keyed by column name | Only a per-entity map can be checked for exhaustiveness at all — a global name list cannot tell you whether every column of every table is covered, which is the entire mechanism of D11. The global floor preserves ADR-0012 rule 4's wording literally: `hash_contrasena` is excluded wherever it appears, in any entity, without depending on the per-entity entry being right |
| D13 | Two composite btree indexes: `(entidad, entidad_id, creado_en)` and `(usuario_id, creado_en)`. No index on `accion`, none on `creado_en` alone | No indexes until a read path exists; index every column | They are the two queries that will exist: history of one record, and everything one actor did. Both are equality-prefix + ordered tail, so the composite serves filter and sort with no sort node; direction is omitted because a btree scans backwards at the same cost. `accion` has five values — a scan over it never beats a seq scan at this size. Adding them *now* is the cheap moment: with no retention policy, adding an index later means building it over an unbounded table. Cost, stated honestly: two indexes double write amplification on an append-only table, which is irrelevant at admin-CRUD write rates |
| D14 | `usuario_id` (the actor) **does** carry an FK to `usuarios` with `onDelete: 'restrict'`. `entidad_id` (the subject) carries none | FK on both; FK on neither | ADR-0011 forbids an FK on `entidad_id` because it is polymorphic, and wants the trail to outlive its subject. Neither applies to the actor: it is always a `usuarios` row, and `restrict` turns "an audit row must have a real, resolvable author" into a database guarantee. #3 deletes users logically, so `restrict` blocks nothing the product does |
| D15 | ADR-0012 rule 3 is enforced today by a `@ts-expect-error` signature test plus a lint-visible rule that `src/auditoria/**` imports nothing from a ledger module. ADR-0012 rule 5's **two literal boundary tests cannot be written in this change** | Write approximations of rule 5 and call it satisfied | Verified: `schema.ts` contains only `usuarios` and `sesiones`. There is no `movimientos` table and no `productos.stock_minimo`, so "recording a sale creates zero audit rows" and "editing `stock_minimo` creates zero movements" have nothing to execute against. The enforceable half of the boundary — the signature admits no quantity — is enforceable now and ships now. The other half is a tracked obligation on #5/#6, recorded in Open Questions. This contradicts one of the proposal's success criteria; see Open Questions |
| D16 | No route file, Zod schema or DTO changes in any slice | Add `GET /api/auditoria` "since we are here" | Write-only v1 is settled. The structural payoff is that `openapi.json` cannot drift, so unlike the previous cycle (`app-shell-login` D14) no slice has to carry a regenerated contract diff and `contract:check` is green at every point in the chain |

## Data Flow

```
POST /api/auth/password        (unchanged route, unchanged schema, unchanged contract)
  handler → changePassword(app.uow, { usuario, sessionId, currentPassword, newPassword })

    verifyPassword(usuario.hashContrasena, currentPassword)     ← outside tx (D3)
      false → 400 INVALID_CURRENT_PASSWORD                        no writes, no audit row
    hashPassword(newPassword)                                   ← outside tx (D3)

    uow.run(async (repos) => {              db.transaction(tx => work(buildRepos(tx)))
      repos.usuarios.updatePassword(id, hash)        ← business write first (D8)
      repos.sesiones.deleteOthers(id, sessionId)
      repos.auditoria.record({                       ← same tx, same connection
        entidad: 'usuarios', entidadId: id, accion: 'cambiar_password',
        usuarioId: id,
        datosPrevios:     { debeCambiarPassword: true  },   ← denylist-filtered diff (D6)
        datosPosteriores: { debeCambiarPassword: false },
      })
    })
      audit insert throws → wrapped AUDIT_WRITE_FAILED (D5)
                          → tx ROLLBACK: password NOT changed, sessions NOT revoked
                          → rethrown → 500 { error: { code: 'AUDIT_WRITE_FAILED', … } }

    → 200 { ok: true }        current cookie still resolves


Executor threading — the property S1 exists to guarantee

  app.repos          = buildRepos(getDb())     ← pool-bound, non-transactional (reads)
  app.uow.run(work)  = getDb().transaction(tx => work(buildRepos(tx)))
                                       │
                       inside `work`, the ONLY repos in scope are tx-bound.
                       There is no un-bound repo to reach for by accident.
```

## File Changes

| File | Action | Slice | Description |
|---|---|---|---|
| `apps/api/src/db/client.ts` | Modify | S1 | `export type DbExecutor` derived from `Db['transaction']` (D2) |
| `apps/api/src/db/uow.ts` | Create | S1 | `UnitOfWork` interface + `createUnitOfWork(db)` (D1) |
| `apps/api/src/auth/repository.ts` | Modify | S1 | Two constructor signatures `Db` → `DbExecutor` |
| `apps/api/src/plugins/repos.ts` | Modify | S1, S2b | `buildRepos(executor)` replaces the object literal; `uow` decorator + `ReposPluginOptions.uow`; later `auditoria` added to `Repos` |
| `apps/api/src/db/schema.ts` | Modify | S2a | `accionAuditoria` / `entidadAuditoria` pgEnums, `auditoria` table, two indexes, one CHECK |
| `apps/api/drizzle/0002_*.sql` + `meta/` | Create | S2a | `pnpm db:generate`. Generated — excluded from the authored-line count |
| `apps/api/src/auditoria/fields.ts` | Create | S2a | Per-entity `{ auditableFields, excludedFields }` + global floor (D11, D12) |
| `apps/api/src/auditoria/repository.ts` | Create | S2b | `AuditoriaRepo` interface + `DrizzleAuditoriaRepo(executor: DbExecutor)` |
| `apps/api/src/auditoria/service.ts` | Create | S2b | `recordAudit` — filters the diff, wraps repo failures (D5, D6) |
| `apps/api/src/lib/errors.ts` | Modify | S2b | `auditWriteFailed(cause?)` → `AUDIT_WRITE_FAILED`, 500 |
| `apps/api/src/auth/service.ts` | Modify | S3 | `changePassword(uow, input)`; the D9 comment at line 106 is replaced by the implementation it predicted |
| `apps/api/src/routes/auth.ts` | Modify | S3 | `changePassword(app.uow, …)` — one call expression, no schema change |

## Interfaces

```ts
// apps/api/src/db/client.ts — one source of truth for "something that can run a query".
// Derived from Db itself so a Drizzle upgrade cannot desynchronise the two arms (D2).
export type DbExecutor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

// apps/api/src/db/uow.ts — the only thing a service is allowed to know about transactions.
// Note the shape: `work` receives repos, it never receives `tx`. A service cannot
// obtain the raw executor, so it cannot bypass the boundary (D1).
export interface UnitOfWork {
  run<T>(work: (repos: Repos) => Promise<T>): Promise<T>;
}

// apps/api/src/auditoria/service.ts
// `entidad` is keyed off the classification map, not off the pgEnum: an entity with no
// classified columns does not compile (D9 + D11). No parameter admits a quantity (ADR-0012 rule 3).
export type AuditableEntidad = keyof typeof FIELD_CLASSIFICATION;   // v1: 'usuarios'
export type AuditAccion =
  | 'crear' | 'actualizar' | 'baja_logica' | 'reactivar' | 'cambiar_password';

export interface AuditEvent<E extends AuditableEntidad = AuditableEntidad> {
  entidad: E;
  entidadId: string;               // uuid, no FK (ADR-0011)
  accion: AuditAccion;
  usuarioId: string;               // actor; FK, restrict (D14)
  datosPrevios: Record<string, unknown> | null;   // null iff accion === 'crear' (D7)
  datosPosteriores: Record<string, unknown>;
}
```

```ts
// apps/api/src/db/schema.ts (excerpt) — the CHECK needs an explicit enum cast in raw SQL.
export const auditoria = pgTable('auditoria', { /* … */ }, (t) => [
  index('auditoria_entidad_entidad_id_creado_en_idx')
    .on(t.entidad, t.entidadId, t.creadoEn),
  index('auditoria_usuario_id_creado_en_idx').on(t.usuarioId, t.creadoEn),
  check(
    'auditoria_datos_previos_solo_en_crear',
    sql`(${t.accion} = 'crear'::accion_auditoria) = (${t.datosPrevios} is null)`,
  ),
]);
```

## Testing Strategy (Strict TDD — RED first, every row)

| Layer | What to test | Approach |
|---|---|---|
| Integration `src/db/uow.integration.test.ts` | **The D1 guarantee itself**: a `run` whose second write throws leaves zero rows from the first; a repo built from `getDb()` and used inside `run` is *not* rolled back (the bug the design prevents, asserted as a documented negative) | Docker Postgres, real repos, real `db.transaction` |
| Unit `src/plugins/repos.test.ts` | `buildRepos(executor)` returns every member of `Repos`; injected fakes still win; `app.uow` present and overridable | Extends the existing two-case suite |
| Unit `src/auditoria/fields.test.ts` | For every classified entity, `auditableFields ∪ excludedFields === Object.keys(getTableColumns(table))`; a stale name in either list fails; `hashContrasena` is excluded (D11, D12) | Pure, against the real schema object |
| Unit `src/auditoria/service.test.ts` | Excluded fields never reach either snapshot; `crear` → `datosPrevios === null`; a repo throw becomes `AUDIT_WRITE_FAILED` preserving `cause`; **`@ts-expect-error` on any quantity-shaped argument** (ADR-0012 rule 3) | Stub repo |
| Integration `src/auditoria/repository.integration.test.ts` | Migration applied: table, both indexes, the CHECK rejects `crear` with non-null `datosPrevios`; all three `entidad` enum values insert (D9); the `usuario_id` FK rejects an unknown actor (D14) | Docker Postgres |
| Unit `src/auth/service.test.ts` | Wrong current password → no writes **and no audit row**; success → `updatePassword`, `deleteOthers`, `record` in that order, all inside one `run`; a throwing audit stub propagates and the fake `run` reports it did not commit | Stub repos + `{ run: (work) => work(stubs) }` |
| Integration `src/routes/auth.integration.test.ts` | `POST /api/auth/password` writes exactly one `auditoria` row with no `hash_contrasena` in either snapshot; with the audit insert forced to fail, the password is unchanged and the response is 500 `AUDIT_WRITE_FAILED` | Real app + Docker Postgres |
| Contract | `pnpm contract:check` green in **every** slice (D16) | CI |

## Threat Matrix

| Boundary | Applicability |
|---|---|
| Documentation-like paths | N/A — no file classification or execution of repository content |
| Git repository selection | N/A — no VCS automation is introduced |
| Commit state | N/A — no index/worktree manipulation |
| Push state | N/A — no push automation |
| PR commands | N/A — no PR automation |
| Shell/subprocess construction | N/A — no command is built or spawned |

No routing, shell, subprocess or process-integration boundary changes. The security-relevant boundary
of this change is data exfiltration into the audit trail (`hash_contrasena` and any future sensitive
column), and it is addressed by D6, D11 and D12 with dedicated RED tests in `fields.test.ts` and
`service.test.ts`, not by prose.

## Migration / Rollout

Additive only: one new table, two new pgEnums, two indexes, one CHECK. No existing table is touched,
so `drizzle/0002_*.sql` is `CREATE TYPE` / `CREATE TABLE` / `CREATE INDEX` and applies to the live
Neon database with `pnpm db:migrate` (ADR-0010) at any point before S2b deploys. Rollback: revert the
commits; if the table must go, a follow-up migration drops it — no data loss is possible because
nothing reads it in v1.

**Environment:** no new variable is required. `DATABASE_URL` already exists and is the only input.

### Changed-line forecast (authored additions + deletions; generated migration SQL and `meta/` excluded)

| Slice | Source | Tests | Total | Over 400? |
|---|---|---|---|---|
| S1 — transaction seam | ~50 | ~105 | **~155** | No |
| S2a — table + field classification | ~85 | ~60 | **~145** | No |
| S2b — repository + service | ~150 | ~120 | **~270** | No |
| S3 — `changePassword` reference implementation | ~30 | ~120 | **~150** | No |
| **Chain total** | ~315 | ~405 | **~720** | **Yes** |

```
Decision needed before apply: No
Chained PRs recommended: Yes
400-line budget risk: High
```

Recommendation: **four chained PRs, S1 → S2a → S2b → S3**, feature-branch chain (PR #1 targets the
tracker branch, each later PR targets the previous slice's branch). Each slice has an autonomous
scope, its own verification, and a clean revert: S1 is a pure refactor with no behaviour change and
is independently valuable; S2a is schema-only and unreachable from any code path until S2b; S2b adds
a service with no call site; S3 is the only slice that changes observable API behaviour. Test lines
dominate the forecast (56%) because strict TDD is enabled and the D1 guarantee needs real Postgres to
be proven at all.

## Open Questions

- [ ] **ADR-0012 rule 5 cannot be satisfied by this change, and the proposal's success criterion
      "Recording a `movimiento` produces zero `auditoria` rows and vice versa" is therefore not
      achievable in v1.** Verified: `schema.ts` has only `usuarios` and `sesiones` — no
      `movimientos`, no `productos.stock_minimo`. D15 ships the enforceable half now (the
      no-quantity signature test) and defers the two literal boundary tests to #5/#6. The
      orchestrator should reconcile this with `sdd-spec`, which is drafting the same criteria in
      parallel: either the criterion is restated as a tracked obligation, or #2.2 stays open until
      #5 lands. Recommendation: restate it.
- [ ] Confirm `drizzle-kit@0.31` emits the D7 CHECK into `0002_*.sql`. `check()` is exported from
      `drizzle-orm/pg-core` (verified, `checks.d.ts:18`), but if generation omits it the migration
      needs one hand-added line — decide during S2a, do not skip the constraint.
- [ ] `entidad_id` is `uuid`, but `sesiones.id` is `text` (ADR-0011's stated exception). Sessions are
      therefore permanently unauditable through this table. That is correct for v1 — a session is
      not a domain entity — but it means "who revoked this session" has no home. Raise it if #3
      wants it.
- [ ] The `run` callback gives services no access to the raw executor by design (D1). If a future
      item needs a savepoint or an advisory lock, `UnitOfWork` grows a second method rather than
      leaking `tx`. Noted so the first person who needs one does not widen the port casually.
