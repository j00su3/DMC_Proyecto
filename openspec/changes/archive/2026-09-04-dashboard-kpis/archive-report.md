# Archive Report: Dashboard KPIs (backlog #13)

**Cycle**: dashboard-kpis
**Backlog Item**: #13
**Status**: ✅ ARCHIVED AND CLOSED
**Archive Date**: 2026-09-04
**Archive Authority**: sdd-archive
**Merged Revision**: a7f184d (main, HEAD at verify time) — PRs #170 (backend), #171 (frontend), both
merged, working tree clean per verify-report

---

## Traceability to All Artifacts

Artifacts for this cycle are hybrid (openspec files + Engram). Filesystem sources read directly in
this archive phase:

| Artifact | Filesystem Source (pre-move) | Notes |
|---|---|---|
| Proposal | `openspec/changes/dashboard-kpis/proposal.md` | Read in full |
| Exploration | `openspec/changes/dashboard-kpis/exploration.md` | Present in archived folder |
| Design | `openspec/changes/dashboard-kpis/design.md` | Read in full (D1-D6) |
| Tasks | `openspec/changes/dashboard-kpis/tasks.md` | Read in full — 17/17 tasks `[x]` |
| Verify Report | `openspec/changes/dashboard-kpis/verify-report.md` | Read in full — verdict PASS (corrected, see Final State Authority) |
| Specs (delta) | `openspec/changes/dashboard-kpis/specs/{dashboard-ui,app-layout,inventory-movements}/spec.md` | All 3 read and merged/promoted below |

This archive report is written to the archived folder as `archive-report.md` (additive — did not
exist in the source change folder) and also persisted to Engram as `sdd/dashboard-kpis/archive-report`
(topic_key upsert), closing the cycle. It supersedes any earlier phase topic_keys
(`sdd/dashboard-kpis/proposal`, `.../spec`, `.../design`, `.../tasks`, `.../verify-report`) as the
terminal record — those remain valid history of what was true at the time each was written, per the
Final-State Authority hierarchy in the `sdd-archive` skill.

---

## Cycle Summary

### Scope (Proposal)

Backlog #13 wires the previously destination-less `Panel general` sidebar entry to a new home/
dashboard screen: 4 KPI cards (Quiebres, Stock bajo, Actividad reciente, Alertas activas), identical
for both roles, no charts/export, and no change to alert lifecycle behavior.

**Scoping decisions ratified by the owner (2026-09-04, all 6 confirmed as proposed)**:
1. Quiebres/stock-bajo data source: `AlertasRepo` route (a) — reuses tested #10/#12 infra, kept
   consistent with Alertas/Reportes screens, diverging deliberately from `TECH-DESIGNv2.md:169`'s
   literal `stock_actual`/`stock_minimo` traceability text (flagged, not silently ignored).
2. RBAC: `deposito` sees the same 4 KPIs, unfiltered — mirrors #12's stock-KPI treatment.
3. Card wording/order (no wireframe exists): "Quiebres" → "Stock bajo" → "Actividad reciente" →
   "Alertas activas", left-to-right, literal to the backlog's own naming.
4. "Actividad reciente": N=10 most recent movimientos, columns producto nombre/tipo/fecha/usuario.
5. "Navegación por rol con 🔒": wiring the existing `Panel general` nav entry only — no new
   in-page shortcuts component.
6. "Alertas activas": reuses `countAbiertas()`'s combined `activa`+`vista` "not yet resolved"
   meaning, matching the existing nav badge exactly.

**Out of scope**: charts/visualization, CSV/export, any change to alert creation/resolution/
evaluation, the Producto-column KPI route, a separate quick-links component.

### Design (D1–D6)

**Architecture Decisions** (all confirmed implemented, per verify-report):

- **D1**: `MovimientosRepo.listRecientes(limit)` — no `usuarioId` param (decision 2 is unfiltered),
  `ORDER BY fecha DESC, id DESC LIMIT N`, reuses `movimientos_fecha_idx` (#12), no migration.
- **D2**: `dashboard/service.ts::obtenerResumen(repos)` — 4 calls via `Promise.all` (3 counts + 1
  list), not a combined SQL query. **Correction flagged in design**: the literal proposal snippet
  `AlertasRepo.list({tipo}, 1, 1).total` has no `estado` predicate and would count resolved alerts
  too — fixed by a new `AlertasRepo.countAbiertasPorTipo(tipo)` mirroring `countAbiertas()`'s exact
  predicate plus a `tipo` equality, not a `list()` reuse. Confirmed by verify-report as a genuinely
  distinct method body sharing no code path with `list()`.
- **D3**: One route, `GET /api/dashboard/resumen`, all 4 pieces in one payload (unlike #12's four
  independently paginated reports) — `usuarioId` (not a resolved name) on `actividadReciente` rows,
  matching `MovimientosPeriodoTable`'s existing precedent.
- **D4**: Bare GET, `config: { roles: ['encargado', 'deposito'] }`, no querystring schema, no
  `requireActor()`, `ACTIVIDAD_RECIENTE_LIMIT = 10` as a route-level constant, never a client param.
- **D5**: Frontend reuses `apps/web/src/routes/index.tsx` (placeholder replaced, not a new route
  file); `AppShell.tsx` gains `to: '/'` on `Panel general`, no lock; new `KpiCard.tsx`,
  `features/dashboard/{queries.ts,useDashboardResumen.ts,ActividadRecienteList.tsx}`; `StatusChip`
  widened to `'danger' | 'warning' | 'success'`.
- **D6**: Edge cases — empty `listRecientes` → `[]` + empty-state; zero `countAbiertasPorTipo` →
  `0` not `undefined`; deactivated producto still resolves via `findById` (no `activo` filter),
  reusing the same N+1 idiom as `reportes/service.ts`.

### Implementation (17 Phase 1-3 Tasks, 100% Complete)

**Phase 1** — `AlertasRepo.countAbiertasPorTipo` (D1, D2's correction) + `MovimientosRepo.listRecientes`
(D1): 5 tasks.
**Phase 2** — `dashboard/service.ts::obtenerResumen`, `routes/dashboard.ts`, `app.ts` registration
(D2, D3, D4): 5 tasks.
**Phase 3** — Frontend: `StatusChip` widening, `KpiCard`, `features/dashboard/*`, `index.tsx`,
`AppShell.tsx`, contract regeneration (D5): 7 tasks.

All 17 tasks checked `[x]` in `tasks.md` at merge time, cross-checked by `sdd-verify` against actual
source/test files on disk, not trusted from the checkbox alone. No stale checkbox reconciliation was
needed — every implementation task was genuinely complete.

### Verification (PASS — 0 CRITICAL, 0 WARNING, 3 SUGGESTIONS)

Per verify-report (verified at revision a7f184d, main HEAD, working tree clean):

- **Verdict**: PASS (see Final State Authority below for the verdict-text correction)
- **Blockers**: 0. **Critical findings**: 0. **Warnings**: 0.
- **Requirements**: 8/8 traced to code. **Scenarios**: 24/24 compliant (100%) across the 3 spec
  deltas — dashboard-ui (6 requirements/15 scenarios; tasks.md's own header over-counted this as 7,
  a documentation-only miscount that does not affect coverage), app-layout (1 MODIFIED/4 scenarios,
  2 pre-existing + 2 new), inventory-movements (1 ADDED/5 scenarios).

**Test Coverage** (evidence_revision `sha256:fae6ebcc4875a3756d7ade281165d9f238738b464e370fa247d905fe86698e4e`):
- API unit tests: 596/596 passed (up from #12's 587)
- Web unit tests: 561/561 passed (up from #12's 545)
- Integration tests (real Postgres, Docker): 188/188 passed (up from #12's 180)
- `pnpm typecheck`: green (exit 0)
- `pnpm lint`: green (397 files, 0 fixes)
- `pnpm contract:check`: green (zero diff — `GET /api/dashboard/resumen` present in both
  `openapi.json` and `schema.d.ts`)

**Design Coherence**: all 6 decisions (D1-D6) confirmed implemented exactly as specified, by direct
source reading (see verify-report's line-numbered evidence table).

**Structural verification (load-bearing)**: `listRecientes`'s "unfiltered for both roles" property
is enforced by the type signature itself having no slot for an actor filter across the entire call
chain (repo interface → `ReadRepos.movimientos` → service → route), not merely a convention nobody
violated yet — confirmed by direct reading of `repository.ts`, `dashboard/service.ts`, and
`routes/dashboard.ts` (no querystring key, no `requireActor()` import).

---

## Final State Authority

Per the launch prompt's explicit final-state facts and direct repository verification performed in
this archive phase, three fixes were made to the working tree by the orchestrator directly before
this archive phase ran, and are confirmed present and correct here:

1. **Verify-report verdict corrected from "PASS WITH WARNINGS" to "PASS".** The report's own Issues
   Found section lists `CRITICAL: None.` and `WARNING: None.`, with only 3 non-blocking
   SUGGESTIONs — the same self-contradiction pattern flagged by this project's `gestion-proveedores`
   claims-gate history (a verdict of "PASS WITH WARNINGS" requires at least one WARNING-severity
   finding). Confirmed by direct read of `verify-report.md`'s Verdict section, which includes the
   orchestrator's own correction note attributing the fix and citing the taxonomy rule. This archive
   report treats the corrected verdict (**PASS**) as the terminal record.
2. **`tasks.md`'s requirement-count header corrected from "7 requirements" to "6".** Confirmed by
   direct count: `grep -c "^### Requirement:" openspec/changes/dashboard-kpis/specs/dashboard-ui/spec.md`
   (pre-move) returns 6, matching the corrected header and the verify-report's own SUGGESTION 1,
   which independently found the same miscount by the same method.
3. **Stale test comment corrected** in
   `apps/api/src/alertas/repository.integration.test.ts:63`, from `"2 open quiebre, 3 open
   stock_bajo, 1 open discrepancia"` to `"2 open quiebre, 1 open stock_bajo, 1 open discrepancia"`.
   Confirmed by direct `git diff` in this archive phase: only the comment changed; the seed data
   (one `stock_bajo` row, `p3`) and the assertion (`expect(...).toBe(1)`) were already correct before
   this fix — matching verify-report's SUGGESTION 2 exactly ("the test itself is correct; only the
   comment is wrong").

All three fixes are intentional, are included in this archive phase's commit, and are recorded here
as part of this cycle's honest history — consistent with how the `reportes` (#12) archive cycle
documented its own `DEPLOY-PLAN.md` fix rather than silently absorbing it.

No CRITICAL findings existed at any point in this cycle's verify history — the archive proceeds
under the Native Review Receipt Gate's ordinary-repository-policy path (no `reviewGate` was
discovered for this candidate; none was requested or referenced by any upstream artifact).

---

## Spec Sync

### Promoted (New Capability, Not a Delta)

`openspec/changes/dashboard-kpis/specs/dashboard-ui/spec.md` is a brand-new capability spec — no
`openspec/specs/dashboard-ui/spec.md` existed before this cycle (confirmed by directory listing of
`openspec/specs/` prior to this archive). Per the skill's "If Main Spec Does NOT Exist" branch, it
was copied mechanically (`cp` → `diff -r` → `mv`, never Read→Write) to
`openspec/specs/dashboard-ui/spec.md` — 6 requirements, 15 scenarios, covering Dashboard Reachable
By Both Roles, Four KPI Cards Fixed Order, Quiebres/Stock-Bajo Tipo-Specific Counts, Alertas Activas
All Tipos, Actividad Reciente (10 most recent), and Panel General Nav Item.

`diff -r` verification of the mechanical copy (source change-spec vs. promoted main spec) produced
**empty output, exit code 0** — byte-identical, no truncation or alteration.

### Merged (Deltas Against Existing Specs)

| Domain | Action | Details |
|--------|--------|---------|
| `app-layout` | MODIFIED — full-block replacement | "Sidebar Items Render As Navigation Links" requirement replaced in full (not appended), per this project's established delta-merge convention; gains the "Panel general" navigation clause plus its `(Previously: ...)` note, and 2 new scenarios appended alongside the 2 pre-existing ones (now 4 total). All other requirements ("Shared Application Layout Component") preserved verbatim. |
| `inventory-movements` | ADDED requirement + archive-phase Non-Goals reconciliation | "Recent Movimientos Are Readable Across All Productos, Unfiltered, By Both Roles" appended (5 scenarios) after the existing "Movement History Is Readable Per Product..." requirement. All 8 pre-existing requirements preserved verbatim. |

**Non-Goals reconciliation (archive-phase-only fix, delta format has no ADDED/MODIFIED mechanism for
prose sections — same pattern as #11's and #12's archive phases used for their own capabilities'
Non-Goals sections)**: `inventory-movements`' main spec previously listed "Cross-product / global
movement listing and reporting (backlog #12)" as a Non-Goal. This was already stale as of #12's own
archive (which added `MovimientosRepo.listByPeriodo`, a cross-producto read, but never reconciled
this line — the spec-phase agent for this cycle independently flagged the same conflict). This
cycle's `listRecientes` (also cross-producto, unfiltered by actor) makes the contradiction
unavoidable to leave unresolved. The line was replaced with prose naming both `listByPeriodo`
(#12) and `listRecientes` (#13) as now-implemented reads on this capability's own `MovimientosRepo`,
clarifying that what remains genuinely out of scope here is only the reporting/dashboard
presentation layer, which belongs to the `reportes` and `dashboard-ui` capabilities respectively —
not a new product decision, a prose correction to match implemented reality.

`diff -r` verification of the mechanical `git mv` archive move (pre-move recursive snapshot vs. the
archived folder, `archive-report.md` excluded as additive-only since it did not exist in the source)
produced **empty output, exit code 0** — byte-identical, no truncation or alteration.

---

## Archive Move

Archived to: `openspec/changes/archive/2026-09-04-dashboard-kpis/`
Contents: `proposal.md`, `exploration.md`, `design.md`, `specs/{dashboard-ui,app-layout,
inventory-movements}/spec.md`, `tasks.md`, `verify-report.md`, plus this `archive-report.md`
(additive).

---

## Merged Pull Requests

| PR | Title | Phase | Status |
|---|---|---|---|
| #170 | Backend: `countAbiertasPorTipo`, `listRecientes`, `dashboard/service.ts`, `routes/dashboard.ts`, `app.ts` | 1+2 | ✅ Merged |
| #171 | Frontend: dashboard screen, `KpiCard`, `ActividadRecienteList`, `AppShell`/`StatusChip` widening | 3 | ✅ Merged |

Per `tasks.md`'s Review Workload Forecast: High 400-line-budget risk as a single PR, chained PRs
recommended (`stacked-to-main`, not a feature-branch chain — PR 2 genuinely needed PR 1's route
contract merged to `main` first), decision-needed-before-apply: Yes. Both units shipped exactly as
forecast — PR 1 (base = `main`), PR 2 (base = `main`, post-PR-1 merge).

---

## Deploy Impact — No Migration, No Manual Neon Step

**Unlike #12, this change needs zero manual Neon step.** Per verify-report's own `git diff --stat`
check against `apps/api/drizzle/`, zero files changed across both merged PRs (#170, #171) — both new
repo methods (`listRecientes`, `countAbiertasPorTipo`) are additive read-only queries over existing
columns/indexes (`movimientos_fecha_idx` from #12, `alertas.estado`/`alertas.tipo`), with no DDL.

No `docs/DEPLOY-PLAN.md` entry is needed for this cycle. Confirmed consistent with how #11
(also zero-migration) was handled: #11 did not get its own dated `DEPLOY-PLAN.md` entry either,
since that document's purpose is tracking outstanding manual migration steps, not documenting every
merge. Only #12 (which added `movimientos_fecha_idx` and still has that migration owed against Neon
per its own archive report) required one.

---

## Claims Gate

Per `CLAUDE.md`'s claims-gate convention, this project requires
`openspec/changes/<cycle>/claims-report.md` before a PR carrying this cycle can be merged (a
`PreToolUse` hook enforces this on `gh pr merge`). No `claims-report.md` exists for this cycle as of
this archive phase. **This archive phase does not produce the claims-report** — per this project's
established precedent (#10, #11, and #12's archive reports all explicitly deferred it as a separate
deliverable owned by the `claims-gate` skill, not `sdd-archive`). The claims gate must run and be
committed before this cycle's PR is merged.

---

## Risk Summary

### Mitigated Risks
- **`AlertasRepo.list({tipo}, 1, 1).total` silently counting resolved alerts** (the literal
  proposal.md snippet design.md D2 explicitly rejected) — did not happen; `countAbiertasPorTipo` is
  confirmed as a genuinely distinct method body composing `and(ne(estado,'resuelta'), eq(tipo,
  tipo))`, sharing no code path with `list()`, and directly proven against the spec's own canonical
  2-quiebre/1-stock_bajo/1-discrepancia mix at real Postgres.
- **`listRecientes` gaining an accidental actor-scoping parameter** — structurally impossible; no
  `usuarioId` slot exists anywhere in the repo interface, the narrowed `ReadRepos.movimientos` type,
  or the call site.
- **No approved wireframe causing screen-shape rework** — mitigated by ratifying card wording/order
  as an explicit, owner-confirmed decision (3) rather than a silent assumption.
- **`countAbiertas()` semantics diverging from "alertas activas"'s intended meaning** — mitigated by
  decision 6 making the reuse explicit and traceable to the existing nav badge, confirmed unmodified
  and still passing its own pre-existing unit test.
- **Migration deploying cleanly and then 500ing silently** — does not apply this cycle; zero schema
  change, confirmed via `git diff --stat` against the pre-cycle merge base.

### Open Risks
- **None blocking archive.** The claims gate has not yet run (see Claims Gate section) — this must
  complete before `gh pr merge` on the PR carrying this cycle's archive commit, per the project's
  `PreToolUse` hook.
- **Two design.md Open Questions were implemented but never explicitly reconfirmed with the owner**
  (StatusChip usage for "Actividad reciente"/"Alertas activas" cards; `countAbiertasPorTipo` being a
  new backend method beyond the original sizing signal) — non-blocking per design.md's own
  documented defaults, matching the actual implementation in both cases (per verify-report
  SUGGESTION 3). Carried forward here as historical record, not re-litigated.

---

## Next Steps (Post-Archive)

1. Run the `claims-gate` skill to produce `claims-report.md` for this cycle before merging the PR
   that carries this archive commit.
2. No manual Neon migration is owed for this cycle (zero schema change).
3. Backlog #14 (Operación local) is the next pending item.

---

## Audit Trail

- **Explore/Propose Phase**: 2026-09-04 (proposal authored, decisions 1-6 ratified by the owner)
- **Spec/Design Phase**: 2026-09-04 (design D1-D6 + 3 spec deltas authored in parallel)
- **Tasks Phase**: 2026-09-04 (tasks.md authored, 17 tasks across 3 phases, chained-PR forecast)
- **Apply Phase**: 2026-09-04 (PRs #170, #171 both merged)
- **Verify Phase**: 2026-09-04 (verify-report authored, PASS after orchestrator's verdict
  correction, 0 CRITICAL/0 WARNING/3 SUGGESTIONS)
- **Archive Phase**: 2026-09-04 (this report; spec promotion, 2 delta merges + Non-Goals
  reconciliation, folder move, backlog flip)

---

## Sign-Off

**Archive Report Authored**: 2026-09-04
**Cycle Status**: ✅ CLOSED — no manual Neon migration owed; claims-gate still owed before merge.
**Recommendation**: Run claims-gate, then proceed to backlog #14 (Operación local).
