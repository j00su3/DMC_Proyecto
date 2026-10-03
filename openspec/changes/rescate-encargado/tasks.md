# Tasks: Last-Encargado Rescue Procedure (`rescate-encargado`, closes D-02)

Inputs: `proposal.md`, `design.md` (D1-D8), `specs/encargado-rescue/spec.md`,
`specs/record-audit-trail/spec.md`. Strict TDD: every behaviour has a RED task before its GREEN
task. `[M]` = mutation probe: apply the named mutation, see the named test fail, revert, see green.

Shell note: in bash, run `export PATH="/c/Users/User/.corepack-shims:$PATH"` before any `pnpm`.
Never read, write or reference `.env*`; a new environment variable would be a manual step (none is
needed here).

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Delivery | 5 chained PRs, owner-ratified (PR 0 -> 1 -> 2 -> 3 -> 4) |
| Raw-diff budget | ~400 lines per PR, measured on the raw diff (tests, generated files, docs included) |
| Over budget | PR 0 (planning, needs `size:exception`); PR 2 (edge, see flag); PR 4 (edge, see flag) |

| PR | Content | Est. raw lines | Budget |
|----|---------|----------------|--------|
| 0 | `openspec/changes/rescate-encargado/` (proposal, design, 2 specs, this file) | ~700 + this file | OVER, docs-only, `size:exception` |
| 1 | D1 lazy key, D2 `origen` param, D3 export, `countActiveEncargados`, fake stubs, tests | ~230 (design 200 + ~30 for in-app no-marker integration guards) | OK |
| 2a | `rescate.ts`, unit tests (tasks 2.1-2.8) | ~410 measured | AT EDGE |
| 2b | real-Postgres integration test (tasks 2.9-2.17) | ~490 measured | OVER, test-only |
| 3 | script, its test, `package.json` entry | ~604 measured | OVER, `size:exception` (owner decision 2026-10-02: script and its unit tests ship together) |
| 4 | docs (Spanish) + `verify-report.md` + `claims-report.md` | ~130 docs + reports (~150-250, not sized by design) = ~280-380 | EDGE, flagged |

Flags:
- PR 2: if the diff exceeds ~400 after writing, move I7 (`countActiveEncargados` real-DB count) and
  the audit-endpoint readback case into PR 1 or a follow-up commit in PR 1's branch (design's own
  fallback was "move I7 and the repo test into PR 1"; the repo test is already in PR 1 here).
- PR 4: the two reports are not sized in design.md; measure the raw diff before opening.

---

## Phase 0: PR 0 - Planning artifacts

- [x] 0.1 Add `openspec/changes/rescate-encargado/tasks.md` to PR 0 (proposal, specs and design are already committed as f1fbe3a). Open PR 0 with an explicit `size:exception` note (docs-only). Satisfies: process only.

Gate 0: no code changed; nothing to run beyond `pnpm lint` (`biome ci .`) to confirm no stray file.

---

## Phase 1: PR 1 - Audit key, marker parameter, normalizeEmail, read-only port

Branch from PR 0. Behaviour-preserving for every existing caller.

### 1A. Lazy pseudonym key (D1)

- [x] 1.1 RED: `apps/api/src/auditoria/service.test.ts` - add cases A1-A7 using `vi.stubEnv('COOKIE_SECRET', undefined)` and `afterEach(() => vi.unstubAllEnvs())` (precedent: `vi.stubEnv` in `plugins/cookie.test.ts:16`). A1 reset-shaped `usuarios` snapshots without `email`, no key: resolves, `repo.record` receives them unchanged. A2 `email` string only in `datosPosteriores`: rejects `/COOKIE_SECRET must be set/`, `repo.record` not called. A3 same for `datosPrevios` only. A4 `crear` with a full created row: rejects, not recorded. A5 `email: null`, no key: resolves, `null` stored. A6 `COOKIE_SECRET=''` with string `email`: rejects. A7 `proveedores` event, no key: resolves. A1 and A5/A7 must be red against current code (A1 at least); A2-A4/A6 pass already and pin the invariant. Satisfies: record-audit-trail "Snapshot without a pseudonymized field records without the key", "Snapshot with an email still requires the key".
- [x] 1.2 RED: same file - add one keyed case: with a key available, a `usuarios` snapshot containing `email` stores the HMAC-pseudonymized value, not plaintext (value equals today's digest). Satisfies: "Snapshot with an email is pseudonymized as before". Existing six `pseudonymizeFields` tests (`:26-96`) and six `recordAudit` tests (`:98-215`) must stay green and untouched.
- [x] 1.3 GREEN: `apps/api/src/auditoria/service.ts` - add `pseudonymizeWith(data, fields, getKey)`; keep exported `pseudonymizeFields(data, fields, key)` signature as a wrapper; in `recordAudit` use `let key; const getKey = () => (key ??= resolvePseudonymKey())`; delete `hasPseudonymizedFields`, `pseudonymKey` and the `pseudonymKey && pseudonymizedFields ? ... : filtered` ternary. `resolvePseudonymKey` unchanged. Satisfies: record-audit-trail "Pseudonym Key Required Only When a Pseudonymized Field Is Present".
- [x] 1.4 Comment-only updates: `apps/api/src/auditoria/service.ts` (block around `:89-98`) and `apps/api/vitest.config.ts` (`:25-30`: "...whose snapshot carries `email`").
- [x] 1.5 [M] Mutation probes (revert each): (a) restore the eager `resolvePseudonymKey()` per entity -> A1 red; (b) make `getKey` fall back to a constant -> A2 red; (c) skip classification of `datosPrevios` -> A3 red. Record results in the PR description.

### 1B. `origen` marker parameter (D2) and export (D3)

- [x] 1.6 RED: `apps/api/src/usuarios/service.test.ts` (harness `:63-142`) - B1: two-argument `resetUsuarioPassword` call: `datosPosteriores` is `toEqual` the exact three-key object `{debeCambiarPassword: true, intentosFallidos: 0, bloqueadoHasta: null}` AND `not.toHaveProperty('origen')` (the existing `:449-474` test uses `toMatchObject` and would miss an extra key). B2: call with third arg `'rescate'`: `datosPosteriores.origen === 'rescate'`, `datosPrevios` has no `origen`. Satisfies: encargado-rescue "Rescue Audit Row and Origin Marker" (marker present only post-state), record-audit-trail "Operator-run action records the subject as actor with a marker".
- [x] 1.7 RED: same file - one test importing `normalizeEmail` from `./service.js` and asserting `normalizeEmail('  ANA@Example.COM ')` is `'ana@example.com'` (fails to compile/import until exported). Satisfies: encargado-rescue "Rescue Command Inputs" (normalized exactly as login).
- [x] 1.8 GREEN: `apps/api/src/usuarios/service.ts` - add optional third parameter `origen?: 'rescate'` to `resetUsuarioPassword` (`:277`) and conditional spread `...(origen !== undefined ? { origen } : {})` into `datosPosteriores` only; add `export` to `normalizeEmail` (`:61`, line-neutral). Do NOT touch `ResetUsuarioPasswordInput`, `datosPrevios`, `routes/usuarios.ts`, or `auditoria/fields.ts` (adding `origen` there would break `fields.test.ts`).
- [x] 1.9 [M] Mutation probes (revert each): (a) make the spread unconditional (`origen: origen`) -> B1 red; (b) drop the spread -> B2 red.
- [x] 1.10 Guard tests, in-app rows carry no marker, on real Postgres: extend `apps/api/src/routes/usuarios.integration.test.ts` - after `POST /api/usuarios/:id/password-reset` by an encargado on a deposito user, the `auditoria` row has no `origen` key in either snapshot and `usuario_id != entidad_id`. Self-service `POST /api/auth/password`: `routes/auth.integration.test.ts` drives it and checks its audit row but not the absence of `origen`, so add the case in `routes/usuarios.integration.test.ts` and assert no `origen` key. Both pass at once by construction; they pin the spec. Satisfies: encargado-rescue "In-app admin reset carries no marker", "Self-service change carries no marker"; record-audit-trail "In-app actions carry no origin marker".
- [x] 1.11 [M] Mutation probe (revert): in `routes/usuarios.ts` temporarily pass `'rescate'` as the third argument at `:235-238` -> 1.10 admin-reset test red. Revert (the file must end unedited).

### 1C. Read-only port `countActiveEncargados` (D5)

- [x] 1.12 RED: `apps/api/src/usuarios/repository.test.ts` - shape test for `countActiveEncargados()` (counts `rol='encargado'` and `activo`, returns a number; follow the file's existing adapter-test style). Real-DB case I7 is written in PR 2 against the integration harness. Satisfies: encargado-rescue "Other Active Encargado Notice" (inactive do not count).
- [x] 1.13 GREEN: `apps/api/src/usuarios/repository.ts` - append `countActiveEncargados(): Promise<number>` at the END of the `UsuariosRepo` interface and the Drizzle adapter class (`count(*)::int` where `rol='encargado' and activo`; plain SELECT, no `FOR UPDATE`; do not reuse `lockActiveEncargados`).
- [x] 1.14 Fake repos: run `pnpm typecheck`; every test double typed as the full `UsuariosRepo` fails. Add a one-line stub to each failing fake. `rg -l lockActiveEncargados apps/api/src` (2026-10-02) lists seven files: the port and its caller (`usuarios/repository.ts`, `usuarios/service.ts`) and five tests (`app.test.ts`, `routes/usuarios.test.ts`, `routes/ventas.test.ts`, `usuarios/service.test.ts`, and `usuarios/guard.integration.test.ts`, which uses the real repository); the real list is whatever typecheck reports (a past cycle broke ~18 test files by forgetting this). Repeat `pnpm typecheck` until clean. Also grep the repo for other implementers of `UsuariosRepo` (`rg "lockActiveEncargados" apps`) to catch fakes typecheck misses.

### Gate 1

- [x] 1.15 Gate: `pnpm -r test`, `pnpm typecheck`, `pnpm lint`, `pnpm contract:check` (expected byte-identical, no API change; if it reports drift, stage the regenerated artifacts and re-run before believing it), `pnpm test:integration` (needs `pnpm db:up`; `routes/usuarios.integration.test.ts` changed; the existing `:415-471` rollback test must stay green). Confirm the raw diff is within ~230 lines.

---

## Phase 2: PR 2 - `rescatarEncargado` core

Branch from PR 1.

**Split (owner decision, 2026-10-02):** the measured diff was 868 raw lines (93 code, 301 unit
tests, 474 integration tests), so PR 2 ships as two chained PRs: **PR 2a** carries tasks 2.1-2.8
(`rescate.ts` and its unit tests) and **PR 2b** carries tasks 2.9-2.17 (the integration test and
the gate). The cycle is now six PRs.

- [x] 2.1 RED: `apps/api/src/usuarios/rescate.test.ts` (new; fakes; a `uow` whose `run` throws if reached) - refusals: unknown email -> `{estado:'rechazado', motivo:'no_encontrado'}`; `rol='deposito'` -> `no_es_encargado`; `activo=false` encargado -> `inactivo`; each case with `confirmar: true`; `uow.run` never called; `hashPassword` not reached. Satisfies: "Refusals Write Nothing" (unknown, non-encargado, inactive; not reactivated), "Refusal precedes the preview" (inactive with `confirmar:false` also returns `inactivo`, not `simulado`).
- [x] 2.2 RED: same file - lookup receives the normalized email for `'  ANA@Example.COM '`; and a stored mixed-case email (`Admin@Tienda.com`, input `Admin@Tienda.com`) is looked up as `admin@tienda.com` and yields `no_encontrado` against a fake keyed on exact stored value. Satisfies: "Email is matched after normalization", "Stored mixed-case email is not found".
- [x] 2.3 RED: same file - `confirmar:false` on a valid target -> `estado:'simulado'` with `objetivo {id,nombre,email}`, `uow.run` never called. Satisfies: "No confirmation, nothing written" (core part).
- [x] 2.4 RED: same file - `confirmar:true` -> `estado:'rescatado'` with `passwordTemporal`; the recorded audit event has `usuarioId === entidadId === target.id`, `accion 'cambiar_password'`, `datosPosteriores.origen === 'rescate'`, `datosPrevios` without `origen`. Two successive rescues return different passwords. Satisfies: "Rescue Audit Row and Origin Marker", "Two rescues produce different passwords".
- [x] 2.5 RED: same file - `hayOtroEncargadoActivo` is `false` at count 1 and `true` at count 2, in both `simulado` and `rescatado`. Satisfies: "Other Active Encargado Notice".
- [x] 2.6 RED: same file - returned `objetivo` has no `hashContrasena` key (and result JSON does not contain the hash). Satisfies: "Confirmation Guard" (never print a hash).
- [x] 2.7 GREEN: `apps/api/src/usuarios/rescate.ts` (new) - export `RescateRepos`, `RescatarEncargadoInput`, `MotivoRechazo`, `ObjetivoRescate`, `ResultadoRescate`, `rescatarEncargado(repos, uow, input)` per D4/D5: `normalizeEmail` -> `findByEmail` -> refusals (order not found / role / inactive) -> `countActiveEncargados() > 1` -> `!confirmar` returns `simulado` -> `resetUsuarioPassword(uow, {id: u.id, actorId: u.id}, 'rescate')` -> `rescatado`. Project `ObjetivoRescate` explicitly. No `uow.run` of its own (D5/D6: an outer transaction would deadlock on a second pool connection).
- [x] 2.8 [M] Mutation probes (revert each): (a) delete each refusal check in turn -> its test red; (b) drop normalization -> 2.2 red; (c) ignore `confirmar` -> 2.3 red; (d) `> 1` -> `>= 1` -> 2.5 red; (e) pass `actorId` of another id or drop `'rescate'` -> 2.4 red.
- [x] 2.9 RED: `apps/api/src/usuarios/rescate.integration.test.ts` (new; real Postgres via `getDb()`; `truncate table auditoria, sesiones, usuarios cascade` in `beforeEach`; `getPool().end()` in a file-scope `afterAll`, per `routes/usuarios.integration.test.ts:59-71`; `vi.stubEnv('COOKIE_SECRET', undefined)` because `vitest.integration.config.ts:25` sets one and would hide D1). Case I1 success: encargado seeded locked (`intentos_fallidos=5`, future `bloqueado_hasta`), `debe_cambiar_password=false`, one session row. Assert: new hash verifies `passwordTemporal` (`verifyPassword`) and not the old one; flag true; counters 0/null; zero sessions for that user and another user's session untouched; exactly one audit row with `usuario_id = entidad_id = target.id`, `accion='cambiar_password'`, `datos_posteriores.origen='rescate'`, no `origen` in `datos_previos`, no `hashContrasena`/plaintext email/plaintext password in any column. Also: a rescue of an already-flagged unlocked account still rotates the hash and records one row. Satisfies: "Successful Rescue", "Rescue Audit Row and Origin Marker", "Temporary Password Handling (not persisted)", "Runs Without COOKIE_SECRET" (unset case).
- [x] 2.10 RED: same file - I2-I4 (unknown email / `deposito` with `intentos_fallidos=3` and one session / inactive encargado), each with `confirmar:true`: snapshot the full `usuarios` rows, session count and audit count before and after and assert equality (not just the motive); inactive stays `activo=false`. Mixed-case stored email `Admin@Tienda.com` with input `Admin@Tienda.com`: `no_encontrado`, nothing changed. Satisfies: "Refusals Write Nothing" scenarios (all four), "Refusal messages are distinct" (distinct motives).
- [x] 2.11 RED: same file - I5 dry run on a valid target: `simulado`, same before/after equality. Satisfies: "No confirmation, nothing written".
- [x] 2.12 RED: same file - I6 rollback: wrap a real `createUnitOfWork(db)` so only `auditoria.record` throws (pattern `routes/usuarios.integration.test.ts:423-440`); expect rejection with `AUDIT_WRITE_FAILED`; hash, flag, lockout and session row unchanged; zero audit rows. Satisfies: "Atomic Rescue With Its Audit Row" (both scenarios; success pair covered by I1).
- [x] 2.13 RED: same file - I7 `countActiveEncargados` (seed active encargado, inactive encargado, active deposito -> 1; second active encargado -> 2) and "Rescue proceeds alongside another active encargado" (A and B active: A rescued, B's row and sessions untouched, `hayOtroEncargadoActivo` true) and "Sole active encargado gets no notice" (other encargado inactive -> false). Satisfies: "Other Active Encargado Notice".
- [x] 2.14 RED: same file - end-to-end through the app: after a rescue of a locked encargado, `POST /api/auth/login` with `passwordTemporal` returns `200` with `debe_cambiar_password = true` (not `423 ACCOUNT_LOCKED`); a request with either removed session cookie returns `401 UNAUTHORIZED`; `GET /api/auditoria` filtered by that `entidadId` returns `datosPosteriores.origen === 'rescate'` unmodified. Use the app-building harness already used by `routes/usuarios.integration.test.ts` (verify its helper at apply). Re-run the success case once with `COOKIE_SECRET` set (leave the stub off) to prove the audit row has the same shape. Satisfies: "The rescued encargado can log in at once", "Every session is removed" (401 half), "Marker is readable through the audit endpoint", "Rescue with the secret set".
- [x] 2.15 GREEN: tasks 2.9-2.14 pass against the 2.7 implementation (no new production code expected; fix `rescate.ts` only if a real defect shows).
- [x] 2.16 [M] Mutation probes on the integration suite (revert each): (a) swap the wrapped uow for the unwrapped one -> I6 red; (b) remove the `rol` check -> I3 red on the row comparison, not only the motive; (c) flip the actor to a different id / drop `origen` -> I1 red; (d) make the dry run call `resetUsuarioPassword` -> I5 red; (e) re-add an eager key resolve (revert PR 1 piece locally) -> I1 red because `COOKIE_SECRET` is unset.

### Gate 2

- [x] 2.17 Gate: `pnpm -r test`, `pnpm typecheck`, `pnpm lint`, `pnpm contract:check` (byte-identical; no route/OpenAPI change), `pnpm test:integration` (integration test added; requires `pnpm db:up`). Measure the raw diff; if over ~400 apply the PR 2 flag above.

---

## Phase 3: PR 3 - Operator script

Branch from PR 2.

- [x] 3.1 RED: `apps/api/scripts/rescatar-encargado.test.ts` (new) - `parseArgs`: every password flag (`--password`, `-p`, `--contrasena`, `--clave`) in both `flag value` and `flag=value` forms throws the dedicated refusal and the thrown message does not contain the value (`Secreto123`); missing `--email`; `--email` without a value or with a value starting with `-`; unknown flags (`--confirm`, `--emial`, `--email=x`); empty email; `--confirmar` defaults to `false`; valid input returns `{email, confirmar}`. Satisfies: "Rescue Command Inputs" (missing email, unknown argument, password flag rejected).
- [x] 3.2 RED: same file - `describeTarget('postgres://user:s3cret@ep-x.neon.tech:5432/db?sslmode=require')` contains host and database and none of `user`, `s3cret`, `sslmode`; spec URL `postgres://rescue_op:s3cret@db.example.net/inventienda` yields `db.example.net` with neither `rescue_op` nor `s3cret`; garbage input throws and the message does not echo the input. Satisfies: "Confirmation Guard and Target Database Disclosure" (host shown, credentials never printed).
- [x] 3.3 RED: same file - `renderResult(result, target)` returns `{lines, exitCode}`: `rescatado` -> exit 0, the password appears in exactly one line, the target line precedes the password line, mentions forced change on first login; `simulado` -> exit 0, name and email present, mentions `--confirmar` and "no se escribio nada", password absent; `rechazado` -> exit 3, one distinct Spanish line per motive (three messages mutually different; inactive one says the script does not reactivate), no password; `hayOtroEncargadoActivo` true adds the in-app-route notice in both `simulado` and `rescatado`, false omits it; in every mode no line contains a username, password or `hashContrasena`. Exhaustive `switch` (compile-checked). Satisfies: "Refusals Write Nothing" (messages), "Confirmation Guard", "Other Active Encargado Notice", "Temporary Password Handling (exactly once, never on refusal/preview)".
- [x] 3.4 RED: same file - the rendered output is joined and emitted in one stdout write on success (assert via a small exported `emit`/write seam spied once), and the exit-code mapping for usage error (2), missing/unparseable `DATABASE_URL` (2, message does not echo the URL), unexpected error (1, via `formatError`, password never in the message). Satisfies: "Missing DATABASE_URL is refused", "Temporary Password Handling (single write; not in error messages)".
- [x] 3.5 GREEN: `apps/api/scripts/rescatar-encargado.ts` (new) - `import 'dotenv/config'` first; export `parseArgs`, `describeTarget`, `renderResult`; `main`: parse args -> `requireDatabaseUrl` (import from `./seed-demo.js`, with `formatError`) -> print target line BEFORE any query -> `rescatarEncargado(buildRepos(db), createUnitOfWork(db), args)` using `getDb()` -> render; reads no password from the environment; `main` guarded by the `import.meta.url` check (as `seed-demo.ts:344-347`) so the test can import the module. Exit codes: 0 rescatado/simulado, 3 rechazado, 2 usage/`DATABASE_URL`, 1 unexpected. Satisfies: all script requirements above and "Runs Without COOKIE_SECRET" (no `COOKIE_SECRET` read).
- [x] 3.6 GREEN: `apps/api/package.json` - add `"rescatar:encargado": "tsx scripts/rescatar-encargado.ts"` after line 17 (verify the line is inside `scripts` at apply). No root alias.
- [x] 3.7 [M] Mutation probes (revert each): (a) `describeTarget` returns the raw URL -> 3.2 red; (b) drop one password flag from the deny list, then the `flag=value` form -> 3.1 red; (c) print the password in the `simulado` branch -> 3.3 red; (d) print the password twice -> 3.3 "exactly one line" red; (e) change exit code 3 to 1 -> 3.3 red.
- [x] 3.8 Manual rehearsal against the local container (the `main` wiring has no automated test; record the transcript in the PR description with no secrets): `pnpm db:up`, seed an encargado, then `pnpm --filter @inventienda/api rescatar:encargado --email <correo>` (preview, exit 0, nothing written), then with `--confirmar` (password shown once, exit 0), then log in with it and confirm the forced change; also run once with `COOKIE_SECRET` unset in the shell, once with `DATABASE_URL` unset (exit 2, no connection), and once with `--password x` (exit 2). Check `echo $?` for each. Satisfies: "A password in the environment is ignored" (run once with `RESCUE_PASSWORD=Secreto123` set: not displayed, not usable), "Password appears exactly once" (search captured stdout+stderr), "Audit failure ... non-zero exit" (exit 1 path is exercised only by unit mapping 3.4; real-DB rollback is I6). **Done with four deviations** (see verify-report S3): `DATABASE_URL` and `COOKIE_SECRET` were set empty, not unset; the run did not log in with the printed password (covered by `rescate.integration.test.ts`); and the PR description records a summary, not a transcript.

### Gate 3

- [x] 3.9 Gate: `pnpm -r test`, `pnpm typecheck`, `pnpm lint`, `pnpm contract:check` (byte-identical). `pnpm test:integration` is not required unless an integration file changed in this PR; run it anyway once as a regression pass if the container is up. Confirm raw diff ~240 lines.

---

## Phase 4: PR 4 - Documentation, verify report, claims report (last)

Branch from PR 3. Must be last: D-02 is only true once the script exists on main. All `docs/` text in Spanish; commit messages and code comments in English.

- [x] 4.1 `docs/DEPLOY-PLAN.md`: new `#### Rescate del último encargado` under `### Recovery` (`:507`), before `### Backup independiente` (`:533`). Must contain: when to use; that the operator is the only gate and must confirm the requester's identity out of band first; exact command `pnpm --filter @inventienda/api rescatar:encargado --email <correo> [--confirmar]`; the preview-then-confirm sequence; reading the target host line; write-capable `DATABASE_URL` required (CI Neon URL is read-only); password shown once and forced change at first login; inactive account refused and not reactivated, with the operator's next step; stored-uppercase email reported as not found and not repaired here (such an account could never log in); other-active-encargado note (in-app reset is the normal route); two operators at once note (the first printed password dies). Add a one-line pointer in `#### Datos semilla` (`:380-386`). Satisfies: "Operator Runbook" (all four scenarios).
- [x] 4.2 `docs/adrs/0007-sesion-cookie-rbac-propio.md`: append at the END a `### Actualizado 2026-10-02 - ...` addendum (the `:61-63` promise is now kept by a tested script; link to the runbook). Do not edit `:61-63`. Satisfies: "Drift and Cross-Reference Records" (ADR addendum).
- [x] 4.3 `docs/DRIFT.md`: rewrite D-02 (`:78-96`) as RESUELTO in D-01's shape (`:55-76`) pointing to the runbook; update table `:44-48` (Crítico 1 -> 0), note `:50-51`, "Resueltos" `:331-339` (add D-02 bullet), "Próximos pasos" item 1 `:389-390` (strike); fix `SECURITY.md:205` -> `207` (absorbed by the rewrite). Satisfies: "D-02 is closed".
- [x] 4.4 `docs/DRIFT.md`: add after D-16 (`:289`) **D-17** (ADR-0007 `:76-79` says a correct password grants access while locked; code throws `accountLocked` at `auth/service.ts:102-107`) and **D-18** (`seed-encargado.ts:85` stores the email unnormalized while login normalizes at `auth/service.ts:45-46`), both severity Advertencia; adjust the severity table counts. Re-read each cited line before writing it. Satisfies: "New drift items are recorded".
- [x] 4.5 `docs/SECURITY.md`: recommendation 4 (`:207-208`) gets a resolution note in the style of `:218`; fix `:164` `56-58` -> `61-63`; fix the other stale ADR-0007 citations named by the owner (`:143`, `:162`, `:1190`, and `:757,773,798,1197` after re-verifying each against the ADR text); update any citation that this change moved (`SECURITY.md:490`'s `:281` for `usuarios/service.ts`, others at `:87,191,1001,1021,1070`, `DRIFT.md:355`, only if they actually moved - check against the post-PR-3 files). Satisfies: "Stale citations resolve".
- [x] 4.6 `README.md` (after `:60-62`): one sentence plus the command, pointing to the runbook. `docs/BACKLOG.md`: new row after `:50` closing D-02, same shape as row 15.
- [x] 4.7 Citation audit: for every `file:line` cited or edited in 4.1-4.6, open the cited lines and confirm they land on the text claimed (rule: a claim is proven by reading the lines). Include the ADR `61-63` and `SECURITY.md:207` targets.
- [x] 4.8 `openspec/changes/rescate-encargado/verify-report.md`: requirement-by-requirement evidence (spec scenario -> test name / command output), test counts, mutation-probe results from 1.5, 1.9, 1.11, 2.8, 2.16, 3.7, manual rehearsal result from 3.8, and the gaps listed in the coverage notes below as ACCEPTED or deferred, with the owner's decision.
- [ ] 4.9 `openspec/changes/rescate-encargado/claims-report.md` via the `claims-gate` skill: one row per verifiable claim (CONFIRMED / REFUTED / UNVERIFIABLE accepted on the record), `Verified revision` recorded; commit the report on top of the verified revision. Do not merge with a refuted or unaccepted-unverifiable claim and do not work around the `gh pr merge` hook.

### Gate 4

- [ ] 4.10 Gate: `pnpm -r test`, `pnpm typecheck`, `pnpm lint` (`biome ci .` also covers markdown-adjacent config; docs are not linted but run it), `pnpm contract:check` (byte-identical). `pnpm test:integration` only if code changed in this PR (expected: no). Measure the raw diff against ~400 and apply the PR 4 flag above.

---

## Coverage: spec requirement -> tasks

| Requirement | Tasks |
|-------------|-------|
| encargado-rescue: Rescue Command Inputs | 1.7, 2.2, 3.1, 3.4, 3.5, 3.8 |
| encargado-rescue: Successful Rescue of an Active Encargado | 2.4, 2.7, 2.9, 2.14 |
| encargado-rescue: Atomic Rescue With Its Audit Row | 2.12, 2.16(a), 3.4 |
| encargado-rescue: Rescue Audit Row and Origin Marker | 1.6, 1.8, 1.10, 1.11, 2.4, 2.9, 2.14 |
| encargado-rescue: Refusals Write Nothing | 2.1, 2.2, 2.10, 2.8(a), 2.16(b), 3.3 |
| encargado-rescue: Confirmation Guard and Target Database Disclosure | 2.3, 2.11, 3.2, 3.3, 3.5 |
| encargado-rescue: Other Active Encargado Notice | 1.12, 1.13, 2.5, 2.13, 3.3 |
| encargado-rescue: Temporary Password Handling | 2.9, 3.3, 3.4, 3.8 |
| encargado-rescue: Runs Without COOKIE_SECRET | 1.1, 1.3, 2.9, 2.14, 2.16(e), 3.5, 3.8 |
| encargado-rescue: Operator Runbook | 4.1 |
| encargado-rescue: Drift and Cross-Reference Records | 4.2, 4.3, 4.4, 4.5, 4.6, 4.7 |
| record-audit-trail: Audit Row Identity and Snapshot Shape (modified) | 1.6, 1.8, 1.10, 2.4, 2.9 |
| record-audit-trail: Pseudonym Key Required Only When a Pseudonymized Field Is Present | 1.1, 1.2, 1.3, 1.5 |

## Coverage notes (gaps and spec/design tensions; flagged, not resolved)

1. Whole-process capture ("exactly one occurrence in stdout + stderr", "exit non-zero on audit failure") has no automated end-to-end test: design only unit-tests the pure `renderResult` and leaves `main` untested. Covered by 3.3/3.4 (pure) and the manual rehearsal 3.8; the verify report should record it as accepted.
2. Spec scenarios "Missing email / DATABASE_URL: no row changes, no connection attempted" are proven by `parseArgs`/`requireDatabaseUrl` ordering in `main` (3.5) and the manual run (3.8), not by an automated test of `main`.
3. Spec "Rescue with the secret set" / "A password in the environment is ignored" appear in neither design.md's test table; added as 2.14 and 3.8.
4. Spec scenarios using `POST /api/auth/login`, `GET /api/auditoria`, and `POST /api/auth/password` are not in design's case table (I1-I7); added as 1.10 and 2.14. The exact integration helper and the existing auth-password integration file were not verified when this was written.
5. Spec says the script "exits non-zero" on any refusal and a preview exits zero; design D8 matches (0/0/3/2/1). The spec's usage-error scenarios say only "non-zero", design fixes it to 2; no conflict.
6. Design lists `docs/DRIFT.md:88` `SECURITY.md:205` -> `207` as absorbed by the D-02 rewrite; if the D-02 rewrite keeps that citation, 4.7 must re-check it.
