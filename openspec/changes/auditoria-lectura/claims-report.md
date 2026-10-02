# Claims Report: auditoria-lectura

**Verified revision:** `e772c243a050eafc3b06cd756e34da36de57bfb7`
**Verified on:** 2026-10-01
**Sources:** verify-report.md, tasks.md, PR #185, PR #186, PR #187, commits 6ab9c1d..e772c24,
docs/SECURITY.md, docs/DRIFT.md, docs/DEPLOY-PLAN.md, docs/BACKLOG.md, README.md.
**Verifier:** `claims-verifier` sub-agent, cold, at `4c09262`. The three rows marked † were refuted
in that pass, fixed in `e772c24`, and re-read by the orchestrator against the cited lines.

## History of this report

A first pass at `e7f3da4` checked 94 claims: 59 confirmed, 34 refuted, 1 unverifiable (that version
of this file is commit `7f143a3`). The refutations were real and were fixed, not argued away:

- A spec scenario disagreed with the code (alertas label). The owner chose the code's form; the
  spec was amended (`ccc446e`).
- Five tests could not fail. They now pin the `select()` projection and the tie order (`ccc446e`).
- verify-report.md miscounted tasks and requirements. It was rewritten (`4c09262`).
- 21 citations in docs/ were stale or false. They were corrected (`419c223`, `e772c24`).

The 59 claims confirmed in the first pass concern production code, and row A1 shows that no
production code changed since. This pass re-checks everything that was refuted or that changed.

| # | Claim (verbatim, abridged where marked …) | Source | How it was proven | Verdict |
| --- | --- | --- | --- | --- |
| A1 | No production code changed between `e7f3da4` and HEAD | carry-over premise | `git diff --stat e7f3da4 HEAD`: only 5 `*.test.ts` files, docs/, README.md, and this cycle's folder | CONFIRMED |
| B1 | tasks.md has 28 checked tasks and 0 unchecked | tasks.md | counted `- [x]` / `- [ ]` lines | CONFIRMED |
| B2 | "`findManyByIds(ids)` returns only `{id, nombre}`, never `hashContrasena`" and the three sibling tasks (1.1, 1.3, 1.5, 1.7) | tasks.md:29-35 | each repository mutated to a full-row `.select()`; each test went red on the `select` assertion | CONFIRMED |
| B3 | "page-2 stability under identical `creado_en`" (1.11) | tasks.md:39 | `desc(auditoria.id)` removed; test failed 3 of 3 runs on real Postgres | CONFIRMED |
| B4 | "The claims gate mutated every Phase 2 and Phase 3 test and all caught their mutation. It also found five Phase 1 tests that could not fail … each now fails under its mutation." (5.2) | tasks.md:68 | first-pass rows T1-T22 in `7f143a3`; `ccc446e` diff; all five re-probed (B2, B3) | CONFIRMED |
| C1 | "**Verified revision:** `419c223…`" | verify-report.md:3 | real commit; `git diff 419c223 HEAD -- apps` is empty | CONFIRMED |
| C2 | "**Tasks:** 28 of 28 ticked." | verify-report.md:6 | same as B1 | CONFIRMED |
| C3 | "it miscounted the tasks (22), listed 7 requirements where the delta spec has 5, and missed that one spec scenario disagreed with the code" | verify-report.md:8-12 | first-pass rows V2, V11, V19, V22, V23 in `7f143a3` | CONFIRMED |
| C4 | "`pnpm typecheck` \| exit 0" | verify-report.md | ran | CONFIRMED |
| C5 | "48 files / 624 tests passed" | verify-report.md | ran | CONFIRMED |
| C6 | "94 files / 561 tests passed" | verify-report.md | ran | CONFIRMED |
| C7 | "23 files / 195 tests passed" (integration) | verify-report.md | ran against Docker Postgres | CONFIRMED |
| C8 | "exit 0, 405 files checked (404 tracked plus `.claude/launch.json`)" | verify-report.md | ran `biome ci .` and on the one file alone | CONFIRMED |
| C9 | "`pnpm contract:check` \| exit 0, no diff" | verify-report.md | ran | CONFIRMED |
| C10 | "The delta spec has 5 requirements and 9 scenarios." | verify-report.md | counted headings in spec.md | CONFIRMED |
| C11a | Row "Audit Trail Read Access": `routes/auditoria.ts:83`, `app.ts:180`, two named route tests | verify-report.md | read; tests exist and pass | CONFIRMED |
| C11b | Row "Composable Audit Filters": one `and()` condition reused; two named tests | verify-report.md | read auditoria/repository.ts:93-110; tests pass | CONFIRMED |
| C11c | Row "Row Enrichment…": `service.ts:180-275`; named tests | verify-report.md | read; tests at service.test.ts:425-590 pass | CONFIRMED |
| C11d | Row "Batched Enrichment Lookup": three named tests | verify-report.md | tests exist and pass | CONFIRMED |
| C11e | Row "Read Response Projects Stored Snapshot As-Is" | verify-report.md | read routes/auditoria.ts:45-46, 66-67; test asserts both snapshots | CONFIRMED |
| C12 | "The alertas label is `<tipo>: <producto>`, with `tipo` alone when the producto is missing and `null` when the referent is missing." and no spec scenario disagrees with the code | verify-report.md | service.ts:254-262 vs spec.md:52-75; all 9 scenarios checked against code and a passing test | CONFIRMED |
| C13 | "`listar()` issues at most four `findManyByIds` lookups per page and skips empty buckets." | verify-report.md | read service.ts:203-232 | CONFIRMED |
| C14 | "`schema.d.ts:4249-4254` renders them as `{ [key: string]: unknown }`, nullable for `datosPrevios`." | verify-report.md | read | CONFIRMED |
| C15 | "All Phase 2 and Phase 3 tests caught their mutation." | verify-report.md | all 8 Phase 2 and all 5 Phase 3 tests mutated; every one went red | CONFIRMED |
| C16 | "It failed in 3 of 3 runs with the `desc(id)` tiebreaker removed." | verify-report.md | same as B3 | CONFIRMED |
| C17a | SEC-004 "has no resolution line, although `rateLimit` configs now exist on routes other than login" | verify-report.md | SECURITY.md SEC-004 block; routes/auth.ts:140, routes/usuarios.ts:174, 214 | CONFIRMED |
| C17b | "The comment at `app.ts:136-137` says rate limiting is \"currently only POST /api/auth/login\"" | verify-report.md | read | CONFIRMED |
| C17c | DEPLOY-PLAN.md inventory "has no row for `PROXY_SHARED_SECRET` or `ALLOW_INSECURE_COOKIES`, and its `NODE_ENV` row still attributes the cookie `Secure` flag to `NODE_ENV`" | verify-report.md | grep; DEPLOY-PLAN.md:151 | CONFIRMED |
| C18 | "**CRITICAL:** none. **WARNING:** none." / "**PASS.**" | verify-report.md | nothing in code, spec or tests contradicts it | CONFIRMED |
| D1 | "With this merged, backlog drift finding D-01 is fully closed — code, not just documentation." | PR #187 | DRIFT.md marks D-01 resolved; all 9 scenarios met | CONFIRMED |
| D2 | "restores this file's pre-existing `pseudonymizeFields`/`recordAudit` test coverage, which an earlier draft … had accidentally overwritten" | PR #186 | local reflog: pre-amend commit `ae38eeb` has only `describe('listar')`; amend `5885b41` restores all 12 tests | CONFIRMED |
| E1 | `app.ts:118-119` documents the registration-order constraint | SECURITY.md:77 | read | CONFIRMED |
| E2 | `usuarios/repository.ts:89-97` explicit projection without the hash | SECURITY.md:91 | read | CONFIRMED |
| E3 | `usuarios/repository.ts:28-36` return type without the field | SECURITY.md:92 | read | CONFIRMED |
| E4 | `auditoria/fields.ts:10,42` denylist | SECURITY.md:94 | read | CONFIRMED |
| E5 | audit repo exposes `record` and read-only `list` (`auditoria/repository.ts:46-56`); no path modifies or deletes a row | SECURITY.md:104 | read | CONFIRMED |
| E6 | `usuarios/repository.ts:141-150` binds the id as a parameter | SECURITY.md:122 | read | CONFIRMED |
| E7 | `usuarios/repository.ts:140-162` (SEC-001 location) | SECURITY.md:142 | read | CONFIRMED |
| E8 | `usuarios/repository.ts:145-147` `>= 5` → 5 minutes | SECURITY.md:156 | read | CONFIRMED |
| E9 | `usuarios/repository.ts:313-325` reactivation leaves lockout intact | SECURITY.md:167 | read | CONFIRMED |
| E10 | `usuarios/repository.ts:332-344` `resetPassword` clears the lockout | SECURITY.md:170 | read | CONFIRMED |
| E11 | `app.ts:83-85` `Fastify({ logger })`, no `trustProxy`; the search sentence is worded as audit-time history | SECURITY.md:326, 338-340 | read; wording fixed in `e772c24` | CONFIRMED |
| E12 | `app.ts:146-154` rate-limit registration | SECURITY.md:326 | read | CONFIRMED |
| E13 | `usuarios/repository.ts:145-147` | SECURITY.md:365 | read | CONFIRMED |
| E14 | `app.ts:146-154` `global: false` plus `keyGenerator` | SECURITY.md:470, 482 | read | CONFIRMED |
| E15 | the comment at `app.ts:136-137` declares login-only | SECURITY.md:483 | read | CONFIRMED |
| E16 | `app.ts:90-154` plugin sequence | SECURITY.md:537, 554 | read | CONFIRMED |
| E17 | `app.ts:106-114` helmet | SECURITY.md:555, 591 | read | CONFIRMED |
| E18 | `vercel.json:15-33` `headers` block | SECURITY.md:594 | read | CONFIRMED |
| E19 | `app.ts:129-135` `onSend` hook | SECURITY.md:635, 670 | read | CONFIRMED |
| E20 | `auditoria/repository.ts:46-56`, no delete or purge | SECURITY.md:1023 | read | CONFIRMED |
| E21 † | `auditoria/fields.ts:30-48` (SEC-012 location) | SECURITY.md:1000 | read fields.ts:30-48: the `usuarios` entry | CONFIRMED |
| E22 † | `auditoria/fields.ts:31-41` — `email` among `auditableFields` of `usuarios` | SECURITY.md:1019 | read: `auditableFields` :31-41, `'email'` at :34 | CONFIRMED |
| E23 † | `excludedFields` contains only `hashContrasena` (`fields.ts:42`) | SECURITY.md:1020 | read fields.ts:42 | CONFIRMED |
| E24 | `fields.ts:42` | SECURITY.md:1043 | read | CONFIRMED |
| E25 | `service.ts:41-49` `filterExcluded` | SECURITY.md:1044 | read | CONFIRMED |
| E26 | `service.ts:130-146` applies it | SECURITY.md:1045 | read | CONFIRMED |
| E27 | `auditoria/repository.ts:46-56` | DRIFT.md:68 | read | CONFIRMED |
| E28 | `app.ts:157-180` registers eleven route groups | DRIFT.md:69 | counted 11 `app.register(...Routes)` | CONFIRMED |
| E29 | `app.ts:180` | DRIFT.md:70 | read | CONFIRMED |
| E30 | `routes/auditoria.ts:80-105` | DRIFT.md:71 | read | CONFIRMED |
| E31 | `routes/auditoria.ts:16-27` | DRIFT.md:73 | read | CONFIRMED |
| E32 | `app.ts:72-78` | DEPLOY-PLAN.md:144 | read | CONFIRMED |
| E33 | `app.ts:73-77` | DEPLOY-PLAN.md:151 | read | CONFIRMED |
| E34 | `app.ts:77` | DEPLOY-PLAN.md:154 | read | CONFIRMED |
| E35 | `app.ts:67-70` | DEPLOY-PLAN.md:172, 475 | read | CONFIRMED |
| E36 | `app.ts:146-154` | DEPLOY-PLAN.md:224 | read | CONFIRMED |
| E37 | `app.ts:72-78` | DEPLOY-PLAN.md:475 | read | CONFIRMED |
| E38 | `app.ts:182-188` | DEPLOY-PLAN.md:476 | read | CONFIRMED |
| E-a | SEC-005 "**Resuelto el 2026-09-01** (commit `7bfc4b4`) …" | SECURITY.md | commit date; app.ts:106-114; package.json:21; vercel.json:15-33; named test passes | CONFIRMED |
| E-b | SEC-006 "**Resuelto el 2026-09-01** (commit `7bfc4b4`) …" | SECURITY.md | app.ts:129-135; `auth: false` on exactly health, login, logout; named test passes | CONFIRMED |
| E-c | "en el código de producción ningún fragmento de `sql` crudo concatena texto … `sql.raw` solo aparece en tests de integración, con nombres de tabla fijos" | SECURITY.md | grep: `sql.raw` only in three `.integration.test.ts`, literal table names | CONFIRMED |
| E-d | D-01 "**RESUELTO el 2026-09-15**" block | DRIFT.md:55-76 | merge commit `b67a10d` dated 2026-09-15, ancestor of `main`; E27-E31 | CONFIRMED |
| E-e | "Crítico \| 1", "Advertencia \| 8", "Sugerencia \| 3" | DRIFT.md | counted open findings per severity | CONFIRMED |
| E-f | BACKLOG.md row 15 and README.md "Estado del proyecto" line | docs/BACKLOG.md, README.md | route, role, filters, batching, per-PR diffs; no file under apps/web/src mentions auditoria except schema.d.ts | CONFIRMED |

**Confirmed:** 75 · **Refuted:** 0 · **Unverifiable:** 0
**Accepted unverifiable:** 0

## Notes

- D2 is provable only from this machine's reflog. The pre-amend commit `ae38eeb` is unreachable and
  will not survive a `git gc` or a fresh clone.
- The verifier ran the suites at `4c09262`. `e772c24` changes only docs/ and this cycle's folder.
- Suggestions C17a-c are real and open. They are outside this cycle and are listed in
  verify-report.md.
