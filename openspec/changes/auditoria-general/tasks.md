# Tasks: Sistema de Auditoría General (backlog #2.2)

Four seams in dependency order (`design.md`): S1 → S2a → S2b → S3. S2a needs S1 (migration
coexistence only); S2b needs S1+S2a; S3 needs all three. No route file changes anywhere except S3's
one call expression — `openapi.json`/`schema.d.ts` stay byte-identical, so `pnpm contract:check` is
green in every slice (D16).

**Delivery note (verified this session):** GitHub does **not** auto-retarget a stacked PR when its
base PR merges, and deleting the base branch closes the dependent PR. Before merging each PR in the
chain except the last, run `gh pr edit <next-pr-number> --base main` first, then merge, then delete
the merged branch only after confirming the retarget landed.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~720 (S1 ~155, S2a ~145, S2b ~270, S3 ~150) |
| 400-line budget risk | High (chain total), Low per slice |
| Chained PRs recommended | Yes |
| Suggested split | S1 → S2a → S2b → S3 |
| Delivery strategy | ask-on-risk |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| S1 | `DbExecutor` type, `buildRepos(executor)`, `UnitOfWork`/`app.uow` | PR 1 | `pnpm --filter @inventienda/api test` then `test:integration` | Docker Postgres (D1 rollback proof) | revert `db/client.ts` type, `db/uow.ts`, `auth/repository.ts` ctor sig, `plugins/repos.ts` factory |
| S2a | `auditoria` table + migration + field classification | PR 2 | `pnpm --filter @inventienda/api test` | N/A — schema-only, unreachable from any code path | revert `db/schema.ts` additions, drop `drizzle/0002_*`, delete `auditoria/fields.ts` |
| S2b | `AuditoriaRepo` + `recordAudit` service + error factory | PR 3 | `pnpm --filter @inventienda/api test` then `test:integration` | Docker Postgres (CHECK, indexes, FK) | delete `auditoria/repository.ts`, `auditoria/service.ts`, revert `lib/errors.ts` factory, revert `Repos.auditoria` |
| S3 | `changePassword` transactional + audit row | PR 4 | `pnpm --filter @inventienda/api test` then `test:integration` | Docker Postgres + real argon2, real app | revert `auth/service.ts` `changePassword` signature, revert `routes/auth.ts` call expression |

## Phase 1: S1 — Transaction Seam (TDD + integration)

Maps to: *Atomic Write With the Business Operation* (`record-audit-trail` spec, D1). No `Repos`
member changes observable yet.

- [x] 1.1 GREEN (config, no test) `apps/api/src/db/client.ts` — add `export type DbExecutor = Db | Parameters<Parameters<Db['transaction']>[0]>[0]` (D2)
- [x] 1.2 GREEN `apps/api/src/auth/repository.ts` — change both repo constructors from `Db` to `DbExecutor`; no behavior change
- [x] 1.3 RED: extend `apps/api/src/plugins/repos.test.ts` — `buildRepos(executor)` returns every member of `Repos`; injected fakes still win; `app.uow` decorator present and overridable
- [x] 1.4 GREEN `apps/api/src/plugins/repos.ts` — `buildRepos(executor)` factory replaces the object literal; `uow` decorator + `ReposPluginOptions.uow` (D1)
- [x] 1.5 GREEN `apps/api/src/db/uow.ts` (new) — `UnitOfWork` interface (`run<T>(work: (repos: Repos) => Promise<T>): Promise<T>`) + `createUnitOfWork(db)` wrapping `db.transaction(tx => work(buildRepos(tx)))` (D1)
- [x] 1.6 RED `apps/api/src/db/uow.integration.test.ts` (new, Docker Postgres) — a `run` whose second write throws leaves zero rows from the first write; documented negative: a repo built from `getDb()` and used inside `run` is NOT rolled back
- [x] 1.7 GREEN — confirmed against the real `db.transaction`; no production code needed beyond 1.4/1.5. **Executed once the user started Docker**: both cases pass against real Postgres (`rolls back every write made through the transaction-bound repos when the callback throws` 129ms; `does NOT roll back a write made through a repo built from getDb()` 76ms). **Proven load-bearing**: replacing `db.transaction((tx) => work(buildRepos(tx)))` with `work(buildRepos(db))` fails BOTH cases — the rollback assertion and the documented negative. The D1 guarantee is therefore dynamically proven, not merely typechecked
- [x] 1.8 MANUAL — resolved. Full integration suite green with Docker Postgres up: **15/15 across 4 files** (was 13/3 before this slice). Note `pnpm db:migrate` fails in an agent's hands (`drizzle-kit` needs `DATABASE_URL` from a `.env*` file, which tooling must not touch) — it was not needed here because the container volume already held the schema, and `apps/api/vitest.integration.config.ts` carries its own connection string inline
- [x] 1.9 Verify on the PR branch: `pnpm lint`, `pnpm typecheck`, `pnpm contract:check` (byte-identical — no route file touched), `pnpm -r test`

## Phase 2: S2a — Table + Field Classification (TDD, schema-only)

Maps to: *Audit Row Identity and Snapshot Shape*, *Sensitive-Field Denylist* (`record-audit-trail`
spec, D7/D9/D10/D11/D12/D13). Unreachable from any code path until S2b — no runtime harness needed.

- [x] 2.1 GREEN (config, no test) `apps/api/src/db/schema.ts` — add `accionAuditoria` pgEnum (`crear`, `actualizar`, `baja_logica`, `reactivar`, `cambiar_password`, D10) and `entidadAuditoria` pgEnum (`usuarios`, `proveedores`, `productos`, D9)
- [x] 2.2 GREEN (config, no test) `apps/api/src/db/schema.ts` — add `auditoria` table: `entidad_id uuid` no FK (ADR-0011), `usuario_id` FK `onDelete: 'restrict'` (D14), `datos_previos jsonb` nullable, `datos_posteriores jsonb NOT NULL`; two composite btree indexes `(entidad, entidad_id, creado_en)` and `(usuario_id, creado_en)` (D13); CHECK `(accion = 'crear') = (datos_previos IS NULL)` (D7)
- [x] 2.3 Ran `pnpm db:generate` — produced `apps/api/drizzle/0002_fat_whizzer.sql` + `meta/0002_snapshot.json` + updated `meta/_journal.json` (generated, exempt from TDD and from the authored-line count). No live DB connection was needed
- [x] 2.4 OPEN QUESTION resolved: read `0002_fat_whizzer.sql` directly — line 12 contains `CONSTRAINT "auditoria_datos_previos_solo_en_crear" CHECK (("auditoria"."accion" = 'crear'::accion_auditoria) = ("auditoria"."datos_previos" is null))`. drizzle-kit@0.31 emitted the D7 CHECK correctly; no hand-edit was needed
- [x] 2.5 RED `apps/api/src/auditoria/fields.test.ts` (new) — for `'usuarios'`, `auditableFields ∪ excludedFields === Object.keys(getTableColumns(usuarios))`; a stale/unclassified column name fails the assertion by name; `hashContrasena` is excluded (D11, D12). Confirmed RED first (`Cannot find module './fields.js'`), then GREEN after 2.6, then proved load-bearing by removing `'activo'` from `auditableFields` — failure named `[ 'activo' ]` exactly, then restored to GREEN
- [x] 2.6 GREEN `apps/api/src/auditoria/fields.ts` (new) — `FIELD_CLASSIFICATION` keyed per entity (`usuarios` classified now; `proveedores`/`productos` enum values exist per D9 but no classification entry required until #4/#5), global `hash_contrasena` denylist floor (D12)
- [x] 2.7 MANUAL — **DONE on both databases (2026-08-26)**. `drizzle/0002_fat_whizzer.sql` applied to the live Neon database by the user, confirmed in Neon's Tables view: `neondb` / schema `public` now lists `auditoria`, `sesiones`, `usuarios`. Deployment is unblocked ahead of S3.
      Two things worth carrying forward. **First: the run LOOKED like it failed and had not.** A `pg-connection-string` SSL deprecation warning overwrote the `[✓] migrations applied successfully!` line, so the console showed `applying migrations...` followed by a SECURITY WARNING and nothing else. The warning is benign (it announces that `sslmode=require` changes meaning in a future major) and had no effect on the migration. Verify in Neon's Tables view rather than trusting console output here.
      **Second: `pnpm` is not on the user's PowerShell PATH** — it lives in `C:\Users\User\.corepack-shims\`, which is not in the user PATH, while `node`/`npx` are on the system PATH. `npx drizzle-kit migrate` is the working equivalent (`db:migrate` is literally that command) and needs no pnpm. The migration was run with `$env:DATABASE_URL` set inline for the single command rather than by editing any `.env*` file, so nothing had to be reverted afterwards.
      Idempotence verified against the local database: a second `npx drizzle-kit migrate` left `drizzle.__drizzle_migrations` at 3 rows, applying nothing.
      **The LOCAL dev database is already migrated** (orchestrator, 2026-08-26): run with the connection string committed in `apps/api/vitest.integration.config.ts` (`postgres://inventienda:inventienda@localhost:5432/inventienda` — the docker-compose dev credentials, not a secret and not from `.env*`), so drizzle's journal recorded it properly and a later `db:migrate` will not double-apply. Verified in the container: `auditoria` exists with the CHECK, the `usuario_id` FK `ON DELETE RESTRICT`, and **no** FK on `entidad_id`.
      **The CHECK was proven load-bearing at the database level**, not just read in the DDL: inserting `accion = 'crear'` with a non-null `datos_previos` is rejected with `violates check constraint "auditoria_datos_previos_solo_en_crear"`. This is what unblocks S2b's integration tests
- [x] 2.8 Verify on the PR branch: `pnpm lint`, `pnpm typecheck`, `pnpm contract:check` (byte-identical), `pnpm -r test` — all exit 0 (see apply-progress for full output)

## Phase 3: S2b — Repository + Service (TDD + integration)

Maps to: *Audit Row Identity and Snapshot Shape*, *Sensitive-Field Denylist*, *No-Quantity Signature
and Movement Boundary* (`record-audit-trail` spec, D5/D6/D9/D14/D15). No call site yet.

- [x] 3.1 RED: extend `apps/api/src/lib/errors.test.ts` — `auditWriteFailed(cause?)` → 500 `AUDIT_WRITE_FAILED`, preserving `cause` (D5)
- [x] 3.2 GREEN `apps/api/src/lib/errors.ts` — add the `auditWriteFailed` factory to the shared envelope builder
- [x] 3.3 RED `apps/api/src/auditoria/service.test.ts` (new) — excluded fields never reach either snapshot; `crear` → `datosPrevios === null`, snapshot equals the whole created row (D7 exception); a repo throw becomes `AUDIT_WRITE_FAILED` preserving `cause`; `@ts-expect-error` on any quantity-shaped argument (D15, ADR-0012 rule 3 — the enforceable half; the two `movimientos` boundary tests are NOT written here, see Phase 5)
- [x] 3.4 GREEN `apps/api/src/auditoria/service.ts` (new) — `recordAudit`, `AuditableEntidad`/`AuditAccion`/`AuditEvent` types per the Interfaces section; filters the diff via `FIELD_CLASSIFICATION` (D6), wraps repo failures as `auditWriteFailed` (D5)
- [x] 3.5 RED `apps/api/src/auditoria/repository.integration.test.ts` (new, Docker Postgres) — migration applied: table + both indexes exist; CHECK rejects `crear` with non-null `datosPrevios`; all three `entidad` enum values insert (D9); the `usuario_id` FK rejects an unknown actor (D14)
- [x] 3.6 GREEN `apps/api/src/auditoria/repository.ts` (new) — `AuditoriaRepo` interface + `DrizzleAuditoriaRepo(executor: DbExecutor)` implementing `.record()`, reading `entidad_id` from the business `INSERT … RETURNING id` result inside the caller's transaction (D8)
- [x] 3.7 GREEN `apps/api/src/plugins/repos.ts` — add `auditoria` to `Repos` and `buildRepos()`
- [x] 3.8 Ran `pnpm test:integration` against Docker Postgres myself (agent-executed, not just left for the user — see apply-progress): confirmed 3.5, 5/5 files, 20/20 tests
- [x] 3.9 Verify on the PR branch: `pnpm lint`, `pnpm typecheck`, `pnpm contract:check` (byte-identical), `pnpm -r test` — all exit 0 (see apply-progress for full output)

## Phase 4: S3 — `changePassword` Reference Implementation (TDD + integration)

Maps to: *Change Password Endpoint* (MODIFIED, `password-change` spec, R1 — `deleteOthers` inside
the transaction). The only slice with observable API behavior change; **no schema or DTO change**.

- [ ] 4.1 RED: extend `apps/api/src/auth/service.test.ts` — wrong current password → `INVALID_CURRENT_PASSWORD`, no writes, no audit row; success → `updatePassword`, `deleteOthers`, `auditoria.record` called in that order, all inside one `uow.run`; a throwing audit stub propagates and the fake `run` (`{ run: (work) => work(stubRepos) }`) reports it did not commit
- [ ] 4.2 GREEN `apps/api/src/auth/service.ts` — `changePassword(uow, input)` replaces `changePassword(repos, input)`; `verifyPassword`/`hashPassword` stay outside the transaction (D3); `updatePassword` → `deleteOthers` → `auditoria.record` run inside `uow.run` (D1, D4, D8); snapshot `{ debeCambiarPassword: true }` → `{ debeCambiarPassword: false }` (D7 non-symmetric case)
- [ ] 4.3 GREEN `apps/api/src/routes/auth.ts` — one call expression: `changePassword(app.uow, { usuario, sessionId, currentPassword, newPassword })`; no schema/DTO change (D16)
- [ ] 4.4 RED: extend `apps/api/src/routes/auth.integration.test.ts` (Docker Postgres) — `POST /api/auth/password` writes exactly one `auditoria` row with no `hash_contrasena` in either snapshot; with the audit insert forced to fail, password unchanged, sessions NOT revoked, response is `500 AUDIT_WRITE_FAILED`
- [ ] 4.5 GREEN — confirm 4.4 passes against 4.2/4.3; no further production code expected
- [ ] 4.6 MANUAL (user, local verification — not executable by the agent). Run `pnpm test:integration` against Docker Postgres to confirm 4.4/4.5
- [ ] 4.7 Verify on the PR branch: `pnpm lint`, `pnpm typecheck`, `pnpm contract:check` (byte-identical — no route/schema change), `pnpm -r test`

## Phase 5: Deferred Obligations + Bookkeeping

- [x] 5.1 Do NOT attempt ADR-0012 rule 5's two literal `movimientos` boundary tests in this change —
      `schema.ts` has no `movimientos` table (R2). Restate the proposal's Success Criteria bullet
      as a tracked obligation on backlog #5/#6; this change does not stay open waiting for it.
      **Done during reconciliation, commit `51262dc`** — `proposal.md`'s Success Criteria now splits
      the enforceable half (no-quantity signature test) from the tracked obligation. Nothing left to
      do here; it stays listed so `sdd-verify` sees the deferral was deliberate, not forgotten
- [ ] 5.2 Bookkeeping: mark checkboxes complete as each PR (S1/S2a/S2b/S3) merges to `main`; the
      orchestrator advances `openspec/changes/auditoria-general/state.yaml` phase statuses
- [ ] 5.3 Before merging each PR except the last, retarget the next PR onto `main` with
      `gh pr edit <next-pr-number> --base main` — GitHub does not do this automatically, and
      deleting a merged base branch before retargeting closes the dependent PR
