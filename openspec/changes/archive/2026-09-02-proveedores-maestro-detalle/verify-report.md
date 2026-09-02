# Verify Report: proveedores-maestro-detalle (backlog #4.1)

- Verified revision: `3e055d1` (main, merge of PR #143; PR1 `4158f3b`, PR2 `2fa81f5`, PR3 `e0b61f5`)
- Verified at: 2026-09-01
- Verdict: PASS with WARNING (no CRITICAL findings; one interpretation deviation flagged as WARNING)

## Envelope (gentle-ai.verify-result/v1)

```json
{
  "contract": "gentle-ai.verify-result/v1",
  "change": "proveedores-maestro-detalle",
  "revision": "3e055d1",
  "verdict": "pass_with_warnings",
  "requirements": { "total": 9, "verified": 9, "failed": 0 },
  "scenarios": { "total": 15, "verified": 15, "failed": 0 },
  "tasks": { "total": 23, "checked": 23, "mismatched": 0 },
  "commands": [
    { "cmd": "pnpm --filter web test -- --run", "exit_code": 0, "summary": "75 files / 488 tests passed" },
    { "cmd": "pnpm typecheck", "exit_code": 0, "summary": "apps/api and apps/web both clean" },
    { "cmd": "pnpm lint", "exit_code": 0, "summary": "biome ci . -- 323 files, 0 errors" },
    { "cmd": "pnpm contract:check", "exit_code": 0, "summary": "no-op, openapi.json + schema.d.ts byte-identical" }
  ],
  "findings": { "critical": 0, "warning": 1, "suggestion": 1 }
}
```

## Requirement-by-requirement verification

All 9 requirements / 15 scenarios in specs/proveedores-ui/spec.md were checked against the
actual source on main (not against prior agent claims):

| # | Requirement | Scenarios | Status | Evidence |
|---|---|---|---|---|
| 1 | Master List Shows The Full Supplier Catalog (PD-1) | 1 | PASS | queries.ts:35 fetches /proveedores?page=1&pageSize=100 once; ProveedoresTable.tsx renders all rows, no pagination control |
| 2 | Client-Side Text Filter Over The Loaded List | 2 | PASS | ProveedoresTable.tsx:36-43 matchesFilter (nombre+contacto, case-insensitive, null-safe); empty-result state at line 97-98, distinct from loading/error |
| 3 | Selecting A Proveedor Shows Its Detail | 1 | PASS (was the flagged gap, now fixed) | ProveedorDetallePanel.tsx:14-17 type includes creadoEn; line 90 renders the Creado paragraph; ProveedorDetallePanel.test.tsx:97-108 asserts it renders |
| 4 | The URL Reflects The Selected Proveedor | 2 | PASS | proveedores.tsx:28-30 Zod ?selected= schema; route test :129-139 (deep link resolves) and :158-167 (no selection shows placeholder) |
| 5 | A Non-Resolving Selection Shows A Distinct Not-Found State (PD-2) | 2 | PASS | proveedores.tsx:80-84,148-149 showNotFound renders a route-owned paragraph distinct from the placeholder; route test :141-156 |
| 6 | Deposito Gets A Fully Read-Only Detail Pane (PD-3) | 2 | PASS | ProveedorDetallePanel.tsx:95 readonly gate, 0 textboxes; disabled estado button with lock reason; create trigger hidden for deposito |
| 7 | Encargado Can Create, Edit, Deactivate, And Reactivate | 2 | PASS | ProveedorForm edit-mode submit test; useActualizarProveedor/useEstadoProveedor hook tests; ProveedorDetallePanel.test.tsx:28-70 single-button toggle |
| 8 | Deactivate/Reactivate Is A Single-Button Action (PD-4) | 1 | PASS | ProveedorDetallePanel.tsx:100-119 renders exactly one button, no modal |
| 9 | Creating A New Proveedor Happens Inside This Screen (PD-5) | 2 | PASS, with a placement caveat (see WARNING below) | proveedores.tsx isCreating local state, no navigation; route test :182-201 create then new row selected; deposito never sees the trigger |

## Design decisions checked

- D1 (single route, ?selected=): confirmed, routeTree.ts:29-46 registers proveedoresRoute
  under shellLayout.addChildren([...]), before encargadoLayout.addChildren([...]) -- never
  inside it.
- D2 (replace: true on selection): confirmed, proveedores.tsx:88,101 both use
  navigate({ search, replace: true }).
- D3 (detail derived from list, no useProveedor(id)): confirmed -- no second fetch;
  proveedores.tsx:63-77 finds the record in the already-loaded list.
- D4 (filter is component useState, not a search param): confirmed, ProveedoresTable.tsx:84.
- D5 (RBAC shape): confirmed, isDeposito gate matches productosDetalle.tsx precedent; zero
  editable inputs for deposito via readonly dl mode, not per-field disabled.
- D6 (create is local isCreating state, not a ?selected=nuevo sentinel): confirmed.
- Ratified Open Questions (100-supplier ceiling; non-uuid junk equals nothing selected): both
  binding per design.md, not re-flagged here -- implementation matches the ratified schema
  and the fixed pageSize=100 ceiling.
- ProveedorSelector.tsx / useProveedoresActivos.ts confirmed byte-unchanged since before PR1
  (git diff 4158f3b^ HEAD on those two files is empty) -- task 3.7's explicit requirement.

## Focused verification of the two flagged risk areas

### 1. PR3's claimed fix for missing creadoEn in ProveedorDetallePanel

Confirmed fixed, read directly from current source:
- ProveedorDetallePanel.tsx:14-17 -- ProveedorDetalle type now includes creadoEn: string
  (previously ProveedorFormValues and activo only, per PR2's own gap).
- ProveedorDetallePanel.tsx:90 -- renders the "Creado: {proveedor.creadoEn}" paragraph
  unconditionally whenever a proveedor is shown (both encargado and deposito paths use the
  same JSX branch).
- ProveedorDetallePanel.test.tsx:91-108 -- dedicated RED-then-GREEN test asserting the exact
  text for an encargado session; no separate deposito-path test exists but the render branch
  is unconditional on role, so the same line executes for deposito too.
- proveedores.tsx:71-77 -- the route passes creadoEn through to the panel, so the field
  survives the DTO-to-form-values conversion.

The requirement ("Selecting A Proveedor Shows Its Detail" -- nombre, contacto, activo,
creadoEn) is now fully satisfied. PASS, verified by reading the cited lines directly, not by
trusting the prior agent's report.

### 2. "Crear proveedor nuevo" trigger placement

Verified as functionally satisfying the tested route-level scenarios, but with a real
deviation from the requirement's literal wording, rated WARNING (not CRITICAL).

The spec requirement states the master pane MUST offer a "Crear proveedor nuevo" action that
opens a create form inside this same screen's detail pane. Read literally, the trigger
belongs in the master (list/table) pane; only the resulting form belongs in the detail pane.

The actual implementation (ProveedorDetallePanel.tsx:73-84) places both the trigger and the
form inside the detail pane -- specifically inside the detail pane's own empty/placeholder
state (rendered only when proveedor is null and isCreating is false). ProveedoresTable.tsx
(the actual master pane) contains no create trigger at all.

This passes every scenario actually written into proveedores.test.tsx and
ProveedorDetallePanel.test.tsx:
- Encargado, nothing selected: button visible, click opens create form, submit selects the
  new row, no full navigation (route test :182-201). PASS.
- Deposito: button never visible, checked both from the placeholder
  (ProveedorDetallePanel.test.tsx:128-134) and with a supplier selected (route test
  :169-180). PASS.

However, a corollary the spec doesn't explicitly test but the requirement's plain reading
implies -- that the action stays offered, not only when nothing is selected -- is not fully
met: because the trigger only renders in the detail pane's placeholder branch, an encargado
who already has any supplier selected (?selected=<uuid> in the URL) has no visible way to
start a create action. ProveedoresTable.tsx has no deselect control, and the detail-shown
branch of ProveedorDetallePanel.tsx (lines 86-127) offers no "back to list" or "create new"
affordance either. The only path back to the placeholder is a fresh navigation to
/proveedores with no ?selected (e.g. clicking the AppShell nav link again, or manually
editing the URL) -- not something the screen itself surfaces once a row is selected.

This is a genuine interpretation gap, not a fabricated one: it does not fail any written
scenario, and design.md is silent on trigger placement (D6 only specifies pane precedence,
not the master-vs-detail location of the trigger itself), so it is not a spec contradiction
either. It is downgraded from CRITICAL to WARNING because every written scenario passes, the
underlying create/edit/toggle machinery is proven correct, and the workaround (revisit
/proveedores with no search param) is one click away via the nav item. It should still be
resolved -- either by moving the trigger into ProveedoresTable.tsx's always-rendered master
pane, or by adding an explicit deselect/new control reachable from the detail-shown state --
before this UX gap surprises a real encargado mid-session.

## Findings

- CRITICAL: none.
- WARNING: "Crear proveedor nuevo" trigger is reachable only from the detail pane's
  nothing-selected placeholder, not from the master (table) pane, and is unreachable once any
  supplier is selected without a full navigation away from the screen. See analysis above.
- SUGGESTION: the design.md Open Question left unresolved (filter label copy -- "the wording
  is product's") remains genuinely open. "Buscar por nombre o contacto" was implemented as-is
  without an explicit product sign-off recorded anywhere in the tracked artifacts.
  Non-blocking; flag for product review at archive time if not already accepted.

## Tasks vs code state

tasks.md: 23/23 checked (checked-count 23, unchecked-count 0). Each phase's GREEN tasks were
spot-checked against the corresponding file's actual presence and content (Phase 1
hooks/queries, Phase 2 components, Phase 3 route/routeTree/AppShell, Phase 4 lint-clean plus
docs/BACKLOG.md #4.1 entry present, dated 2026-09-01). No mismatch found between a checked
task and the code it claims.

## Commands run (this verify pass, fresh -- not reused from apply-progress)

    pnpm --filter web test -- --run   -> 75 files / 488 tests passed, exit 0
    pnpm typecheck                    -> apps/api + apps/web clean, exit 0
    pnpm lint                         -> biome ci ., 323 files, 0 errors, exit 0
    pnpm contract:check               -> no-op (openapi.json + schema.d.ts unchanged), exit 0

## Recommendation

Ready for sdd-archive once the WARNING (create-trigger placement/reachability) is either
accepted as a known v1 limitation by the owner (same ratification pattern already used for
the two Open Questions in design.md) or fixed. It is not a CRITICAL blocker on its own reading
of the record -- no written scenario fails -- but it is a real, evidence-backed deviation from
the requirement's literal text and should get the same explicit ratification the other two
Open Questions received, not a silent pass.
