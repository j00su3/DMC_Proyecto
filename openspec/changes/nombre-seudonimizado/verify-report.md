# Verify Report: nombre-seudonimizado (closes D-22)

| Field | Value |
| --- | --- |
| Cycle | `nombre-seudonimizado` (record-audit-trail delta) |
| Branch | `feat/nombre-seudonimizado-impl` |
| Verified revision | `1a8f154` (the last commit touching anything outside the cycle folder) |
| Date | 2026-10-05 |
| PRs | #198 (PR A, planning, open); PR B is this branch, not yet opened |
| Verdict | **PASS WITH WARNINGS** (0 CRITICAL, 1 WARNING, 3 SUGGESTION) |

A first verify pass ran at `fee320d`. It found that test A7 only counted the record call; `1a8f154`
strengthened it (section 6). The rest of this report is at `1a8f154`.

## 1. Task completion

Counted by reading every `- [x]` / `- [ ]` line of `tasks.md` under each phase heading.

| Phase | Done | Open | Note |
| --- | --- | --- | --- |
| 0 (PR A) | 0 | 1 | 0.1 is ticked when PR A (#198) merges |
| 1 | 3 | 0 | 1.1-1.3 |
| 2 | 11 | 0 | 2.1-2.11 |
| 3 | 4 | 0 | 3.1-3.4 |
| 4 | 3 | 1 | 4.4 (record probe results) closes with the claims gate |
| 5 | 5 | 0 | 5.1-5.5 |
| 6 | 2 | 1 | 6.1 (gate) and 6.2 (this report, ticked in the commit that adds it); 6.3 open |
| **Total** | **28** | **3** | 31 tasks |

## 2. Spec coverage

The delta `specs/record-audit-trail/spec.md` has 5 requirements (4 ADDED, 1 MODIFIED) and 13
scenarios, counted by heading. Test files: `S` = `apps/api/src/auditoria/service.test.ts`, `F` =
`apps/api/src/auditoria/fields.test.ts`, `UI` = `apps/api/src/routes/usuarios.integration.test.ts`,
`R` = `apps/api/src/usuarios/rescate.integration.test.ts`.

| # | Scenario | Evidence | Result |
| --- | --- | --- | --- |
| 1 | Creation stores a pseudonym | `S` "on crear, passes datosPrevios through as null and keeps the whole created-row snapshot (minus excluded fields)"; `UI` "files exactly one crear audit row, with no hash in either snapshot" | covered |
| 2 | Rename shows two different pseudonyms | `S` "pseudonymizes usuarios.nombre in both snapshots with two different pseudonyms on a rename"; `UI` "updates a profile and files exactly one actualizar row with only the changed field" and "stores no plaintext name in the audit rows after a create then a rename" | covered |
| 3 | No-op rename writes no row | `UI` "writes nothing when a PATCH changes nothing (D5)"; `apps/api/src/usuarios/service.test.ts` "writes nothing and files no audit row when the request changes nothing" | covered |
| 4 | Same string under email and nombre differs | `S` "T5: gives the same string different pseudonyms under email and nombre"; `F` "gives every pseudonymized field a distinct, well-formed tag, none a prefix of another" | covered |
| 5 | Email pseudonym is stable | `S` "pins the exact email pseudonym digest, so the pseudonym is stable across releases" (section 4) | covered |
| 6 | No update path to existing rows | `UI` "returns a pre-change audit row with a plaintext nombre unchanged"; the enumeration half rests on the diff touching no audit repository file | PARTIAL, accepted in `tasks.md` |
| 7 | Proveedor snapshot records as before | `S` "A7: records a proveedores event without COOKIE_SECRET", which since `1a8f154` asserts both stored snapshots equal the input | covered |
| 8 | Snapshot without a pseudonymized field records without the key | `S` "A1: records reset-shaped usuarios snapshots (no email) without COOKIE_SECRET, unchanged" | covered |
| 9 | Deactivate, reactivate and rescue record without the key | `S` "records a %s usuarios snapshot without COOKIE_SECRET" (three cases); `R` suite "rescatarEncargado (integration, real Postgres, no COOKIE_SECRET)" | covered |
| 10 | Snapshot with an email still requires the key | `S` A2, A3, A4 and A6, with A2 and A3 now pairing the email with `rol` instead of `nombre` | covered |
| 11 | Snapshot with a nombre requires the key | `S` "T4: rejects without COOKIE_SECRET when a nombre is the only string to pseudonymize, and records nothing"; `UI` "refuses a name-only PATCH when COOKIE_SECRET is missing: the name is unchanged and no audit row exists" | covered |
| 12 | Email pseudonymized as before | `S` "with a key available, stores the HMAC pseudonym of usuarios.email, not the plaintext", plus the pin | covered |
| 13 | Nombre pseudonymized | `S` scenario 1 and 2 tests; `F` "lists usuarios pseudonymizedFields as a subset of auditableFields, including email and nombre" | covered |

12 covered, 1 PARTIAL (accepted), 0 uncovered.

## 3. Gate evidence

| Gate | Result |
| --- | --- |
| `pnpm -r test` at `1a8f154` | api 695 tests, web 561 tests, all pass |
| `pnpm typecheck` at `1a8f154` | pass |
| `pnpm lint` at `1a8f154` | pass |
| `pnpm contract:check` at `fee320d` | no change to `openapi.json` or `schema.d.ts` |
| `pnpm test:integration` at `fee320d` | 24 files, 216 tests, all pass |

`1a8f154` differs from `fee320d` only in `apps/api/src/auditoria/service.test.ts`, a unit test file,
so the contract and integration results carry over.

## 4. Mutation evidence

- **Email pin (`510af8f`):** that commit touches only `service.test.ts`, so the digest was pinned on
  unchanged production code. Recomputing
  `createHmac('sha256', <test key>).update('audit-email-pseudonym:ana@example.com')` gives the pinned
  `97451326ef8e08feb4254e560c793525b599fd9616b5aa851d017e4f048dcd58`, and the test passes at
  `1a8f154`. Before that commit, the apply phase changed one character of the email tag and, separately,
  swapped `tag + value` to `value + tag` on the unchanged code: each turned only the pin test red
  (task 1.3), and both were reverted.
- **Probes run by the apply phase** (recorded in this session, to be re-run by the claims gate):
  removing `nombre` from the list, removing `email` from it, leaving `datosPrevios` unclassified,
  giving `nombre` the email tag, widening `PseudonymizedField` to `string`, resolving the key eagerly,
  and rewriting `nombre` on the read path. Each turned its tests red and was reverted.
- **Probes run by the orchestrator:** removing `nombre` from `pseudonymizedFields` turns 4 audit unit
  tests red; excluding `proveedores.nombre` turns the strengthened A7 red. Both reverted.

## 5. Specific checks

- The two tags (`audit-email-pseudonym:`, `audit-nombre-pseudonym:`) are distinct and neither is a
  prefix of the other.
- The rescue still records without `COOKIE_SECRET`: the `R` suite passes with the secret stubbed out.
- The docs match the code: `docs/PRD.md` (correo y nombre; earlier rows not rewritten), the SEC-012
  Status (2026-10-05) and summary row in `docs/SECURITY.md`, `docs/BACKLOG.md` row 17, and
  `docs/DRIFT.md` (D-22 resolved, D-21 widened, D-26 new). DRIFT's severity table (Advertencia 5,
  Sugerencia 9) matches its `**Severidad:**` lines.
- No `.env*` file is in the diff.

## 6. Findings

### CRITICAL

None.

### WARNING

- **W1: mutation probes are recorded only in this session.** Tasks 4.1-4.3 are ticked and 4.4 is
  open; the claims gate re-runs the probes and records them.

### Fixed during verification

- **A7 only counted the record call** (first pass at `fee320d`): a change that dropped or altered a
  `proveedores` field would have passed. `1a8f154` asserts both stored snapshots.

### SUGGESTION

- **S1:** DRIFT's 2026-10-04 summary still calls D-22 one of the two most relevant open findings; the
  dated 2026-10-05 note and the table correct it.
- **S2:** the PR B budget headroom is small (620 raw lines before the two reports).
- **S3:** SEC-012's original evidence text describes the code as it was audited; only its line
  citations were updated.

## 7. Verdict

**PASS WITH WARNINGS.** All 13 scenarios are covered except one accepted partial; the gates are
green; the email pseudonym is pinned on pre-change code. W1 closes with the claims gate.
