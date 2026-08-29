# productos-ui Specification

## Purpose

Frontend screens (list with search, create/edit form, deactivate/reactivate) consuming
`product-management`'s backend routes as-is, mounted under `shellLayout` (not
`encargadoLayout`, since `deposito` reads and mostly writes products too). Every role/field
lock in this capability is a UX affordance; the backend's 403 responses
(`FORBIDDEN`, `FIELD_RESERVED_FOR_ENCARGADO`) are the actual authorization boundary. No
movement-registration UI (entrada/salida/ajuste modal) ships here — the only stock-affecting
control is the create-time initial-stock field, which produces the `ajuste` movement
described in `product-management`. The ≤3-step movement modal is backlog #6. New capability
(greenfield, no prior spec).

## Requirements

### Requirement: Product List Is Open To Both Roles Under shellLayout
The product list route (registered as `/inventario` via the existing `NAV_ITEMS` entry) MUST
mount under `shellLayout`, not `encargadoLayout`, and MUST render for both `encargado` and
`deposito` sessions without a route redirect.

#### Scenario: Deposito reaches the product list without redirect
- GIVEN an authenticated session with `rol = deposito`
- WHEN the user navigates to `/inventario`
- THEN the screen renders the product list, with no route guard redirecting it away

### Requirement: List With Pagination, Search, And Derived Status Chips
The list MUST render `GET /api/productos`'s `{ data, page, pageSize, total }` with pagination
controls and a search input bound to `?q`. Each row MUST show a client-derived status chip
computed only from `stock_actual`/`stock_minimo` already on the DTO — never a server-computed
field: `quiebre` when `stock_actual <= 0`; `bajo` when `stock_minimo` is set and
`0 < stock_actual <= stock_minimo`; no chip when `stock_minimo` is `null`, regardless of
`stock_actual`.

#### Scenario: Search input filters the list
- GIVEN products exist matching and not matching a search term
- WHEN the user types into the search input
- THEN the list request includes `?q=<term>` and only matching rows render

#### Scenario: A product without stock_minimo shows no chip
- GIVEN a product has `stock_minimo = null` and `stock_actual = 0`
- WHEN its row renders
- THEN no `quiebre`/`bajo` chip is shown, since no threshold triggers a false alert

#### Scenario: A product at or below its threshold shows the bajo chip
- GIVEN a product has `stock_minimo = 10` and `stock_actual = 8`
- WHEN its row renders
- THEN the `bajo` chip is shown

### Requirement: Create/Edit Form With Role-Gated stock_minimo And Create-Only Initial Stock
The create/edit form (`react-hook-form` + Zod resolver) MUST render `stock_minimo` disabled
with a 🔒 indicator for `deposito` sessions — present, not hidden, per the same visible-locks
convention as `usuarios-ui` — and enabled for `encargado`. The initial-stock field MUST appear
only on create, never on edit. The supplier selector MUST offer only active suppliers.

#### Scenario: Deposito sees stock_minimo locked, not absent
- GIVEN a `deposito` session opens the create or edit form
- WHEN the form renders
- THEN the `stock_minimo` field is visible, disabled, and carries a 🔒 indicator

#### Scenario: Initial stock is create-only
- GIVEN the edit form opens for an existing product
- WHEN its fields are inspected
- THEN no initial-stock input is present

#### Scenario: Supplier selector excludes inactive suppliers
- GIVEN some suppliers are `activo = false`
- WHEN the create/edit form's supplier selector is inspected
- THEN only active suppliers are offered as choices

### Requirement: Deactivate/Reactivate Controls, Encargado-Only, Visible-Locked For Deposito
Each row MUST offer a deactivate action (active products) or reactivate action (inactive
products), calling the respective route and updating the row's chip from the response without
a full reload. For `deposito` sessions, the control MUST render visible and disabled with a
🔒 indicator, never absent, since the server 403 — not this control — is the real boundary.

#### Scenario: Encargado deactivates without a page reload
- GIVEN an `encargado` session views an active product's row
- WHEN the deactivate action is triggered and the server returns `200`
- THEN the row's status updates to inactive without a page reload

#### Scenario: Deposito sees the control locked, not absent
- GIVEN a `deposito` session views any product's row
- WHEN the deactivate/reactivate control is inspected
- THEN it is visible, disabled, and carries a 🔒 indicator

### Requirement: Error Surfacing By Code
The screen MUST render a distinct, user-facing message for each of `PRODUCT_NOT_FOUND`,
`SKU_ALREADY_IN_USE`, `FIELD_RESERVED_FOR_ENCARGADO`, `SUPPLIER_INACTIVE`,
`VALIDATION_ERROR`, and `FORBIDDEN`, keyed off `ApiError.code`, following the
`errorMessages.ts` convention.

#### Scenario: Each code maps to a distinct message
- GIVEN a fetch or mutation throws an `ApiError` with one of the six listed codes
- WHEN the screen renders the resulting error
- THEN the displayed message matches that code's mapped copy, not a generic fallback
