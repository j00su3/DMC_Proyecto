# Archive Report: Reportes (backlog #12)

**Cycle**: reportes
**Backlog Item**: #12
**Status**: ✅ ARCHIVED AND CLOSED
**Archive Date**: 2026-09-04
**Archive Authority**: sdd-archive
**Merged Revision**: a65fb54 (main, HEAD at verify time) — PRs #164-#168, all merged, working tree
clean per verify-report

---

## Traceability to All Artifacts

All change artifacts are traced to Engram observations (immutable record across sessions):

| Artifact | Observation ID | Title | Created |
|----------|---|---|---|
| Exploration | #295 | sdd/reportes/explore | 2026-09-03 18:55:47 |
| Proposal | #296 | sdd/reportes/propose | 2026-09-03 19:15:06 |
| Design | #297 | sdd/reportes/design | 2026-09-03 19:28:28 |
| Spec | #298 | sdd/reportes/spec | 2026-09-03 19:29:27 |
| Tasks | #299 | sdd/reportes/tasks | 2026-09-03 19:32:09 |
| Apply Progress | #300 | sdd/reportes/apply-progress | 2026-09-03 21:42:21 |
| Verify Report | #301 | sdd/reportes/verify-report | 2026-09-04 02:40:34 |

This archive report is persisted as `sdd/reportes/archive-report` (Engram), closing the cycle. All
observations above (#295-#301) are superseded by this archive report as the terminal record for the
cycle; they remain in Engram as valid history of what was true at the time each was written, per the
Final-State Authority hierarchy in the `sdd-archive` skill.

---

## Cycle Summary

### Scope (Proposal)

Backlog #12 closes the reporting gap left by #6 (movimientos) and #7 (punto-de-venta): four
purpose-built, read-only endpoints gated per role per `docs/PRD.md:62-64`'s verbatim RBAC split —
stock actual, bajo mínimo, movimientos por período (encargado: all actors; deposito: row-scoped to
their own), and discrepancias globales (encargado only, deposito gets 403).

**Scoping decisions ratified by the owner (2026-09-03)**:
1. Discrepancias globales data source: `alertas` where `tipo = 'discrepancia'` (not
   `movimientos.esDiscrepancia`) — carries resolution state (`estado`, `resueltaEn`, `resueltaPor`).
2. Deposito's movimientos report shares the same date-range-filterable query as encargado's, just
   row-scoped — not a separate, simpler own-history view.

**Out of scope**: dashboard/KPI visualization (backlog #13), CSV/PDF export, any change to how
alertas or `esDiscrepancia` movimientos are created/resolved/classified, any change to
`ProductosRepo.list()`/`MovimientosRepo.listByProducto()`/existing RBAC middleware behavior.

### Design (D1–D5)

**Architecture Decisions** (all confirmed implemented, per verify-report #301):

- **D1**: `ProductosRepo.bajoMinimo` — new dedicated method (not a `list()` option), predicate
  `stockActual <= stockMinimo AND stockMinimo IS NOT NULL` applied identically to page and count
  query, order `asc(stockActual), asc(id)`.
- **D2**: `MovimientosRepo.listByPeriodo` — bare `Movimiento[]` rows (N+1 `productoNombre`
  resolution in the service layer, mirroring `alertas/service.ts`'s existing D6 idiom), new
  `movimientos_fecha_idx` index on `(fecha)` since the existing `(productoId, fecha)` index cannot
  serve a cross-producto query.
- **D3**: Actor-scoping lives entirely in `reportes/service.ts` — `usuarioId = actor.rol ===
  'deposito' ? actor.id : undefined`, `actor` populated only from `requireActor(request.user)`, no
  `usuarioId`/`actor` field on the Zod wire contract. Never inside `plugins/auth.ts`, per ADR-0007's
  resolution of finding A6.
- **D4**: `AlertasRepo.FiltroAlertas` gains an additive `tipo?: TipoAlerta` field; `list()`'s
  condition becomes a composed `and()` of `estado` and `tipo`, applied identically to page and count
  query.
- **D5**: Four routes in `routes/reportes.ts`, each with its own `config.roles` (no shared
  conditional branch inside one endpoint); `movimientosPeriodoQuerySchema` adds `fechaDesde`/
  `fechaHasta` with a `.refine()` for range validity; `fechaHasta` is calendar-day inclusive,
  converted to a half-open interval before reaching the repo.

### Implementation (21 Phase 1-5 Tasks, 100% Complete)

**Phase 1** — `ProductosRepo.bajoMinimo` (D1) + `AlertasRepo.list()` `tipo` widening (D4): 5 tasks.
**Phase 2** — `movimientos_fecha_idx` migration + `MovimientosRepo.listByPeriodo` (D2): 3 tasks.
**Phase 3** — `reportes/service.ts`, D3 actor-scoping, all 4 report orchestrations, load-bearing
mutation-probed integration test: 4 tasks.
**Phase 4** — `routes/reportes.ts` (D5, 4 routes) + `app.ts` registration: 4 tasks.
**Phase 5** — Frontend `apps/web/src/features/reportes/`, route registration
(`shellLayout`/`encargadoLayout` split), contract regeneration: 5 tasks.

All 21 tasks checked `[x]` in `tasks.md` at merge time, independently cross-checked against actual
source/test files by `sdd-verify` (not trusted from the checkbox alone, per this project's claims
discipline). No stale checkbox reconciliation was needed.

### Verification (PASS WITH WARNINGS — 0 CRITICAL, 1 WARNING, 2 SUGGESTIONS)

Per verify-report #301 (verified at revision a65fb54, main HEAD, working tree clean):

- **Verdict**: PASS WITH WARNINGS
- **Blockers**: 0
- **Critical findings**: 0
- **Requirements**: 7/7 traced to code; **Scenarios**: 10/10 compliant (100%) — tasks.md's own
  header over-counted scenarios as 11; the real count, verified by direct grep against
  `specs/reportes/spec.md`, is 10 (SUGGESTION 1, non-blocking documentation drift, does not affect
  coverage).

**Test Coverage** (evidence_revision sha256:d6cdfc634349c2705454d699a95c3d9f0e4de843c7c247b24704710c9154ed62):
- API unit tests: 587/587 passed (up from #11's 564)
- Web unit tests: 545/545 passed (up from #11's 525)
- Integration tests (real Postgres, Docker): 180/180 passed (up from #11's 169)
- `pnpm typecheck`: green (exit 0)
- `pnpm lint`: green (380 files, 0 fixes)
- `pnpm contract:check`: green (zero diff — 4 new routes present in both `openapi.json` and
  `schema.d.ts`)

**Design Coherence**: all 5 decisions (D1-D5) confirmed implemented exactly as specified by direct
source reading — see verify-report #301's line-numbered evidence table.

**Mutation-Probe Verification (load-bearing, re-executed live)**: the row-level actor-scoping guard
at `reportes/service.ts:49` (`const usuarioId = input.actor.rol === 'deposito' ? input.actor.id :
undefined;`) — the first row-level (non-role) authorization filter in this codebase — was mutated
three ways (guard removed, guard inverted, compared against `'encargado'` instead of `'deposito'`)
and re-run against `reportes/service.integration.test.ts` (real Docker Postgres). All 3 mutants were
caught; the working tree was confirmed clean after revert (`git status --short` empty), and the test
file re-passed (2/2) post-revert.

---

## Final State Authority

Per the launch prompt's explicit final-state facts and direct repository verification performed in
this archive phase:

- **Verify-report #301's WARNING is resolved.** At verify time, `docs/DEPLOY-PLAN.md` had no entry
  documenting migration `0009_brief_paibok.sql` (the `movimientos_fecha_idx` index), breaking this
  project's own established per-cycle documentation precedent (#8, #10, #11). The orchestrator added
  the missing entry directly to the working tree before launching this archive phase, under the
  section header **`### 2026-09-04 — Reportes (#12) merged; requiere migración manual antes de usar
  el reporte de movimientos`** (`docs/DEPLOY-PLAN.md`, appended after line 909). This archive phase
  read that exact entry and confirmed it is complete and accurate against what verify-report #301
  actually found: it names all 5 merged PRs (#164-#168), names the exact migration file
  (`apps/api/drizzle/0009_brief_paibok.sql`) and the exact index it creates
  (`movimientos_fecha_idx` on `movimientos(fecha)`), states the index is applied to the local Docker
  Postgres but **not yet to Neon**, states the exact manual action required (`pnpm db:migrate`
  against Neon's `DATABASE_URL`, run from the developer's own machine per `CLAUDE.md`'s
  never-touch-`.env*` convention), and correctly scopes the operational risk to only the
  `/api/reportes/movimientos` route (the other three reports need no schema change). It also cites
  the mutation-probe result for the row-level scoping guard. This entry is now committed as part of
  this archive phase's commit, alongside the archive move and spec promotion — it does not need a
  second entry from `sdd-archive` per verify-report #301's own recommendation ("either by archive
  itself... or by the user directly before archive runs" — the orchestrator did it directly).
- **Both scenario-count and requirement-count SUGGESTIONS from verify-report #301 are non-blocking
  documentation drift** (tasks.md's header over-counts scenarios as 11 vs. the real 10; design.md's
  two Open Questions — `bajoMinimo`'s default sort order and stock-actual's `q`-param omission — were
  never explicitly re-confirmed with the product owner but match the documented implementation
  defaults). Neither affects shipped behavior or test coverage; carried forward here as historical
  record, not re-litigated.
- No CRITICAL findings existed at any point in this cycle's verify history — the archive proceeds
  under the Native Review Receipt Gate's ordinary-repository-policy path (no `reviewGate` was
  discovered for this candidate).

---

## Spec Sync (New Capability, Not a Delta)

Unlike #11 (a delta against the existing `alertas` capability), `openspec/changes/reportes/
specs/reportes/spec.md` is a **brand-new capability spec** — no `openspec/specs/reportes/spec.md`
existed before this cycle (confirmed by directory listing of `openspec/specs/` prior to this
archive: 21 existing capabilities, none named `reportes`). Per the skill's "If Main Spec Does NOT
Exist" branch, it was copied mechanically (`cp` → `diff -r` → `mv`, never Read→Write) to
`openspec/specs/reportes/spec.md` as the new promoted capability spec — 7 requirements, 10
scenarios, covering Stock Actual Report, Bajo Mínimo Report, Movimientos — Encargado Scope,
Movimientos — Deposito Row-Level Scope, Discrepancias Globales Report, Report Empty State, and
Pagination Correctness Under Filtering.

`diff -r` verification of the mechanical copy (source change-spec vs. promoted main spec) produced
**empty output, exit code 0** — byte-identical, no truncation or alteration.

---

## Archive Move

`diff -r` verification of the mechanical `git mv` archive move (pre-move recursive snapshot vs. the
archived folder, `archive-report.md` excluded as additive-only since it did not exist in the source)
produced **empty output, exit code 0** — byte-identical, no truncation or alteration.

Archived to: `openspec/changes/archive/2026-09-04-reportes/`
Contents: `proposal.md`, `exploration.md`, `design.md`, `specs/reportes/spec.md`, `tasks.md`,
`verify-report.md`, plus this `archive-report.md` (additive).

---

## Merged Pull Requests

| PR | Title | Phase | Status |
|---|---|---|---|
| #164 | `ProductosRepo.bajoMinimo` (D1) + `AlertasRepo.list()` `tipo` widening (D4) | 1 | ✅ Merged |
| #165 | `movimientos_fecha_idx` migration + `MovimientosRepo.listByPeriodo` (D2) | 2 | ✅ Merged |
| #166 | `reportes/service.ts` — D3 actor-scoping, all 4 report orchestrations | 3 | ✅ Merged |
| #167 | `routes/reportes.ts` (D5, 4 routes) + `app.ts` registration | 4 | ✅ Merged |
| #168 | Frontend `apps/web/src/features/reportes/` | 5 | ✅ Merged |

Per `tasks.md`'s Review Workload Forecast: High 400-line-budget risk, chained PRs recommended
(feature-branch-chain), decision-needed-before-apply: Yes. All 5 units shipped as their own PR
chained off the tracker branch, matching the forecast exactly — no single PR carried more than one
phase's concern.

---

## Deploy Impact — Manual Neon Migration Required

**Unlike #11, this change DOES require a manual Neon step.** Migration
`apps/api/drizzle/0009_brief_paibok.sql` adds `movimientos_fecha_idx` on `movimientos(fecha)` — the
existing `(productoId, fecha)` index cannot serve `MovimientosRepo.listByPeriodo`'s cross-producto
query as an index-condition scan (confirmed by direct read of the query condition: no `productoId`
predicate). Applied to the local Docker Postgres (integration suite passes against it); **not yet
applied to Neon** as of this archive.

**Manual action required**: run `pnpm db:migrate` against the Neon `DATABASE_URL` from the owner's
own machine before `GET /api/reportes/movimientos` is exercised in production, per `CLAUDE.md`'s "a
change that adds a table [or index] will deploy cleanly and then 500" rule and ADR-0010:71-72. The
other three reports (stock actual, bajo mínimo, discrepancias) touch no schema and work without this
step.

A dated entry documenting this was added to `docs/DEPLOY-PLAN.md`'s registry section — see Final
State Authority above for the exact section header and confirmation of its accuracy.

---

## Claims Gate

Per `CLAUDE.md`'s claims-gate convention, this project requires
`openspec/changes/<cycle>/claims-report.md` before a PR carrying this cycle can be merged (a
`PreToolUse` hook enforces this on `gh pr merge`). No `claims-report.md` exists for this cycle as of
this archive phase. **This archive phase does not produce the claims-report** — per this project's
established precedent (#10 and #11's archive reports both explicitly deferred it as a separate
deliverable owned by the `claims-gate` skill, not `sdd-archive`). The claims gate must run and be
committed before this cycle's PR is merged.

---

## Risk Summary

### Mitigated Risks
- **Row-level `usuario_id = :actor` scoping folded into RBAC middleware instead of the service
  layer** (finding A6's exact failure mode) — did not happen; `reportes/service.ts:49` is the sole
  scoping line in the entire change, `plugins/auth.ts` untouched. Confirmed structurally and by live
  mutation probing (3/3 mutants caught).
- **Bajo-mínimo report reintroducing the documented D7/D11 fetch-then-filter trap** — did not
  happen; the predicate is applied identically to page and count query via a shared
  `whereCondition` reference, confirmed by direct code read.
- **Deposito bypassing row-scoping via a client-supplied actor parameter** — structurally
  impossible; the Zod querystring schema has no `usuarioId`/`actor` field, confirmed by direct
  schema read and by the "Query parameters cannot override the scope" integration test.
- **Migration deploying cleanly and then 500ing silently** — mitigated by this archive's DEPLOY-PLAN
  entry, which makes the manual Neon step explicit and scoped to exactly one route.

### Open Risks
- **None blocking archive.** The claims gate has not yet run (see Claims Gate section) — this must
  complete before `gh pr merge` on the PR carrying this cycle's archive commit, per the project's
  `PreToolUse` hook.
- **Manual Neon migration not yet applied** — `GET /api/reportes/movimientos` will 500 against
  production until the owner runs `pnpm db:migrate`. Documented, not a defect of this cycle.

---

## Next Steps (Post-Archive)

1. Run the `claims-gate` skill to produce `claims-report.md` for this cycle before merging the PR
   that carries this archive commit.
2. Run `pnpm db:migrate` against Neon's `DATABASE_URL` from the owner's own machine before exercising
   `GET /api/reportes/movimientos` in production.
3. Backlog #13 (Dashboard/KPIs) is the natural next item; it is also the correct home for any future
   chart/aggregate visualization work explicitly deferred by this cycle's Non-Goals.

---

## Audit Trail

- **Explore Phase**: 2026-09-03 18:55 (exploration authored, Engram #295)
- **Propose Phase**: 2026-09-03 19:15 (proposal authored, Engram #296)
- **Spec/Design Phase**: 2026-09-03 19:28-19:29 (design + spec authored in parallel, Engram #297/#298)
- **Tasks Phase**: 2026-09-03 19:32 (tasks.md authored, Engram #299)
- **Apply Phase**: 2026-09-03 21:42 (Phase 5 completion recorded, Engram #300; Phases 1-4 already
  merged to main prior to this apply run)
- **Verify Phase**: 2026-09-04 02:40 (verify-report authored, PASS WITH WARNINGS, 0 CRITICAL/1
  WARNING, Engram #301)
- **Archive Phase**: 2026-09-04 (this report; spec promotion, folder move, backlog flip, DEPLOY-PLAN
  entry confirmation)

---

## Sign-Off

**Archive Report Authored**: 2026-09-04
**Cycle Status**: ✅ CLOSED — manual Neon migration owed before `/api/reportes/movimientos` is
production-ready; claims-gate still owed before merge.
**Recommendation**: Run claims-gate, then run the manual Neon migration, then proceed to backlog #13
(Dashboard/KPIs).
