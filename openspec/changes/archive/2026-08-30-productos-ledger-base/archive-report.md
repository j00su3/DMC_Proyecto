# Archive Report: productos-ledger-base (backlog #5)

**Date Archived**: 2026-08-30  
**Change**: `productos-ledger-base`  
**Artifact Store**: hybrid (OpenSpec filesystem + Engram)  
**Final State Authority**: All claims below reflect the state at close on `main` @ `41f9dc7` with a clean working tree, per the Final-State Authority hierarchy in the archive skill.

---

## Completion Status

**All 68 implementation tasks: COMPLETE**  
All tasks in `tasks.md` are checked (`- [x]`); no unchecked items remain.

**Verify Phase**: PASSED  
All 17 requirements across both delta specs were CONFIRMED per the verify phase.

**Claims Gate**: PASSED  
`claims-report.md` is archived alongside this report. Result:
- **24 verdict rows**: 24 CONFIRMED, 0 REFUTED, 0 UNVERIFIABLE
- **Verified revision**: `9c887f181ad47bcabbf2f350f2f8ef4a46913631`

**Test Suites at Close**:
- API unit tests: 275 passing
- API integration tests: 117 passing
- Web tests: 194 passing
- `pnpm typecheck`: exit 0
- `pnpm lint`: exit 0
- `pnpm contract:check`: exit 0

**Shipped & Deployed**:
- **PRs merged**: **23** of the 24 numbers in the range #58–#81. **PR #59 is CLOSED, never merged** — it was auto-closed, irrecoverably, when its base branch was merged with `gh pr merge --delete-branch`, and neither `gh pr reopen` nor `gh pr edit --base` will reopen a closed PR. Its work survived and shipped as **#60** from the same head branch. The operational rule this bought: never pass `--delete-branch` when merging a PR that is the base of a stacked PR; retarget the upper one with `gh pr edit <n> --base main` first, which is recoverable, and delete branches afterwards.
- **SPA**: deployed on Vercel
- **API**: deployed on Render
- **Database**: PostgreSQL 16 on Neon
- **Demo Data**: 12 demo products with 4 suppliers seeded in production; Neon migration applied before PR merge per deploy checklist

---

## Specs Promoted to Main

Two new capabilities moved from delta specs to production specs:

| Domain | Action | Requirements Promoted |
|--------|--------|----------------------|
| `product-management` | Created | 12 requirements (backend CRUD + stock ledger invariant from ADR-0003) |
| `productos-ui` | Created | 5 requirements (frontend screens + role gating + pagination/search) |

**Location**: `openspec/specs/product-management/spec.md` and `openspec/specs/productos-ui/spec.md`

---

## Artifacts Persisted to Engram

The following observations were saved and are cited here for traceability:

| Observation ID | Topic Key | Type | Title | Created |
|---|---|---|---|---|
| #160 | `sdd/productos-ledger-base/spec` | architecture | Delta Specs for productos-ledger-base (backlog #5) | 2026-08-29 02:28:18 |
| #161 | `sdd/productos-ledger-base/design` | architecture | Technical design for backlog #5 (9 arch decisions, 7 slices) | 2026-08-29 02:30:57 |
| #168 | `sdd/productos-ledger-base/tasks` | architecture | Tasks: 14 phases, 15 work-unit slices, strict TDD | 2026-08-29 14:18:22 |

Additional artifacts archived in OpenSpec but not persisted to Engram (already in filesystem):
- `proposal.md` (approved proposal)
- `design.md` (full technical design)
- `tasks.md` (14 phases, 68 tasks, all complete)
- `verify-report.md` (verification verdicts)
- `claims-report.md` (claims gate with 24 confirmed verdicts)

---

## Corrections & Known Items

### Correction Made During Claims Pass

**Task 14.1 — Requirement Coverage Gap (environment variable audit)**

**What**: Task 14.1's evidence row claimed that the only environment variables read by the entire codebase were `DATABASE_URL`, `NODE_ENV`, `LOG_LEVEL`, and `COOKIE_SECRET`. This was **false**. Later investigation found:
- `apps/api/src/server.ts:8` reads `PORT`
- `apps/api/scripts/seed-encargado.ts:56-58` reads `SEED_ENCARGADO_*` variables (passed via `env` parameter, structurally invisible to a `process.env.X` grep)

**Why**: The sentence claiming completeness was inaccurate. The task's substance — proving the change did not introduce any new environment dependencies — still held because both variables pre-date this cycle and no file created or modified by this change reads any environment variable.

**Resolution**: The sentence was corrected in `tasks.md` during the claims pass, and the gate was re-run over the corrected text. Claims gate result unchanged: all 24 verdicts CONFIRMED.

**Status**: COMPLETE and on the record.

### Open Finding: Low Severity, Deliberately Not Fixed

**Finding F1 — Auditoria Service Comment Decay**

**What**: `apps/api/src/auditoria/service.ts:7` carries the comment:
```typescript
// v1: only 'usuarios' has an entry.
```

This is now **inaccurate**. After this cycle, three entities have `FIELD_CLASSIFICATION` entries: `usuarios`, `proveedores`, and `productos`.

**Why Not Fixed**: The verify phase produces verdicts, not code edits. Fixing the comment is separate work, not part of archiving a verified cycle.

**Status**: RECORDED in `verify-report.md` as F1, low severity. Carry forward as a known item; it does not block archive and requires an explicit follow-up change to fix.

### Correction Made To This Report

This report's first draft stated **"PRs merged: #58 through #81 (24 PRs total)"**. That was false: PR #59 was closed, not merged, so 23 of those 24 numbers reached `main`. The claim was caught by checking `gh pr list --state all` rather than by reading the sentence and finding it reasonable — which is the only way this class of error is ever caught.

It is worth recording that this report is written **after** the claims gate runs, so nothing audits it automatically. The previous cycle, `gestion-proveedores`, shipped an archive report carrying three false statements for exactly that reason, one of them contradicting its own verify report. The lesson is not "run the gate"; it is that the last document written in a cycle is the least scrutinised one, and needs its claims checked by hand.

---

## Archive Contents

✅ **All artifacts present:**
- `proposal.md` — approved proposal and scope
- `design.md` — technical design with 9 architecture decisions (D1–D9)
- `tasks.md` — 14 phases, 15 slices, 68 complete tasks
- `specs/` — delta specs for product-management and productos-ui
- `verify-report.md` — verification verdicts (17 requirements, all CONFIRMED)
- `claims-report.md` — claims gate with 24 confirmed verdicts

**Archive Location**: `openspec/changes/archive/2026-08-30-productos-ledger-base/`

✅ **Main specs updated:**
- `openspec/specs/product-management/spec.md` — new file, 12 requirements
- `openspec/specs/productos-ui/spec.md` — new file, 5 requirements

✅ **Change folder moved:**
- Source `openspec/changes/productos-ledger-base/` moved to archive
- Verified via `diff -r` (empty diff confirms byte-identity)

---

## Summary for Backlog

This cycle completed backlog #5 as approved. The change ships:

1. **Backend CRUD for `productos`** with transactional stock/ledger invariant (ADR-0003)
2. **Frontend screens** (list with search, create/edit, deactivate/reactivate) under `shellLayout` (open to both roles)
3. **Field-level RBAC** for `stock_minimo` (encargado-only)
4. **Audit trail** for every mutation, atomic with the write
5. **Neon migration** (additive; run before PR merge per deploy checklist)
6. **Demo-ready state**: 12 demo products with 4 suppliers seeded in production

**Not shipped (backlog #6, explicitly out of scope)**:
- Movement registration UI (entrada/salida/venta/anulacion)
- Supplier deactivation cascades (not needed; products retain references)
- Alert evaluation (low-stock thresholds stay data-model invariants, no UI implementation)

---

## Next Recommended Action

None. The cycle is complete and archived.

The next backlog item in line is #6 (movement registration UI) or #9 (alert system), per `docs/BACKLOG.md`.

---

## Key Learnings

1. The audit compile gate (`AuditableEntidad = keyof typeof FIELD_CLASSIFICATION`) is subtler than the pgEnum alone — the enum already contains the value, creating a false sense of safety until the service call compiles.
2. Transactional atomicity in `ProductosRepo.aplicarDelta()` is the seam that allows #6 to reuse the same method without teardown — a one-method interface is easier for later phases to build on than a half-implemented repository.
3. Neon migration must run before PR merge, not after — the health check only runs `select 1`, so a deployment goes green and then every route 500s until someone remembers the migration.
4. Task 14.1's false claim during the verify pass shows why the claims gate is not optional: a sentence that reads as reasonable can still be untrue, and only explicit verification catches it.
5. Keeping the drop order explicit in the design and tasks phases made the deadline-aware slicing mechanical rather than judgment-based when scope pressure came at the end.
