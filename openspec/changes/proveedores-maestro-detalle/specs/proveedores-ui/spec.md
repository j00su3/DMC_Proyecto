# proveedores-ui Specification

## Purpose

The proveedores master-detail screen: an unpaginated, client-filterable supplier list paired
with a detail pane for viewing, creating, editing, deactivating, and reactivating suppliers,
with per-component role gating for `deposito`. New capability (greenfield, no prior UI spec) —
`supplier-management` covers only the backend and is untouched by this change.

## Non-Goals

- No backend/API contract change of any kind — no new `q` param, no new endpoint, no
  pagination shape change on `GET /api/proveedores` (PD-1).
- No server-side or fuzzy search — filtering is a client-side substring match over the
  already-fetched full list.
- No bulk actions (multi-select deactivate/reactivate, bulk edit).
- No pagination of the master list for v1 (PD-1).
- No mobile-responsive layout (explicit punt, `docs/design.md:95`).

## Requirements

### Requirement: Master List Shows The Full Supplier Catalog (PD-1)
The master pane MUST fetch and display every proveedor — active and inactive — in a single
unpaginated request, with no `page`/`pageSize` control offered to the user.

#### Scenario: Full catalog renders in one request
- GIVEN the proveedores screen is opened
- WHEN the master list loads
- THEN every proveedor (active and inactive) is present in the list, with no pagination
  control shown

### Requirement: Client-Side Text Filter Over The Loaded List
The master pane MUST offer a text input that filters the already-loaded list by substring
match, entirely client-side, with no request sent to the server as the user types.

#### Scenario: Filter narrows the visible rows without a new request
- GIVEN the full proveedor list has loaded
- WHEN the user types a substring matching one supplier's name
- THEN only matching rows remain visible, with no additional network request triggered

#### Scenario: Filter matching nothing shows an empty-result state
- GIVEN the full proveedor list has loaded
- WHEN the user types a substring matching no supplier
- THEN the list shows an empty-result state, distinct from the loading and error states

### Requirement: Selecting A Proveedor Shows Its Detail
Selecting a row in the master pane MUST render that proveedor's `nombre`, `contacto`,
`activo`, and `creadoEn` in the detail pane.

#### Scenario: Selecting a row shows its fields
- GIVEN the master list is loaded
- WHEN a proveedor row is selected
- THEN the detail pane shows that proveedor's nombre, contacto, activo, and creadoEn

### Requirement: The URL Reflects The Selected Proveedor
The screen's URL MUST reflect which proveedor, if any, is currently selected, such that
copying the URL and opening it in a new session reopens the same selection. The mechanism
(search param vs. nested route) is a design decision, not specified here.

#### Scenario: A bookmarked URL reopens the same selection
- GIVEN a proveedor is selected and its URL is copied
- WHEN that URL is opened in a new session
- THEN the same proveedor's detail is shown, with no extra step required

#### Scenario: No selection is reflected by the absence of a selection indicator in the URL
- GIVEN no proveedor is selected
- WHEN the URL is inspected
- THEN it carries no selected-supplier indicator

### Requirement: A Non-Resolving Selection Shows A Distinct Not-Found State (PD-2)
A selected id that is malformed or does not resolve to any proveedor MUST render a distinct,
visible not-found state in the detail pane. This state MUST NOT be the same visual state used
when nothing is selected.

#### Scenario: Malformed or unknown id shows not-found
- GIVEN a URL carries a selection indicator for an id that does not resolve to any proveedor
- WHEN the screen loads
- THEN the detail pane shows a distinct "not found" message, not the empty/nothing-selected
  placeholder

#### Scenario: Nothing selected shows the empty placeholder, not not-found
- GIVEN no selection indicator is present in the URL
- WHEN the screen loads
- THEN the detail pane shows the empty/nothing-selected placeholder, not the not-found message

### Requirement: Deposito Gets A Fully Read-Only Detail Pane (PD-3)
When the session's `rol` is `deposito`, the detail pane MUST render every field as
display-only (no editable inputs) and every write affordance (edit, deactivate/reactivate,
create-new) MUST be hidden or disabled with a visible reason. The server's role check remains
the actual authorization boundary; this is a UX affordance only.

#### Scenario: Deposito sees display-only fields
- GIVEN a session with rol = deposito
- WHEN a proveedor's detail is shown
- THEN all fields render as display-only, with no editable input present

#### Scenario: Deposito sees write controls hidden or disabled with a reason
- GIVEN a session with rol = deposito
- WHEN the detail pane renders
- THEN edit, deactivate/reactivate, and create-new controls are each hidden or disabled, and
  any disabled control shows a visible reason

### Requirement: Encargado Can Create, Edit, Deactivate, And Reactivate
When the session's `rol` is `encargado`, the detail pane MUST offer working controls to edit
an existing proveedor's fields and to toggle `activo` (deactivate when active, reactivate when
inactive).

#### Scenario: Encargado edits an existing proveedor
- GIVEN a session with rol = encargado and a selected proveedor
- WHEN the encargado submits an edit to nombre or contacto
- THEN the detail pane reflects the updated values

#### Scenario: Encargado toggles activo
- GIVEN a session with rol = encargado and a selected active proveedor
- WHEN the encargado triggers the deactivate action
- THEN the proveedor's activo becomes false and the same control now offers reactivate

### Requirement: Deactivate/Reactivate Is A Single-Button Action (PD-4)
Triggering deactivate or reactivate MUST require exactly one user action (a single button
click) with no confirmation modal or additional typed-field gate.

#### Scenario: One click completes the action
- GIVEN a session with rol = encargado and a selected proveedor
- WHEN the encargado clicks the deactivate (or reactivate) button
- THEN the action completes with no intervening modal or confirmation step

### Requirement: Creating A New Proveedor Happens Inside This Screen (PD-5)
The master pane MUST offer a "Crear proveedor nuevo" action, visible only to `encargado`
sessions, that opens a create form inside this same screen's detail pane — not a separate
route.

#### Scenario: Encargado creates a proveedor without leaving the screen
- GIVEN a session with rol = encargado
- WHEN "Crear proveedor nuevo" is triggered and the form is submitted with valid data
- THEN the new proveedor appears in the master list and is shown selected, with no full-page
  navigation

#### Scenario: Deposito does not see the create action
- GIVEN a session with rol = deposito
- WHEN the master pane renders
- THEN no "Crear proveedor nuevo" action is present

## Open Questions (not resolved by this spec — flagged for design)

1. **Route mechanism for URL-reflects-selection** — single route with a search param vs. two
   nested routes rendered into a shared slot. Proposal defers this explicitly; this spec states
   only the product-level URL/selection contract.
2. **Push vs. replace history semantics** for selection changes — no codebase precedent
   favors either; left to design.
