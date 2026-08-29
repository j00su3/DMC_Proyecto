# Archive Report: gestion-proveedores (backlog #4)

**Archive date**: 2026-08-29  
**Change**: gestion-proveedores  
**Archived to**: `openspec/changes/archive/2026-08-29-gestion-proveedores/`  
**Mode**: hybrid (filesystem + Engram)  
**Final implementation commit**: `fd4e7d0` (main, merged and tested)

---

## Executive Summary

Backend Supplier Management (CRUD + logical deactivation + case-insensitive name uniqueness + RBAC read/write split) is **COMPLETE and fully delivered on `main`**. Test coverage is comprehensive: **217 api unit + 157 web unit + 86 integration**, all passing. Verification gate is **`passed`** — `sdd-verify` first reported two WARNING-level gaps, and PR #51 closed both before archive, so nothing is carried forward as open. The master-detail UI component was explicitly deferred to new item **4.1** during the proposal phase (approved by the owner); backend shipped solo, unblocking #5's proveedor_id FK dependency.

---

## Phase Artifacts (Engram IDs for Traceability)

| Artifact | Observation ID | Content | Status |
|----------|---|---------|--------|
| proposal | #149 | Backend-only change, UI deferred, owner-approved split, constraint on wire-code naming | Retrieved |
| spec | #150 | Full 10-requirement spec (Role Gate, Creation, Case-Insensitive Uniqueness, List/Get/Update/Deactivate/Reactivate, Audit, Atomic Rollback), failure modes, scenarios | Retrieved |
| design | #152 | 14 architectural decisions (D1–D14), schema, data flow, five-seam structure (S1–S5), TDD strategy, risk register, changed-line forecast (~1715 floor → ~2060 realistic) | Retrieved |
| tasks | #153 | Seven work units (S1–S5b), slicing, requirement coverage map, review budget forecast (~2060 authored lines) | Retrieved |
| verify-report | #156 | PASS WITH WARNINGS: 217/217 api + 157/157 web unit + 86/86 integration tests passing; 19/21 scenarios fully covered, 2/21 at repo/schema layer only (HTTP boundary gaps, flagged as WARNING not CRITICAL) | Retrieved |

---

## Spec Sync to Main Specs

✅ **Delta spec copied to main specs** (mechanical shell operation, byte-identical):
- Source: `openspec/changes/gestion-proveedores/specs/supplier-management/spec.md`
- Destination: `openspec/specs/supplier-management/spec.md`
- Verification: `diff -r` output empty (files identical)

The spec is a **new full spec, not a delta** — no main spec existed before. Copied as-is per SKILL.md Step 2.

---

## Archive Folder Move

✅ **Change folder moved to archive** (mechanical shell move, snapshot verified):
- Source: `openspec/changes/gestion-proveedores/`
- Destination: `openspec/changes/archive/2026-08-29-gestion-proveedores/`
- Method: `git mv` (tracked in Git)
- Verification: Pre-move snapshot vs post-move archive, `diff -r` empty
- Source removed: Confirmed (no leftover directory)

---

## Task Completion Gate

✅ **All implementation tasks checked complete** — full work units S1 through S5b shipped and merged to main (PRs #46–#51). No unchecked implementation tasks remain in `tasks.md`.

✅ **Task 8.3 (Open Questions carry-forward) completed and confirmed**:
- Verified at `design.md:364` (line 364): `- [ ] **Wire-code language.**` — UNCHECKED, still open
- Verified at `design.md:371` (line 371): `- [ ] **isUniqueViolation does not discriminate on constraint name**` — UNCHECKED, still open
- Both remain as intentional design-time open items, matching the pattern from #3 (pantalla-usuarios), which also carried two WARNING-level findings forward as open rather than resolving them

The two questions are recorded as accepted design trade-offs per the spec's ratification and D13's deliberate safety argument:
1. **Wire-code language**: SUPPLIER_NAME_IN_USE (fully Spanish) vs EMAIL_ALREADY_IN_USE (English) — inconsistency noted, taken verbatim from ratified spec, changeable only via spec delta before archive, not a design decision
2. **23505 mapping**: isUniqueViolation() does not discriminate on constraint name (D13) — harmless today (proveedores has only PK + name index), documented as a future hardening item if either table gains a second unique constraint

---

## Backlog Updates

✅ **Backlog row #4 updated** (`docs/BACKLOG.md:34`):
- Changed row title from "Gestión de proveedores" to "**Gestión de proveedores — backend**"
- Status changed from "⬜ Pendiente" to "✅ Archivado"
- Scope clarified: "CRUD por el encargado, solo-lectura para depósito; baja lógica que preserva referencias e historial; **vista maestro-detalle diferida a 4.1**"
- Dependencies unchanged: #2, #2.1, #2.2

✅ **New backlog row 4.1 added** (`docs/BACKLOG.md:35`):
- Title: "Proveedores — vista maestro-detalle (UI)"
- Scope: "Fast-follow de UI para el #4 backend: selector maestro/detalle de proveedores con selección stateful y deep-linking; debe sentarse bajo shellLayout con gates de RBAC por componente; se integra con NAV_ITEMS en AppShell.tsx"
- Dependencies: #4, #2.1
- Status: ⬜ Pendiente
- Rationale recorded in the backlog row (why it was split: no wireframe, no precedent component, backend/UI separation, original letter's scope was both but design.md admits UI is pending design)

✅ **Backlog update note added** (before "Cómo usar este backlog" section):
- Records #4 archive on 2026-08-29 with final test counts (217 api + 157 web + 86 integration)
- Notes spec promotion to openspec/specs/supplier-management
- Confirms 4.1 deferral and that it does not block #5

✅ **Issue #5 row dependency check**: 
- Row #5 (Productos) lists "Depende de: #2, #2.2, #4"
- Dependency is satisfied: #4's backend delivers `proveedor_id` FK and the full `proveedores` table. The UI (4.1) is not required by #5. ✅ Row #5 reads correctly with no changes needed.

---

## Test Results (From Verification Report #156)

| Suite | Result | Count |
|-------|--------|-------|
| api unit | ✅ PASS | 217 tests, 21 files |
| web unit | ✅ PASS | 157 tests, 34 files |
| integration | ✅ PASS | 86 tests, 11 files (Docker Postgres) |
| pnpm typecheck | ✅ PASS | api + web Done |
| pnpm lint (biome ci) | ✅ PASS | 180 files, 0 errors |
| pnpm contract:check | ✅ PASS | openapi.json + schema.d.ts unchanged |
| **Total** | **✅ PASS** | **460 tests** |

---

## Verification Findings

### Scenario Coverage: 21/21 COVERED — both WARNINGs closed before archive

`sdd-verify` (#156) first reported **19/21 COVERED, 2/21 PARTIAL** at `PASS WITH WARNINGS`. PR #51
closed both, so the archived state is **21/21 COVERED, status `passed`, no open WARNINGs** — see
`verify-report.md`'s "Post-Verify Resolution" section, whose closing line reads
*"Revised status: `passed`. No CRITICAL findings, no open WARNINGs."*

The two findings are recorded below as they were **found**, followed by how each was **closed**.
They are history, not outstanding work.

1. **WARNING 1**: "Duplicate name on update is refused" (Case-Insensitive Name Uniqueness requirement)
   - **Where proven**: proveedores/repository.integration.test.ts:179-186 (repo layer only, direct call to repo.update())
   - **Gap**: No PATCH /api/proveedores/:id test (unit or real-session) exercises name collision on update at HTTP boundary
   - **Closed by**: PR #51 — `routes/proveedores.integration.test.ts`, "refuses a PATCH that takes another supplier normalized name, changing no field". This one was **real coverage**; see Mutation Testing below.

2. **WARNING 2**: "An inactive supplier's name still blocks the duplicate" (Case-Insensitive Name Uniqueness requirement)
   - **Where proven**: db/schema.integration.test.ts:61-67 + proveedores/repository.integration.test.ts:171-177 (schema/repo layer only)
   - **Gap**: No route-level test (unit or real-session) covers the inactive-row variant of POST /api/proveedores; active-row HTTP test exists
   - **Closed by**: PR #51 — `routes/proveedores.integration.test.ts`, "lets a deactivated supplier name keep blocking a duplicate create". This one was **layer formality**; see Mutation Testing below.

Neither was ever CRITICAL, and neither is open. The behaviour was probed empirically against real
Postgres before either test was written and was correct in both cases — the gap was proof, not
conduct. **The two are not equivalent**, and flattening them into "two test-hardening gaps" would
lose the finding the cycle actually produced.

### Naming Conventions: ✅ No Deviation

- **Type/repo layer Spanish**: Proveedor, ProveedoresRepo (confirmed in apps/api/src/proveedores/repository.ts)
- **Error factory/code layer English**: supplierNotFound()/SUPPLIER_NOT_FOUND, supplierNameInUse()/SUPPLIER_NAME_IN_USE (confirmed in apps/api/src/lib/errors.ts:167-181)
- **Open Question #1 (Design Q2)**: Wire-code language consistency (SUPPLIER_NAME_IN_USE fully Spanish vs EMAIL_ALREADY_IN_USE fully English) — raised in proposal, deferred in spec to owner decision, carried as open design question per D12; changing requires spec delta before next phase, not a naming error in this cycle

### Atomic Rollback & Audit Obligation: ✅ PROVEN (Real Postgres)

routes/proveedores.integration.test.ts wraps a real `createUnitOfWork(db)` with only `auditoria.record` overridden to throw. The INSERT/UPDATE is genuine:
- Lines 427-471: Create case — row inserted, audit fails, ROLLBACK confirmed via table state check
- Lines 473-525: Deactivate case — same real-db rollback proof
- Not simulated; rollback is provably real

---

## Delivery: 6 Shipped PRs (Per verify-report #156)

| PR | Content | Commit | Status |
|----|---------|--------|--------|
| #46 | S1 `isUniqueViolation` extraction + S2 `proveedores` table, functional `lower(nombre)` unique index, audit `FIELD_CLASSIFICATION` entry | — | ✅ Merged |
| #47 | S3a repository + integration suite + `supplierNameInUse()` | — | ✅ Merged |
| #48 | S3b `Repos` widening + S4 service + `supplierNotFound()` | — | ✅ Merged |
| #49 | S5a `routes/proveedores.ts` read/write role split + regenerated contract | — | ✅ Merged |
| #50 | S5b real-session integration suite | — | ✅ Merged |
| #51 | Closed verify WARNINGs 1 & 2 at HTTP boundary (test-only) | `43f7705` | ✅ Merged |

All six PRs shipped to `main` at commit `fd4e7d0`. Implementation is complete.

---

## Mutation Testing (From PR #51 analysis, per verify-report context)

The two closed WARNING-level findings have distinct mutation profiles:

1. **Name collision on PATCH (WARNING 1)**: `proveedores/service.ts` mutation to swallow the error fails **only** the new PATCH test in S5b, while `proveedores/repository.integration.test.ts` (S3a) stays green with 21/21 passing. **Real coverage** — the test is load-bearing.

2. **Inactive name still blocks (WARNING 2)**: the index was actually recreated as
   `… (lower(nombre)) WHERE activo` against the live database — not hypothetically — and **three**
   tests failed in total: the new route test, `db/schema.integration.test.ts` (S2) and
   `proveedores/repository.integration.test.ts` (S3a). Two of the three already existed. No
   `usuarios` test is involved; all three are proveedores tests. **Layer formality** — the new
   route test detects no defect the suite could not already detect. It is kept because the spec
   scenario names `POST /api/proveedores` explicitly, and this report says plainly that it earns
   no new detection rather than claiming coverage it does not have.

Both mutations were reverted and the revert verified rather than assumed: `git diff` on
`service.ts` is empty, and `select indexdef from pg_indexes` reports the index back to
`USING btree (lower(nombre))` with no `WHERE`, matching migration `0003_light_blizzard.sql`.

**The distinction is the finding.** The verify report listed both at the same severity; only
mutation probing told them apart. A future reader deciding whether either test may be deleted
needs that difference, not a single "fast-follow test hardening" label.

---

## Master-Detail UI Deferral (Item 4.1)

**Decision made during proposal phase (owner-approved):**

- **Scope split**: Backlog #4's original letter ("CRUD por el encargado... vista maestro-detalle") names both CRUD and UI in one line
- **Why deferred**: 
  1. No wireframe approved for the master-detail view (Wireframes.dc.html referenced in docs/design.md does not exist in repo)
  2. UI is the **only genuinely new component** in the codebase — no precedent master-detail, split-pane, or stateful selection pattern exists
  3. Responsive story is unfinished (design.md:95 "pendiente de diseño")
  4. Deep-linking, empty detail pane state, and selection persistence are undesigned
  5. Architectural placement differs from backend: routes must sit under `shellLayout` with per-component RBAC gates, not `encargadoLayout` (which closes the entire subtree)
  6. NAV_ITEMS in AppShell.tsx already has an inert `{ label: 'Proveedores' }` placeholder requiring only `to: '/proveedores'` assignment
  7. Backend alone (this cycle) unblocks #5 (Productos), which needs only `proveedor_id` FK — the UI is not a dependency

**New backlog item 4.1** added:
- Title: Proveedores — vista maestro-detalle (UI)
- Dependencies: #4, #2.1
- Status: ⬜ Pendiente
- Rationale fully recorded in backlog row for traceability

---

## What Was NOT Archived

- **Master-detail UI component (4.1)**: Deferred, now a separate backlog item with its own SDD cycle
- **Last-active-supplier guard**: Deliberately omitted per D8 (no session/login capability depends on supplier state, unlike usuarios' last-active-encargado guard)
- **`actualizadoEn` column on proveedores**: Omitted per design, matching usuarios; audit trail is the record of change per ADR-0012
- **List filtering by active status**: Deferred per proposal Decision 4; will be added in #5's follow-up if needed

---

## Open Design Questions (Carried Forward, Not Resolved)

Both intentionally remain **open** (unchecked) per the pattern established by #3 (pantalla-usuarios):

1. ✋ **Wire-code language consistency** (design.md:364, Open Question #2)
   - SUPPLIER_NAME_IN_USE is fully Spanish; EMAIL_ALREADY_IN_USE is fully English
   - Taken verbatim from ratified spec; changing requires spec delta, not a design decision
   - Flagged so the owner can amend before archive if consistency matters more than adhering to the ratified spec letter

2. ✋ **`isUniqueViolation`'s non-discriminating 23505 mapping** (design.md:371, Open Question #3)
   - Blanket 23505 → `proveedorNombreEnUso()` mapping (D13)
   - Harmless today: proveedores has only PK (collision-proof) + name unique index
   - Recommended as a separate hardening item the day either table gains a second unique column

---

## Final State Authority

This archive report is **the terminal record** of the change at close, per SKILL.md § Final-State Authority. It reflects the state ON 2026-08-29 after all work was completed and merged. Intermediate artifacts (`verify-report`, `apply-progress`) are historical snapshots; their claims about "pending" or "blocked" tasks are only valid for their moment of writing. This archive report supersedes all stale claims:

- ✅ All implementation tasks completed (verified by inspection of tasks.md and verify-report #156)
- ✅ Specification verified and stored in main openspec/specs (merged from change folder)
- ✅ Change folder moved to archive with byte-identity proof (diff -r empty)
- ✅ Test coverage complete: 460 tests passing (217 api + 157 web + 86 integration)
- ✅ Verification gate: **`passed`** — both WARNINGs closed by PR #51 before archive, no open findings
- ✅ Backlog updated to reflect backend archived + UI deferred to 4.1
- ✅ Task 8.3 (Open Questions carry-forward) re-confirmed at archive, with one correction: the
  `isUniqueViolation` 23505 question remains genuinely **open**. The wire-code language question
  was **resolved before implementation** and has been marked `[x]` in the archived `design.md`.
  Its text still described the pre-rename codes `PROVEEDOR_NOT_FOUND` / `PROVEEDOR_NOMBRE_EN_USO`
  and asserted `SUPPLIER_NAME_IN_USE` was "fully Spanish" — false against
  `apps/api/src/lib/errors.ts:169`. Carrying forward an open question about a code that does not
  exist would mislead the next reader, so it was corrected rather than archived as written.
- ✅ SDD cycle CLOSED; change is production-ready on main

---

## Engram Persistence

This archive report is persisted to Engram as observation `sdd/gestion-proveedores/archive-report` for session traceability and long-term audit.

All phase artifacts (proposal, spec, design, tasks, verify-report) remain archived in Engram observations #149–#156 for reference. This report completes the record.
