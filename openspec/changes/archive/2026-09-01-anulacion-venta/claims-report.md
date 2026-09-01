# Claims Report: anulacion-venta

**Verified revision:** `dbcd9d8b476a0e3f9528a78315715b4cb0f4cb9b`
**Verified on:** 2026-09-01
**Sources:** verify-report.md, archive-report.md, tasks.md, PR #130, PR #131, PR #132, PR #133 bodies/commits, docs/DEPLOY-PLAN.md, docs/DRIFT.md (citation into a file this cycle touched)

Verified retroactively: the `claims-gate` `PreToolUse` hook is configured in
`inventienda/.claude/settings.json`, but this session's project root is the parent
`DCM_Proyecto` directory, so the hook never loaded and never gated any of this cycle's four
merges (#130, #131, #132, #133). This report closes that gap after the fact. Steps 3-5 of
the gate procedure (reading cited lines, running commands, mutating tests) were delegated
cold to an isolated `general-purpose` agent carrying the `claims-verifier` persona verbatim
— see the skill's Delegation section — since the project-scoped `claims-verifier` subagent
type is unavailable in this session for the same project-root reason.

| # | Claim (verbatim) | Source | How it was proven | Verdict |
| --- | --- | --- | --- | --- |
| 1 | "23/23 tasks checked `[x]` across Phases 1-8." | verify-report.md:15 | Read tasks.md, counted all 23 checkboxes | CONFIRMED |
| 2 | "All 9 requirements / 18 scenarios have covering implementation and a passing runtime test. No UNTESTED or FAILING scenario found." | verify-report.md:31-32 | `rg` counts on the delta specs (9/18, matches) + full green suites + 3 targeted mutation probes on the highest-risk scenarios | CONFIRMED |
| 3 | "`pnpm --filter api test` — 0 — 451/451 passed, 32 files" | verify-report.md:77 | Ran the command: 451/451, exit 0 | CONFIRMED |
| 4 | "`pnpm test:integration` (real Docker Postgres) — 0 — 151/151 passed, 16 files" | verify-report.md:78 | Ran against the live container: 151/151, exit 0 | CONFIRMED |
| 5 | "`pnpm --filter web test` — 0 — 441/441 passed, 65 files" | verify-report.md:79 | Ran the command: 441/441, exit 0 | CONFIRMED |
| 6 | "`pnpm typecheck` — 0 — api + web clean" | verify-report.md:80 | Ran the command: exit 0 | CONFIRMED |
| 7 | "`pnpm lint` (biome ci) — 0 — 297 files, no fixes needed" | verify-report.md:81 | Ran the command: exit 0 | CONFIRMED |
| 8 | "`pnpm contract:check` — 0 — byte-identical, no drift" | verify-report.md:82 | Ran the command: exit 0 | CONFIRMED |
| 9 | "Anulacion Is Encargado-Only ... routes/ventas.ts:244-247 (roles: ['encargado'])" | verify-report.md:38 | Read the cited lines | CONFIRMED |
| 10 | "Motivo Anulacion Is Mandatory (PD-1) ... service.ts:307-317 (trim().min(3).max(500))" | verify-report.md:39 | Read the cited lines + the `MOTIVO_ANULACION_MIN/MAX_LENGTH` constants (3, 500) | CONFIRMED |
| 11 | "Anulacion Reversal Is Atomic Across Stock/Ledger/Pagos/Venta State ... ventas.integration.test.ts:565,639,691" | verify-report.md:41 | Mutated `revertirPagos` to swallow its error; exactly the line-691 test went red (`expected 200 to be 500`); reverted, 13/13 green | CONFIRMED |
| 12 | "Exempt From Activo/Stock Guards (A8) ... productos/repository.ts:257-273, mutation-probed per Task 8.3" | verify-report.md:42 | Mutated the query to add back an `activo = true` predicate; the named unit test went red; reverted, 3/3 green | CONFIRMED |
| 13 | "Already-Anulada Refused With Conflict ... concurrent race leads to exactly one succeeds ... ventas.integration.test.ts:822, mutation-probed" | verify-report.md:43 | Mutated `marcarAnulada`'s WHERE to drop `estado = 'confirmada'`; exactly the line-822 concurrency test went red (`[200,200]` instead of `[200,409]`); reverted, 13/13 green | CONFIRMED |
| 14 | "Numero Correlativo Immutable (PD-5) ... marcarAnulada's UPDATE never touches numeroCorrelativo" | verify-report.md:44 | Read repository.ts:201-213 — `.set()` has no `numeroCorrelativo` key | CONFIRMED |
| 15 | "Recibo.tsx untouched ... zero lines changed in that file" | verify-report.md:51 | `git show --name-only` on 52d6313, 1e23440, 8585cd6 — no match for the path | CONFIRMED |
| 16 | "marcarAnulada UPDATE runs FIRST (serialization point) ... first call inside uow.run" | verify-report.md:59 | Read service.ts:319-327 | CONFIRMED |
| 17 | "No recordAudit call ... ventas is not an AuditableEntidad" | verify-report.md:62 | Grepped for `recordAudit` in `ventas/` (comment only, no call); `FIELD_CLASSIFICATION` has no `ventas` key | CONFIRMED |
| 18 | "PR #132 ... Object.create(Object.getPrototypeOf(...)) + Object.assign now preserves every other method" | verify-report.md:96-98 | `git show 8585cd6` — matches exactly, single file, +15/-5 | CONFIRMED |
| 19 | "### CRITICAL — None found." | verify-report.md:104 | Independent re-read of the diffs/source, corroborated by the mutation probes for claims 11-13 | CONFIRMED |
| 20 | "design.md Open Question 4 ... Ticked at archive time with confirmation note." | archive-report.md:91 | Read design.md — ticked, with the exact confirmation note | CONFIRMED |
| 21 | "BACKLOG.md row 9 ... Flipped at archive time" | archive-report.md:93 | `git show 68b9590 -- docs/BACKLOG.md` — 1-line diff, Pendiente → Archivado | CONFIRMED |
| 22 | "No new code in PR #132 affects production: Follow-up fix is test-only" | archive-report.md:105 | `git show --stat 8585cd6` — one test file only | CONFIRMED |
| 23 | "Manual pre-deploy step: `pnpm db:migrate` must run against Neon ... Migration was shipped with PR #130 (Phase 1). Schema already migrated in backend PR merge." | archive-report.md:103 | Read verbatim — "must run" (pending) directly contradicts "already migrated" in the same paragraph; PR #130's own body says "not applied to Neon yet — manual step post-merge"; `docs/DEPLOY-PLAN.md` has no dated entry recording migration 0007 applied to Neon as of this report's authorship | **REFUTED** |
| 24 | Task 8.1: "git history for #6/#7/#8 shows the BACKLOG.md flip lands in its own `chore(sdd): archive <cycle>...` commit, never inside an apply/feature commit" | tasks.md:196-199 | `git log` + per-commit inspection: #7 (d9ebdef) and #8 (7d8ba97) match; #6's flip is `87aa1f9`, titled `docs(backlog): mark #6 archived...` — a differently-prefixed commit, not matching the quoted `chore(sdd): archive <cycle>` pattern | **REFUTED** |
| 25 | PR #130: "Concurrency-safe (the confirmada -> anulada conditional UPDATE is the serialization point — proven by a real concurrency race test)." | PR #130 body | Corroborated by claim 13's mutation probe | CONFIRMED |
| 26 | PR #131: "All 23 tasks in `openspec/changes/anulacion-venta/tasks.md` are now complete." | PR #131 body | `git show c6c7a69:openspec/changes/anulacion-venta/tasks.md` — 23/23 checked at that commit; Task 8.3's text at that revision correctly described the fix as "verified locally, not committed", not yet claiming PR #132 existed | CONFIRMED |
| 27 | DRIFT.md: the action-style POST route pattern "va a replicarse otra vez ... el #9 anular una venta" | docs/DRIFT.md:357-359 | `routes/ventas.ts:244-247`'s `POST /ventas/:id/anular` matches `routes/usuarios.ts`'s `POST /usuarios/:id/deactivate` shape exactly (same `typed.post(path, { config: { roles: [...] }, ... })` idiom) | CONFIRMED |

**Confirmed:** 25 · **Refuted:** 2 · **Unverifiable:** 0
**Accepted unverifiable:** 0

## Refuted claims

### 23 — "Schema already migrated in backend PR merge"
`archive-report.md:103` asserts in the same sentence both that `pnpm db:migrate` "must run"
against Neon (a pending obligation) and that the "Schema already migrated in backend PR
merge" (already done) — these cannot both be true, and PR #130's own body correctly states
the migration was "not applied to Neon yet" at merge time. At the time this archive report
was authored, Neon had in fact **not** been migrated yet — the user ran `pnpm db:migrate`
against Neon manually in a later step of this same session, after the archive cycle had
already closed. The intent (migration ships in the PR's diff, application to the production
database is a separate manual step) is correct and matches this project's documented
convention; only this one sentence's wording asserts the wrong tense. `docs/DEPLOY-PLAN.md`
carries no dated entry for migration 0007 being applied, unlike this project's own
convention for the sibling incident (`### 2026-09-01 — Incidente: POST /api/ventas devolvía
500...`). Recommend adding that entry as a small documentation follow-up; not a code defect.

### 24 — "the BACKLOG.md flip lands in its own `chore(sdd): archive <cycle>...` commit"
True for cycles #7 (`d9ebdef`) and #8 (`7d8ba97`). False for #6: its flip commit is
`87aa1f9`, titled `docs(backlog): mark #6 archived, matching the cycle now in archive/` — a
different, unrelated commit-message prefix. The broader, load-bearing point this task cited
it for — the flip always lands in its own commit, never mixed into an apply/feature commit —
holds for all three cycles; only the specific quoted naming pattern is wrong for #6.
