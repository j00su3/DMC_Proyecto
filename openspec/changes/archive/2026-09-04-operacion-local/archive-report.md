# Archive Report: Operación local — consistency-check half (backlog #14)

**Cycle**: operacion-local
**Backlog Item**: #14 (partial — consistency-check half only; backup/`pg_dump` half is a separate,
still-open concern, see Backlog Update section)
**Status**: ✅ ARCHIVED AND CLOSED (scoped half only)
**Archive Date**: 2026-09-04
**Archive Authority**: sdd-archive
**Merged Revision**: 0b16f45 (main, HEAD at verify time) — PR #173 merged into 3e06f66, working
tree clean per verify-report

---

## Traceability to All Artifacts

Artifacts for this cycle are hybrid (openspec files + Engram). Filesystem sources read directly in
this archive phase:

| Artifact | Filesystem Source (pre-move) | Notes |
|---|---|---|
| Proposal | `openspec/changes/operacion-local/proposal.md` | Read in full |
| Exploration | `openspec/changes/operacion-local/exploration.md` | Present in archived folder |
| Design | `openspec/changes/operacion-local/design.md` | Read in full (D1-D5) |
| Tasks | `openspec/changes/operacion-local/tasks.md` | Read in full — 8/8 numbered implementation tasks `[x]` |
| Verify Report | `openspec/changes/operacion-local/verify-report.md` | Read in full — verdict PASS |
| Specs (new capability) | `openspec/changes/operacion-local/specs/verificacion-consistencia-stock/spec.md` | Read and promoted below |

This archive report is written to the archived folder as `archive-report.md` (additive — did not
exist in the source change folder) and also persisted to Engram as
`sdd/operacion-local/archive-report` (topic_key upsert), closing the cycle for its scoped half. It
supersedes any earlier phase topic_keys (`sdd/operacion-local/proposal`, `.../spec`, `.../design`,
`.../tasks`, `.../verify-report`) as the terminal record — those remain valid history of what was
true at the time each was written, per the Final-State Authority hierarchy in the `sdd-archive`
skill.

---

## Cycle Summary

### Scope (Proposal)

Backlog #14 was split by explicit owner decision (2026-09-04, recorded in `exploration.md`): the
backup/`pg_dump` half is orphaned/stale — written against a local-disk Postgres, superseded by
ADR-0010's Neon migration, already flagged in `docs/DRIFT.md` D-04 — and is handled separately via
`docs/DEPLOY-PLAN.md` + an ADR update, not by SDD. This proposal covers only the other half: a
periodic check that `producto.stockActual` matches `SUM(movimientos.cantidad)` per producto. Since
every stock write goes through `aplicarDelta` inside `UnitOfWork` (ADR-0005), a divergence signals
a bug or data corruption, not routine drift.

**Scoping decisions ratified by the owner (2026-09-04)**:
1. New GitHub Actions secret confirmed, using a **read-only** Neon role/credential, not the
   full read-write connection string `pnpm db:migrate` uses — defense in depth.
2. Cadence confirmed: weekly.

**Out of scope**: the backup/`pg_dump` half of #14 (separate concern); any new UI/screen/route;
any change to how `movimientos`/`stockActual` are written.

### Design (D1–D5)

- **D1**: `MovimientosRepo.verificarConsistenciaStock()` — one raw SQL query, `LEFT JOIN productos
  p ON m.producto_id = p.id ... GROUP BY p.id, p.sku, p.stock_actual HAVING p.stock_actual <>
  COALESCE(sum(m.cantidad), 0)`. Follows `resumenRotacion`'s raw-SQL precedent; `COALESCE` is
  load-bearing (a bare `sum()` over an empty `LEFT JOIN` group is Postgres `NULL`, and
  `HAVING x <> NULL` is never true).
- **D2**: `apps/api/scripts/verificar-consistencia.ts`, `tsx`, `getDb()` from
  `../src/db/pool.js`. Mirrors `seed-encargado.ts`/`seed-demo.ts`'s main-guard/try-catch→exit
  shape. **Design correction flagged and confirmed followed**: `apps/api/scripts/` already existed
  before this cycle (not a repo-root `scripts/`, contra the proposal's original wording) — this
  cycle correctly reused the existing directory.
- **D3**: `.github/workflows/consistencia-stock.yml`, `schedule: cron: '0 8 * * 0'` (weekly, Sun
  08:00 UTC), steps mirroring `ci.yml`'s checkout/pnpm-setup/node-setup/install shape, then the
  domain-specific `pnpm --filter @inventienda/api verificar:consistencia` step; secret
  `NEON_READONLY_DATABASE_URL` → `DATABASE_URL` env.
- **D4**: Neon read-only Postgres role — **manual owner step, agent cannot touch secrets/`.env*`**.
  See "Outstanding Manual Owner Action (D4)" below — this is NOT resolved by this archive.
- **D5**: Testing — unit test on the script's exit-code branches via an injected fake repo
  (mirrors `seed-encargado.test.ts`); integration test extends
  `movimientos/repository.integration.test.ts` with a seeded mismatch (real Postgres, direct
  `UPDATE`, before/after row-equality assertion).

### Implementation (8 Phase 1-2 Tasks, 100% Complete)

**Phase 1** — repo aggregate query (D1): 3 tasks (1.1 RED, 1.2 GREEN, 1.3 integration confirmation).
**Phase 2** — script, wiring, workflow (D2, D3): 5 tasks (2.1 RED, 2.2 GREEN, 2.3-2.4 package.json
entries, 2.5 workflow YAML).

All 8 numbered tasks checked `[x]` in `tasks.md` at merge time, cross-checked by `sdd-verify`
against actual source/test files on disk (line-numbered evidence, not the checkbox alone). No
stale-checkbox reconciliation was needed — every implementation task was genuinely complete. The
D4 manual owner action carries no checkbox at all in `tasks.md` (correctly, per design.md's
statement that the agent cannot touch secrets) and is never represented as completed work.

### Verification (PASS — 0 CRITICAL, 0 WARNING, 3 SUGGESTIONs)

Per verify-report (verified at revision 0b16f45, main HEAD, working tree clean):

- **Verdict**: PASS.
- **Blockers**: 0. **Critical findings**: 0. **Warnings**: 0.
- **Requirements**: 5/5 traced to code. **Scenarios**: 7/7 compliant (100%) — the actual counted
  total from `specs/verificacion-consistencia-stock/spec.md` (see Final State Authority below for
  the header-count correction).

**Test Coverage** (evidence_revision
`sha256:13b34287a3734dc208e5e26c3be20a96d9c371d7f311f2e78fcc36eb514b9c50`):
- API unit tests: 599/599 passed (up from #13's 596)
- Web unit tests: 561/561 passed (unchanged from #13, confirming zero frontend changes this cycle)
- Integration tests (real Postgres, Docker): 193/193 passed (up from #13's 188 — +5 new tests in
  `movimientos/repository.integration.test.ts`'s `verificarConsistenciaStock` describe block)
- `pnpm typecheck`: green (exit 0)
- `pnpm lint`: green (399 files, 0 fixes)
- `pnpm contract:check`: not run this cycle — independently confirmed unnecessary via
  `git diff --stat 3e06f66 HEAD -- apps/api/openapi.json apps/api/drizzle/` (empty output both
  paths): no route added, no schema migration.

**Design Coherence**: D1-D3 confirmed implemented exactly as specified; D4 confirmed present
(SQL block byte-identical between `design.md` and `tasks.md`) and confirmed correctly NOT
implemented by the agent (owner-only step, outside agent tool access); D5 confirmed functionally
equivalent to the design's actual (more detailed) testing-strategy intent, with one loosely-worded
summary-table cell flagged as SUGGESTION 2 (non-functional).

**Read-only guarantee**: proven at runtime, not just by source absence — a direct pattern scan for
`insert(`/`update(`/`delete(` across both new-code files returned zero matches, and the
integration test captures full `productos`/`movimientos` table state before and after a run
guaranteed to detect a mismatch, asserting deep row-set equality.

---

## Final State Authority

Per the launch prompt's explicit final-state facts and direct repository verification performed in
this archive phase, one fix was made to the working tree by the orchestrator directly before this
archive phase ran, and is confirmed present and correct here:

1. **`tasks.md`'s header count corrected from "8 scenarios" to "7 scenarios".** Confirmed by direct
   count in this archive phase: `specs/verificacion-consistencia-stock/spec.md` (pre-move) contains
   5 `### Requirement:` headings and 7 `#### Scenario:` headings, matching the corrected header and
   `verify-report.md`'s own SUGGESTION 1, which independently found the same miscount by the same
   method (counting headings directly rather than trusting the inherited brief). This is the third
   consecutive cycle (after #12 and #13) where a `tasks.md`/brief header miscounted its own spec's
   requirement or scenario total — a recurring drift class, not a one-off.

No CRITICAL or WARNING findings existed at any point in this cycle's verify history — the archive
proceeds under the Native Review Receipt Gate's ordinary-repository-policy path (no `reviewGate`
was discovered for this candidate; none was requested or referenced by any upstream artifact).

---

## Spec Sync

### Promoted (New Capability, Not a Delta)

`openspec/changes/operacion-local/specs/verificacion-consistencia-stock/spec.md` is a brand-new
capability spec — no `openspec/specs/verificacion-consistencia-stock/spec.md` existed before this
cycle (confirmed by directory listing of `openspec/specs/` prior to this archive; a prior claim in
this cycle to the contrary was independently corrected by the orchestrator before this phase ran).
Per the skill's "If Main Spec Does NOT Exist" branch, it was copied mechanically (`cp` → `diff -r`
→ `mv` into `openspec/specs/`, never Read→Write) to
`openspec/specs/verificacion-consistencia-stock/spec.md` — 5 requirements, 7 scenarios, covering
Stock-Ledger Consistency Detection, Zero-Movement Producto Handling, Per-Producto Mismatch
Identification, Exit-Code Contract, and Read-Only Execution.

`diff -r` verification of the mechanical copy (source change-spec vs. promoted main spec) produced
**empty output, exit code 0** — byte-identical, no truncation or alteration:

```text
--- DIFF (mechanical spec copy) ---
(empty output)
DIFF_EXIT=0
```

### Merged (Deltas Against Existing Specs)

None — this cycle adds no `MODIFIED`/`REMOVED`/`RENAMED` requirements to any existing capability.
Only the one new capability above.

`diff -r` verification of the mechanical `git mv` archive move (pre-move recursive snapshot vs. the
archived folder, `archive-report.md` excluded as additive-only since it did not exist in the source)
produced **empty output, exit code 0** — byte-identical, no truncation or alteration:

```text
--- DIFF (mechanical archive move) ---
(empty output)
DIFF_EXIT=0
```

---

## Archive Move

Archived to: `openspec/changes/archive/2026-09-04-operacion-local/`
Contents: `proposal.md`, `exploration.md`, `design.md`,
`specs/verificacion-consistencia-stock/spec.md`, `tasks.md`, `verify-report.md`, plus this
`archive-report.md` (additive).

---

## Merged Pull Requests

| PR | Title | Phase | Status |
|---|---|---|---|
| #173 | Repo aggregate (`verificarConsistenciaStock`), script, package.json entries, workflow YAML | 1+2 | ✅ Merged |

Per `tasks.md`'s Review Workload Forecast: Low 400-line-budget risk as a single PR (~180-230
estimated lines), no chained PRs recommended, decision-needed-before-apply: No. Shipped exactly as
forecast — a single PR (base = `main`).

---

## Backlog Update (Partial-Completion Row — First Case of Its Kind)

`docs/BACKLOG.md` row #14 was checked for precedent before editing: every other row in the table is
either fully `✅ Archivado`/`✅ Hecho` or fully `⬜ Pendiente`. **No prior row in this backlog has
ever been partially archived.** This is the first such case, so the row was updated using judgment
rather than an existing template, following the project's general convention of dense prose inside
the cell plus a clear terminal status marker.

The row was rewritten to:
- State explicitly, near the top of the cell, that item #14 was split into two independent halves
  by an owner decision on 2026-09-04, pointing to the cycle's own `exploration.md` for the
  reasoning.
- Describe Half A (consistency check) as closed and archived on 2026-09-04, with the same level of
  implementation/coverage detail this backlog uses for every other closed item (methods added,
  test counts, verify verdict, spec promoted).
- Name the still-outstanding D4 manual step explicitly inside the row itself (not just in
  `DEPLOY-PLAN.md`), so a reader of the backlog alone — without cross-referencing the deploy plan —
  learns the workflow will fail every scheduled run until the owner does this.
- Describe Half B (backup/`pg_dump`) as **not silently dropped**: it is explicitly tracked as an
  infrastructure/deploy-plan decision (ADR + `docs/DEPLOY-PLAN.md`), not as an SDD-tracked
  application feature, per the owner's explicit split decision — with a pointer to `docs/DRIFT.md`
  D-04, which already flagged this half as orphaned/stale before this cycle began.
- Replace the terminal status marker with `🟡 Parcial — mitad de consistencia ✅ Archivado, mitad de
  backup ⬜ Pendiente (infraestructura, no SDD)` — a new marker pattern for this backlog, since no
  `✅ Archivado`/`⬜ Pendiente` binary correctly represents a half-done row.

This is a judgment call, not dictated by an existing convention (since none existed) — flagged here
explicitly per the Task Completion Gate's spirit of recording exceptional reasoning.

---

## Outstanding Manual Owner Action (D4) — NOT Resolved By This Archive

**This is explicitly OUTSTANDING, post-archive, and is not checked off, implied-complete, or
otherwise resolved anywhere in this report or by the act of archiving.** Archiving the SDD cycle
closes the application-code portion of backlog #14's consistency-check half; it does not, and
cannot, perform an action outside any tool this agent has access to.

- **What remains**: create the Neon read-only Postgres role `consistencia_readonly` (exact SQL in
  `design.md`'s "Manual step required before real wiring (D4)" section, archived unchanged in this
  same folder) and add the resulting connection string as a new GitHub Actions secret named
  `NEON_READONLY_DATABASE_URL`.
- **Who**: the repository owner, via the Neon SQL console and GitHub repo settings — outside any
  tool this agent can call (no `.env*`/secret access, per this repo's `CLAUDE.md`).
- **Consequence of not doing it**: `.github/workflows/consistencia-stock.yml` will run on its
  weekly schedule and **fail every time** (red X) until the secret exists. This is the expected,
  documented behavior per `design.md`'s own Migration/Rollout note ("merging the workflow file
  first is safe — it will fail visibly if triggered before the secret exists"), not a defect
  introduced by this archive.
- **Where this is also tracked**: `docs/DEPLOY-PLAN.md` § Autorizaciones pendientes, new item #11
  (added by this archive phase, following the same table this project already used for #12's
  outstanding migration and nine other outstanding infra actions), plus a new dated entry in that
  same document's § Registro de ejecución y verificación, mirroring the exact pattern #12's archive
  used for its own outstanding manual migration step. `docs/BACKLOG.md` row #14 also names this
  step directly (see Backlog Update section above), so it is visible from the backlog alone without
  cross-referencing the deploy plan.
- **Two related open questions, also NOT resolved by this archive** (carried forward unchanged from
  `design.md`'s own "Open Questions" and `tasks.md`'s "Open Questions Carried Forward"): the exact
  secret name `NEON_READONLY_DATABASE_URL` and the exact cron `0 8 * * 0` were both explicitly
  marked as proposed-but-not-owner-ratified beyond the ratified scope (secret's read-only nature,
  weekly cadence). If the owner picks a different secret name or schedule when performing the D4
  step, the workflow YAML must be updated to match — that follow-up is not part of this archive.

---

## Deploy Impact

**Zero migration/schema change for this cycle**, confirmed by verify-report's own
`git diff --stat 3e06f66 HEAD -- apps/api/drizzle/` (empty output) and re-confirmed here: no new
table, no new column, no new index. Same zero-migration pattern as #11 and #13's cycles — no
`docs/DEPLOY-PLAN.md` entry is needed for the code itself, and none was added for that reason.

**However**, unlike #11/#13's cycles (which had genuinely nothing outstanding), this cycle DOES
leave an outstanding manual owner action — the D4 Neon role + GitHub secret described above. Since
`docs/DEPLOY-PLAN.md` already has an established pattern for tracking exactly this kind of
outstanding manual step (§ Autorizaciones pendientes, used for #12's outstanding migration and nine
other infra items), this archive phase followed that same pattern rather than inventing a new one:
added item #11 to that table, plus a new dated entry in § Registro de ejecución y verificación
mirroring #12's own entry structure. This is deliberately proactive — the goal is to avoid this
manual step being forgotten the same way ADR-0009's backup script was (per `docs/DRIFT.md` D-04,
the exact orphaning this cycle's own proposal cites as its reason for splitting backlog #14 in the
first place).

---

## Claims Gate

Per `CLAUDE.md`'s claims-gate convention, this project requires
`openspec/changes/<cycle>/claims-report.md` before a PR carrying this cycle can be merged (a
`PreToolUse` hook enforces this on `gh pr merge`). No `claims-report.md` exists for this cycle as of
this archive phase. **This archive phase does not produce the claims-report** — per this project's
established precedent (#10, #11, #12, and #13's archive reports all explicitly deferred it as a
separate deliverable owned by the `claims-gate` skill, not `sdd-archive`). The claims gate must run
and be committed before this cycle's PR is merged.

---

## Risk Summary

### Mitigated Risks
- **New Neon secret widening prod-credential exposure** — mitigated at the design level by scoping
  the credential to a read-only Postgres role from the start (D4), not a post-hoc restriction.
- **Weekly cadence delaying detection of a real corruption bug** — accepted risk per the proposal's
  own reasoning: a bug persists across writes until fixed, so a week's delay is acceptable at this
  project's scale; not mitigated further because no mitigation was deemed necessary.
- **A real mismatch on an untouched producto going undetected** — mitigated by the `COALESCE`
  clause in D1's SQL, directly proven at real Postgres by the integration test (not merely inferred
  from the SQL text), per the Read-Only Execution / Zero-Movement Producto Handling requirements.
- **The consistency check itself mutating data** — mitigated by construction (a single `SELECT`
  call, no other DB call in either new file) and proven at runtime by a full before/after row-set
  equality assertion, not a status-code-style check.

### Open Risks
- **The claims gate has not yet run** (see Claims Gate section) — this must complete before
  `gh pr merge` on the PR carrying this cycle's archive commit, per the project's `PreToolUse` hook.
- **D4 manual owner action is outstanding** (see dedicated section above) — the workflow will fail
  every scheduled run until the owner performs it; this is expected and documented, not a defect,
  but it is a genuinely open item, not a closed one.
- **Secret name and cron schedule not owner-ratified beyond the ratified scope** (see dedicated
  section above) — carried forward as an explicit open question, not silently resolved.
- **Backlog #14's backup/`pg_dump` half remains entirely untouched** — tracked separately per the
  owner's split decision (see Backlog Update section); not part of this cycle's scope and not
  resolved by this archive.

---

## Next Steps (Post-Archive)

1. Run the `claims-gate` skill to produce `claims-report.md` for this cycle before merging the PR
   that carries this archive commit.
2. Owner: perform the D4 manual step (Neon read-only role + `NEON_READONLY_DATABASE_URL` GitHub
   secret) — see `docs/DEPLOY-PLAN.md` § Autorizaciones pendientes item #11. Until then, the new
   workflow will fail every scheduled Sunday run.
3. Backlog #14's backup/`pg_dump` half remains open, tracked as an infrastructure/deploy-plan
   decision (ADR update), not as a new SDD cycle.

---

## Audit Trail

- **Explore/Propose Phase**: 2026-09-04 (proposal authored; owner split backlog #14 into two
  halves, scoping decisions 1-2 ratified)
- **Spec/Design Phase**: 2026-09-04 (design D1-D5 + 1 new-capability spec authored in parallel)
- **Tasks Phase**: 2026-09-04 (tasks.md authored, 8 tasks across 2 phases, single-PR forecast)
- **Apply Phase**: 2026-09-04 (PR #173 merged)
- **Verify Phase**: 2026-09-04 (verify-report authored, PASS — 0 CRITICAL/0 WARNING/3 SUGGESTIONs)
- **Archive Phase**: 2026-09-04 (this report; spec promotion, folder move, partial-completion
  backlog update, `docs/DEPLOY-PLAN.md` outstanding-action tracking)

---

## Sign-Off

**Archive Report Authored**: 2026-09-04
**Cycle Status**: ✅ CLOSED for the consistency-check half only — backup/`pg_dump` half remains a
separate, open, non-SDD concern; D4 manual owner action remains outstanding; claims-gate still owed
before merge.
**Recommendation**: Run claims-gate, then perform the D4 manual step when convenient (not
archive-blocking). Backlog #14's backup half awaits a separate ADR/deploy-plan decision, not a new
SDD cycle.
