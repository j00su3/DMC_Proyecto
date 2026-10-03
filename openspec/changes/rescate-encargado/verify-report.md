# Verify Report: `rescate-encargado` (closes drift finding D-02)

| Field | Value |
| --- | --- |
| Cycle | `rescate-encargado` |
| Branch | `docs/rescate-encargado-docs` |
| Verified revision | `ba6013994b1af050b24aac28dde1e75f65087ae7` |
| Date | 2026-10-02 |
| PRs | #190 (planning, PR 0), #191 (PR 1), #192 (PR 2a), #193 (PR 2b), #194 (PR 3), PR 4 (docs, this branch) |
| Verdict | **PASS WITH WARNINGS** (0 CRITICAL, 1 WARNING, 5 SUGGESTION) |

The first verify pass ran at `4d5b416` and reported four warnings. Three of them (W1-W3 below) were
fixed in `4f37e14` before this report was written; the fixes and their evidence are recorded in
section 6. No `.env*` file was read or referenced.

## 1. Task completion (`tasks.md`)

Counted as lines matching `^- \[[ x]\]` under each `## Phase N` heading.

| Phase | Tasks | Checked | Unchecked |
| --- | --- | --- | --- |
| 0 (PR 0) | 1 (0.1) | 1 | 0 |
| 1 (PR 1) | 15 (1.1-1.15) | 15 | 0 |
| 2 (PR 2a/2b) | 17 (2.1-2.17) | 17 | 0 |
| 3 (PR 3) | 9 (3.1-3.9) | 9 | 0 |
| 4 (PR 4) | 10 (4.1-4.10) | 8 (4.1-4.8) | 2 (4.9, 4.10) |
| **Total** | **52** | **50** | **2** |

4.8 is this report, ticked in the commit that adds it; 4.9 is `claims-report.md` and 4.10 the
final gate, both open at this point by construction.

## 2. Requirement and scenario coverage

Counted by heading (`### Requirement:` / `#### Scenario:`):

- `encargado-rescue`: 11 requirements, 41 scenarios.
- `record-audit-trail` (delta): 2 requirements, 7 scenarios.
- **Total: 13 requirements, 48 scenarios. All 48 covered; none partial, none uncovered.**

Test files, under `apps/api/`: `U` = `src/usuarios/rescate.test.ts`, `I` =
`src/usuarios/rescate.integration.test.ts`, `S` = `scripts/rescatar-encargado.test.ts`, `UI` =
`src/routes/usuarios.integration.test.ts`, `A` = `src/auditoria/service.test.ts`. MANUAL means the
PR #194 rehearsal adds evidence on top of the automated test.

### 2.1 encargado-rescue

**R1 Rescue Command Inputs**

| Scenario | Evidence |
| --- | --- |
| Email matched after normalization | `I` "rescues the encargado stored as ana@tienda.com when given "  Ana@Tienda.COM "" (added in `ba60139`); `U` "looks the target up by the normalized email"; `src/usuarios/service.test.ts` `normalizeEmail` export test |
| Missing email refused | `S` parseArgs "requires --email"; `S` run "usage error: exit 2, stderr only, nothing executed" |
| Missing DATABASE_URL refused | `S` run "missing DATABASE_URL (%o): exit 2, Spanish message, nothing executed" (cases `{}` and `''`); MANUAL: empty `DATABASE_URL` in the rehearsal |
| Password flag rejected | `S` parseArgs password-flag cases in both forms and the attached `-pVALUE`; `S` run "password flag: exit 2 and the value is nowhere in the output" |
| Password in the environment ignored | `S` run "rescatado: ..." sets `RESCUE_PASSWORD` and asserts it is absent; MANUAL: the stored hash does not verify `RESCUE_PASSWORD` |

**R2 Successful Rescue of an Active Encargado**

| Scenario | Evidence |
| --- | --- |
| Credential replaced, change forced | `I` "I1: rescues a locked encargado, replaces the credential and files one marked row" |
| Rescued encargado can log in at once | `I` "lets the rescued encargado log in at once, kills every old session and exposes the marker" (login 200, `debeCambiarPassword` true) |
| Lockout cleared | `I` I1 (`intentosFallidos` 0, `bloqueadoHasta` null after `lockOut`) |
| Every session removed | `I` I1 (target 0 sessions, other user 1); the app test (both old cookies get 401) |
| Already-flagged account still rotates | `I` "I1: rotates the credential of an already-flagged, unlocked account and files one row" |

**R3 Atomic Rescue With Its Audit Row**

| Scenario | Evidence |
| --- | --- |
| Audit failure rolls back | `I` "I6: rolls back the whole rescue when the audit write fails" (real uow, only `auditoria.record` throws, full snapshot equal); exit 1 and no password: `S` run "unexpected failure: exit 1, cause chain on stderr, no stdout beyond the target line" |
| Successful pair commits together | `I` I1 (hash changed and exactly one audit row) |

**R4 Rescue Audit Row and Origin Marker**

| Scenario | Evidence |
| --- | --- |
| Rescue row identifies itself | `expectRescueRow` (`I:136-153`) used by I1 and "files the same row shape when COOKIE_SECRET is set"; `U` "rescues through the reset with the target as its own actor and the rescue marker" |
| Snapshots carry no secrets | `I` I1: no `hashContrasena`, hash, plaintext email or temporary password in the audit rows; no `origen` in `datos_previos` |
| In-app admin reset has no marker | `UI` "files the in-app admin reset without an origen marker, actor distinct from subject" |
| Self-service change has no marker | `UI` "files the self-service password change without an origen marker" |
| Marker readable through the audit endpoint | `I` app test (`GET /api/auditoria` returns `datosPosteriores.origen === 'rescate'`) |

**R5 Refusals Write Nothing**

| Scenario | Evidence |
| --- | --- |
| Unknown email | `I` "I2: unknown email is refused and the database does not change" (full `usuarios` rows, session and audit counts equal); `U` "refuses an unknown email without reaching the uow" |
| Non-encargado refused | `I` "I3: a deposito user ..." (snapshot equality); `U` "refuses a non-encargado" |
| Inactive refused, not reactivated | `I` "I4: an inactive encargado ..." and "I4: an inactive encargado stays inactive"; `U` "refuses an inactive encargado" |
| Stored mixed-case email not found | `I` "a stored mixed-case email ..."; `U` "does not find a stored mixed-case email, which login could never match either" |
| Refusal messages distinct | `S` renderResult "rechazado: exit 3, one distinct line per motive, no password" |

**R6 Confirmation Guard and Target Database Disclosure**

| Scenario | Evidence |
| --- | --- |
| No confirmation, nothing written | `I` "I5: a dry run on a valid target reports it and the database does not change"; `S` renderResult "simulado: ..." (exit 0, no password); `S` describeTarget on the spec URL |
| Credentials never printed | `S` describeTarget "shows host, port and database only"; `S` run tests assert no `rescue_op`, `s3cret` or `sslmode` in output |
| Confirmed run discloses host first | `S` run "rescatado: target line first, before any query; one stdout write carries the password" |
| Refusal precedes preview | `U` "refuses an inactive encargado before offering the preview" |

**R7 Other Active Encargado Notice**

| Scenario | Evidence |
| --- | --- |
| Proceeds alongside another active encargado | `I` "rescues one encargado alongside another active one and leaves the other alone"; `S` renderResult notice test |
| Preview carries the notice | `S` renderResult notice test (`simulado(true)`); `U` other-encargado `it.each` (counts 1 and 2, both modes) |
| Sole active encargado gets no notice | `I` "gives a sole active encargado no other-encargado notice"; `I` "I7: counts only active encargados" |

**R8 Temporary Password Handling**

| Scenario | Evidence |
| --- | --- |
| Password appears exactly once | `S` run "rescatado: ..." (exactly one occurrence across stdout and stderr, one stdout write); MANUAL: once across the captured process output |
| Password not persisted | `I` I1 searches every row of `usuarios`, `sesiones` and `auditoria` for the temporary password (`I:223-227`, added in `4f37e14`) |
| Two rescues produce different passwords | `I` "rescuing twice prints two passwords and only the second one works" (`I:263`, added in `4f37e14`); `U:238` |

**R9 Runs Without COOKIE_SECRET**

| Scenario | Evidence |
| --- | --- |
| Secret unset | `I` first describe stubs `COOKIE_SECRET` to `undefined`; I1 records the full row; `A` A1 |
| Secret set | `I` "files the same row shape when COOKIE_SECRET is set" |

**R10 Operator Runbook** (`docs/DEPLOY-PLAN.md`, `#### Rescate del último encargado`, lines 536-637)

| Scenario | Evidence |
| --- | --- |
| States the sole-gate rule | `DEPLOY-PLAN.md:546-549` |
| Operable end to end | command `:570-574`; flags `:580-581`; write-capable `DATABASE_URL` `:560-563`; password shown once `:597-602`; forced change `:552`, `:599` |
| Mixed-case stored email | `:615-621` |
| Inactive-account case | `:624-628` |

**R11 Drift and Cross-Reference Records**

| Scenario | Evidence |
| --- | --- |
| D-02 closed | `DRIFT.md:84` heading ends in RESUELTO; severity table shows Crítico 0 |
| New drift items recorded | D-17 at `DRIFT.md:346`, D-18 at `DRIFT.md:373`, both Advertencia; the table counts findings still marked open (10 Advertencia, 3 Sugerencia), and `DRIFT.md:50-53` records that the closures claimed by commit `537865c` were never reconciled |
| Stale citations resolve | ADR-0007 `61-63` lands on the rescue promise; `SECURITY.md:207-208` is recommendation 4 with its resolution marker; the moved citations into `usuarios/service.ts`, `auditoria/service.ts`, `usuarios/repository.ts` and `auth/service.ts` were re-checked by the docs task (4.7); the claims gate re-checks them |

The ADR-0007 addendum is at `docs/adrs/0007-sesion-cookie-rbac-propio.md:156-178`; lines 61-63 are
unchanged. `README.md:63-67` and `docs/BACKLOG.md:51` (row 16) are present.

### 2.2 record-audit-trail (delta)

| Scenario | Evidence |
| --- | --- |
| entidad_id has no foreign key | Pre-existing, untouched: `src/db/schema.ts:110`; `src/auditoria/repository.integration.test.ts` |
| Creation event has no prior snapshot | Pre-existing: `A` "on crear, passes datosPrevios through as null ..." |
| Operator-run action records subject as actor with marker | `src/usuarios/service.test.ts` B2; `U` rescue test; `I` I1 |
| In-app actions carry no origin marker | `src/usuarios/service.test.ts` B1; `UI` admin-reset and self-service tests |
| Snapshot without a pseudonymized field records without the key | `A` A1, A5, A7 |
| Snapshot with an email still requires the key | `A` A2, A3, A4, A6 |
| Snapshot with an email pseudonymized as before | `A` "with a key available, stores the HMAC pseudonym of usuarios.email, not the plaintext" |

## 3. Gate evidence

Run at `ba60139` with `export PATH="/c/Users/User/.corepack-shims:$PATH"`.

| Gate | Result |
| --- | --- |
| `pnpm -r test` | exit 0; api 687 tests, web 561 tests |
| `pnpm test:integration` | exit 0; 213 tests (211 at PR 3, plus the twice-rescue and normalized-email tests) |
| `pnpm typecheck` | exit 0 |
| `pnpm lint` | exit 0 |
| `pnpm contract:check` | exit 0, no change to `openapi.json` or `schema.d.ts` |

The runbook's statement that pnpm echoes script arguments (`DEPLOY-PLAN.md:564-568`) was checked
against pnpm 11.21.0 with a throwaway package: arguments are printed at launch and repeated in the
failure line when run with `--filter`.

## 4. Mutation-probe evidence

From the PR bodies; each probe was applied, seen red, then reverted.

- **#191 (1.5, 1.9, 1.11):** eager key resolution restored; key falling back to a constant;
  `datosPrevios` not classified; `origen` spread unconditional or removed; `routes/usuarios.ts`
  passing `'rescate'`.
- **#192 (2.8):** each refusal check deleted; normalization dropped; `confirmar` ignored; `> 1` to
  `>= 1`; wrong `actorId`; `'rescate'` dropped.
- **#193 (2.16):** unwrapped uow in I6; role check removed (caught by the row comparison);
  `'rescate'` dropped; dry run resetting; eager key resolve restored; inactive refusal removed.
- **#194 (3.7):** raw URL from `describeTarget`; a password flag dropped from the deny list; the
  `flag=value` form dropped; password printed in the preview; printed twice; exit 3 changed to 1.
- **This PR:** `generateTempPassword` made to return a constant turns "rescuing twice prints two
  passwords and only the second one works" red; reverted.
- **Manual rehearsal (#194, throwaway database, dropped afterwards):** preview exit 0 and database
  unchanged; unknown email exit 3; empty `DATABASE_URL` exit 2; `--password x` and `--password=x`
  exit 2; confirmed rescue with `COOKIE_SECRET` empty and `RESCUE_PASSWORD` set exit 0, password
  printed once and found in no table, stored hash verifies it and not `RESCUE_PASSWORD`, one audit
  row with `origen: 'rescate'` and actor = subject.

## 5. Known gaps (accepted by the owner on 2026-10-03)

1. The `main()` wiring of `rescatar-encargado.ts` has no automated end-to-end test. It is covered by
   unit tests of `run` through an injected I/O seam plus the manual rehearsal.
2. The core's integration tests (#193) were written after the implementation (#192) and were proven
   by mutation probes rather than an initial red.
3. pnpm echoes script arguments; the script cannot prevent it. The runbook documents it.
4. Review-budget exceptions: PR 0 (#190) about 1,100 lines, docs-only; PR 2a (#192) 418; PR 2b
   (#193) about 490, test-only; PR 3 (#194) 608.

## 6. Findings

### CRITICAL

None.

### WARNING

- **W4: PR 4 review budget.** The docs and test commits on this branch are 354 raw lines before
  this report and `claims-report.md`; with both, PR 4 will exceed the ~400 budget. Task 4.10 measures
  it.

### Fixed during verification (first pass at `4d5b416`)

- **W1, stale checkbox:** task 0.1 was unchecked although #190 was merged. Ticked in `4f37e14`.
- **W2, "Two rescues produce different passwords" half asserted:** only the difference was tested.
  `4f37e14` adds an integration test that rescues the same encargado twice and asserts the second
  password verifies and the first does not.
- **W3, "Password is not persisted" partly covered:** I1 searched only the audit rows and the
  target's `usuarios` row. `4f37e14` searches every row of `usuarios`, `sesiones` and `auditoria`.

### SUGGESTION

- **S1, duplicate host line:** the script prints `Base de datos objetivo: <t>`
  (`rescatar-encargado.ts:190`) and `renderResult` repeats `Base de datos: <t>`. Harmless, and the
  runbook mentions it.
- **S2, the script loads local development configuration:** `rescatar-encargado.ts:1` imports
  `dotenv/config`, so a local configuration can supply `DATABASE_URL`. The runbook says so
  (`DEPLOY-PLAN.md:594-596`) and the target line is the safeguard.
- **S3, rehearsal against task 3.8:** the #194 rehearsal did not log in with the printed password
  (covered by `I`), tested an empty rather than unset `DATABASE_URL`, and did not exercise exit 1
  (covered by `S`).
- **S4, stale sentence in `DRIFT.md:425`:** "Ningún commit desde entonces tocó estos archivos" is
  no longer literally true after #191; the cited lines still land. Not edited by this cycle.
- **S5, socket URLs:** `describeTarget` refuses a URL with an empty host (`postgres:///db`) as a usage
  error. Acceptable for a runbook that assumes a network host; not documented.

## 7. Verdict

**PASS WITH WARNINGS.** All gates are green at `ba60139`: api 687, web 561, integration 213,
typecheck, lint, byte-identical contract. All 48 scenarios are covered and none is contradicted by
the code. The one open warning is the PR 4 size. The known gaps in section 5 were accepted by
the owner on 2026-10-03.

## 8. Corrections made during the claims gate (2026-10-03)

The claims gate settled 412 claims at `ecb1d43`; 16 were refuted. All 16 were fixed in `ba60139`:

- **Coverage:** "none partial" was false for "Email is matched after normalization": no test ran a
  confirmed rescue with a non-normalized email. `ba60139` adds one; dropping `normalizeEmail` from
  `rescate.ts` turns it red (reverted).
- **tasks.md:** task 1.10 claimed no integration test drove `POST /api/auth/password` (one does:
  `routes/auth.integration.test.ts`); task 1.14 listed five files for an `rg -l` that returns seven;
  task 3.8 was ticked without its two deviations. All three now state what happened.
- **docs/SECURITY.md:** SEC-001 and SEC-008 locations pointed at code that has moved; "the counter
  only resets on a successful login" omitted the password reset; "the per-account lock still bounds
  guessing" is false since the password is verified while locked (D-17); "without a rate limit" was
  false for the user-creation and password-reset routes; recommendation 4 was marked resolved
  although it asks for an in-band path and the rescue is out of band. Each now matches the code.
- **docs/DRIFT.md:** the severity table was described as counting open findings, but commit
  `537865c` says it closed eight of them without marking their entries; the text now says the table
  counts findings still marked open and that reconciliation is pending. D-15's recommendation cited
  stale line ranges; it now names the sections. "No ADR was modified during this audit" was false
  for the 2026-09-09 commit; corrected.

