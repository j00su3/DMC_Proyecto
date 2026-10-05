# Tasks: Pseudonymize `usuarios.nombre` in Audit Snapshots (`nombre-seudonimizado`, closes D-22)

Inputs: `proposal.md`, `design.md` (D1-D4, tests T1-T8, I1-I4), `specs/record-audit-trail/spec.md`.
Strict TDD: RED before GREEN. `[M]` = mutation probe made with Edit, verified by `git diff` (no `sd`).
Bash: `export PATH="/c/Users/User/.corepack-shims:$PATH"` before any `pnpm`. Never touch `.env*`.

## Review Workload Forecast

| PR | Content | Est. raw lines | Budget (800) |
|----|---------|----------------|--------------|
| A | exploration 85, proposal 97, spec 104, design 124 (committed) + this file ~115 | ~525 | OK |
| B | code 50, tests ~320 (fields 40, audit unit ~140, integration ~140), vitest comment 6, docs ~130, verify ~120, claims ~60 | ~690 | OK, ~110 headroom |
| Archive | move + promote spec | separate PR | n/a |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: Medium

Delivery: ask-on-risk; owner decided 2026-10-04: PR A (branch `feat/nombre-seudonimizado`), then PR B from
main after A merges, branch name containing `nombre-seudonimizado` (e.g. `feat/nombre-seudonimizado-impl`)
so the claims gate applies. Rollback: B is revertible alone; docs ship with the code, never before it.
Risk: if B's diff measures above 800, move the two reports to a follow-up commit batch and re-measure.

## Phase 0: PR A - Planning artifacts

- [ ] 0.1 Commit `tasks.md` on `feat/nombre-seudonimizado`; run `pnpm lint`; open PR A (docs only).

## Phase 1: PR B - Pin today's email digest (UNCHANGED code, first)

- [x] 1.1 T1: in `apps/api/src/auditoria/service.test.ts` pin `pseudonymizeFields({ email: 'ana@example.com' }, ['email'], KEY)` to a literal `hmac-sha256:<hex>`. Compute the hex with `node -e` + `createHmac('sha256', KEY).update('audit-email-pseudonym:ana@example.com').digest('hex')`. Satisfies: "Email pseudonym is stable across the change".
- [x] 1.2 Run the file: green on unchanged code. Commit it BEFORE any refactor (done as `510af8f`, `test(auditoria): pin today's email pseudonym before the tag change`).
- [x] 1.3 [M] T1 probe: change one character of the email tag in `service.ts:54` -> T1 red; swap to `value + tag` -> red; `git diff` empty after revert.

## Phase 2: RED - tests that fail on current code

- [x] 2.1 T7: `apps/api/src/auditoria/fields.test.ts:41` expects `['email', 'nombre']`; refresh comment `:31-36`.
- [x] 2.2 T8: same file - every listed field has a tag; tags distinct, match `/^audit-[a-z]+-pseudonym:$/`, none a prefix of another; `// @ts-expect-error` on `const _x: PseudonymizedField = 'contacto'`. Red until `PSEUDONYM_DOMAIN_TAGS` is exported.
- [x] 2.3 T2 (fix `service.test.ts:121-143`), T3 (`actualizar` with `nombre` in both snapshots: both match `/^hmac-sha256:[0-9a-f]{64}$/`, differ, neither plaintext). Satisfies: "Creation stores a pseudonym", "Rename shows two different pseudonyms", "Snapshot with a nombre is pseudonymized".
- [x] 2.4 T4: name-only snapshot, `vi.stubEnv('COOKIE_SECRET', undefined)`: rejects `/COOKIE_SECRET must be set/`, `record` not called. T5: same string under `email` and `nombre` gives different pseudonyms. Satisfies: "Snapshot with a nombre requires the key", "Same string ... differs".
- [x] 2.5 U-extra: new case(s) in `auditoria/service.test.ts`, key stubbed out, `usuarios` snapshots `{activo:true}`->`{activo:false}` (`baja_logica`), reverse (`reactivar`), and rescue-shaped post-state with `origen: 'rescate'`: all record. Existing `usuarios/service.test.ts:386-389`, `:430-433` prove only the snapshot shapes against a mocked `record`, not key-free recording, so they do not cover this. Passes at once (pins the spec). Satisfies: "Deactivate, reactivate and operator rescue record without the key".
- [x] 2.6 T6: tighten A2 (`:249`), A3 (`:263`) and A6 (`:311`) - replace the `{ nombre }` snapshots (and `baseEvent`'s `datosPrevios`, `:17-24`) with a non-pseudonymized field such as `rol`. A3 also puts `nombre` in `datosPosteriores`, which design's T6 did not list. Stay green now; probe in 4.1.
- [x] 2.7 I1 (fix `usuarios.integration.test.ts:599-600`: each snapshot equals `pseudonymizeFields({ nombre }, ['nombre'], process.env.COOKIE_SECRET)` for old and new name) and I2 (extend `:281-308`: `datos_posteriores::text` lacks `'Beto Deposito'`).
- [x] 2.8 I3: new integration case - real `POST` create then `PATCH` rename; `select datos_previos::text, datos_posteriores::text from auditoria` contains neither name.
- [x] 2.9 I5: new case in the `usuarios activo and update routes` block (`:547`) - `buildApp({ cookieSecret: COOKIE_SECRET })` (`:16`) keeps cookies working because the HMAC key reads `process.env.COOKIE_SECRET`, not that option. Log in first, then `vi.stubEnv('COOKIE_SECRET', undefined)` (add `vi` to the `:3` import; `vi.unstubAllEnvs()` in that block's `afterEach`, `:554`). Name-only `PATCH`: non-2xx (confirm status at apply), `usuarios.nombre` unchanged, zero `auditoria` rows for the entity. Satisfies: "Snapshot with a nombre requires the key" (rollback half).
- [x] 2.10 I6: new case - insert directly into `auditoria` a row whose `datos_previos`/`datos_posteriores` hold a plaintext `nombre`; `GET /api/auditoria?entidad=usuarios&entidadId=<id>` as encargado (pattern `rescate.integration.test.ts:484`) returns it unchanged. Passes at once (pins the spec). Satisfies: "No update path to existing rows".
- [x] 2.11 Run unit suite + `pnpm test:integration`: confirm T2, T3, T4, T5, T7, T8, I1, I2, I3, I5 are red for the right reason. (I4 = existing no-op rename `:711-731` and rescue suite `rescate.integration.test.ts:182-184`, untouched, stay green.)

## Phase 3: GREEN

- [x] 3.1 `apps/api/src/auditoria/fields.ts`: export `PSEUDONYM_DOMAIN_TAGS = { email: 'audit-email-pseudonym:', nombre: 'audit-nombre-pseudonym:' } as const`, `type PseudonymizedField`; `pseudonymizedFields?: readonly PseudonymizedField[]` (`:23`); list `nombre` for `usuarios`; update comments `:15-23`, `:43-46`. Code comment next to the map: a future entity pseudonymizing a field also called `nombre` would share the tag (owner decision: recorded, not solved).
- [x] 3.2 `apps/api/src/auditoria/service.ts`: remove `PSEUDONYM_DOMAIN_TAG` (`:54`); `pseudonymizeWith` and `pseudonymizeFields` take `readonly PseudonymizedField[]` and use `PSEUDONYM_DOMAIN_TAGS[field] + value`; keep lazy `getKey` (`:140-144`); refresh comments `:51-53`, `:57-74`, `:101-112`.
- [x] 3.3 `apps/api/vitest.config.ts` comment `:25-30` (email only -> email and nombre); `rg -n "correo|email" apps/api/src` for other stale "email" comments about pseudonymization, fix in place.
- [x] 3.4 Run unit + integration suites: 1.1 and Phase 2 tests green.

## Phase 4: Mutation probes (revert each, check `git diff` empty)

- [x] 4.1 Unlist `email` -> T6 (A2, A3, A6) red. Unlist `nombre` -> T2, T3, T4, T7, I1, I2, I3, I5 red.
- [x] 4.2 Pseudonymize `datosPosteriores` only -> T3 and I3 (skip `datosPrevios`) red. Set the `nombre` tag equal to the email tag -> T5, T8 red. Widen `PseudonymizedField` to `string` -> `pnpm typecheck` reports an unused `@ts-expect-error`.
- [x] 4.3 Resolve the key eagerly at the top of `recordAudit` -> U-extra and rescue suite red. In the audit read path (locate at apply) rewrite `nombre` -> I6 red.
- [x] 4.4 Record each probe result for the verify report.

## Phase 5: Docs (re-read every cited line when writing it; docs in Spanish, owner reviews wording)

- [x] 5.1 `docs/PRD.md:202-209`: "correo" -> "correo y nombre" plus one sentence: rows written before the change keep the plaintext name and are not rewritten. Orchestrator drafts the Spanish.
- [x] 5.2 `docs/SECURITY.md`: SEC-012 Status line after `:1003-1007`; summary row `:1216` (says correo only).
- [x] 5.3 `docs/DRIFT.md`: D-22 (`:437-470`) RESUELTO in D-01/D-02 format; D-21 (`:411-428`) widened (rotation changes `nombre` pseudonyms too); new **D-26** `proveedores.contacto`, severity Sugerencia (move the `:458-460` bullet; report ends at D-25 `:517`); recount the severity table by reading each severity line; update `:22`, `:34-49` and next step 1 (`:594-596`).
- [x] 5.4 `docs/BACKLOG.md:33` (item 2.5) or a new row: correo and nombre, D-22 date.
- [x] 5.5 Citation audit: open every `file:line` cited or edited in 5.1-5.4 and confirm it lands on the claimed text.

## Phase 6: Gate, reports

- [x] 6.1 Gate: `pnpm -r test`, `pnpm typecheck`, `pnpm lint`, `pnpm contract:check` (expect byte-identical; if it reports drift, stage artifacts and re-run), `pnpm test:integration` (WARNING: truncates the developer's local `inventienda` database; needs `pnpm db:up`). Measure raw diff against 800.
- [x] 6.2 `openspec/changes/nombre-seudonimizado/verify-report.md`: scenario -> test evidence, counts, probe results (1.3, 4.1-4.3), gaps ACCEPTED/deferred.
- [x] 6.3 `claims-report.md` via the `claims-gate` skill; `Verified revision` = the last commit touching anything outside the cycle folder (reports sit inside it, so commit them on top). No merge with a refuted or unaccepted-unverifiable claim.

## Coverage: spec scenario -> tasks

| Scenario | Tasks |
|----------|-------|
| Creation stores a pseudonym | 2.3 (T2), 2.8, 3.1-3.2 |
| Rename shows two different pseudonyms | 2.3 (T3), 2.7, 2.8 |
| No-op rename writes no row | I4 existing `usuarios.integration.test.ts:711-731`, 2.11 |
| Same string under email and nombre differs | 2.4 (T5), 2.2, 4.2 |
| Email pseudonym stable | 1.1-1.3 |
| No update path to existing rows | 2.10 (returned as stored); enumeration half: PR diff touches no audit repository, checked in 6.2 (PARTIAL, no automated enumeration test) |
| Proveedor snapshot records as before | existing A7 `service.test.ts:324`, 2.11, 6.1 |
| Without pseudonymized field records without key | existing A1 `:226` |
| Deactivate, reactivate, rescue without key | 2.5, 4.3 |
| Email still requires the key | existing A2-A4, A6, tightened 2.6 |
| Nombre requires the key | 2.4 (T4), 2.9 (I5) |
| Email pseudonymized as before | 1.1, 2.6 |
| Nombre pseudonymized | 2.3, 2.7, 3.1-3.2 |

Other: D-22/D-21/D-26 doc records 5.1-5.5; no unmapped scenario.
