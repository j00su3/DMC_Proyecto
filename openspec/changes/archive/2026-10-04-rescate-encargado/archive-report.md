# Archive Report: rescate-encargado (backlog #16)

**Cycle:** rescate-encargado
**Closes:** drift finding D-02 (`docs/DRIFT.md`), recorded as backlog item 16
**Archived on:** 2026-10-04
**Archived from:** `main` at `a084cc9` (merge of PR #195)
**Status:** PASS WITH WARNINGS, same as `verify-report.md`

## What the cycle delivered

An operator-run rescue for an `encargado` who lost their password, the manual procedure ADR-0007
promised: `pnpm --filter @inventienda/api rescatar:encargado --email <correo> [--confirmar]`.
Without `--confirmar` it previews and writes nothing. With it, it reuses the in-app password reset:
a one-time password printed once, a forced change at first login, the lockout cleared, every
session removed and one audit row filed under the rescued account with `origen: 'rescate'`, all in
one transaction. It refuses an unknown email, a non-encargado and an inactive account without
writing. It runs without `COOKIE_SECRET`. The runbook lives in `docs/DEPLOY-PLAN.md`.

| PR | Content | Merge commit |
| --- | --- | --- |
| #190 | Planning: proposal, specs, design, tasks | `41774e2` |
| #191 | Lazy pseudonym key, `origen` parameter, `normalizeEmail` export, `countActiveEncargados` | `8ad053f` |
| #192 | `usuarios/rescate.ts` and its unit tests | `0ee4dba` |
| #193 | Real-Postgres integration tests for the rescue | `740f273` |
| #194 | `scripts/rescatar-encargado.ts` and its tests | `ae102e1` |
| #195 | Runbook, ADR addendum, DRIFT/SECURITY/BACKLOG/README, two test strengthenings, verify and claims reports | `a084cc9` |

The cycle was planned as five PRs; PR 2 was split into #192 and #193 by owner decision because it
measured 868 raw lines.

## Artifacts in this folder

`proposal.md`, `design.md` (decisions D1-D8), `tasks.md`, `specs/encargado-rescue/spec.md`,
`specs/record-audit-trail/spec.md` (the delta), `verify-report.md`, `claims-report.md`, and this
report. The folder was moved with `git mv` from `openspec/changes/rescate-encargado/`.

## Tasks

`tasks.md` has 52 tasks, all checked: 1 in Phase 0, 15 in Phase 1, 17 in Phase 2, 9 in Phase 3 and
10 in Phase 4.

## Verification

`verify-report.md`, verified at `6c9981c`: **PASS WITH WARNINGS**, 0 CRITICAL, 1 WARNING (PR #195's
size). 13 requirements and 48 scenarios, all covered. Gates at `6c9981c`: api 687 tests, web 561,
integration 213, typecheck, lint and `contract:check` clean. The owner accepted four known gaps on
2026-10-03: the script's `main` wiring has no end-to-end test; the core's integration tests were
proven by mutation rather than an initial red; pnpm echoes script arguments; four PRs exceeded the
review budget.

## Claims gate

`claims-report.md`, verified at `6abcebb`: 428 CONFIRMED, 0 REFUTED, 3 UNVERIFIABLE, all three
accepted by the owner on 2026-10-04. 19 claims were refuted along the way and their source text
corrected before the report was written; they are listed in the report.

## Spec sync

- **New capability** `openspec/specs/encargado-rescue/spec.md`: 11 requirements, 41 scenarios, copied
  from the cycle's spec.
- **`openspec/specs/record-audit-trail/spec.md`**: "Audit Row Identity and Snapshot Shape" replaced by
  the delta's version, which adds the operator-run actor rule and the origin marker; "Pseudonym Key
  Required Only When a Pseudonymized Field Is Present" appended. The spec went from 11 requirements
  and 20 scenarios to 12 requirements and 25 scenarios.

## Docs

`docs/BACKLOG.md` row 16 is marked `✅ Archivado`. `README.md`'s "Estado del proyecto" lists the
backlog as archived through #16.

## Deploy impact

No migration and no schema change. The script runs from an operator's machine with a write-capable
`DATABASE_URL`; nothing runs on Render.

## Carried forward

- `docs/DRIFT.md`: commit `537865c` says it closed D-03, D-05, D-06, D-10, D-11, D-13, D-14 and D-15,
  but their entries are still marked open; a new drift pass should reconcile them. D-17 and D-18 are
  new and open.
- `docs/SECURITY.md`: SEC-001's evidence bullets still cite `auth/service.ts:55-60` and `:66-69` for
  code that has moved; D-15's quotes of `docs/DEPLOY-PLAN.md:537` and `:549` no longer exist.
- `pnpm test:integration` runs against the developer's own `inventienda` database and truncates it.
