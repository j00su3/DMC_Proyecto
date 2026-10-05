# Archive Report: nombre-seudonimizado (backlog #17)

**Cycle:** nombre-seudonimizado
**Closes:** drift finding D-22 (`docs/DRIFT.md`), recorded as backlog item 17
**Archived on:** 2026-10-05
**Archived from:** `main` at `ff49523` (merge of PR #199)
**Status:** PASS WITH WARNINGS, same as `verify-report.md`

## What the cycle delivered

The PRD says the audit trail keeps no personal data, but audit snapshots stored users' `nombre` in
plain text; only the email was pseudonymized. `usuarios.nombre` is now pseudonymized in both
snapshots. Each pseudonymized field has its own HMAC domain tag (`PSEUDONYM_DOMAIN_TAGS` in
`apps/api/src/auditoria/fields.ts`): `email` keeps `audit-email-pseudonym:`, so every email pseudonym
already stored is unchanged, and `nombre` uses `audit-nombre-pseudonym:`. An untagged field fails
`pnpm typecheck`. Rows written before the change keep the plaintext name and are not rewritten.

| PR | Content | Merge commit |
| --- | --- | --- |
| #198 | Planning: exploration, proposal, spec delta, design, tasks | `bddf207` |
| #199 | Code, tests, docs (PRD, SECURITY, DRIFT, BACKLOG), verify and claims reports | `ff49523` |

## Owner decisions (2026-10-04)

Pseudonymize the name; leave existing rows as they are; a separate tag for `nombre`; edit the PRD and
SEC-012; `proveedores.contacto` out of scope, recorded as D-26. Delivery: two PRs plus this archive,
800-line budget, with `size:exception` for #199.

## Artifacts in this folder

`exploration.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/record-audit-trail/spec.md` (the
delta), `verify-report.md`, `claims-report.md`, and this report. The folder was moved with `git mv`
from `openspec/changes/nombre-seudonimizado/`.

## Tasks

`tasks.md` has 31 tasks. 30 are checked; 0.1 ("commit `tasks.md` and open PR A") is unchecked
because its box lives on the branch it describes, although PR #198 was opened and merged.

## Verification

`verify-report.md`: **PASS WITH WARNINGS**, 0 CRITICAL, 1 WARNING (mutation probes recorded only in
the session; closed by the claims gate). 5 requirements and 13 scenarios: 12 covered, 1 accepted
partial. Gates at the last code revision `1a8f154`: api 695 tests, web 561, integration 216,
typecheck, lint and `contract:check` clean.

## Claims gate

`claims-report.md`, verified at `f3063a3`: 221 CONFIRMED, 0 REFUTED, 0 UNVERIFIABLE. The verifier
re-ran every gate and 13 mutation probes. Three stale line citations in `docs/` were refuted and
fixed in `f3063a3`; the corrected text was verified again.

## Spec sync

`openspec/specs/record-audit-trail/spec.md`: "Pseudonym Key Required Only When a Pseudonymized Field
Is Present" replaced by the delta's version (the key is required for `email` or `nombre`); four
requirements appended (name pseudonymized in both snapshots; distinct pseudonyms per field with email
pseudonyms unchanged; earlier rows not rewritten; proveedores snapshots unchanged). The spec went
from 12 requirements and 25 scenarios to 16 requirements and 35 scenarios.

## Docs

`docs/BACKLOG.md` row 17 is marked `✅ Archivado`. `README.md`'s "Estado del proyecto" lists the
backlog as archived through #17.

## Deploy impact

No migration and no new environment variable. A name-only `PATCH /api/usuarios/:id` now needs
`COOKIE_SECRET`, which production validates at startup.

## Carried forward

- D-26: `proveedores.contacto` is audited in plain text.
- D-21: rotating `COOKIE_SECRET` changes every email and name pseudonym; still undocumented in the
  operations runbook.
- Audit rows written before 2026-10-05 keep users' names in plain text.
