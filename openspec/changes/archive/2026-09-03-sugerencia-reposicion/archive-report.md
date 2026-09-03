# Archive Report: Sugerencia de Reposición (backlog #11)

**Cycle**: sugerencia-reposicion
**Backlog Item**: #11
**Status**: ✅ ARCHIVED AND CLOSED
**Archive Date**: 2026-09-03
**Archive Authority**: sdd-archive
**Merged Revision**: 3cdf006 (main, HEAD) — PR #161 (0e304f8) + PR #162 (3cdf006), both merged, working tree clean at verify time

---

## Traceability to All Artifacts

All change artifacts are traced to Engram observations (immutable record across sessions):

| Artifact | Observation ID | Title | Created |
|----------|---|---|---|
| Exploration | #286 | sdd/sugerencia-reposicion/explore | 2026-09-03 00:16:12 |
| Proposal | #287 | sdd/sugerencia-reposicion/propose | 2026-09-03 13:13:56 |
| Design | #288 | sdd/sugerencia-reposicion/design | 2026-09-03 13:48:56 |
| Spec (delta) | #289 | sdd/sugerencia-reposicion/spec | 2026-09-03 13:48:57 |
| Tasks | #290 | sdd/sugerencia-reposicion/tasks | 2026-09-03 13:51:20 |
| Apply Progress | #291 | sdd/sugerencia-reposicion/apply-progress | 2026-09-03 14:50:46 |
| Verify Report | #292 | sdd/sugerencia-reposicion/verify-report | 2026-09-03 18:26:34 |

This archive report is persisted as `sdd/sugerencia-reposicion/archive-report` (Engram), closing
the cycle. All observations above (#286-#292) are superseded by this archive report as the
terminal record for the cycle; they remain in Engram as valid history of what was true at the time
each was written, per the Final-State Authority hierarchy in the `sdd-archive` skill.

---

## Cycle Summary

### Scope (Proposal)

#10 (motor de alertas) shipped `stock_bajo`, `quiebre`, and `discrepancia`, and deliberately left
`sugerencia_reposicion` unimplemented (its archive report named #11 as the direct successor). #11
closes that gap with the S7 heuristic ratified in ADR-0008: suggest reposición when a product's
30-day sales-velocity-implied coverage drops below 14 days.

**In Scope**:
- New evaluator rule producing `sugerencia_reposicion` alerts (exact S7 definition).
- Widening `TipoAlertaEvaluada` (`alertas/repository.ts`) and `TIPOS_MANUALMENTE_RESOLVIBLES`
  (`alertas/service.ts`) — the two compile-time gates #10's own D5 deliberately left excluding
  `sugerencia_reposicion`.
- New `MovimientosRepo.resumenRotacion` aggregate (30-day venta+salida sum, first-movimiento date).
- Wiring into `registrarSiCorresponde()`, reusing #10's SAVEPOINT-isolated, synchronous,
  in-transaction trigger mechanism.
- Manual-only resolution (encargado), consistent with the existing `discrepancia` precedent.

**Out of Scope** (owner-ratified 2026-09-03):
- Suggested-quantity column/migration — S7's ratified definition is a coverage-day threshold, not
  a quantity. Deferred to a future backlog item.
- Dedicated UI for this alert type (backlog #13) — surfaces through #10's existing generic Alertas
  table.
- Any change to `stock_bajo`, `quiebre`, or `discrepancia` behavior.
- `ventas/service.ts::anularVenta` is excluded from evaluation — a reversal restores stock, not new
  outbound demand.

### Design (D1–D7)

**Architecture Decisions** (all confirmed implemented, per verify-report #292):

- **D1**: `TipoAlertaEvaluada` collapses to `= TipoAlerta` (drops the `Exclude<...>` alias); type
  name kept.
- **D2**: `TIPOS_MANUALMENTE_RESOLVIBLES` gains `sugerencia_reposicion`; never auto-resolves,
  mirroring `discrepancia`'s existing precedent exactly.
- **D3**: `anularVenta`'s exclusion lives inside `evaluar()`, keyed on `movimiento.tipo`, avoiding
  a call-site signature change across all four `registrarSiCorresponde` callers.
- **D4**: Boundary semantics — `cobertura_dias < 14` strict, `diasHistoria >= 7` strict, divisor =
  `min(diasHistoria, 30)`, using Postgres `now()` for transaction-consistent time.
- **D5**: `MovimientosRepo.resumenRotacion` — one query, conditional aggregation, reuses the
  existing `movimientos_producto_id_fecha_idx` index, no new index or migration.
- **D6**: Evaluator reads `movimiento.stockResultante`, never a fresh `producto.stockActual`
  (avoids the same staleness class #10's design already guarded against).
- **D7**: `EvaluadorRepos` widens by one `Pick<MovimientosRepo, 'resumenRotacion'>`, zero
  call-site changes — structural typing routes the existing `Repos` object through unchanged.

**Evaluator Logic** (new branch, appended to #10's existing branches):
```ts
if (movimiento.tipo !== 'anulacion') {
  const { unidadesSalida30d, diasHistoria } = await repos.movimientos.resumenRotacion(movimiento.productoId);
  if (diasHistoria >= 7) {
    const divisor = Math.min(diasHistoria, 30);
    const promedioDiario = unidadesSalida30d / divisor;
    if (promedioDiario > 0) {
      const coberturaDias = movimiento.stockResultante / promedioDiario;
      if (coberturaDias < 14) -> create 'sugerencia_reposicion'
    }
  }
}
```

### Implementation (11 Phase 1-2 Tasks, 100% Complete)

**Phase 1 — Foundation** (3 tasks): `MovimientosRepo.resumenRotacion` (D5), integration tests
(30-day boundary, `diasHistoria` unbounded), mutation-probed.
**Phase 2 — Evaluator, gates, wiring** (8 tasks): Evaluator branch (D1-D4/D6/D7), compile-gate
widenings, `resolver()` unit test, mutation-probed `anularVenta` exclusion, per-call-site
integration proof, dedup proof, route-level resolve test.

All 11 tasks checked `[x]` in `tasks.md` at merge time and independently cross-checked against
actual source/test files by `sdd-verify` (not trusted from the checkbox alone). No stale checkbox
reconciliation was needed.

### Verification (PASS, 0 CRITICAL, 0 WARNING)

Per verify-report #292 (verified at revision 3cdf006, main HEAD, working tree clean):

- **Verdict**: PASS
- **Blockers**: 0
- **Critical findings**: 0
- **Warnings**: 0
- **Suggestions**: 3 (all non-blocking — see below)
- **Requirements**: 5/5 traced to code; **Scenarios**: 13/13 compliant (100%)

**Test Coverage** (evidence_revision sha256:3cdf0063c3c1d39e9ddf555c2bb2004a9e0fe06c):
- API unit tests: 564/564 passed (up from #10's 552)
- Web unit tests: 525/525 passed
- Integration tests (real Postgres): 169/169 passed (up from #10's 159)
- `pnpm typecheck`: green (exit 0)
- `pnpm lint`: green (353 files, 0 fixes)
- `pnpm contract:check`: green (zero diff)

**Design Coherence**: all 7 decisions (D1-D7) confirmed implemented exactly as specified by direct
source reading (evaluador.ts, repository.ts × 2, service.ts) — see verify-report #292's
line-numbered evidence table.

**Zero production-code-changes claim, independently diff-verified**: `git diff e755bcc..3cdf006 --
apps/api/src/movimientos/service.ts apps/api/src/productos/service.ts apps/api/src/ventas/service.ts`
returned empty — the three existing #10 call sites route the new rule through structural typing
with no code change of their own, exactly as design.md D3/D7 predicted.

**Migration check**: `git diff e755bcc..3cdf006 --stat -- apps/api/drizzle/` returned empty — zero
migration files added by either PR. Confirmed by listing `apps/api/drizzle/*.sql` (9 files, all
pre-dating this cycle).

**Suggestions (non-blocking, carried forward for future reference)**:
1. `crearProducto`'s `stockInicial > 0` branch can structurally never fire `sugerencia_reposicion`
   (a brand-new producto's first-ever movimiento always yields `diasHistoria = 0`, failing the
   `>= 7` gate). Not a defect against this cycle's ratified scope — worth flagging for whoever
   eventually revisits the `stockInicial = 0` limitation #10 already left in place.
2. Mutation probing for the two named load-bearing tests (1.3 — 30-day boundary; 2.5 —
   `anularVenta` exclusion) was spot-checked by close reading during `sdd-verify` rather than
   re-executed; task-level mutation probing (1.3/2.5 in `tasks.md`) was completed during apply. If
   a future regression touches either guard, re-run the actual mutation sweep.
3. No `claims-report.md` existed at verify time — flagged so archive does not skip it (see Claims
   Gate note below; this is a `claims-gate`-owned deliverable, produced separately, not by
   `sdd-archive`).

---

## Final State Authority

Per the launch prompt's explicit final-state facts and direct repository verification performed in
this archive phase:

- Both PR #161 and PR #162 are merged to `main`. `git log` confirms: `3cdf006` (merge #162),
  `95ea664` (feat commit), `0e304f8` (merge #161), `2f49272` (feat commit).
- `git status` at archive start showed a clean working tree except for the untracked
  `verify-report.md` (never committed to `main` by the verify agent — it existed only on disk
  under `openspec/changes/sugerencia-reposicion/`). This archive phase's `git mv` of the whole
  change folder is what brings `verify-report.md` into version control for the first time, as part
  of the archived cycle.
- Verify-report #292's PASS verdict, 0 CRITICAL / 0 WARNING findings, and 5/5 requirement /
  13/13 scenario compliance stand as the final verification state for this cycle — no later commit
  contradicts or supersedes it.
- No CRITICAL findings existed at any point in this cycle's verify history — the archive proceeds
  under the Native Review Receipt Gate's ordinary-repository-policy path (no `reviewGate` was
  discovered for this candidate; receipt-driven development review, if enabled at all in this
  project, was never started for this specific candidate).

---

## Spec Sync (Delta → Main)

Merged `openspec/changes/sugerencia-reposicion/specs/alertas/spec.md` into
`openspec/specs/alertas/spec.md`:

| Action | Requirement | Detail |
|---|---|---|
| ADDED | Sugerencia De Reposición Evaluation Rule (S7 Heuristic) | 5 scenarios |
| ADDED | Sugerencia De Reposición Evaluated Only At Specific Call Sites | 2 scenarios |
| ADDED | Sugerencia De Reposición Reuses Existing De-Duplication | 1 scenario |
| ADDED | Sugerencia De Reposición Carries No Suggested Quantity | 1 scenario |
| MODIFIED | Manual Resolution Restricted To Encargado | Full block replaced (not appended) — now covers both `discrepancia` and `sugerencia_reposicion`, 4 scenarios total (2 pre-existing + 2 new) |

All 5 pre-existing requirements not touched by the delta (Alertas Table Schema,
Threshold-Crossing Creation, De-Duplication Per Producto And Tipo, Auto-Resolution On Stock
Recovery, Discrepancia Creation From Flagged Ajuste, Evaluator Failure Never Rolls Back The
Movement, Evaluation Triggered At Every Movimiento-Creation Call Site, Both Roles Can View Alerts,
Alert Create And Resolve Are Audited) were preserved verbatim.

**Additional archive-phase update** (per the delta format having no ADDED/MODIFIED mechanism for
prose sections): the main spec's `## Non-Goals` section previously listed
`sugerencia_reposicion (backlog #11, PD-1)` as deferred — this line was removed now that #11 is
implemented, and replaced with the two decisions that remain genuinely out of scope (suggested
quantity column, dedicated UI for backlog #13), both correctly attributed to their respective
backlog items.

`diff -r` verification of the mechanical `git mv` archive move (source pre-move snapshot vs.
archived folder, `archive-report.md` excluded as additive-only) produced **empty output, exit code
0** — byte-identical, no truncation or alteration.

---

## Merged Pull Requests

| PR | Title | Phase | Status |
|---|---|---|---|
| #161 | feat(alertas): add resumenRotacion aggregate for sugerencia_reposicion | 1 | ✅ Merged (0e304f8) |
| #162 | feat(alertas): evaluate sugerencia_reposicion via S7 heuristic | 2 | ✅ Merged (95ea664 → 3cdf006) |

Both PRs merged to `main` cleanly; no chained/stacked-PR review-budget exception was needed
(tasks.md forecast: Medium 400-line risk, no chaining recommended, decision-needed-before-apply:
No).

---

## Deploy Impact — No Manual Action Required

**Unlike #10, this change introduces NO schema or migration change and needs NO manual Neon
step.** Confirmed by direct diff (`git diff e755bcc..3cdf006 --stat -- apps/api/drizzle/` — empty)
and by listing `apps/api/drizzle/*.sql` (9 pre-existing files, none added by PR #161 or #162). The
pgEnum `alertaTipo`, the partial dedup unique index, and the `alertas.movimientoId` FK were already
generic enough to accept the fourth `tipo` value since #10 built them that way (#10's own D5).

This is a pure code change: one new repository method, one new evaluator branch, two one-line
compile-gate widenings. It is safe to deploy via the normal Render/Vercel auto-deploy pipeline with
zero extra action from the owner — no `pnpm db:migrate` step, no Neon console check, no deploy
window risk.

A dated entry documenting this was added to `docs/DEPLOY-PLAN.md`'s "Registro de ejecución y
verificación" section (`### 2026-09-03 — Sugerencia de reposición (#11) merged; NO schema/migration,
safe auto-deploy`), mirroring the format of #10's migration-required entry but with the opposite
conclusion.

---

## Claims Gate

Per `CLAUDE.md`'s claims-gate convention, this project requires
`openspec/changes/<cycle>/claims-report.md` before a PR carrying this cycle can be merged (a
`PreToolUse` hook enforces this on `gh pr merge`). No `claims-report.md` existed at verify time
(flagged as verify-report #292's SUGGESTION 3). **This archive phase does not produce the
claims-report** — per this project's established precedent (#10's archive-report explicitly
deferred it as a separate "Phase 5"-style deliverable, and the claims-gate skill is the owning
tool, not `sdd-archive`). The claims gate must run and be committed before this cycle's PR is
merged.

---

## Risk Summary

### Mitigated Risks
- **`TIPOS_MANUALMENTE_RESOLVIBLES` gate silently 409-ing at runtime**: explicitly tested —
  `service.test.ts` and `routes/alertas.test.ts` both confirm `resolver()` succeeds (200) for
  `sugerencia_reposicion` without a 409.
- **First alert rule reading a table other than its triggering row inside the transaction**: proven
  correct at real-Postgres integration scale; existing index (`movimientos_producto_id_fecha_idx`)
  confirmed sufficient, no new index needed.
- **Wiring into the wrong subset of call sites**: owner ratified the exact call-site set in
  proposal.md before design/tasks; `anularVenta`'s exclusion is independently mutation-probed
  (task 2.5) and independently re-derived by `sdd-verify` (verify-report #292).

### Open Risks
- **None blocking archive.** The `crearProducto` structural-impossibility (SUGGESTION 1) is an
  accepted, documented limitation inherited from #10, not a defect of this cycle.
- **Claims gate not yet run** — must complete before `gh pr merge` on the PR carrying this
  cycle's archive commit, per the PreToolUse hook described above.

---

## Next Steps (Post-Archive)

1. Run the `claims-gate` skill to produce `claims-report.md` for this cycle before merging the PR
   that carries this archive commit.
2. Deploy: no manual Neon step required — normal Render/Vercel auto-deploy applies.
3. Backlog #12 (Reportes) and #13 (Dashboard/KPIs) remain pending; #13 is the natural home for any
   future dedicated `sugerencia_reposicion` UI polish (explicitly deferred by this cycle's
   Non-Goals).

---

## Audit Trail

- **Explore Phase**: 2026-09-03 00:16 (exploration authored)
- **Propose Phase**: 2026-09-03 13:13 (proposal authored)
- **Spec/Design Phase**: 2026-09-03 13:48 (spec delta + design authored in parallel)
- **Tasks Phase**: 2026-09-03 13:51 (tasks.md authored, Phase 1 already merged)
- **Apply Phase**: 2026-09-03 14:50 (Phase 2 implementation complete, branch
  `feat/sugerencia-reposicion-phase2`)
- **Verify Phase**: 2026-09-03 18:26 (verify-report authored, PASS, 0 CRITICAL/WARNING)
- **Archive Phase**: 2026-09-03 (this report; spec merge, folder move, backlog flip, deploy note)

---

## Sign-Off

**Archive Report Authored**: 2026-09-03
**Cycle Status**: ✅ CLOSED — no manual deploy action required; claims-gate still owed before merge
**Recommendation**: Run claims-gate, then proceed to backlog #12 (Reportes) or #13
(Dashboard/KPIs).
