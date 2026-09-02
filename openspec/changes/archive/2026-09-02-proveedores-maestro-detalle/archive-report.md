# Archive Report: proveedores-maestro-detalle (backlog #4.1)

**Change**: proveedores-maestro-detalle
**Archived to**: `openspec/changes/archive/2026-09-02-proveedores-maestro-detalle/`
**Archived at**: 2026-09-02
**Final revision**: fa45b9b (main)

## Change Summary

A new master-detail supplier (proveedores) screen for InvenTienda, providing both roles with the ability to browse, search, and filter the full supplier catalog client-side. Encargado gains create/edit/deactivate/reactivate capabilities; deposito sees a fully read-only detail pane with visible lock reasons. The screen integrates into `AppShell.tsx`'s `NAV_ITEMS` and supports deep-linking via a bookmarkable `?selected=<uuid>` URL parameter.

## Spec Promotion

The new capability `proveedores-ui` has been promoted from the change folder to the main spec repository:

| Domain | Action | Path | Details |
|--------|--------|------|---------|
| proveedores-ui | Created | `openspec/specs/proveedores-ui/spec.md` | Full specification: unpaginated master list, client-side filtering, detail pane with role-gated write controls, deep-linking, distinct not-found state |

## Verification Summary

**Verify Verdict**: PASS with WARNING (per verify-report, 2026-09-01, revision 3e055d1)

- **Requirements**: 9/9 verified
- **Scenarios**: 15/15 verified  
- **Tasks**: 23/23 checked complete
- **Test Coverage**: 75 files / 488 tests passed
- **Lint & Type Check**: Clean

### Verification Finding — Create-Trigger Placement (WARNING)

The verify-report identified one WARNING: the "Crear proveedor nuevo" trigger was placed only in the detail pane's nothing-selected placeholder, making it unreachable once a supplier is selected.

**Status**: RESOLVED by PR #144 (merged post-verify, 2026-09-01 after the verify-report was written). The verify-report's own text explicitly notes "this WARNING ... was fixed by PR #144", confirming the fix preceded archive by design.

### Post-Verification Bugfixes (Not Verify Findings)

Two additional bugs were discovered during live testing after verify and closed separately:

1. **ProveedorForm stale defaultValues (PR #145)**: react-hook-form was not correctly resetting form values when switching between suppliers. Fixed with explicit `reset()` on supplier selection.
2. **Master-pane CSS grid overflow (PR #146)**: The master list pane's CSS grid column width (`340px`) caused text overflow. Fixed with `overflow: hidden` and text truncation, matching the design-token `340px` constraint from `docs/design.md:93`.

Neither of these was a verify-report finding; both are clean bugfixes with passing tests, discovered and resolved as part of normal post-verify iteration.

## Task Completion

All 23 implementation tasks marked complete in `openspec/changes/archive/2026-09-02-proveedores-maestro-detalle/tasks.md`:

- **Phase 1 (Data Layer)**: 8/8 tasks complete — error messages, schemas, hooks, mutations
- **Phase 2 (Presentational Components)**: 6/6 tasks complete — table, form, detail panel
- **Phase 3 (Route Wiring)**: 7/7 tasks complete — route, navigation, integration, test coverage
- **Phase 4 (Cleanup)**: 2/2 tasks complete — lint cleanup, BACKLOG update

No unchecked implementation tasks remain in the archived artifact.

## File Inventory

The archived change folder contains:

- `proposal.md` ✅ — product decisions (PD-1 through PD-5), scope, approach, risks, rollback
- `specs/proveedores-ui/spec.md` ✅ — full capability specification (requirements, scenarios, non-goals)
- `design.md` ✅ — technical architecture, data flow, file changes, testing strategy, threat matrix
- `tasks.md` ✅ — 23 implementation tasks across 4 phases, all checked complete
- `verify-report.md` ✅ — verification evidence, requirement-by-requirement analysis, test results
- `exploration.md` ✅ — supporting research (unchanged from change folder)

## Source of Truth

The main spec repository now contains the authoritative specification:
- `openspec/specs/proveedores-ui/spec.md` — the promoted delta spec, canonical source for this capability going forward

## PR Trail

Implementation merged across six pull requests to `main`:

1. **PR #141** — Data layer (queries, hooks, mutations, schemas, error messages)
2. **PR #142** — Presentational components (table, form, detail panel)
3. **PR #143** — Route wiring (route file, navigation, route tree registration)
4. **PR #144** — Create-trigger placement fix (verify WARNING resolved)
5. **PR #145** — ProveedorForm defaultValues reset (post-verify bugfix)
6. **PR #146** — Master-pane CSS grid overflow (post-verify bugfix)

All merged to `main`, current HEAD: fa45b9b.

## Known Limitations (Ratified)

Per design.md's Ratified Open Questions:

1. **100-supplier ceiling**: The unpaginated `pageSize=100` fetch will silently truncate beyond 100 suppliers. This is an accepted v1 limitation (PD-1's own rationale: "this shop's supplier catalog won't realistically reach 100 for years"). Revisit only if it becomes real.
2. **Non-UUID junk normalization**: Malformed `?selected=` parameters (non-UUID) normalize to "nothing selected" (per Zod schema `.catch(undefined)`), not a distinct "not found" state. This is by design (D1): malformed junk is almost always a hand-typed bad link, not a "it existed and got deleted" case needing user explanation.

## SDD Cycle Complete

The change has been fully planned, implemented, verified, and archived. Ready for the next backlog item.

## Observation IDs (Engram Traceability)

For hybrid-mode artifact tracking:

- Proposal: (searched at archive time if Engram record exists)
- Spec: (searched at archive time if Engram record exists)
- Design: (searched at archive time if Engram record exists)
- Tasks: (searched at archive time if Engram record exists)
- Verify-Report: (searched at archive time if Engram record exists)
- Archive-Report: (this observation, persisted to Engram topic `sdd/proveedores-maestro-detalle/archive-report`)

Note: Observation IDs from earlier phases were not carried in the change artifacts (openspec-only until this archive). The archive-report itself is the final Engram record for this cycle.
