# Tasks: Gestión de Usuarios (backlog #3)

Eight seams in dependency order, refining `design.md`'s four-seam split (S1→S2→S3→S4) after
validating each against the 400-line budget: S2 splits into **S2a** (CRUD) / **S2b** (guard +
session revocation, isolated because its proof is a real-Postgres concurrency test); S3 splits
into **S3a** (generator + errors, standalone) / **S3b** (service, needs S2a+S2b); S4 splits into
**S4a** (read routes) / **S4b1** (create + password-reset, temp-password flows) / **S4b2** (update
+ deactivate + reactivate, guard-adjacent flows). This is `sdd-tasks`' own forecast, not
`design.md`'s — see Review Workload Forecast at the end for the reasoning and the numbers.

Chain order: S1 → S2a → S2b → S3a → S3b → S4a → S4b1 → S4b2. Each targets `main` directly
(`stacked-to-main`). `app.test.ts:38`'s `satisfies UsuariosRepo` fake, plus every other consumer
fake (`auth/service.test.ts`, `routes/auth.test.ts`, `plugins/auth.test.ts`,
`plugins/repos.test.ts`), must gain one line per new `UsuariosRepo` member in the same slice that
adds it — carried explicitly in S2a/S2b's task list and forecast, per D1's correction.

Threat Matrix: every row is N/A (no doc classification, VCS, shell/subprocess, or PR-automation
boundary is touched anywhere in this change) — no dedicated RED task is required for it.

## Phase 1: S1 — Repository Relocation (import-only, zero behaviour change)

- [x] 1.1 GREEN (mechanical move, no new test — D1) Create `apps/api/src/usuarios/repository.ts`:
      move `Usuario`, `LockoutResult`, `UsuariosRepo`, `DrizzleUsuariosRepo` verbatim from
      `apps/api/src/auth/repository.ts`
- [x] 1.2 GREEN `apps/api/src/auth/repository.ts` — keep `NuevaSesion`/`SesionesRepo`/
      `DrizzleSesionesRepo` only; import `Usuario` from `../usuarios/repository.js`
- [x] 1.3 GREEN `apps/api/src/auth/service.ts`, `apps/api/src/plugins/auth.ts`,
      `apps/api/src/plugins/repos.ts` — update import paths only; `Repos`/`buildRepos` shapes
      unchanged
- [x] 1.4 GREEN update import paths only (no assertion changes) in `auth/service.test.ts`,
      `auth/repository.test.ts`, `plugins/repos.test.ts`, `plugins/auth.test.ts`,
      `routes/auth.test.ts`, `app.test.ts` — green with zero assertion diff is the proof the move
      is behaviour-neutral. Also updated `auth/repository.integration.test.ts` (not listed above
      but required: it imports `DrizzleUsuariosRepo` from `./repository.js`, and `tsconfig.json`'s
      `include: ["src"]` means `pnpm typecheck` compiles it too)
- [x] 1.5 Verify: `pnpm -r test`, `pnpm typecheck`, `pnpm lint`, `pnpm contract:check`
      (byte-identical — no route touched)

## Phase 2: S2a — CRUD Repository Methods (TDD + integration)

Satisfies spec: *Email Uniqueness and Normalization*, *List Users*, *Get User by Id*, *Update User
Profile*. Design refs: D9, D15, D16 (naming), D17.

- [x] 2.1 GREEN `apps/api/src/usuarios/repository.ts` — add `UsuarioResumen`, `NuevoUsuario`,
      `CambiosUsuario` (D15's no-hash projection, D8's no-plaintext-field shape)
- [x] 2.2 GREEN extend `UsuariosRepo` interface: `list`, `findById`, `findByIdForUpdate`, `create`,
      `update`, `setActivo`, `resetPassword`
- [x] 2.3 RED `apps/api/src/usuarios/repository.integration.test.ts` (new, Docker PG) — `list`
      paginates/totals correctly and stays stable across `creado_en` ties (D17); `list`/`findById`/
      `findByIdForUpdate` rows have no `hashContrasena` key (D15); duplicate email on `create`/
      `update` surfaces `EMAIL_ALREADY_IN_USE`, not a raw pg error (D9); `resetPassword` sets the
      flag and clears `intentos_fallidos`/`bloqueado_hasta` in one statement (D11); `setActivo`
      leaves both counters untouched on reactivate (D11)
- [x] 2.4 GREEN `apps/api/src/usuarios/repository.ts` — implement `list`/`findById`/
      `findByIdForUpdate`/`create`/`update`/`setActivo`/`resetPassword`; 23505 → `emailAlreadyInUse`
      mapping on `create`/`update` (D9); emails normalized `trim().toLowerCase()` on every write
- [x] 2.5 GREEN widen every `UsuariosRepo` fake by one line per new method (D1 correction — real
      cost, must ship in this slice): `app.test.ts`, `auth/service.test.ts`, `routes/auth.test.ts`,
      `plugins/auth.test.ts`, `plugins/repos.test.ts`
- [x] 2.6 Verify: `pnpm -r test`, `pnpm test:integration`, `pnpm typecheck`, `pnpm lint`,
      `pnpm contract:check` (byte-identical)

**S2a outcome notes (2026-08-28):**

- **2.5 landed in one file, not five.** Only `app.test.ts` needed widening. The other four fakes
  (`auth/service.test.ts`, `routes/auth.test.ts`, `plugins/auth.test.ts`, `plugins/repos.test.ts`)
  use `as UsuariosRepo`, and a cast absorbs a widened interface silently — `pnpm typecheck` is
  green without touching them. Adding seven throwing stubs to each would have been 28 lines no
  type checker asked for. `satisfies` in `app.test.ts` is what caught the widening, which is the
  point D1's correction was making; the four `as` fakes are the latent problem, and converting
  them is its own decision, not S2a's.
- **Drizzle wraps driver errors.** `DrizzleQueryError` carries the `pg` error on `.cause`, so a
  top-level `.code` read finds no SQLSTATE. The first GREEN run had `isUniqueViolation` reading
  only the top level, which would have turned every duplicate email into a 500 instead of a 409.
  The D9 integration tests caught it; `isUniqueViolation` now walks a bounded `cause` chain.
- **The D17 tie test was decoration and was rewritten.** As first written it asserted only
  "no overlap, no gap, same set", which passes with no tiebreaker at all — a five-row seq scan is
  incidentally stable across three OFFSET queries, so the set is identical either way and only the
  ORDER differs. It now fixes five ascending ids and asserts the exact descending sequence.
  Verified: dropping `desc(usuarios.id)` fails it. Five mutations run against S2a, five caught.

## Phase 3: S2b — Last-Encargado Guard + Session Revocation (TDD + integration, real concurrency)

Satisfies spec: *Last-Active-Encargado Guard* (all three scenarios). Design refs: D2, D3, D10.
The guard's race-safety is only provable against real Postgres — no unit test can substitute.

- [x] 3.1 GREEN `apps/api/src/usuarios/repository.ts` — add `lockActiveEncargados(): Promise<string[]>`
      to `UsuariosRepo`
- [x] 3.2 GREEN `apps/api/src/auth/repository.ts` — add `deleteAllForUser(usuarioId): Promise<void>`
      to `SesionesRepo` (D10; distinct from `deleteOthers`, revokes every session including the
      caller's — there is no caller-owned session to preserve on an admin action)
- [x] 3.3 RED `apps/api/src/usuarios/guard.integration.test.ts` (new, Docker PG, two real
      transactions on separate pooled connections) — with exactly two active encargados, two
      simultaneous deactivates leave exactly one, the other raises the guard error; same for
      deactivate-A ∥ demote-B; the documented negative: the rejected `EXISTS`-subquery UPDATE run
      in the same harness leaves zero active encargados (spec: *Concurrent requests cannot both
      succeed*)
- [x] 3.4 GREEN `apps/api/src/usuarios/repository.ts` — implement
      `select id from usuarios where rol='encargado' and activo=true order by id for update` (D2)
- [x] 3.5 RED extend `apps/api/src/auth/repository.integration.test.ts` — `deleteAllForUser` removes
      every session of the target and none of any other user
- [x] 3.6 GREEN `apps/api/src/auth/repository.ts` — implement `deleteAllForUser`
- [x] 3.7 GREEN widen `UsuariosRepo`/`SesionesRepo` fakes by one line each for the two new methods
      (same five/four consumer files as 2.5)
- [x] 3.8 Verify: `pnpm -r test`, `pnpm test:integration` (`fileParallelism: false` — the race needs
      two live connections and no other file truncating `usuarios` underneath it), `pnpm typecheck`,
      `pnpm lint`, `pnpm contract:check`

**S2b outcome notes (2026-08-28):**

- **The documented negative passed on the first run, before any of my code existed.** It is raw SQL
  on two pooled connections, so it depends on nothing in `UsuariosRepo` — which is the point. It
  records that the rejected `EXISTS`-subquery UPDATE really does leave zero active encargados, and
  it would keep recording that even if the guard were deleted.
- **Interleaving is proved, not timed.** `waitForBlockedLock()` polls `pg_locks where not granted`
  until a backend is genuinely blocked, so T2 provably holds a waiting lock request before T1
  commits. A `sleep` would make the interleaving likely; this makes it observed.
- **Two tests were added that the task list did not ask for, because mutation testing found the
  guard fails OPEN without them.** Dropping `rol = 'encargado'` from the lock predicate killed no
  test: every fixture here was all-encargado, so the filter was a no-op. But active `deposito`
  rows padding the locked set means `locked` minus the target is non-empty, nothing throws, and
  the last encargado is deactivated. Added *trips for the last encargado even when active deposito
  users exist* and its mirror for an inactive encargado. Verified: both mutations now fail.
- **3.7 landed in one file again**, for the same reason as 2.5 — `app.test.ts`'s `satisfies` is the
  only fake the compiler holds to the widened ports.
- Five mutations run against S2b; after the two added tests, five caught.

## Phase 4: S3a — Temp-Password Generator + Error Factories (TDD, no service dependency)

Satisfies spec: *User Creation With Temporary Password* (generation half). Design refs: D7, D14.

- [x] 4.1 RED `apps/api/src/usuarios/temp-password.test.ts` (new) — exactly 16 symbols; every symbol
      is in the 32-char Crockford alphabet and none is `I`/`L`/`O`/`U`; 1000 draws are distinct;
      `randomBytes` is called with 10 and `Math.random` is never called (spy)
- [x] 4.2 GREEN `apps/api/src/usuarios/temp-password.ts` (new) — `TEMP_PASSWORD_ALPHABET`,
      `TEMP_PASSWORD_LENGTH`, `generateTempPassword()`; 80 bits → 16 × 5-bit symbols (D7)
- [x] 4.3 RED extend `apps/api/src/lib/errors.test.ts` — `userNotFound()` → 404
      `USER_NOT_FOUND`; `emailAlreadyInUse()` → 409 `EMAIL_ALREADY_IN_USE`; `lastActiveEncargado()`
      → 409 `LAST_ACTIVE_ENCARGADO` (D14)
- [x] 4.4 GREEN `apps/api/src/lib/errors.ts` — add the three factories
- [x] 4.5 Verify: `pnpm -r test`, `pnpm typecheck`, `pnpm lint`, `pnpm contract:check`
      (byte-identical)

## Phase 5: S3b — Usuarios Service (TDD, needs S2a + S2b + S3a)

Satisfies spec: *User Creation*, *Update User Profile*, *Logical Deactivation*, *Reactivation*,
*Admin-Initiated Password Reset*, *Audit Obligation Per Mutation*, *Atomic Rollback on Guard Trip
or Audit Failure*, *Locked Account Is Rescuable By Reset*, *No State Change Writes Nothing*.
Design refs: D3–D6, D8, D11, D12.

- [x] 5.1 RED `apps/api/src/usuarios/service.test.ts` (new, stub repos + `{ run: (work) =>
      work(stubs) }`) — create passes a hash and no plaintext-bearing key to the repo, returned
      `passwordTemporal` never equals any repo argument (D8); `debeCambiarPassword: true` on
      create; `crear` audit has `datosPrevios === null` and no `hashContrasena` (D7); guard throws
      `LAST_ACTIVE_ENCARGADO` when the locked set minus target is empty, passes at size 2 (D2/D3);
      guard NOT consulted for create/reactivate/promote/name-edit (D3); empty diff → no write, no
      audit, 200 (D5); already-inactive deactivate → no write, no audit, guard not consulted (D5);
      reset calls `deleteAllForUser`, never `deleteOthers`, audit is `cambiar_password` with the
      three-key snapshot (D12); every mutation's repo calls occur inside one `run`
- [x] 5.2 GREEN `apps/api/src/usuarios/service.ts` (new) — `listUsuarios`, `getUsuario`,
      `createUsuario`, `updateUsuario`, `setUsuarioActivo`, `resetUsuarioPassword`; hashing/
      generation outside `uow.run`, guard+write+`recordAudit` inside (D6); `changedFields` diff
      helper (D5)
- [x] 5.3 Verify: `pnpm -r test`, `pnpm typecheck`, `pnpm lint`, `pnpm contract:check`
      (byte-identical — no route yet)

**S3b outcome notes (2026-08-28):**

- **D12 asked for a snapshot the port could not produce.** The reset audit needs the PRIOR
  `intentosFallidos`/`bloqueadoHasta`, but `UsuarioResumen` omits both on purpose (D15) and
  `UPDATE … RETURNING` hands back the new values, not the old. Closed with one narrow repo read,
  `findLockoutState(id): Promise<LockoutResult | undefined>`, taken inside the transaction under
  the row lock already held. Rejected widening `UsuarioResumen`, which would push lockout counters
  into every route DTO for the sake of one audit row.
- **The already-inactive deactivate still takes the set lock.** D3 decides the lock from the
  REQUEST SHAPE before the target is read, deliberately over-locking rather than inverting the
  lock order. What the already-inactive row changes is the GUARD, which needs `previo.activo` and
  so never trips. The test asserts both halves, because "guard not consulted" and "lock not taken"
  are different claims and only the first one is true.
- **The email diff normalizes in the service as well as the repo.** The repo normalizes on write
  (D9), but the DIFF has to compare what will actually be stored — otherwise `ANA@EXAMPLE.COM`
  over `ana@example.com` reads as a change and files a write plus an audit row for a value the
  database already holds.
- **`toMatchObject` cannot test a changed-fields-only snapshot.** Mutation P8 replaced
  `datosPrevios: diff.before` with the whole row and killed no test, because a subset match passes
  on a superset. The audit-snapshot assertions are now `toEqual` on `datosPrevios`/
  `datosPosteriores` directly. Verified: P8 now fails.
- **Harness options instead of `mockResolvedValue`.** Overriding a spy's implementation also
  replaces the call recording that lives inside it, so an overridden spy drops out of the ordering
  log and the transaction-discipline assertions go blind. Caught by the ordering test itself.
- Eight mutations run against S3b; after tightening the snapshot assertions, eight caught.

## Phase 6: S4a — Read Routes: List + Get (TDD + contract)

Satisfies spec: *Role Gate on Every User-Management Route* (partial), *List Users (Paginated)*,
*Get User by Id*. Design refs: D15–D17.

- [ ] 6.1 RED `apps/api/src/routes/usuarios.test.ts` (new, `buildApp({ repos, uow, cookieSecret })`
      + `inject`) — `deposito` → 403 and unauthenticated → 401 on `GET /api/usuarios` and
      `GET /api/usuarios/:id`; default pagination shape; explicit `?page&pageSize` echoed; unknown
      `:id` → 404 `USER_NOT_FOUND`
- [ ] 6.2 GREEN `apps/api/src/routes/usuarios.ts` (new) — `usuarioResumenDto` (own DTO, not
      `auth.ts`'s, per D16); `GET /api/usuarios` (`pageQuerySchema` + `paginated()` verbatim, D17)
      and `GET /api/usuarios/:id`; both `config: { roles: ['encargado'] }`, reads via `app.repos`
      not `uow` (D17)
- [ ] 6.3 GREEN `apps/api/src/app.ts` — `app.register(usuariosRoutes, { prefix: '/api' })` after
      `authPlugin`
- [ ] 6.4 RED `apps/api/src/routes/usuarios.integration.test.ts` (new, real app + Docker PG) — list
      and get against seeded users, no `hash_contrasena` field in any response
- [ ] 6.5 GREEN — confirm 6.4 passes against 6.2/6.3
- [ ] 6.6 Run `pnpm contract` to regenerate `openapi.json`/`schema.d.ts` for these two paths
      (generated, exempt from TDD and from the authored-line count)
- [ ] 6.7 Verify: `pnpm -r test`, `pnpm test:integration`, `pnpm typecheck`, `pnpm lint`,
      `pnpm contract:check`

## Phase 7: S4b1 — Create + Password-Reset Routes (TDD + contract, integration)

Satisfies spec: *User Creation With Temporary Password*, *Duplicate email on create*, *Admin-
Initiated Password Reset* (both scenarios), *Locked Account Is Rescuable By Reset*. Design refs:
D7, D8, D11, D12.

- [ ] 7.1 RED extend `apps/api/src/routes/usuarios.test.ts` — `deposito` → 403, unauthenticated →
      401 on `POST /api/usuarios` and `POST /api/usuarios/:id/password-reset`; `passwordTemporal`
      present in both 201/200 bodies and absent from every other response body; `Cache-Control:
      no-store` on both
- [ ] 7.2 GREEN `apps/api/src/routes/usuarios.ts` — `usuarioConPasswordDto` (disjoint from
      `usuarioResumenDto`, D8); `POST /api/usuarios` and `POST /api/usuarios/:id/password-reset`;
      `reply.header('Cache-Control', 'no-store')` on both
- [ ] 7.3 RED extend `apps/api/src/routes/usuarios.integration.test.ts` — create → login with the
      returned temporary password → `GET /api/usuarios` returns 403
      `PASSWORD_CHANGE_REQUIRED` → `POST /auth/password` clears it; a reset on a locked account
      lets that account log in immediately (D11); exactly one `auditoria` row per mutation
      (`crear`, `cambiar_password`) with no `hash_contrasena` in either snapshot; admin reset kills
      every session of the target while the actor's own session still resolves (D10); a forced
      audit-insert failure leaves the user row and sessions unchanged, returns 500
      `AUDIT_WRITE_FAILED`
- [ ] 7.4 GREEN — confirm 7.3 passes against 7.2
- [ ] 7.5 Run `pnpm contract` to regenerate for these two paths
- [ ] 7.6 Verify: `pnpm -r test`, `pnpm test:integration`, `pnpm typecheck`, `pnpm lint`,
      `pnpm contract:check`

## Phase 8: S4b2 — Update + Deactivate + Reactivate Routes (TDD + contract, integration)

Satisfies spec: *Update User Profile and Role*, *Logical Deactivation*, *Reactivation*, *Last-
Active-Encargado Guard* (route-level), *No State Change Writes Nothing*, *PATCH Rejects an
`activo` Key*. Design refs: D4, D5, D13.

- [ ] 8.1 RED extend `apps/api/src/routes/usuarios.test.ts` — `deposito` → 403, unauthenticated →
      401 on `PATCH /api/usuarios/:id`, `POST .../deactivate`, `POST .../reactivate`; `PATCH` with
      an `activo` key → 400 `VALIDATION_ERROR` before any handler runs; `PATCH` with `{}` → 400
      (D13)
- [ ] 8.2 GREEN `apps/api/src/routes/usuarios.ts` — `PATCH /api/usuarios/:id` (Zod body rejects
      `activo`, requires ≥1 of `nombre`/`email`/`rol`), `POST .../deactivate`,
      `POST .../reactivate`
- [ ] 8.3 RED extend `apps/api/src/routes/usuarios.integration.test.ts` — successful update/
      deactivate/reactivate each produce one correctly-verbed `auditoria` row; deactivate makes the
      target's next request with its old session cookie 401; deactivating/demoting the last
      encargado → 409 `LAST_ACTIVE_ENCARGADO`, row unchanged, no audit row; already-inactive
      deactivate and unchanged `PATCH` → 200, no write, no audit row (D5)
- [ ] 8.4 GREEN — confirm 8.3 passes against 8.2
- [ ] 8.5 Run `pnpm contract` to regenerate for the remaining three paths — all seven routes now
      present, `openapi.json`/`schema.d.ts` complete for `user-management`
- [ ] 8.6 Verify: `pnpm -r test`, `pnpm test:integration`, `pnpm typecheck`, `pnpm lint`,
      `pnpm contract:check`

## Phase 9: Bookkeeping

- [ ] 9.1 Before merging each PR except the last, `gh pr edit <next-pr-number> --base main` — GitHub
      does not auto-retarget a stacked PR when its base merges (verified precedent:
      `auditoria-general`); delete a merged branch only after confirming the retarget landed
- [ ] 9.2 Mark checkboxes complete as each of the eight PRs merges to `main`
- [ ] 9.3 No `.env*` change and no new environment variable for this change (`DATABASE_URL`/
      `COOKIE_SECRET` are the only inputs) — confirm no manual user step is needed before S4a merges

## Review Workload Forecast

Estimated changed lines (authored, excluding generated `openapi.json` / `schema.d.ts`): 2110
Chained PRs recommended: Yes
400-line budget risk: High
Decision needed before apply: Yes

| Slice | Source | Tests | Total | Over 400? |
|---|---|---|---|---|
| S1 — repository relocation | ~190 | ~20 | ~210 | No |
| S2a — CRUD repository methods | ~140 | ~200 | ~340 | No |
| S2b — guard + session revocation | ~35 | ~150 | ~185 | No |
| S3a — temp-password + error factories | ~60 | ~70 | ~130 | No |
| S3b — usuarios service | ~170 | ~210 | ~380 | No |
| S4a — read routes (list + get) | ~75 | ~130 | ~205 | No |
| S4b1 — create + password-reset routes | ~90 | ~240 | ~330 | No |
| S4b2 — update/deactivate/reactivate routes | ~90 | ~240 | ~330 | No |
| **Chain total** | **~850** | **~1260** | **~2110** | **Yes** |

Divergence from `design.md`'s ~1250 estimate is deliberate, not a rounding difference: (1) the
D1-correction stub-widening cost (one line per new `UsuariosRepo`/`SesionesRepo` member across up
to five consumer fakes) is now explicit line-item work in S2a/S2b rather than folded into "source";
(2) splitting the original S2/S3/S4 seams surfaces integration-test weight — `guard.integration.
test.ts`'s two-real-connection race test and `routes/usuarios.integration.test.ts`'s full-flow
assertions — that a single combined slice's total obscured. Every individual slice still lands
under 400, which is the property the split exists to guarantee; the chain total crossing 400 is
expected and is exactly what `stacked-to-main` exists to absorb.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| S1 | Move `Usuario`/`UsuariosRepo`/`DrizzleUsuariosRepo` to `usuarios/` | PR 1 | `pnpm --filter @inventienda/api test` | N/A — import-only, no behaviour change | revert `usuarios/repository.ts` creation and the five import-path edits |
| S2a | CRUD repo methods (`list`/`findById`/`create`/`update`/`setActivo`/`resetPassword`) | PR 2 | `pnpm --filter @inventienda/api test` then `test:integration` | Docker Postgres (D9/D15/D17 proofs) | revert new `UsuariosRepo` methods and the fake-stub widening; S1 unaffected |
| S2b | `lockActiveEncargados` guard SQL + `SesionesRepo.deleteAllForUser` | PR 3 | `pnpm --filter @inventienda/api test` then `test:integration` (`fileParallelism: false`) | Docker Postgres, two real concurrent connections (D2 race proof) | revert both methods and `guard.integration.test.ts`; S2a's CRUD stays usable without the guard |
| S3a | `generateTempPassword()` + three error factories | PR 4 | `pnpm --filter @inventienda/api test` | N/A — pure functions, no DB | revert `usuarios/temp-password.ts` and the three `lib/errors.ts` factories |
| S3b | `usuarios/service.ts` business rules | PR 5 | `pnpm --filter @inventienda/api test` | N/A — stub repos, no route reachable yet | revert `usuarios/service.ts`; S2a/S2b/S3a unaffected |
| S4a | `GET /api/usuarios`, `GET /api/usuarios/:id` | PR 6 | `pnpm --filter @inventienda/api test` then `test:integration` | Docker Postgres + real app (`inject`) | revert the two routes and the `app.ts` registration; `pnpm contract` to restore prior `openapi.json` |
| S4b1 | `POST /api/usuarios`, `POST /api/usuarios/:id/password-reset` | PR 7 | `pnpm --filter @inventienda/api test` then `test:integration` | Docker Postgres + real app, full create→login→change-password flow | revert the two routes; `pnpm contract` to restore prior `openapi.json` |
| S4b2 | `PATCH /api/usuarios/:id`, deactivate, reactivate | PR 8 | `pnpm --filter @inventienda/api test` then `test:integration` | Docker Postgres + real app, guard-trip and no-op assertions | revert the three routes; `pnpm contract` to restore prior `openapi.json`; feature fully reachable only after this PR |

## PR Grouping — DECIDED (user, 2026-08-27) — supersedes "Suggested Work Units" above

The eight slices above remain the **implementation order** and the dependency chain. They are NOT
eight pull requests. The user reviewed the eight-PR forecast and chose **three PRs**, cut by where
risk actually sits rather than by line count, explicitly accepting `size:exception` for PR2 and PR3.

| PR | Slices | Lines | Why this is a checkpoint worth having |
|---|---|---|---|
| **PR1 — the move** | S1 | ~210 | Touches auth files. Purely mechanical: if CI is green it is demonstrably behaviour-neutral, which is exactly the property that stops a security-sensitive relocation from hiding a real change |
| **PR2 — the logic** | S2a, S2b, S3a, S3b | ~1035 | Carries the `FOR UPDATE` guard and its two-connection race proof — the first real concurrency in this codebase. None of it is reachable over HTTP yet, so a defect here has no exposed surface |
| **PR3 — the surface** | S4a, S4b1, S4b2 | ~865 | The only PR with a contract diff. Where the change becomes observable |

`delivery_strategy` for this change is therefore **`exception-ok`**, not `ask-on-risk`: the user was
asked, and accepted the two over-budget PRs.

**Why not eight**: the 400-line budget serves *review*, and review is not the binding constraint
here — the user merges on green CI rather than reading line by line. What splitting actually buys is
**known-good states to return to**, and that value is concentrated in two places (the auth-file move,
and the guard), not spread evenly across eight. Eight PRs would also mean eight manual base
retargets, and a base branch deleted while dependents are open *closes* them — an operational risk
that scales with chain length and bought nothing here.

**Why not one**: a single PR has genuine advantages that were weighed, not dismissed — zero semantic-
conflict risk (the failure class that broke `main` on 2026-08-26, where two independently green
branches did not compile together) and zero retargeting. It was rejected because it leaves exactly
one checkpoint, at the end: if the guard's race proof needs another approach, isolating it must not
mean unwinding 2000 lines.

**Ledger note**: `--max-changed-lines` counts RAW diff lines, not authored. PR3 regenerates
`openapi.json` and `schema.d.ts`, so its raw count will exceed its ~865 authored lines by a wide
margin. Acquire PR3's attempt with a cap set against the RAW expectation, or it will block on a
false positive as S2a of `auditoria-general` did.

### Decision status
```
Decision needed before apply: RESOLVED
Chain: 3 PRs, stacked-to-main
delivery_strategy: exception-ok (size:exception accepted for PR2 and PR3)
```
